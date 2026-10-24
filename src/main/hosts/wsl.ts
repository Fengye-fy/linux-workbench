import { spawnSync } from 'node:child_process'
import type { DirEntry, HostInfo } from '../../shared/types'
import { ExecHelper } from './exec-helper'
import { PtyShell } from './pty-shell'
import { homeScript, listDirScript, parseListing, shellLaunchScript } from './scripts'
import { testPathPrefix, type ExecResult, type Host, type ShellHandle, type ShellOptions } from './types'

/**
 * 进 WSL 时脚本放在环境变量 WB_SCRIPT 里，通过 WSLENV 带进去，命令行上只有固定的
 * `sh -c 'eval "$WB_SCRIPT"'`，绕开 Windows 命令行转义对引号、$ 的各种处理。
 */
function wslEnv(script: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const names = ['WB_SCRIPT', ...Object.keys(extra)].map((n) => `${n}/u`)
  const prev = process.env.WSLENV ? `${process.env.WSLENV}:` : ''
  return { ...process.env, ...extra, WB_SCRIPT: script, WSLENV: prev + names.join(':') }
}

const evalArgs = (distro: string): string[] => ['-d', distro, '--exec', 'sh', '-c', 'eval "$WB_SCRIPT"']

/** 本机安装的 WSL 发行版，默认发行版排第一；docker-desktop 那几个是 Docker 自用的，不算 */
export function listWslDistros(): { name: string; isDefault: boolean }[] {
  const r = spawnSync('wsl.exe', ['-l', '-v'], { encoding: 'utf16le', windowsHide: true, timeout: 15000 })
  if (r.status !== 0 || !r.stdout) return []
  return r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => /^\s*(\*?)\s*(\S+)\s+\S+\s+\d+\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && !m[2].startsWith('docker-desktop'))
    .map((m) => ({ name: m[2], isDefault: m[1] === '*' }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

export class WslHost implements Host {
  readonly flavor = 'posix'
  private helper: ExecHelper
  private homeDir: Promise<string> | null = null

  constructor(private distro: string) {
    this.helper = new ExecHelper((script) => ({ file: 'wsl.exe', args: evalArgs(distro), env: wslEnv(script) }))
  }

  info(): HostInfo {
    return { id: `wsl:${this.distro}`, kind: 'wsl', name: this.distro, detail: 'WSL', status: 'connected' }
  }

  openShell({ cols, rows, cwd, agent }: ShellOptions): ShellHandle {
    const env = wslEnv(shellLaunchScript({ cwd, agent, pathPrefix: testPathPrefix(), clear: true }), {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    })
    // Windows 开了代理时，wsl.exe 每次启动都会先打一行 localhost proxy 的警告，不让它出现在终端里
    return new PtyShell('wsl.exe', evalArgs(this.distro), { cols, rows, env, dropBeforeMarker: true })
  }

  exec(script: string): Promise<ExecResult> {
    return this.helper.exec(script)
  }

  async listDir(dir: string): Promise<DirEntry[]> {
    const { stdout, code } = await this.exec(listDirScript(dir))
    if (code !== 0) throw new Error(`无法读取 ${dir}`)
    return parseListing(dir, stdout)
  }

  home(): Promise<string> {
    this.homeDir ??= this.exec(homeScript).then((r) => r.stdout || '/')
    return this.homeDir
  }

  dispose(): void {
    this.helper.dispose()
  }
}
