// 渲染进程跑在沙箱里没有 node:path，这里放几个 POSIX 路径小工具

/** 从资源管理器拖出的路径用的 dataTransfer 类型，终端只认这个 */
export const PATH_MIME = 'application/x-workbench-path'

export const parentDir = (p: string): string => p.replace(/\/[^/]+\/?$/, '') || '/'

export const tildify = (p: string, home: string): string =>
  p === home ? '~' : p.startsWith(home + '/') ? '~' + p.slice(home.length) : p
