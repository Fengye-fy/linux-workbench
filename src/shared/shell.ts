// 往终端里写路径时的引号处理。主进程和渲染进程共用，不依赖任何模块，方便直接单测

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

/** 只在需要时加单引号，内部的单引号写成 '\'' */
export const shellQuote = (s: string): string => (SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/**
 * 从资源管理器拖进终端时插入的文字：
 * shell 里插绝对路径（必要时加引号）；agent 里插 @相对路径，agent 会把它当文件引用。
 * 相对路径带空白时 @ 引用会断开，退回到加引号的绝对路径。
 */
export function pathForInsert(path: string, cwd: string | null, agent: boolean): string {
  if (agent) {
    const rel = path === cwd ? '.' : cwd && path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
    if (!/\s/.test(rel)) return `@${rel} `
  }
  return shellQuote(path) + ' '
}
