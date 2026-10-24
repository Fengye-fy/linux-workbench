import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  Client,
  utils,
  type AnyAuthMethod,
  type AuthenticationType,
  type ClientChannel,
  type NextAuthHandler
} from 'ssh2'
import type { DirEntry, HostInfo, HostStatus, SshHostConfig } from '../../shared/types'
import { checkHostKey, fingerprint, formatKnownHost, hostPattern, keyTypeOf, parseKnownHosts } from './known-hosts'
import { homeScript, listDirScript, parseListing, PidMarkerFilter, shellLaunchScript } from './scripts'
import {
  Emitter,
  NotConnectedError,
  testPathPrefix,
  type ExecResult,
  type Host,
  type ShellHandle,
  type ShellOptions
} from './types'

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m\r\n`
const red = (s: string): string => `\x1b[31m${s}\x1b[0m\r\n`

/** 用户在登录提示上按了 Ctrl+C */
class Cancelled extends Error {}

/** 加密保存的服务器密码，由注册表从 secrets.ts 传进来 */
export interface PasswordStore {
  get(hostId: string): string | null
  has(hostId: string): boolean
  set(hostId: string, password: string): Promise<boolean>
}

interface Attempt {
  reason: Error | null
  password: string | null
}

/**
 * SSH 终端。登录阶段还没有远程 shell，由它自己在终端里显示提示、收集输入
 * （密码不回显），登录成功后再接到远程 shell 的通道上。
 */
class SshShell implements ShellHandle {
  pid: number | null = null
  ready = false
  cols: number
  rows: number
  /** 断线或连接失败后按回车重连 */
  reconnect: () => void = () => {}
  private channel: ClientChannel | null = null
  private input: { echo: boolean; buf: string; resolve: (v: string | null) => void } | null = null
  /**
   * 登录成功、远程 shell 还没开出来的这几百毫秒里敲的字，先存着，开出来后补发。
   * 只在登录成功后才存：登录前提前敲的（可能是密码）不能落进 shell。
   */
  private typeahead: string | null = null
  private data = new Emitter<string>()
  private exit = new Emitter<number>()
  private filter = new PidMarkerFilter((pid) => (this.pid = pid))
  private killed = false
  private ended = false

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  print(text: string): void {
    this.data.emit(text)
  }

  /** 在终端里问一个问题；Ctrl+C 返回 null */
  prompt(question: string, echo: boolean): Promise<string | null> {
    this.print(question)
    return new Promise((resolve) => (this.input = { echo, buf: '', resolve }))
  }

  /** 登录成功，接下来开远程 shell */
  expectShell(): void {
    this.typeahead = ''
  }

  attach(ch: ClientChannel): void {
    if (this.killed) {
      ch.close()
      return
    }
    this.channel = ch
    if (this.typeahead) ch.write(this.typeahead)
    this.typeahead = null
    this.ready = true
    this.pid = null
    this.filter = new PidMarkerFilter((pid) => (this.pid = pid))
    const decoder = new StringDecoder('utf8')
    let exitCode: number | null = null
    ch.on('data', (d: Buffer) => {
      const out = this.filter.push(decoder.write(d))
      if (out) this.print(out)
    })
    ch.stderr.on('data', (d: Buffer) => this.print(d.toString('utf8')))
    ch.on('exit', (code: number | null) => (exitCode = code ?? 0))
    ch.on('close', () => {
      this.channel = null
      this.ready = false
      const rest = this.filter.flush()
      if (rest) this.print(rest)
      // 远程 shell 自己退出（exit）就关掉窗格；没有退出码说明是连接断了
      if (exitCode !== null || this.killed) this.end(exitCode ?? 0)
      else this.offerRetry('连接已断开')
    })
  }

  /** 连接失败或断开：提示按回车重连，Ctrl+C 关闭 */
  async offerRetry(reason: string): Promise<void> {
    this.typeahead = null
    if (this.killed) return this.end(255)
    this.print(red(`\r\n${reason}`))
    const ans = await this.prompt(dim('按回车重新连接，Ctrl+C 关闭').trimEnd(), false)
    if (ans === null || this.killed) this.end(255)
    else this.reconnect()
  }

  write(data: string): void {
    if (this.channel) {
      this.channel.write(data)
      return
    }
    const p = this.input
    if (!p && this.typeahead !== null) {
      this.typeahead = (this.typeahead + data).slice(-4096)
      return
    }
    if (!p || data.startsWith('\x1b')) return
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        this.input = null
        this.print('\r\n')
        p.resolve(p.buf)
        return
      }
      if (ch === '\x03') {
        this.input = null
        this.print('^C\r\n')
        p.resolve(null)
        return
      }
      if (ch === '\x7f' || ch === '\b') {
        if (p.buf) {
          p.buf = [...p.buf].slice(0, -1).join('')
          if (p.echo) this.print('\b \b')
        }
      } else if (ch === '\x15') {
        p.buf = ''
      } else if (ch >= ' ') {
        p.buf += ch
        if (p.echo) this.print(ch)
      }
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.channel?.setWindow(rows, cols, 0, 0)
  }

  kill(): void {
    this.killed = true
    if (this.channel) {
      this.channel.close()
      return
    }
    const p = this.input
    this.input = null
    p?.resolve(null)
    this.end(255)
  }

  onData(cb: (data: string) => void): void {
    this.data.on(cb)
  }
  onExit(cb: (code: number) => void): void {
    this.exit.on(cb)
  }

  private end(code: number): void {
    if (this.ended) return
    this.ended = true
    this.exit.emit(code)
  }
}

/** Windows 自带 OpenSSH 的 ssh-agent 服务；Linux 上看 SSH_AUTH_SOCK */
function agentPath(): string | undefined {
  if (process.platform === 'win32') {
    const pipe = '\\\\.\\pipe\\openssh-ssh-agent'
    return existsSync(pipe) ? pipe : undefined
  }
  return process.env.SSH_AUTH_SOCK || undefined
}

function keyFiles(keyPath?: string): string[] {
  if (keyPath) return existsSync(keyPath) ? [keyPath] : []
  return ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => join(homedir(), '.ssh', f)).filter((f) => existsSync(f))
}

const readText = (file: string): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export class SshHost implements Host {
  private conn: Client | null = null
  private connecting: Promise<Client> | null = null
  private status: HostStatus = 'disconnected'
  private homeDir: Promise<string> | null = null

  readonly flavor = 'posix'

  /**
   * knownHostsFile：应用自己的 known_hosts，确认过的新主机写在这里，不改用户的 ~/.ssh/known_hosts
   * passwords：加密保存的密码（见 secrets.ts），勾了"记住密码"才会写
   */
  constructor(
    readonly config: SshHostConfig,
    private knownHostsFile: string,
    private passwords: PasswordStore,
    private onStatus: (status: HostStatus) => void
  ) {}

  info(): HostInfo {
    const { id, name, username, host, port } = this.config
    return {
      id,
      kind: 'ssh',
      name,
      detail: `${username}@${host}${port === 22 ? '' : `:${port}`}`,
      status: this.status,
      savedPassword: this.passwords.has(id)
    }
  }

  openShell({ cols, rows, cwd, agent, agentArgs }: ShellOptions): ShellHandle {
    const shell = new SshShell(cols, rows)
    const start = async (): Promise<void> => {
      try {
        const conn = await this.connect(shell)
        shell.expectShell()
        conn.exec(
          shellLaunchScript({ cwd, agent, agentArgs, pathPrefix: testPathPrefix() }),
          { pty: { term: 'xterm-256color', cols: shell.cols, rows: shell.rows } },
          (err, ch) => (err ? void shell.offerRetry(`打开终端失败：${err.message}`) : shell.attach(ch))
        )
      } catch (e) {
        await shell.offerRetry(e instanceof Cancelled ? '已取消登录' : `连接失败：${(e as Error).message}`)
      }
    }
    shell.reconnect = () => void start()
    // 等调用方挂好 onData 再开始输出提示
    setImmediate(() => void start())
    return shell
  }

  exec(script: string): Promise<ExecResult> {
    const conn = this.conn
    if (!conn) return Promise.reject(new NotConnectedError())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('命令超时')), 15000)
      conn.exec(script, (err, ch) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }
        const chunks: Buffer[] = []
        let code = 1
        ch.on('data', (d: Buffer) => chunks.push(d))
        ch.stderr.resume()
        ch.on('exit', (c: number | null) => (code = c ?? 1))
        ch.on('close', () => {
          clearTimeout(timer)
          resolve({ stdout: Buffer.concat(chunks).toString('utf8'), code })
        })
        ch.end()
      })
    })
  }

  async listDir(dir: string): Promise<DirEntry[]> {
    const { stdout, code } = await this.exec(listDirScript(dir))
    if (code !== 0) throw new Error(`无法读取 ${dir}`)
    return parseListing(dir, stdout)
  }

  home(): Promise<string> {
    if (!this.conn) return Promise.reject(new NotConnectedError())
    this.homeDir ??= this.exec(homeScript).then((r) => r.stdout || '/')
    return this.homeDir
  }

  dispose(): void {
    this.conn?.end()
    this.conn = null
  }

  private setStatus(status: HostStatus): void {
    this.status = status
    this.onStatus(status)
  }

  private connect(shell: SshShell): Promise<Client> {
    if (this.conn) return Promise.resolve(this.conn)
    if (this.connecting) {
      shell.print(dim('等待另一个终端完成登录…'))
      return this.connecting
    }
    const { host, port, username } = this.config
    shell.print(dim(`正在连接 ${username}@${host}${port === 22 ? '' : `:${port}`} …`))
    this.setStatus('connecting')
    const conn = new Client()
    // 主机校验和认证里发生的事：失败时给用户看哪句话；成功时最后用的是哪个密码（要不要记住）
    const why: Attempt = { reason: null, password: null }
    this.connecting = new Promise<Client>((resolve, reject) => {
      let settled = false
      const fail = (e: Error): void => {
        if (settled) return
        settled = true
        this.connecting = null
        this.setStatus('disconnected')
        reject(e)
      }
      conn.on('ready', () => {
        settled = true
        this.conn = conn
        this.connecting = null
        const { id, savePassword } = this.config
        if (savePassword && why.password && why.password !== this.passwords.get(id)) {
          void this.passwords.set(id, why.password).then((ok) => {
            if (!ok) shell.print(dim('这台电脑不支持加密保存，密码没有记住'))
          })
        }
        this.setStatus('connected')
        resolve(conn)
      })
      conn.on('error', (e) =>
        fail(why.reason ?? (e.message.includes('authentication methods failed') ? new Error('认证失败') : e))
      )
      conn.on('close', () => {
        if (this.conn === conn) {
          this.conn = null
          this.homeDir = null
          this.setStatus('disconnected')
        } else {
          fail(new Error('连接被关闭'))
        }
      })
      conn.connect({
        host,
        port,
        username,
        readyTimeout: 30000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 4,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
          this.verifyHostKey(key, shell).then(
            (ok) => {
              if (!ok) why.reason = new Error('主机身份没有确认，已断开')
              verify(ok)
            },
            (e) => {
              why.reason = e
              verify(false)
            }
          )
        },
        authHandler: this.authHandler(shell, why)
      })
    })
    return this.connecting
  }

  private async verifyHostKey(key: Buffer, shell: SshShell): Promise<boolean> {
    const { host, port } = this.config
    const keyType = keyTypeOf(key)
    const b64 = key.toString('base64')
    const entries = parseKnownHosts(
      readText(join(homedir(), '.ssh', 'known_hosts')) + '\n' + readText(this.knownHostsFile)
    )
    const status = checkHostKey(entries, host, port, keyType, b64)
    if (status === 'ok') return true
    if (status !== 'unknown') {
      shell.print(red(`警告：${hostPattern(host, port)} 的主机密钥和之前记录的不一致，可能有人在冒充这台服务器。`))
      shell.print(red(`如果确实是服务器重装了，删掉 known_hosts 里这台主机的旧记录后再连接。`))
      throw new Error('主机密钥不一致，已拒绝连接')
    }
    shell.print(`无法确认 ${hostPattern(host, port)} 的身份。\r\n${keyType} 指纹 ${fingerprint(key)}\r\n`)
    const ans = await shell.prompt('确认这是你的服务器，并记住它吗？(yes/no) ', true)
    if (ans === null) throw new Cancelled()
    if (!/^y(es)?$/i.test(ans.trim())) return false
    await mkdir(dirname(this.knownHostsFile), { recursive: true })
    await appendFile(this.knownHostsFile, formatKnownHost(host, port, keyType, b64))
    return true
  }

  /**
   * 认证顺序和 ssh 命令一样：agent → 私钥 → 键盘交互 / 密码（最多三次）。
   * 保存了密码时第一次直接用它，不对再在终端里问。
   */
  private authHandler(shell: SshShell, why: Attempt) {
    const { id, username, host, keyPath } = this.config
    const saved = this.passwords.get(id)
    type Step = (left: AuthenticationType[] | null) => Promise<AnyAuthMethod | null>
    const allows = (left: AuthenticationType[] | null, t: AuthenticationType): boolean => !left || left.includes(t)
    const ask = async (q: string, echo: boolean): Promise<string> => {
      const a = await shell.prompt(q, echo)
      if (a === null) throw new Cancelled()
      return a
    }
    const steps: Step[] = []

    const agent = agentPath()
    if (agent) steps.push(async (left) => (allows(left, 'publickey') ? { type: 'agent', username, agent } : null))

    for (const file of keyFiles(keyPath)) {
      steps.push(async (left) => {
        if (!allows(left, 'publickey')) return null
        const key = await readFile(file)
        const parsed = utils.parseKey(key)
        if (!(parsed instanceof Error)) return { type: 'publickey', username, key }
        if (!/passphrase/i.test(parsed.message)) return null
        return { type: 'publickey', username, key, passphrase: await ask(`私钥 ${file} 的口令：`, false) }
      })
    }

    // 实际试过几次密码（跳过的步骤不算），用来决定提示语和要不要用保存的密码
    let tries = 0
    for (let i = 0; i < 3; i++) {
      steps.push(async (left) => {
        const ki = !!left && left.includes('keyboard-interactive') && !left.includes('password')
        if (!ki && !allows(left, 'password')) return null
        const useSaved = tries === 0 && saved !== null
        if (tries === 1 && saved !== null) shell.print(red('保存的密码不对，请输入新密码'))
        else if (tries > 0) shell.print(red('密码不对，请重试'))
        if (useSaved) shell.print(dim('使用保存的密码登录…'))
        tries++

        if (ki) {
          return {
            type: 'keyboard-interactive',
            username,
            prompt: (_name, instructions, _lang, prompts, finish) => {
              ;(async () => {
                if (instructions) shell.print(instructions.replace(/\n/g, '\r\n') + '\r\n')
                const answers: string[] = []
                for (const p of prompts) {
                  // 不回显、问的是密码的那一项，才算密码（可以用保存的、也会被记住）；验证码之类照常问
                  const isPassword = !p.echo && /pass|密码/i.test(p.prompt)
                  const answer = isPassword && useSaved ? saved! : await ask(p.prompt, !!p.echo)
                  if (isPassword) why.password = answer
                  answers.push(answer)
                }
                finish(answers)
              })().catch(() => finish([]))
            }
          }
        }
        why.password = useSaved ? saved! : await ask(`${username}@${host} 的密码：`, false)
        return { type: 'password', username, password: why.password }
      })
    }

    return (left: AuthenticationType[] | null, _partial: boolean, next: NextAuthHandler): void => {
      // 传 false 表示没有别的办法了、放弃认证；ssh2 支持，但类型定义里没写
      const giveUp = (): void => (next as unknown as (v: false) => void)(false)
      ;(async () => {
        while (steps.length) {
          const auth = await steps.shift()!(left)
          if (auth) return next(auth)
        }
        giveUp()
      })().catch((e) => {
        steps.length = 0
        why.reason = e
        giveUp()
      })
    }
  }
}
