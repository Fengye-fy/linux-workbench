import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { WorkbenchApi } from '../shared/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: WorkbenchApi = {
  env: () => ipcRenderer.invoke('app:env'),
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    cd: (id, dir) => ipcRenderer.invoke('pty:cd', id, dir),
    cwd: (id) => ipcRenderer.invoke('pty:cwd', id),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
