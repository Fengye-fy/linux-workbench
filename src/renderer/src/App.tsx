import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { AppEnv, DetectedAgent, HostInfo, SshHostDraft } from '../../shared/types'
import { mapPath } from '../../shared/hostpath'
import { AgentPanel, type AgentPanelHandle } from './components/AgentPanel'
import { Explorer } from './components/Explorer'
import { HostDialog } from './components/HostDialog'
import { AgentIcon, CloseIcon, SplitIcon } from './components/icons'
import { SettingsPanel } from './components/SettingsPanel'
import { TerminalPane, type TerminalHandle, type TermOptions } from './components/TerminalPane'
import { TilingView } from './components/TilingView'
import { TitleBar } from './components/TitleBar'
import { chooseSplitDir, computeLayout, containsPane, workspaceReducer } from './layout'
import { applySettings, DEFAULTS, GRADIENTS, loadSettings, saveSettings, type Settings } from './settings'
import { load, save } from './storage'

const EXPLORER_WIDTH = 260
const MIN_AGENT_WIDTH = 320
/** 拉宽 agent 面板时给平铺区至少留这么宽 */
const MIN_TILES_WIDTH = 380

interface PaneInfo {
  hostId: string
  /** 创建时的起始目录，null 表示 home */
  cwd: string | null
}

