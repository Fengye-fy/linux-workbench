import * as pty from 'node-pty'
import { PidMarkerFilter } from './scripts'
import { Emitter, type ShellHandle } from './types'

/** 本机和 WSL 共用：用 node-pty 起一个进程，从输出里截下 pid 标记 */
export class PtyShell implements ShellHandle {
  pid: number | null = null
  readonly ready = true
  private data = new Emitter<string>()
  private exit = new Emitter<number>()
  private proc: pty.IPty
  private filter: PidMarkerFilter

  /** dropBeforeMarker：pid 标记之前的输出不是 shell 打的，丢掉（见 PidMarkerFilter） */
  constructor(
    file: string,
    args: string[],
    opts: { cols: number; rows: number; env: Record<string, string | undefined>; dropBeforeMarker?: boolean }
  ) {
    this.filter = new PidMarkerFilter((pid) => (this.pid = pid), opts.dropBeforeMarker)
    this.proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
      // Windows 上用 node-pty 自带的新版 ConPTY：系统自带的那个要一秒多才报告进程退出
      useConptyDll: process.platform === 'win32'
    })
    this.proc.onData((d) => {
      const out = this.filter.push(d)
      if (out) this.data.emit(out)
    })
    this.proc.onExit(({ exitCode }) => {
      const rest = this.filter.flush()
      if (rest) this.data.emit(rest)
      this.exit.emit(exitCode)
    })
  }

  write(data: string): void {
    this.proc.write(data)
  }
  resize(cols: number, rows: number): void {
    this.proc.resize(cols, rows)
  }
  kill(): void {
    this.proc.kill()
  }
  onData(cb: (data: string) => void): void {
    this.data.on(cb)
  }
  onExit(cb: (code: number) => void): void {
    this.exit.on(cb)
  }
}
