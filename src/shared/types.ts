// 主进程、preload、渲染进程共用的类型
import type { AgentId } from './agents'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface AppEnv {
  /** 资源管理器初始根目录：命令行传入的目录，否则是 home */
  root: string
  home: string
  /** 终端使用的 shell 名称，如 bash、zsh */
  shell: string
}

export type CdResult =
  | { ok: true }
  | { ok: false; reason: 'busy'; process: string }
  | { ok: false; reason: 'gone' }

export interface PtyCreateOptions {
  cols: number
  rows: number
  cwd: string
  /** 设置后在登录 shell 里启动这个 agent，退出后留在 shell 里 */
  agent?: AgentId
}

export interface DetectedAgent {
  id: AgentId
  /** command -v 的结果：可执行文件路径，或 alias 定义 */
  path: string
}

export interface WorkbenchApi {
  env: () => Promise<AppEnv>
  listDir: (dir: string) => Promise<DirEntry[]>
  detectAgents: () => Promise<DetectedAgent[]>
  pty: {
    create: (opts: PtyCreateOptions) => Promise<number>
    write: (id: number, data: string) => void
    resize: (id: number, cols: number, rows: number) => void
    kill: (id: number) => void
    cd: (id: number, dir: string) => Promise<CdResult>
    cwd: (id: number) => Promise<string | null>
    onData: (cb: (id: number, data: string) => void) => () => void
    onExit: (cb: (id: number, exitCode: number) => void) => () => void
  }
}
