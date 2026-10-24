import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ExecResult } from './types'

/**
 * 常驻的 sh 进程，按顺序执行发来的脚本。WSL 上每次起 wsl.exe 要两百多毫秒，
 * 常驻进程只要几毫秒，展开目录、刷新当前目录才跟手。
 * 协议：一行 "<编号> <base64 脚本>"，回 "脚本输出\n\x1e<编号> <退出码>\x1e\n"。
 */
const HELPER = `while IFS=' ' read -r id b64; do
  script=$(printf '%s' "$b64" | base64 -d)
  ( eval "$script" ) </dev/null 2>/dev/null
  printf '\\n\\036%s %s\\036\\n' "$id" "$?"
done`

const FRAME = /\n\x1e(\d+) (\d+)\x1e\n/

interface Pending {
  id: number
  resolve: (r: ExecResult) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class ExecHelper {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private queue: Pending[] = []
  private nextId = 1

  /** spawnArgs 收到 helper 脚本，返回要启动的命令行 */
  constructor(private spawnArgs: (script: string) => { file: string; args: string[]; env?: NodeJS.ProcessEnv }) {}

  exec(script: string, timeoutMs = 15000): Promise<ExecResult> {
    const proc = this.ensure()
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        // 超时说明 helper 卡住了，整个重启，排在后面的一起失败
        this.reset(new Error('命令超时'))
      }, timeoutMs)
      this.queue.push({ id, resolve, reject, timer })
      proc.stdin.write(`${id} ${Buffer.from(script).toString('base64')}\n`)
    })
  }

  dispose(): void {
    this.reset(new Error('已关闭'))
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const { file, args, env } = this.spawnArgs(HELPER)
    const proc = spawn(file, args, { env, windowsHide: true })
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => this.onData(d))
    proc.on('exit', () => {
      if (this.proc === proc) this.reset(new Error('辅助进程退出了'))
    })
    proc.on('error', (e) => {
      if (this.proc === proc) this.reset(e)
    })
    this.proc = proc
    return proc
  }

  private onData(d: string): void {
    this.buf += d
    let m: RegExpExecArray | null
    while ((m = FRAME.exec(this.buf))) {
      const out = this.buf.slice(0, m.index)
      this.buf = this.buf.slice(m.index + m[0].length)
      const p = this.queue.shift()
      if (!p) continue
      clearTimeout(p.timer)
      if (Number(m[1]) === p.id) p.resolve({ stdout: out, code: Number(m[2]) })
      else p.reject(new Error('辅助进程应答错位'))
    }
  }

  private reset(err: Error): void {
    const proc = this.proc
    this.proc = null
    this.buf = ''
    proc?.kill()
    for (const p of this.queue.splice(0)) {
      clearTimeout(p.timer)
      p.reject(err)
    }
  }
}
