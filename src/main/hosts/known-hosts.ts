// known_hosts 的解析和校验：兼容 OpenSSH 的格式（包括 HashKnownHosts 的哈希条目和通配符）

import { createHash, createHmac } from 'node:crypto'

interface Entry {
  marker: '' | '@revoked' | '@cert-authority'
  /** 明文主机模式列表，或哈希条目的 salt + hash */
  hosts: string[] | { salt: Buffer; hash: Buffer }
  keyType: string
  key: string
}

export type HostKeyStatus = 'ok' | 'unknown' | 'mismatch' | 'revoked'

export function parseKnownHosts(text: string): Entry[] {
  const entries: Entry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const marker = parts[0].startsWith('@') ? (parts.shift() as Entry['marker']) : ''
    const [hostField, keyType, key] = parts
    if (!hostField || !keyType || !key) continue
    let hosts: Entry['hosts']
    if (hostField.startsWith('|1|')) {
      const [, , salt, hash] = hostField.split('|')
      hosts = { salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') }
    } else {
      hosts = hostField.split(',')
    }
    entries.push({ marker, hosts, keyType, key })
  }
  return entries
}

/** known_hosts 里主机的写法：22 端口直接写主机名，其他端口写 [host]:port */
export const hostPattern = (host: string, port: number): string => (port === 22 ? host : `[${host}]:${port}`)

const globToRegExp = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

function matches(entry: Entry, pattern: string): boolean {
  if (!Array.isArray(entry.hosts)) {
    const { salt, hash } = entry.hosts
    return createHmac('sha1', salt).update(pattern).digest().equals(hash)
  }
  let hit = false
  for (const p of entry.hosts) {
    if (p.startsWith('!')) {
      if (globToRegExp(p.slice(1)).test(pattern)) return false
    } else if (globToRegExp(p).test(pattern)) {
      hit = true
    }
  }
  return hit
}

/** 同一种密钥类型：有一致的 → ok；只有不一致的 → mismatch（可能是中间人）；都没有 → unknown */
export function checkHostKey(
  entries: Entry[],
  host: string,
  port: number,
  keyType: string,
  key: string
): HostKeyStatus {
  const pattern = hostPattern(host, port)
  const relevant = entries.filter((e) => e.marker !== '@cert-authority' && matches(e, pattern))
  if (relevant.some((e) => e.marker === '@revoked' && e.key === key)) return 'revoked'
  const sameType = relevant.filter((e) => e.marker === '' && e.keyType === keyType)
  if (sameType.some((e) => e.key === key)) return 'ok'
  return sameType.length ? 'mismatch' : 'unknown'
}

export const formatKnownHost = (host: string, port: number, keyType: string, key: string): string =>
  `${hostPattern(host, port)} ${keyType} ${key}\n`

/** 原始公钥 blob → 密钥类型名（blob 开头是 uint32 长度 + 类型字符串） */
export function keyTypeOf(blob: Buffer): string {
  const len = blob.readUInt32BE(0)
  return blob.subarray(4, 4 + len).toString('ascii')
}

/** 和 ssh 命令显示的一样：SHA256:base64（去掉末尾的 =） */
export const fingerprint = (blob: Buffer): string =>
  'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
