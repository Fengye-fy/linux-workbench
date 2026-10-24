import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEnv, HostStatus, PtyCreateOptions, SshHostDraft } from '../shared/types'
import { HostRegistry } from './hosts/registry'
import {
  cdSession,
  createSession,
  detectAgents,
  killAllSessions,
  killSession,
  resizeSession,
  sessionCwd,
  writeSession
} from './sessions'
import { chooseWallpaper, clearWallpaper, registerWallpaperScheme, serveWallpaper, wallpaperUrl } from './wallpaper'

registerWallpaperScheme()
// 测试用：数据目录（服务器列表、known_hosts、壁纸、界面设置）放到临时目录，不碰真实数据
if (process.env.WORKBENCH_USER_DATA) app.setPath('userData', process.env.WORKBENCH_USER_DATA)

/** `workbench /some/dir`：命令行传入的 Linux 路径，作为默认主机上资源管理器的起始目录 */
const initialDir = (): string | null =>
  process.argv.slice(1).find((a) => a.startsWith('/') && !a.startsWith('//')) ?? null

const broadcast = (channel: string, ...args: unknown[]): void => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

function registerIpc(registry: HostRegistry, env: AppEnv): void {
  ipcMain.handle('app:env', () => env)

  ipcMain.handle('hosts:list', () => registry.list())
  ipcMain.handle('hosts:saveSsh', (_e, draft: SshHostDraft) => registry.saveSsh(draft))
  ipcMain.handle('hosts:remove', (_e, id: string) => registry.remove(id))
  ipcMain.handle('hosts:sshConfigSuggestions', () => registry.sshConfigSuggestions())
  ipcMain.handle('hosts:sshConfig', (_e, id: string) => registry.sshConfig(id))
  ipcMain.handle('hosts:keyCandidates', () => registry.keyCandidates())
  ipcMain.handle('hosts:forgetPassword', (_e, id: string) => registry.forgetPassword(id))
  ipcMain.handle('hosts:home', (_e, id: string) => registry.get(id).home())

  ipcMain.handle('fs:list', (_e, hostId: string, dir: string) => registry.get(hostId).listDir(dir))
  ipcMain.handle('agents:detect', (_e, hostId: string) => detectAgents(registry.get(hostId)))

  ipcMain.handle('pty:create', (e, opts: PtyCreateOptions) =>
    createSession(
      registry,
      opts,
      (id, data) => {
        if (!e.sender.isDestroyed()) e.sender.send('pty:data', id, data)
      },
      (id, exitCode) => {
        if (!e.sender.isDestroyed()) e.sender.send('pty:exit', id, exitCode)
      }
    )
  )
  ipcMain.on('pty:write', (_e, id: number, data: string) => writeSession(id, data))
  ipcMain.on('pty:resize', (_e, id: number, cols: number, rows: number) => resizeSession(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: number) => killSession(id))
  ipcMain.handle('pty:cd', (_e, id: number, dir: string) => cdSession(id, dir))
  ipcMain.handle('pty:cwd', (_e, id: number) => sessionCwd(id))

  ipcMain.handle('wallpaper:choose', (e) => chooseWallpaper(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('wallpaper:current', () => wallpaperUrl())
  ipcMain.handle('wallpaper:clear', () => clearWallpaper())
}

function createWindow(): void {
  const icon = join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#11111b',
    icon: existsSync(icon) ? icon : undefined,
    // 自己画标题栏，系统的最小化 / 最大化 / 关闭按钮叠在右上角
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#00000000', symbolColor: '#cdd6f4', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win.show())

  // 默认菜单已去掉，开发时用 F12 开关 DevTools
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  // 页面刷新（开发时热重载）后旧终端没人接收了，直接结束掉
  win.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) killAllSessions()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 默认菜单的快捷键会抢走终端按键：Ctrl+W 关窗口、Ctrl+R 刷新、Ctrl+M 最小化
  Menu.setApplicationMenu(null)
  serveWallpaper()
  const registry = new HostRegistry(app.getPath('userData'), (id, status: HostStatus) =>
    broadcast('hosts:status', id, status)
  )
  registry.init()
  registerIpc(registry, { platform: process.platform, defaultHostId: registry.defaultId(), initialDir: initialDir() })
  app.on('before-quit', () => registry.disposeAll())
  createWindow()
})

app.on('window-all-closed', () => {
  killAllSessions()
  app.quit()
})
