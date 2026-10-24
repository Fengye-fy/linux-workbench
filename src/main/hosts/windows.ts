import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { DirEntry, HostInfo } from '../../shared/types'
import { listDir as listLocalDir } from '../fs'
import { encodeCommand, PromptTracker, psAgentDetectScript, psLaunchScript } from './ps-scripts'
import { parseAgentDetect } from './scripts'
import { Emitter, type ExecResult, type Host, type ShellHandle, type ShellOptions } from './types'

/** 测试用：把假的 agent 命令所在目录放进 Windows 的 PATH 最前面 */
const testWinPathPrefix = (): string | undefined => process.env.WORKBENCH_WIN_PATH_PREFIX || undefined

/** 装了 PowerShell 7 就用 pwsh，否则用系统自带的 Windows PowerShell */
function findPowerShell(): string {
  try {
    execFileSync('where.exe', ['pwsh.exe'], { stdio: 'ignore', windowsHide: true })
    return 'pwsh.exe'
  } catch {
    return 'powershell.exe'
  }
}

/**
 * PowerShell 终端。没有 /proc，当前目录靠提示符报告；
 * 按回车到下一个提示符之间算在跑命令（启动时到第一个提示符之前也算，agent 运行期间就是这样）。
 */
class PsShell implements ShellHandle {
  readonly pid = null
  readonly ready = true
  private cwd: string | null
  private busy = true
  private data = new Emitter<string>()
  private exit = new Emitter<number>()
  private proc: pty.IPty
  private tracker = new PromptTracker((cwd) => {
    this.cwd = cwd
    this.busy = false
  })

  constructor(file: string, script: string, opts: { cols: number; rows: number; cwd: string | null }) {
    this.cwd = opts.cwd
    this.proc = pty.spawn(file, ['-NoLogo', '-NoExit', '-EncodedCommand', encodeCommand(script)], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      env: process.env,
      useConptyDll: true
    })
    this.proc.onData((d) => {
      const out = this.tracker.push(d)
      if (out) this.data.emit(out)
    })
    this.proc.onExit(({ exitCode }) => this.exit.emit(exitCode))
  }

  trackedCwd(): string | null {
    return this.cwd
  }
  trackedBusy(): boolean {
    return this.busy
  }
  write(data: string): void {
    if (data.includes('\r')) this.busy = true
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

/** Windows 本机：PowerShell 终端、Windows 文件系统，能直接用装在 Windows 上的 agent CLI */
export class WindowsHost implements Host {
  readonly flavor = 'powershell'
  private shellExe = findPowerShell()

  info(): HostInfo {
    const ps = this.shellExe === 'pwsh.exe' ? 'PowerShell 7' : 'Windows PowerShell'
    return { id: 'windows', kind: 'windows', name: '本机', detail: ps, status: 'connected' }
  }

  openShell({ cols, rows, cwd, agent, agentArgs }: ShellOptions): ShellHandle {
    const script = psLaunchScript({ cwd, agent, agentArgs, pathPrefix: testWinPathPrefix() })
    return new PsShell(this.shellExe, script, { cols, rows, cwd })
  }

  exec(script: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.shellExe,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
      )
      let stdout = ''
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (d: string) => (stdout += d))
      proc.on('error', reject)
      proc.on('close', (code) => resolve({ stdout, code: code ?? 1 }))
    })
  }

  async detectAgents(ids: readonly string[]): Promise<Map<string, string>> {
    const { stdout } = await this.exec(psAgentDetectScript(ids, testWinPathPrefix()))
    return parseAgentDetect(stdout.replace(/\r/g, ''))
  }

  listDir(dir: string): Promise<DirEntry[]> {
    return listLocalDir(dir)
  }

  async home(): Promise<string> {
    return homedir()
  }

  dispose(): void {}
}
