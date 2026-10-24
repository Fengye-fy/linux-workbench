import { useEffect, useReducer, useRef, useState } from 'react'
import type { AppEnv, DetectedAgent } from '../../shared/types'
import { AgentPanel } from './components/AgentPanel'
import { Explorer } from './components/Explorer'
import { AgentIcon, CloseIcon, SplitIcon } from './components/icons'
import { TerminalPane, type TerminalHandle } from './components/TerminalPane'
import { TilingView } from './components/TilingView'
import { chooseSplitDir, computeLayout, workspaceReducer } from './layout'
import { load, save } from './storage'

const EXPLORER_WIDTH = 240
const MIN_AGENT_WIDTH = 300
/** 拉宽 agent 面板时给平铺区至少留这么宽 */
const MIN_TILES_WIDTH = 360

export default function App() {
  const [env, setEnv] = useState<AppEnv | null>(null)
  const [root, setRoot] = useState('')
  const [ws, dispatch] = useReducer(workspaceReducer, {
    layout: { type: 'pane', id: 'p1' },
    focused: 'p1'
  })
  const [cwds, setCwds] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const tilesRef = useRef<HTMLDivElement>(null)
  // 这些只在事件里读写，不需要触发渲染
  const nextId = useRef(2)
  const startCwds = useRef(new Map<string, string>())
  const ptyIds = useRef(new Map<string, number>())
  const handles = useRef(new Map<string, TerminalHandle>())

  // agent 面板。焦点在它上面时，双击 cd、拖入路径都作用在 agent 终端
  const [agents, setAgents] = useState<DetectedAgent[] | null>(null)
  const [agentVisible, setAgentVisible] = useState(() => load('agent.visible', true))
  const [agentWidth, setAgentWidth] = useState(() => load('agent.width', 420))
  const [agentFocused, setAgentFocused] = useState(false)
  const [agentCwd, setAgentCwd] = useState<string | null>(null)
  const agentPty = useRef<number | null>(null)
  const agentHandle = useRef<TerminalHandle>(null)

  const detectAgents = (): void => {
    setAgents(null)
    window.api.detectAgents().then(setAgents)
  }

  useEffect(() => {
    window.api.env().then((e) => {
      setEnv(e)
      setRoot(e.root)
    })
    detectAgents()
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (ws.focused) handles.current.get(ws.focused)?.focus()
  }, [ws.focused])

  const newPaneId = (startCwd: string): string => {
    const id = `p${nextId.current++}`
    startCwds.current.set(id, startCwd)
    return id
  }

  /** 拆分 target；没有终端时新开一个。新终端继承 target 当前所在的目录 */
  const split = (target: string | null): void => {
    if (!ws.layout || !target) {
      dispatch({ type: 'open', id: newPaneId(root) })
      return
    }
    const box = tilesRef.current
    const rect = computeLayout(ws.layout).panes.get(target)
    const dir = box && rect ? chooseSplitDir(rect, box.clientWidth, box.clientHeight) : null
    if (!dir) {
      setNotice('空间不够了，先关掉一个终端或把窗口拉大')
      return
    }
    const id = newPaneId(cwds[target] ?? startCwds.current.get(target) ?? root)
    setAgentFocused(false)
    dispatch({ type: 'split', target, id, splitId: `s${nextId.current++}`, dir })
  }

  const close = (id: string): void => {
    dispatch({ type: 'close', id })
    startCwds.current.delete(id)
    ptyIds.current.delete(id)
    setCwds(({ [id]: _, ...rest }) => rest)
  }

  const focusTile = (): void => {
    setAgentFocused(false)
    if (ws.focused) handles.current.get(ws.focused)?.focus()
  }

  const toggleAgent = (show = !agentVisible): void => {
    setAgentVisible(show)
    save('agent.visible', show)
    // 面板这一帧才显示出来，下一帧再给终端焦点
    if (show) requestAnimationFrame(() => agentHandle.current?.focus())
    else focusTile()
  }

  const resizeAgent = (width: number): void => {
    const max = Math.max(MIN_AGENT_WIDTH, window.innerWidth - EXPLORER_WIDTH - MIN_TILES_WIDTH)
    const w = Math.round(Math.min(Math.max(width, MIN_AGENT_WIDTH), max))
    setAgentWidth(w)
    save('agent.width', w)
  }

  /** 当前焦点终端：agent 或平铺区里的焦点窗格 */
  const target = (): { pty?: number; handle?: TerminalHandle | null } =>
    agentFocused
      ? { pty: agentPty.current ?? undefined, handle: agentHandle.current }
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
      setNotice(res.reason === 'busy' ? `终端正在运行 ${res.process}，没有切换目录` : '终端已退出')
    }
    handle?.focus()
  }

  // 在捕获阶段拦截快捷键，抢在 xterm 之前，不让按键发进 shell
  const shortcuts = useRef<Record<string, () => void>>({})
  shortcuts.current = {
    Enter: () => split(ws.focused),
    // agent 面板上按关闭只是隐藏，会话保留
    KeyW: () => (agentFocused ? toggleAgent(false) : ws.focused && close(ws.focused)),
    KeyA: () => toggleAgent()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      const action = shortcuts.current[e.code]
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      action()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!env) return null
  return (
    <div className="app">
      <Explorer
        root={root}
        home={env.home}
        activeDir={agentFocused ? agentCwd : ws.focused ? (cwds[ws.focused] ?? null) : null}
        onRootChange={setRoot}
        onOpenDir={openDir}
      />
      <main className="terminal-area">
        {ws.layout ? (
          <TilingView
            layout={ws.layout}
            containerRef={tilesRef}
            onRatioChange={(splitId, ratio) => dispatch({ type: 'resize', splitId, ratio })}
            renderPane={(id) => (
              <TerminalPane
                ref={(h) => {
                  if (h) handles.current.set(id, h)
                  else handles.current.delete(id)
                }}
                cwd={startCwds.current.get(id) ?? env.root}
                home={env.home}
                label={env.shell}
                autoFocus
                focused={id === ws.focused && !agentFocused}
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
            )}
          />
        ) : (
          <div className="empty">
            <button className="btn" onClick={() => split(null)}>
              新建终端
            </button>
            <span className="hint">Ctrl+Shift+Enter</span>
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
      </main>
      <AgentPanel
        agents={agents}
        cwd={root}
        home={env.home}
        visible={agentVisible}
        width={agentWidth}
        focused={agentFocused}
        terminalRef={agentHandle}
        onResize={resizeAgent}
        onHide={() => toggleAgent(false)}
        onRedetect={detectAgents}
        onFocus={() => setAgentFocused(true)}
        onReady={(pty) => {
          agentPty.current = pty
        }}
        onCwdChange={setAgentCwd}
      />
      {!agentVisible && (
        <button className="agent-rail" title="显示 agent（Ctrl+Shift+A）" onClick={() => toggleAgent(true)}>
          <AgentIcon />
        </button>
      )}
    </div>
  )
}
