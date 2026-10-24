// 同一台电脑上，Windows 和 WSL 能互相打开对方的目录，只是写法不同。纯函数，方便单测
import type { HostKind } from './types'

interface HostRef {
  id: string
  kind: HostKind
}

const distroOf = (h: HostRef): string => h.id.replace(/^wsl:/, '')

/**
 * 把 from 主机上的目录换成 to 主机能打开的写法：
 * WSL 的 /home/x 在 Windows 上是 \\wsl.localhost\<发行版>\home\x；Windows 的 C:\x 在 WSL 里是 /mnt/c/x。
 * 服务器上的目录别的主机打不开，不同的 WSL 发行版之间也不行，返回 null。
 */
export function mapPath(path: string, from: HostRef, to: HostRef): string | null {
  if (from.id === to.id) return path
  if (from.kind === 'wsl' && to.kind === 'windows') {
    return `\\\\wsl.localhost\\${distroOf(from)}${path === '/' ? '\\' : path.replace(/\//g, '\\')}`
  }
  if (from.kind === 'windows' && to.kind === 'wsl') {
    const unc = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i.exec(path)
    if (unc) {
      if (unc[1].toLowerCase() !== distroOf(to).toLowerCase()) return null
      return (unc[2] ?? '\\').replace(/\\/g, '/')
    }
    const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path)
    if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`.replace(/\/+$/, '')
  }
  return null
}
