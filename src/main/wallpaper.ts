import { app, dialog, net, protocol, type BrowserWindow } from 'electron'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 壁纸复制到应用数据目录里，通过 wb:// 协议给页面用，不让页面直接读本地文件

const dir = (): string => join(app.getPath('userData'), 'wallpaper')

/** 必须在 app ready 之前调用 */
export function registerWallpaperScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'wb', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export function serveWallpaper(): void {
  protocol.handle('wb', async () => {
    const file = await currentFile()
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
  })
}

async function currentFile(): Promise<string | null> {
  try {
    const name = (await readdir(dir())).find((f) => f.startsWith('current.'))
    return name ? join(dir(), name) : null
  } catch {
    return null
  }
}

export async function wallpaperUrl(): Promise<string | null> {
  const file = await currentFile()
  // 带上修改时间，换图后地址变了，页面不会用缓存的旧图
  return file ? `wb://wallpaper/current?v=${Math.round((await stat(file)).mtimeMs)}` : null
}

export async function clearWallpaper(): Promise<void> {
  const file = await currentFile()
  if (file) await rm(file, { force: true })
}

export async function chooseWallpaper(win: BrowserWindow | null): Promise<string | null> {
  const opts = {
    title: '选择壁纸',
    properties: ['openFile' as const],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }]
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const src = r.filePaths[0]
  if (r.canceled || !src) return null
  await mkdir(dir(), { recursive: true })
  await clearWallpaper()
  await copyFile(src, join(dir(), `current${extname(src).toLowerCase()}`))
  return wallpaperUrl()
}
