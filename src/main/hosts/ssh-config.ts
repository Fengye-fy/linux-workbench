// 读 ~/.ssh/config 里写好的主机，作为"添加服务器"时的候选。只取常用的几个字段，不处理 Match / Include

export interface SshConfigEntry {
  alias: string
  host: string
  port: number
  username: string
  keyPath?: string
}

export function parseSshConfig(text: string, defaultUser: string, home: string): SshConfigEntry[] {
  const out: SshConfigEntry[] = []
  let current: { aliases: string[]; opts: Record<string, string> } | null = null
  const flush = (): void => {
    if (!current) return
    for (const alias of current.aliases) {
      // 带通配符的是给一批主机设默认值的，不是具体的服务器
      if (/[*?!]/.test(alias)) continue
      const o = current.opts
      out.push({
        alias,
        host: o.hostname ?? alias,
        port: Number(o.port) || 22,
        username: o.user ?? defaultUser,
        keyPath: o.identityfile?.replace(/^~(?=[/\\])/, home)
      })
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(\S+)\s*=?\s*(.+)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim().replace(/^"(.*)"$/, '$1')
    if (key === 'host') {
      flush()
      current = { aliases: value.split(/\s+/), opts: {} }
    } else if (key === 'match') {
      flush()
      current = null
    } else if (current && !(key in current.opts)) {
      // ssh 的规则是同一个选项以第一次出现为准
      current.opts[key] = value
    }
  }
  flush()
  return out
}
