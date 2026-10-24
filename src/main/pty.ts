import { basename } from 'node:path'
import { readFile, readlink } from 'node:fs/promises'
import * as pty from 'node-pty'
import { isAgentId } from '../shared/agents'
import { shellQuote } from '../shared/shell'
import type { CdResult, PtyCreateOptions } from '../shared/types'

interface Session {
  proc: pty.IPty
  shell: string
}

const sessions = new Map<number, Session>()
let nextId = 1

export const defaultShell = (): string => process.env.SHELL || '/bin/bash'

export function createPty(
  { cols, rows, cwd, agent }: PtyCreateOptions,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void
): number {
  if (agent !== undefined && !isAgentId(agent)) throw new Error(`未知的 agent：${agent}`)
  const shell = defaultShell()
  // agent 在登录交互 shell 里启动，PATH、nvm、ROS 环境和平时开终端一样；agent 退出后留在 shell 里
  const args = agent ? ['-ilc', `${agent}; exec ${shellQuote(shell)} -i`] : []
  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  })
  const id = nextId++
  sessions.set(id, { proc, shell })
  proc.onData((data) => onData(id, data))
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    onExit(id, exitCode)
  })
  return id
}

export function writePty(id: number, data: string): void {
  sessions.get(id)?.proc.write(data)
}

export function resizePty(id: number, cols: number, rows: number): void {
  sessions.get(id)?.proc.resize(cols, rows)
}

export function killPty(id: number): void {
  sessions.get(id)?.proc.kill()
  sessions.delete(id)
}

export function killAllPtys(): void {
  for (const id of [...sessions.keys()]) killPty(id)
}

/**
 * 终端前台不是 shell 自己时返回前台进程名，否则返回 null。
 * Linux 上看终端的前台进程组是不是 shell：只比进程名的话，bash 脚本写的程序也叫 bash，会被当成空闲。
 */
async function foregroundProcess(s: Session): Promise<string | null> {
  if (process.platform !== 'linux') {
    const fg = basename(s.proc.process).replace(/^-/, '')
    return fg === basename(s.shell) ? null : fg
  }
  try {
    const stat = await readFile(`/proc/${s.proc.pid}/stat`, 'utf8')
    // comm 字段里可能有空格和括号，从最后一个 ')' 往后数：state ppid pgrp session tty_nr tpgid
    const tpgid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[5])
    if (tpgid <= 0 || tpgid === s.proc.pid) return null
    return (await readFile(`/proc/${tpgid}/comm`, 'utf8').catch(() => '?')).trim()
  } catch {
    return null
  }
}

export async function cdPty(id: number, dir: string): Promise<CdResult> {
  const s = sessions.get(id)
  if (!s) return { ok: false, reason: 'gone' }
  // 前台有程序在跑（vim、ros2 launch、agent…）时不能往里打字，交给界面提示
  const fg = await foregroundProcess(s)
  if (fg) return { ok: false, reason: 'busy', process: fg }
  // Ctrl-E Ctrl-U：先清掉提示符上已经输入的半截命令
  s.proc.write(`\x05\x15cd -- ${shellQuote(dir)}\r`)
  return { ok: true }
}

export async function ptyCwd(id: number): Promise<string | null> {
  const s = sessions.get(id)
  if (!s || process.platform !== 'linux') return null
  try {
    return await readlink(`/proc/${s.proc.pid}/cwd`)
  } catch {
    return null
  }
}
