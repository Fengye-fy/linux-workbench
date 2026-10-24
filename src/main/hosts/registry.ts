import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { HostInfo, HostStatus, SshHostConfig, SshHostDraft } from '../../shared/types'
import { deletePassword, getPassword, hasPassword, setPassword } from '../secrets'
import { LocalHost } from './local'
import { SshHost, type PasswordStore } from './ssh'
import { parseSshConfig } from './ssh-config'
import type { Host } from './types'
import { WindowsHost } from './windows'
import { listWslDistros, WslHost } from './wsl'

const passwords: PasswordStore = { get: getPassword, has: hasPassword, set: setPassword }

/** 所有主机：WSL 发行版和 Windows 本机（Windows 上）、本机（Linux 上）、保存的 SSH 服务器 */
export class HostRegistry {
  private hosts = new Map<string, Host>()
  private file: string

  constructor(
    private dataDir: string,
    private onStatus: (id: string, status: HostStatus) => void
  ) {
    this.file = join(dataDir, 'hosts.json')
  }

  init(): void {
    if (process.platform === 'linux') this.add(new LocalHost())
    if (process.platform === 'win32') {
      for (const d of listWslDistros()) this.add(new WslHost(d.name))
      this.add(new WindowsHost())
    }
    for (const cfg of this.loadSsh()) this.add(this.makeSsh(cfg))
  }

  list(): HostInfo[] {
    return [...this.hosts.values()].map((h) => h.info())
  }

  get(id: string): Host {
    const host = this.hosts.get(id)
    if (!host) throw new Error(`没有这台主机：${id}`)
    return host
  }

  /** 默认打开第一台 Linux 主机（本机或默认 WSL 发行版），都没有再退到 Windows 本机 */
  defaultId(): string | null {
    const list = this.list()
    return (
      list.find((h) => h.kind === 'local' || h.kind === 'wsl')?.id ??
      list.find((h) => h.kind !== 'ssh')?.id ??
      list[0]?.id ??
      null
    )
  }

  sshConfig(id: string): SshHostConfig | null {
    const host = this.hosts.get(id)
    return host instanceof SshHost ? host.config : null
  }

  async saveSsh(draft: SshHostDraft): Promise<HostInfo> {
    const cfg: SshHostConfig = {
      id: draft.id ?? `ssh:${randomUUID().slice(0, 8)}`,
      name: draft.name.trim() || draft.host.trim(),
      host: draft.host.trim(),
      port: Math.trunc(Number(draft.port)) || 22,
      username: draft.username.trim(),
      keyPath: draft.keyPath?.trim() || undefined,
      savePassword: !!draft.savePassword
    }
    if (!cfg.host || !cfg.username) throw new Error('主机地址和用户名不能为空')
    if (cfg.port < 1 || cfg.port > 65535) throw new Error('端口要在 1 到 65535 之间')
    // 不再记住密码，就把已经存的删掉
    if (!cfg.savePassword) await deletePassword(cfg.id)
    // 改了配置就断开旧连接，下次开终端按新配置重连
    this.hosts.get(cfg.id)?.dispose()
    this.add(this.makeSsh(cfg))
    await this.persist()
    return this.get(cfg.id).info()
  }

  async remove(id: string): Promise<void> {
    const host = this.hosts.get(id)
    if (!(host instanceof SshHost)) return
    host.dispose()
    this.hosts.delete(id)
    await deletePassword(id)
    await this.persist()
  }

  forgetPassword(id: string): Promise<void> {
    return deletePassword(id)
  }

  /** ~/.ssh 下看着像私钥的文件（OpenSSH / PEM / PuTTY 格式） */
  keyCandidates(): string[] {
    const dir = join(homedir(), '.ssh')
    try {
      return readdirSync(dir)
        .filter((f) => !f.endsWith('.pub') && !/^(known_hosts|config|authorized_keys)/.test(f))
        .map((f) => join(dir, f))
        .filter((f) => {
          try {
            const head = readFileSync(f).subarray(0, 64).toString('utf8')
            return head.includes('PRIVATE KEY') || head.startsWith('PuTTY-User-Key-File')
          } catch {
            return false
          }
        })
    } catch {
      return []
    }
  }

  /** ~/.ssh/config 里还没添加过的主机 */
  sshConfigSuggestions(): SshHostDraft[] {
    let text = ''
    try {
      text = readFileSync(join(homedir(), '.ssh', 'config'), 'utf8')
    } catch {
      return []
    }
    const saved = this.list()
      .filter((h) => h.kind === 'ssh')
      .map((h) => this.sshConfig(h.id)!)
    return parseSshConfig(text, userInfo().username, homedir())
      .filter((e) => !saved.some((s) => s.host === e.host && s.username === e.username && s.port === e.port))
      .map((e) => ({ name: e.alias, host: e.host, port: e.port, username: e.username, keyPath: e.keyPath }))
  }

  disposeAll(): void {
    for (const h of this.hosts.values()) h.dispose()
  }

  private add(host: Host): void {
    this.hosts.set(host.info().id, host)
  }

  private makeSsh(cfg: SshHostConfig): SshHost {
    return new SshHost(cfg, join(this.dataDir, 'known_hosts'), passwords, (s) => this.onStatus(cfg.id, s))
  }

  private loadSsh(): SshHostConfig[] {
    try {
      const list = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  private async persist(): Promise<void> {
    const list = [...this.hosts.values()].filter((h): h is SshHost => h instanceof SshHost).map((h) => h.config)
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.file, JSON.stringify(list, null, 2))
  }
}
