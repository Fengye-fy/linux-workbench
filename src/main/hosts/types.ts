import type { ShellFlavor } from '../../shared/shell'
import type { DirEntry, HostInfo } from '../../shared/types'

/** 主机上的一个交互终端 */
export interface ShellHandle {
  /** 主机上 shell 的 Linux pid，用来读 /proc；启动标记还没收到时为 null */
  readonly pid: number | null
  /** SSH 还在登录、没开出 shell 时为 false */
  readonly ready: boolean
  /**
   * 没有 /proc 的主机（Windows 本机）由 shell 自己跟踪当前目录和是否在跑命令：
   * 提示符里带当前目录，按回车到下一个提示符之间算忙
   */
  trackedCwd?(): string | null
  trackedBusy?(): boolean
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
}

export interface ShellOptions {
  cols: number
  rows: number
  cwd: string | null
  agent?: string
  agentArgs?: readonly string[]
}

export interface ExecResult {
  stdout: string
  code: number
}

/** 一台主机：Linux 本机、Windows 本机、WSL 发行版或 SSH 服务器 */
export interface Host {
  /** 终端里的 shell 类型，决定 cd 命令和路径引号怎么写 */
  readonly flavor: ShellFlavor
  info(): HostInfo
  openShell(opts: ShellOptions): ShellHandle
  /** 跑一段脚本（Linux 主机是 sh，Windows 本机是 PowerShell；stdin 是空的）；SSH 没连上时抛错 */
  exec(script: string): Promise<ExecResult>
  listDir(dir: string): Promise<DirEntry[]>
  home(): Promise<string>
  /** 查哪些 agent 命令可用，返回 命令名 → 路径；不实现就用 Linux 的 sh 脚本查 */
  detectAgents?(ids: readonly string[]): Promise<Map<string, string>>
  dispose(): void
}

export class NotConnectedError extends Error {
  constructor() {
    super('主机还没连接')
  }
}

/** 测试用：把假的 agent 命令放进 PATH 最前面 */
export const testPathPrefix = (): string | undefined => process.env.WORKBENCH_PATH_PREFIX || undefined

/** 把回调列表和事件源接起来的小工具 */
export class Emitter<T> {
  private cbs: ((v: T) => void)[] = []
  on(cb: (v: T) => void): void {
    this.cbs.push(cb)
  }
  emit(v: T): void {
    for (const cb of this.cbs) cb(v)
  }
}
