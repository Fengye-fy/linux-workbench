import { app, safeStorage } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 服务器密码：用系统的加密能力保存（Windows 上是 DPAPI，只有当前 Windows 用户能解开），
 * 文件里只有密文。系统不支持加密时不保存，绝不落明文。
 */

const file = (): string => join(app.getPath('userData'), 'secrets.json')

function readAll(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

async function writeAll(all: Record<string, string>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(file(), JSON.stringify(all, null, 2))
}

export const canSavePasswords = (): boolean => safeStorage.isEncryptionAvailable()

export function getPassword(hostId: string): string | null {
  const enc = readAll()[hostId]
  if (!enc || !canSavePasswords()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export const hasPassword = (hostId: string): boolean => hostId in readAll()

export async function setPassword(hostId: string, password: string): Promise<boolean> {
  if (!canSavePasswords()) return false
  const all = readAll()
  all[hostId] = safeStorage.encryptString(password).toString('base64')
  await writeAll(all)
  return true
}

export async function deletePassword(hostId: string): Promise<void> {
  const all = readAll()
  if (!(hostId in all)) return
  delete all[hostId]
  await writeAll(all)
}
