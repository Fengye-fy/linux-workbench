import { AGENTS, isAgentId } from '../shared/agents'
import { cdCommand } from '../shared/shell'
import type { CdResult, DetectedAgent, PtyCreateOptions } from '../shared/types'
import type { HostRegistry } from './hosts/registry'
import { agentDetectScript, cwdScript, foregroundScript, parseAgentDetect } from './hosts/scripts'
import { testPathPrefix, type Host, type ShellHandle } from './hosts/types'

interface Session {
  host: Host
  shell: ShellHandle
}

const sessions = new Map<number, Session>()
let nextId = 1

export function createSession(
  registry: HostRegistry,
  { hostId, cols, rows, cwd, agent }: PtyCreateOptions,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void
): number {
  if (agent !== undefined && !isAgentId(agent)) throw new Error(`未知的 agent：${agent}`)
  const host = registry.get(hostId)
  const shell = host.openShell({ cols, rows, cwd, agent })
  const id = nextId++
  sessions.set(id, { host, shell })
  shell.onData((data) => onData(id, data))
  shell.onExit((code) => {
    sessions.delete(id)
    onExit(id, code)
  })
  return id
}

export function writeSession(id: number, data: string): void {
  sessions.get(id)?.shell.write(data)
}

export function resizeSession(id: number, cols: number, rows: number): void {
  sessions.get(id)?.shell.resize(cols, rows)
}

export function killSession(id: number): void {
  sessions.get(id)?.shell.kill()
  sessions.delete(id)
}

export function killAllSessions(): void {
  for (const id of [...sessions.keys()]) killSession(id)
}

/** 在主机上跑个小脚本，失败（断线、超时）就当没结果 */
async function query(s: Session, script: string): Promise<string | null> {
  try {
    return (await s.host.exec(script)).stdout.trim() || null
  } catch {
    return null
  }
}

export async function cdSession(id: number, dir: string): Promise<CdResult> {
  const s = sessions.get(id)
  if (!s) return { ok: false, reason: 'gone' }
  if (!s.shell.ready) return { ok: false, reason: 'connecting' }
  // 前台有程序在跑（vim、ros2 launch、agent…）时不能往里打字。
  // Linux 主机看终端的前台进程组是不是 shell 自己；Windows 本机看 shell 自己跟踪的状态
  if (s.shell.trackedBusy) {
    if (s.shell.trackedBusy()) return { ok: false, reason: 'busy', process: null }
  } else {
    const fg = s.shell.pid ? await query(s, foregroundScript(s.shell.pid)) : null
    if (fg) return { ok: false, reason: 'busy', process: fg }
  }
  s.shell.write(cdCommand(dir, s.host.flavor))
  return { ok: true }
}

export async function sessionCwd(id: number): Promise<string | null> {
  const s = sessions.get(id)
  if (!s) return null
  if (s.shell.trackedCwd) return s.shell.trackedCwd()
  return s.shell.pid ? query(s, cwdScript(s.shell.pid)) : null
}

export async function detectAgents(host: Host): Promise<DetectedAgent[]> {
  const ids = AGENTS.map((a) => a.id)
  const found = host.detectAgents
    ? await host.detectAgents(ids)
    : parseAgentDetect((await host.exec(agentDetectScript(ids, testPathPrefix()))).stdout)
  return AGENTS.filter((a) => found.has(a.id)).map((a) => ({ id: a.id, path: found.get(a.id)! }))
}
