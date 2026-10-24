// 渲染进程跑在沙箱里没有 node:path，这里放几个路径小工具。
// Linux 主机是 POSIX 路径，Windows 本机是 C:\ 这样的路径，两种都要认。

/**
 * 从资源管理器拖出的路径用的 dataTransfer 类型，把主机编号编进类型名里：
 * 拖动过程中读不到数据、只能看类型，这样终端在 dragover 时就能判断是不是自己主机上的文件。
 */
export const pathMime = (hostId: string): string =>
  'application/x-wb-path-' + [...new TextEncoder().encode(hostId)].map((b) => b.toString(16).padStart(2, '0')).join('')

const isWinPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || /^[A-Za-z]:$/.test(p)

/** 上一级目录；已经是根目录（/ 或 C:\）就原样返回 */
export function parentDir(p: string): string {
  if (isWinPath(p)) {
    const trimmed = p.replace(/[\\/]+$/, '')
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\'
    const up = trimmed.replace(/[\\/][^\\/]+$/, '')
    return /^[A-Za-z]:$/.test(up) ? up + '\\' : up
  }
  return p.replace(/\/[^/]+\/?$/, '') || '/'
}

export const isRootDir = (p: string): boolean => p === '/' || /^[A-Za-z]:[\\/]?$/.test(p)

/** home 下的路径缩写成 ~；Windows 路径不区分大小写 */
export function tildify(p: string, home: string): string {
  const win = isWinPath(p)
  const norm = (s: string): string => (win ? s.toLowerCase() : s)
  const sep = win ? '\\' : '/'
  if (norm(p) === norm(home)) return '~'
  return norm(p).startsWith(norm(home) + sep) ? '~' + p.slice(home.length) : p
}
