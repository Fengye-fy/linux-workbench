import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry } from '../shared/types'

/** 列出一层目录：文件夹在前，按名称排序；指向文件夹的软链接也算文件夹 */
export async function listDir(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (d) => {
      const path = join(dir, d.name)
      const isDir = d.isSymbolicLink()
        ? await stat(path).then((s) => s.isDirectory(), () => false)
        : d.isDirectory()
      return { name: d.name, path, isDir }
    })
  )
  return entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
}
