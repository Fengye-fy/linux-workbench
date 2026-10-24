// 主进程、preload、渲染进程共用的类型
import type { AgentId } from './agents'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

/** local：应用自己跑在 Linux 上；windows：Windows 本机（PowerShell）；wsl：WSL 发行版；ssh：远程服务器 */
export type HostKind = 'local' | 'windows' | 'wsl' | 'ssh'

export type HostStatus = 'connected' | 'connecting' | 'disconnected'

export interface HostInfo {
  /** local、wsl:<发行版>、ssh:<编号> */
  id: string
  kind: HostKind
  name: string
  /** 副标题：WSL 显示发行版，SSH 显示 user@host:port */
  detail: string
  status: HostStatus
  /** SSH：本机加密保存了这台服务器的密码 */
  savedPassword?: boolean
}

/** 保存的 SSH 服务器。密码不在这里：要记住的话单独加密保存（见主进程 secrets.ts） */
export interface SshHostConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  /** 私钥路径，可选。不填就依次试 ssh-agent、~/.ssh 下的默认私钥，最后在终端里问密码 */
  keyPath?: string
  /** 登录成功后记住密码，下次自动用 */
  savePassword?: boolean
}

export type SshHostDraft = Omit<SshHostConfig, 'id'> & { id?: string }

export interface AppEnv {
  platform: string
  /** 启动时默认打开的主机：Linux 上是本机，Windows 上是默认的 WSL 发行版 */
  defaultHostId: string | null
  /** 命令行传入的目录，只对默认主机生效 */
  initialDir: string | null
}

export type CdResult =
  | { ok: true }
  /** process：前台程序名，拿不到时（Windows 本机）为 null */
  | { ok: false; reason: 'busy'; process: string | null }
  | { ok: false; reason: 'connecting' }
  | { ok: false; reason: 'gone' }

export interface PtyCreateOptions {
  hostId: string
  cols: number
  rows: number
  /** 起始目录，null 表示 home */
  cwd: string | null
  /** 设置后在登录 shell 里启动这个 agent，退出后留在 shell 里 */
  agent?: AgentId
  /** 只对 claude：分叉当前目录最近的对话（claude --continue --fork-session） */
  fork?: boolean
}

export interface DetectedAgent {
  id: AgentId
  /** command -v 的结果：可执行文件路径，或 alias 定义 */
  path: string
}

export interface WorkbenchApi {
  env: () => Promise<AppEnv>
  hosts: {
    list: () => Promise<HostInfo[]>
    saveSsh: (draft: SshHostDraft) => Promise<HostInfo>
    remove: (id: string) => Promise<void>
    /** ~/.ssh/config 里写好的主机，添加服务器时可以一键填入 */
    sshConfigSuggestions: () => Promise<SshHostDraft[]>
    sshConfig: (id: string) => Promise<SshHostConfig | null>
    /** ~/.ssh 下的私钥文件，填私钥路径时可以直接选 */
    keyCandidates: () => Promise<string[]>
    /** 删掉这台服务器保存的密码 */
    forgetPassword: (id: string) => Promise<void>
    /** SSH 主机没连上时会失败 */
    home: (id: string) => Promise<string>
    onStatus: (cb: (id: string, status: HostStatus) => void) => () => void
  }
  listDir: (hostId: string, dir: string) => Promise<DirEntry[]>
  detectAgents: (hostId: string) => Promise<DetectedAgent[]>
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
  wallpaper: {
    /** 弹出选图对话框，选中后复制到应用数据目录，返回可直接用作 CSS 背景的地址 */
    choose: () => Promise<string | null>
    current: () => Promise<string | null>
    clear: () => Promise<void>
  }
}
