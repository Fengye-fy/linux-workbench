import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { WorkbenchApi } from '../shared/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: WorkbenchApi = {
  env: () => ipcRenderer.invoke('app:env'),
  hosts: {
    list: () => ipcRenderer.invoke('hosts:list'),
    saveSsh: (draft) => ipcRenderer.invoke('hosts:saveSsh', draft),
    remove: (id) => ipcRenderer.invoke('hosts:remove', id),
    sshConfigSuggestions: () => ipcRenderer.invoke('hosts:sshConfigSuggestions'),
    sshConfig: (id) => ipcRenderer.invoke('hosts:sshConfig', id),
    keyCandidates: () => ipcRenderer.invoke('hosts:keyCandidates'),
    forgetPassword: (id) => ipcRenderer.invoke('hosts:forgetPassword', id),
    home: (id) => ipcRenderer.invoke('hosts:home', id),
    onStatus: (cb) => subscribe('hosts:status', cb)
  },
  listDir: (hostId, dir) => ipcRenderer.invoke('fs:list', hostId, dir),
  detectAgents: (hostId) => ipcRenderer.invoke('agents:detect', hostId),
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    cd: (id, dir) => ipcRenderer.invoke('pty:cd', id, dir),
    cwd: (id) => ipcRenderer.invoke('pty:cwd', id),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb)
  },
  wallpaper: {
    choose: () => ipcRenderer.invoke('wallpaper:choose'),
    current: () => ipcRenderer.invoke('wallpaper:current'),
    clear: () => ipcRenderer.invoke('wallpaper:clear')
  }
}

contextBridge.exposeInMainWorld('api', api)
