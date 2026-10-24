// 在 Linux 主机上执行的 sh 脚本。WSL、SSH、本机共用，只依赖 POSIX sh 和 /proc。
// 都是纯函数，方便单测。

import type { DirEntry } from '../../shared/types'
import { shellQuote } from '../../shared/shell'

/** shell 启动时先打印这个 OSC 序列报告自己的 pid，主进程截下来后从输出里去掉 */
export const PID_MARKER = /\x1b\]7777;wb-pid=(\d+)\x07/

/** 用户在 passwd 里登记的登录 shell；拿不到就退回 $SHELL 或 /bin/sh */
const LOGIN_SHELL = `s=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7); [ -x "$s" ] || s=\${SHELL:-/bin/sh}; export SHELL="$s"`

const pathPrefixLine = (prefix?: string): string =>
  prefix ? `PATH=${shellQuote(prefix)}:$PATH; export PATH` : ''

export interface LaunchOptions {
  cwd: string | null
  agent?: string
  /** 跟在 agent 命令后面的参数（只会是代码里写死的几个开关，比如 --continue --fork-session） */
  agentArgs?: readonly string[]
  pathPrefix?: string
  /**
   * 报完 pid 后清屏并清空滚动缓冲。WSL 用：wsl.exe 启动时打的警告留在 Windows ConPTY 自己的
   * 屏幕缓冲里，终端一改尺寸 ConPTY 会按缓冲重绘，又把它画回来；清屏连 ConPTY 的缓冲一起清掉。
   */
  clear?: boolean
}

/**
 * 启动终端用的脚本：报出 pid → 进入目录 → exec 成用户的登录 shell（exec 不换 pid，
 * 之后就能用这个 pid 读 /proc 拿当前目录和前台进程）。
 * 指定 agent 时在登录交互 shell 里启动它，退出后留在 shell 里。
 */
export function shellLaunchScript({ cwd, agent, agentArgs = [], pathPrefix, clear }: LaunchOptions): string {
  const command = [agent, ...agentArgs.map(shellQuote)].join(' ')
  return [
    `printf '\\033]7777;wb-pid=%s\\007' $$`,
    clear ? `printf '\\033[H\\033[2J\\033[3J'` : '',
    pathPrefixLine(pathPrefix),
    cwd ? `cd -- ${shellQuote(cwd)} 2>/dev/null || cd` : 'cd',
    LOGIN_SHELL,
    agent ? `exec "$s" -ilc ${shellQuote(`${command}; exec "$SHELL" -il`)}` : `exec "$s" -l`
  ]
    .filter(Boolean)
    .join('\n')
}

/** 列一层目录，每项输出 "d/名字\0" 或 "f/名字\0"；指向目录的软链接算目录 */
export function listDirScript(dir: string): string {
  return `cd -- ${shellQuote(dir)} || exit 1
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  if [ -d "$f" ]; then t=d; else t=f; fi
  printf '%s/%s\\000' "$t" "$f"
done`
}

export function parseListing(dir: string, out: string): DirEntry[] {
  const base = dir === '/' ? '' : dir.replace(/\/+$/, '')
  return out
    .split('\0')
    .filter((s) => s.length > 2)
    .map((s) => ({ name: s.slice(2), path: `${base}/${s.slice(2)}`, isDir: s[0] === 'd' }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
}

/** 终端前台不是这个 shell 时输出前台进程名，否则什么都不输出（stat 里第 8 个字段是 tpgid） */
export const foregroundScript = (pid: number): string =>
  `set -- $(sed 's/^.*) //' /proc/${pid}/stat) || exit 1
[ "$6" -gt 0 ] && [ "$6" != ${pid} ] && cat /proc/$6/comm`

export const cwdScript = (pid: number): string => `readlink /proc/${pid}/cwd`

export const homeScript = `printf '%s' "$HOME"`

/** 在登录交互 shell 里查 agent 命令，nvm、~/.local/bin、alias 都认得；只认带 found: 前缀的行 */
export function agentDetectScript(ids: readonly string[], pathPrefix?: string): string {
  const inner = ids
    .map((id) => `command -v ${id} >/dev/null 2>&1 && echo "found:${id}:$(command -v ${id})"`)
    .join('; ')
  return [pathPrefixLine(pathPrefix), LOGIN_SHELL, `exec "$s" -ilc ${shellQuote(inner)} </dev/null 2>/dev/null`]
    .filter(Boolean)
    .join('\n')
}

/** 同名命令出现多次（Windows 上 PATH 里有好几个）时以第一个为准，和 shell 实际调用的一致 */
export function parseAgentDetect(out: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const line of out.split('\n')) {
    const m = /^found:(\w+):(.*)$/.exec(line.trim())
    if (m && !found.has(m[1])) found.set(m[1], m[2])
  }
  return found
}

/**
 * 从终端输出里截下 pid 标记。标记是 shell 的第一段输出，没出现之前先攒着；
 * 超过 8KB 还没看到（比如主机上没有 sh 的 printf），就放弃并原样吐出。
 * dropBefore：标记之前的内容不是 shell 打的（比如 wsl.exe 自己的代理警告），找到标记时一并丢掉；
 * 一直没等到标记（wsl.exe 真出错了）就照常显示。
 */
export class PidMarkerFilter {
  private buf = ''
  private done = false
  private onPid: (pid: number) => void
  private dropBefore: boolean

  constructor(onPid: (pid: number) => void, dropBefore = false) {
    this.onPid = onPid
    this.dropBefore = dropBefore
  }

  push(data: string): string {
    if (this.done) return data
    this.buf += data
    const m = PID_MARKER.exec(this.buf)
    if (m) {
      this.done = true
      this.onPid(Number(m[1]))
      const out = (this.dropBefore ? '' : this.buf.slice(0, m.index)) + this.buf.slice(m.index + m[0].length)
      this.buf = ''
      return out
    }
    if (this.buf.length > 8192) return this.flush()
    return ''
  }

  /** 不再等标记，把攒着的内容吐出来 */
  flush(): string {
    this.done = true
    const out = this.buf
    this.buf = ''
    return out
  }
}
