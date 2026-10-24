import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AppEnv, PtyCreateOptions } from '../shared/types'
import { detectAgents } from './agents'
import { listDir } from './fs'
import {
  cdPty,
  createPty,
  defaultShell,
  killAllPtys,
  killPty,
  ptyCwd,
  resizePty,
  writePty
} from './pty'

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** `electron . <目录>` 或打包后 `workbench <目录>`：取第一个不是应用自身的目录参数 */
function resolveRoot(): string {
  const appPath = app.getAppPath()
  const arg = process.argv
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .map((a) => resolve(a))
    .find((p) => p !== appPath && isDir(p))
  return arg ?? homedir()
}

function registerIpc(env: AppEnv): void {
  ipcMain.handle('app:env', () => env)
  ipcMain.handle('fs:list', (_e, dir: string) => listDir(dir))
  ipcMain.handle('agents:detect', () => detectAgents())

  ipcMain.handle('pty:create', (e, opts: PtyCreateOptions) =>
    createPty(
      opts,
      (id, data) => {
        if (!e.sender.isDestroyed()) e.sender.send('pty:data', id, data)
      },
      (id, exitCode) => {
        if (!e.sender.isDestroyed()) e.sender.send('pty:exit', id, exitCode)
      }
    )
  )
  ipcMain.on('pty:write', (_e, id: number, data: string) => writePty(id, data))
  ipcMain.on('pty:resize', (_e, id: number, cols: number, rows: number) => resizePty(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: number) => killPty(id))
  ipcMain.handle('pty:cd', (_e, id: number, dir: string) => cdPty(id, dir))
  ipcMain.handle('pty:cwd', (_e, id: number) => ptyCwd(id))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
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
    if (isMainFrame && !isSameDocument) killAllPtys()
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
  registerIpc({ root: resolveRoot(), home: homedir(), shell: basename(defaultShell()) })
  createWindow()
})

app.on('window-all-closed', () => {
  killAllPtys()
  app.quit()
})
