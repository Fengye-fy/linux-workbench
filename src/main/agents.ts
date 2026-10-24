import { execFile } from 'node:child_process'
import { AGENTS } from '../shared/agents'
import type { DetectedAgent } from '../shared/types'
import { defaultShell } from './pty'

/**
 * 在用户的登录交互 shell 里查 agent 命令：从桌面启动时进程 PATH 不全，
 * 而 nvm、~/.local/bin、.bashrc 里的 alias 都要靠 shell 配置才有。
 * 只认带 found: 前缀的行，不怕 rc 文件打印别的东西。fish 语法不同，会查不到。
 */
export function detectAgents(): Promise<DetectedAgent[]> {
  const script = AGENTS.map(
    ({ id }) => `command -v ${id} >/dev/null 2>&1 && echo "found:${id}:$(command -v ${id})"`
  ).join('; ')
  return new Promise((resolve) => {
    execFile(defaultShell(), ['-ilc', script], { timeout: 15000 }, (_err, stdout) => {
      const found = new Map<string, string>()
      for (const line of String(stdout).split('\n')) {
        const m = /^found:(\w+):(.*)$/.exec(line.trim())
        if (m) found.set(m[1], m[2])
      }
      resolve(AGENTS.filter((a) => found.has(a.id)).map((a) => ({ id: a.id, path: found.get(a.id)! })))
    })
  })
}
