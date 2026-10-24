import { spawn } from 'node:child_process'
import { homedir, hostname } from 'node:os'
import type { DirEntry, HostInfo } from '../../shared/types'
import { listDir as listLocalDir } from '../fs'
import { PtyShell } from './pty-shell'
import { shellLaunchScript } from './scripts'
import { testPathPrefix, type ExecResult, type Host, type ShellHandle, type ShellOptions } from './types'

/** 应用自己跑在 Linux 上时，本机就是一台主机 */
export class LocalHost implements Host {
  readonly flavor = 'posix'

  info(): HostInfo {
    return { id: 'local', kind: 'local', name: '本机', detail: hostname(), status: 'connected' }
  }

  openShell({ cols, rows, cwd, agent }: ShellOptions): ShellHandle {
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    return new PtyShell('/bin/sh', ['-c', shellLaunchScript({ cwd, agent, pathPrefix: testPathPrefix() })], {
      cols,
      rows,
      env
    })
  }

  exec(script: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('/bin/sh', ['-c', script], { stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = ''
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (d: string) => (stdout += d))
      proc.on('error', reject)
      proc.on('close', (code) => resolve({ stdout, code: code ?? 1 }))
    })
  }

  listDir(dir: string): Promise<DirEntry[]> {
    return listLocalDir(dir)
  }

  async home(): Promise<string> {
    return homedir()
  }

  dispose(): void {}
}
