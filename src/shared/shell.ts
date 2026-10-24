// 往终端里写路径时的引号处理。主进程和渲染进程共用，不依赖任何模块，方便直接单测

/** 终端里跑的是哪一类 shell：Linux 主机上是 POSIX sh 系，Windows 本机是 PowerShell */
export type ShellFlavor = 'posix' | 'powershell'

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/
const PS_SAFE = /^[A-Za-z0-9_.:\\/-]+$/

/** 只在需要时加单引号，内部的单引号写成 '\'' */
export const shellQuote = (s: string): string => (SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/** PowerShell 的单引号字符串里，单引号写两遍 */
export const psQuote = (s: string): string => (PS_SAFE.test(s) ? s : `'${s.replace(/'/g, "''")}'`)

const quoteFor = (flavor: ShellFlavor): ((s: string) => string) => (flavor === 'powershell' ? psQuote : shellQuote)

/** 让 shell 切到某个目录的命令（含回车） */
export function cdCommand(dir: string, flavor: ShellFlavor): string {
  // POSIX 先按 Ctrl-E Ctrl-U 清掉提示符上已经输入的半截命令
  return flavor === 'powershell' ? `Set-Location -LiteralPath ${psQuote(dir)}\r` : `\x05\x15cd -- ${shellQuote(dir)}\r`
}

/**
 * 从资源管理器拖进终端时插入的文字：
 * shell 里插绝对路径（必要时加引号）；agent 里插 @相对路径，agent 会把它当文件引用。
 * 相对路径带空白时 @ 引用会断开，退回到加引号的绝对路径。
 */
export function pathForInsert(path: string, cwd: string | null, agent: boolean, flavor: ShellFlavor = 'posix'): string {
  if (agent) {
    const sep = flavor === 'powershell' ? '\\' : '/'
    const prefix = cwd ? cwd.replace(/[\\/]+$/, '') + sep : null
    const inside = prefix && (flavor === 'powershell' ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix))
    const rel = path === cwd ? '.' : inside ? path.slice(prefix.length) : path
    if (!/\s/.test(rel)) return `@${rel} `
  }
  return quoteFor(flavor)(path) + ' '
}