/** 后端报错前面会带一串 "Error invoking remote method…"，给用户看时去掉 */
const cleanError = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function App() {
  const [env, setEnv] = useState<AppEnv | null>(null)
  const [hosts, setHosts] = useState<HostInfo[]>([])
  /** 每台主机的 home 和资源管理器根目录 */
  const [homes, setHomes] = useState<Record<string, string>>({})
  const [roots, setRoots] = useState<Record<string, string>>({})
  /** 没有终端获得焦点时（比如全关了），资源管理器显示这台主机 */
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null)
  const [ws, dispatch] = useReducer(workspaceReducer, { layout: null, focused: null })
  const [cwds, setCwds] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ initial: SshHostDraft | null; savedPassword?: boolean } | null>(null)
  const tilesRef = useRef<HTMLDivElement>(null)
  // 这些只在事件里读写，不需要触发渲染
  const nextId = useRef(1)
  /** 按最近获得焦点的顺序排列，切回某台主机时找它最近用过的终端 */
  const paneInfo = useRef(new Map<string, PaneInfo>())
  const ptyIds = useRef(new Map<string, number>())
  const handles = useRef(new Map<string, TerminalHandle>())
  const loadingHome = useRef(new Set<string>())

  // agent 面板。焦点在它上面时，双击 cd、拖入路径都作用在 agent 终端
  const [agentHostId, setAgentHostId] = useState<string | null>(null)
  const [agents, setAgents] = useState<DetectedAgent[] | null | 'offline'>(null)
  const [agentRun, setAgentRun] = useState(0)
  const [agentVisible, setAgentVisible] = useState(() => load('agent.visible', true))
  const [agentWidth, setAgentWidth] = useState(() => load('agent.width', 440))
  const [agentFocused, setAgentFocused] = useState(false)
  const [agentCwd, setAgentCwd] = useState<string | null>(null)
  /** agent 的启动目录；null 表示用 agent 所在主机的资源管理器根目录 */
  const [agentDir, setAgentDir] = useState<string | null>(null)
  const agentPanel = useRef<AgentPanelHandle>(null)

  const hostById = (id: string | null): HostInfo | null => hosts.find((h) => h.id === id) ?? null
  const tileHostId = ws.focused ? (paneInfo.current.get(ws.focused)?.hostId ?? null) : null
  const currentHostId = agentFocused ? agentHostId : (tileHostId ?? selectedHostId)
  const currentHost = hostById(currentHostId)
  const agentHost = hostById(agentHostId)

  const newPane = (hostId: string, cwd: string | null): string => {
    const id = `p${nextId.current++}`
    paneInfo.current.set(id, { hostId, cwd })
    return id
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.env(), window.api.hosts.list(), window.api.wallpaper.current()]).then(([e, list, wp]) => {
      if (cancelled) return
      setEnv(e)
      setHosts(list)
      setWallpaperUrl(wp)
      setSelectedHostId(e.defaultHostId)
      // agent 上次选的主机还在就接着用，否则用默认主机
      const lastAgentHost = load<string | null>('agent.host', null)
      setAgentHostId(list.some((h) => h.id === lastAgentHost) ? lastAgentHost : e.defaultHostId)
      if (e.defaultHostId) dispatch({ type: 'open', id: newPane(e.defaultHostId, e.initialDir) })
    })
    const off = window.api.hosts.onStatus((id, status) =>
      setHosts((hs) => hs.map((h) => (h.id === id ? { ...h, status } : h)))
    )
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    applySettings(settings)
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!ws.focused) return
    handles.current.get(ws.focused)?.focus()
    // 挪到最后，记录为这台主机最近用的终端
    const info = paneInfo.current.get(ws.focused)
    if (info) {
      paneInfo.current.delete(ws.focused)
      paneInfo.current.set(ws.focused, info)
      setSelectedHostId(info.hostId)
    }
  }, [ws.focused])

  // 第一次显示某台主机（SSH 要等连上）时读它的 home，作为资源管理器的根目录
  useEffect(() => {
    if (!env) return
    for (const h of [currentHost, agentHost]) {
      if (!h || roots[h.id] || loadingHome.current.has(h.id)) continue
      if (h.kind === 'ssh' && h.status !== 'connected') continue
      loadingHome.current.add(h.id)
      window.api.hosts
        .home(h.id)
        .then((home) => {
          setHomes((m) => ({ ...m, [h.id]: home }))
          const start = h.id === env.defaultHostId && env.initialDir ? env.initialDir : home
          setRoots((m) => (m[h.id] ? m : { ...m, [h.id]: start }))
        })
        .catch(() => {})
        .finally(() => loadingHome.current.delete(h.id))
    }
  }, [env, currentHost?.id, currentHost?.status, agentHost?.id, agentHost?.status, roots])

  // 在 agent 所在主机上检测装了哪些 agent；SSH 主机连上后自动再检测一次
  const agentHostOnline = agentHost ? agentHost.kind !== 'ssh' || agentHost.status === 'connected' : false
  useEffect(() => {
    if (!agentHostId) return
    if (!agentHostOnline) {
      setAgents('offline')
      return
    }
    let alive = true
    setAgents(null)
    window.api.detectAgents(agentHostId).then(
      (a) => alive && setAgents(a),
      () => alive && setAgents('offline')
    )
    return () => {
      alive = false
    }
  }, [agentHostId, agentHostOnline, agentRun])

  /**
   * 拆分 target；没有终端时新开一个。
   * 不指定 hostId 时新终端和 target 同一台主机、继承它当前的目录；指定了就在那台主机的根目录开。
   */
  const split = (target: string | null, hostId?: string): void => {
    const host = hostId ?? (target ? paneInfo.current.get(target)?.hostId : currentHostId) ?? null
    if (!host) {
      setDialog({ initial: null })
      return
    }
    const cwd =
      target && !hostId
        ? (cwds[target] ?? paneInfo.current.get(target)?.cwd ?? null)
        : (roots[host] ?? null)
    setAgentFocused(false)
    const layout = ws.layout
    if (!layout) {
      dispatch({ type: 'open', id: newPane(host, cwd) })
      return
    }
    // 在 target 旁边拆；target 不在了就拆焦点终端
    const anchor = [target, ws.focused].find((t): t is string => !!t && containsPane(layout, t))
    if (!anchor) return
    const box = tilesRef.current
    const rect = computeLayout(layout).panes.get(anchor)
    const dir = box && rect ? chooseSplitDir(rect, box.clientWidth, box.clientHeight) : null
    if (!dir) {
      setNotice('空间不够了，先关掉一个终端或把窗口拉大')
      return
    }
    dispatch({ type: 'split', target: anchor, id: newPane(host, cwd), splitId: `s${nextId.current++}`, dir })
  }

  const close = (id: string): void => {
    dispatch({ type: 'close', id })
    paneInfo.current.delete(id)
    ptyIds.current.delete(id)
    setCwds(({ [id]: _, ...rest }) => rest)
  }

  /** 点标题栏里的主机：有终端就切过去，没有就新开一个（SSH 这时开始连接） */
  const selectHost = (id: string): void => {
    setSelectedHostId(id)
    const existing = [...paneInfo.current]
      .reverse()
      .find(([pid, info]) => info.hostId === id && ws.layout && containsPane(ws.layout, pid))?.[0]
    if (existing) {
      setAgentFocused(false)
      dispatch({ type: 'focus', id: existing })
      handles.current.get(existing)?.focus()
      return
    }
    split(ws.focused, id)
  }

  const focusTile = (): void => {
    setAgentFocused(false)
    if (ws.focused) handles.current.get(ws.focused)?.focus()
  }

  const toggleAgent = (show = !agentVisible): void => {
    setAgentVisible(show)
    save('agent.visible', show)
    // 面板这一帧才显示出来，下一帧再给终端焦点
    if (show) requestAnimationFrame(() => agentPanel.current?.focus())
    else focusTile()
  }

  const restartAgent = (): void => setAgentRun((r) => r + 1)

  const selectAgentHost = (id: string): void => {
    setAgentHostId(id)
    setAgentDir(null)
    save('agent.host', id)
    setAgentRun((r) => r + 1)
  }

  /**
   * agent 换到资源管理器当前所在的目录重新启动。目录在别的主机上时换算路径：
   * WSL 的目录给 Windows 上的 agent 用就是 \\wsl.localhost\…；服务器上的目录别处打不开
   */
  const useExplorerDirForAgent = (): void => {
    const from = currentHost
    const dir = from ? roots[from.id] : null
    if (!from || !agentHost || !dir) return
    const mapped = mapPath(dir, from, agentHost)
    if (!mapped) {
      setNotice(
        from.kind === 'ssh'
          ? `${agentHost.name}上的 agent 打不开服务器上的目录：在 ${from.name} 上装好 agent，再把 agent 切到那台服务器`
          : `${agentHost.name}上的 agent 打不开 ${from.name} 上的目录`
      )
      return
    }
    setAgentDir(mapped)
    setAgentRun((r) => r + 1)
  }

  const resizeAgent = (width: number): void => {
    const max = Math.max(MIN_AGENT_WIDTH, window.innerWidth - EXPLORER_WIDTH - MIN_TILES_WIDTH)
    const w = Math.round(Math.min(Math.max(width, MIN_AGENT_WIDTH), max))
    setAgentWidth(w)
    save('agent.width', w)
  }

  const updateSettings = (patch: Partial<Settings>): void => setSettings((s) => ({ ...s, ...patch }))

  const chooseWallpaper = async (): Promise<void> => {
    const url = await window.api.wallpaper.choose()
    if (!url) return
    setWallpaperUrl(url)
    updateSettings({ wallpaper: 'image' })
  }

  const clearWallpaper = async (): Promise<void> => {
    await window.api.wallpaper.clear()
    setWallpaperUrl(null)
    if (settings.wallpaper === 'image') updateSettings({ wallpaper: DEFAULTS.wallpaper })
  }

  const refreshHosts = async (): Promise<void> => setHosts(await window.api.hosts.list())

  const closePanesOn = (hostId: string): void => {
    for (const [pid, info] of [...paneInfo.current]) if (info.hostId === hostId) close(pid)
  }

  const saveHost = async (draft: SshHostDraft): Promise<void> => {
    try {
      // 改了配置会断开旧连接，这台主机上的终端一起关掉，按新配置重连
      if (draft.id) closePanesOn(draft.id)
      const info = await window.api.hosts.saveSsh(draft)
      await refreshHosts()
      setDialog(null)
      if (!draft.id) selectHost(info.id)
    } catch (e) {
      throw new Error(cleanError(e))
    }
  }

  const deleteHost = async (id: string): Promise<void> => {
    closePanesOn(id)
    if (agentHostId === id) {
      setAgentHostId(env?.defaultHostId ?? null)
      save('agent.host', null)
    }
    if (selectedHostId === id) setSelectedHostId(env?.defaultHostId ?? null)
    await window.api.hosts.remove(id)
    await refreshHosts()
    setDialog(null)
  }

  const editHost = async (id: string): Promise<void> => {
    const [cfg, list] = await Promise.all([window.api.hosts.sshConfig(id), window.api.hosts.list()])
    setHosts(list)
    if (cfg) setDialog({ initial: cfg, savedPassword: list.find((h) => h.id === id)?.savedPassword })
  }

  /** 当前焦点终端：agent 或平铺区里的焦点窗格 */
  const target = (): { pty?: number; handle?: TerminalHandle | null } =>
    agentFocused
      ? { pty: agentPanel.current?.pty() ?? undefined, handle: agentPanel.current }
      : ws.focused
        ? { pty: ptyIds.current.get(ws.focused), handle: handles.current.get(ws.focused) }
        : {}

  const openDir = async (dir: string): Promise<void> => {
    const { pty, handle } = target()
    if (pty === undefined) {
      setNotice('没有打开的终端')
      return
    }
    const res = await window.api.pty.cd(pty, dir)
    if (!res.ok) {
      setNotice(
        res.reason === 'busy'
          ? `终端正在运行${res.process ? ` ${res.process}` : '程序'}，没有切换目录`
          : res.reason === 'connecting'
            ? '终端还在登录，登录后再试'
            : '终端已退出'
      )
    }
    handle?.focus()
  }

  const bumpFont = (delta: number | null): void =>
    updateSettings({
      termFontSize: delta === null ? DEFAULTS.termFontSize : Math.min(24, Math.max(11, settings.termFontSize + delta))
    })

  // 在捕获阶段拦截快捷键，抢在 xterm 之前，不让按键发进 shell
  const shortcuts = useRef<Record<string, () => void>>({})
  shortcuts.current = {
    // 焦点在 agent 面板时，拆分 / 关闭作用在 agent 分身上
    'ctrl+shift+Enter': () => (agentFocused ? agentPanel.current?.split() : split(ws.focused)),
    // agent 面板上按关闭只是隐藏，会话保留
    // 最后一个 agent 分身上按关闭只是隐藏面板，会话保留
    'ctrl+shift+KeyW': () =>
      agentFocused ? agentPanel.current?.closeFocused() || toggleAgent(false) : ws.focused && close(ws.focused),
    'ctrl+shift+KeyA': () => toggleAgent(),
    'ctrl+Comma': () => setSettingsOpen((o) => !o),
    'ctrl+Equal': () => bumpFont(1),
    'ctrl+NumpadAdd': () => bumpFont(1),
    'ctrl+Minus': () => bumpFont(-1),
    'ctrl+NumpadSubtract': () => bumpFont(-1),
    'ctrl+Digit0': () => bumpFont(null),
    'ctrl+Numpad0': () => bumpFont(null)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.metaKey || !e.ctrlKey) return
      const action = shortcuts.current[`ctrl+${e.shiftKey ? 'shift+' : ''}${e.code}`]
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      action()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const termOptions: TermOptions = useMemo(
    () => ({
      fontSize: settings.termFontSize,
      fontFamily: settings.termFontFamily,
      lineHeight: settings.termLineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink
    }),
    [settings.termFontSize, settings.termFontFamily, settings.termLineHeight, settings.cursorStyle, settings.cursorBlink]
  )

  const background =
    settings.wallpaper === 'image' && wallpaperUrl
      ? `center / cover no-repeat url("${wallpaperUrl}")`
      : GRADIENTS[settings.wallpaper === 'image' ? 'aurora' : settings.wallpaper].css

  if (!env) return <div className="wallpaper" style={{ background }} />

  const explorerHostId = currentHostId
  return (
    <div className="app">
      <div className="wallpaper" style={{ background }} />
      <div className="wallpaper-dim" />
      <TitleBar
        hosts={hosts}
        currentHostId={currentHostId}
        onSelectHost={selectHost}
        onAddHost={() => setDialog({ initial: null })}
        onEditHost={(id) => void editHost(id)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="workspace" style={{ gridTemplateColumns: `${EXPLORER_WIDTH}px minmax(0, 1fr) auto` }}>
        <Explorer
          host={currentHost}
          root={explorerHostId ? (roots[explorerHostId] ?? null) : null}
          home={explorerHostId ? (homes[explorerHostId] ?? null) : null}
          activeDir={agentFocused ? agentCwd : ws.focused ? (cwds[ws.focused] ?? null) : null}
          onRootChange={(dir) => explorerHostId && setRoots((m) => ({ ...m, [explorerHostId]: dir }))}
          onOpenDir={openDir}
          onConnect={() => explorerHostId && selectHost(explorerHostId)}
        />
        <main className="terminal-area">
          {ws.layout ? (
            <TilingView
              layout={ws.layout}
              containerRef={tilesRef}
              onRatioChange={(splitId, ratio) => dispatch({ type: 'resize', splitId, ratio })}
              renderPane={(id) => {
                const info = paneInfo.current.get(id)
                const host = hostById(info?.hostId ?? null)
                if (!info || !host) return null
                return (
                  <TerminalPane
                    ref={(h) => {
                      if (h) handles.current.set(id, h)
                      else handles.current.delete(id)
                    }}
                    hostId={host.id}
                    hostName={host.name}
                    flavor={host.kind === 'windows' ? 'powershell' : 'posix'}
                    cwd={info.cwd}
                    home={homes[host.id] ?? null}
                    autoFocus
                    focused={id === ws.focused && !agentFocused}
                    options={termOptions}
                    onReady={(pty) => ptyIds.current.set(id, pty)}
                    onCwdChange={(c) => setCwds((m) => (m[id] === c ? m : { ...m, [id]: c }))}
                    onFocus={() => {
                      setAgentFocused(false)
                      dispatch({ type: 'focus', id })
                    }}
                    onExit={() => close(id)}
                    actions={
                      <>
                        <button className="icon-btn small" title="拆分（Ctrl+Shift+Enter）" onClick={() => split(id)}>
                          <SplitIcon />
                        </button>
                        <button className="icon-btn small" title="关闭（Ctrl+Shift+W）" onClick={() => close(id)}>
                          <CloseIcon />
                        </button>
                      </>
                    }
                  />
                )
              }}
            />
          ) : (
            <div className="empty">
              {hosts.length === 0 ? (
                <div className="welcome glass">
                  <h2>欢迎使用 Linux Workbench</h2>
                  <p>没有检测到 WSL。添加一台服务器，就能在这里管理它的终端和文件。</p>
                  <button className="btn primary" onClick={() => setDialog({ initial: null })}>
                    添加服务器
                  </button>
                </div>
              ) : (
                <>
                  <button className="btn primary" onClick={() => split(null)}>
                    在 {currentHost?.name ?? '当前主机'} 上新建终端
                  </button>
                  <span className="hint">Ctrl+Shift+Enter</span>
                </>
              )}
            </div>
          )}
          {notice && (
            <div className="toast" key={notice}>
              {notice}
            </div>
          )}
        </main>
        <AgentPanel
          ref={agentPanel}
          host={agentHost}
          hosts={hosts}
          onSelectHost={selectAgentHost}
          agents={agents}
          cwd={agentDir ?? (agentHostId ? (roots[agentHostId] ?? null) : null)}
          home={agentHostId ? (homes[agentHostId] ?? null) : null}
          visible={agentVisible}
          width={agentWidth}
          focused={agentFocused}
          run={agentRun}
          options={termOptions}
          onResize={resizeAgent}
          onHide={() => toggleAgent(false)}
          onRestart={restartAgent}
          onUseExplorerDir={useExplorerDirForAgent}
          onFocus={() => setAgentFocused(true)}
          onCwdChange={setAgentCwd}
          onNotice={setNotice}
        />
        {!agentVisible && (
          <button className="agent-rail glass" title="显示 agent（Ctrl+Shift+A）" onClick={() => toggleAgent(true)}>
            <AgentIcon />
          </button>
        )}
      </div>
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          wallpaperUrl={wallpaperUrl}
          onChange={updateSettings}
          onChooseWallpaper={() => void chooseWallpaper()}
          onClearWallpaper={() => void clearWallpaper()}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {dialog && (
        <HostDialog
          initial={dialog.initial}
          savedPassword={dialog.savedPassword}
          onSave={saveHost}
          onForgetPassword={dialog.initial?.id ? () => window.api.hosts.forgetPassword(dialog.initial!.id!) : undefined}
          onDelete={dialog.initial?.id ? () => deleteHost(dialog.initial!.id!) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
