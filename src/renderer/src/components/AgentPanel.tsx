import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { AGENTS, type AgentId } from '../../../shared/agents'
import type { DetectedAgent, HostInfo } from '../../../shared/types'
import { chooseSplitDir, computeLayout, containsPane, workspaceReducer, type Workspace } from '../layout'
import { tildify } from '../paths'
import { load, save } from '../storage'
import { AgentIcon, CloseIcon, FolderIcon, HideIcon, RestartIcon, SplitIcon } from './icons'
import { TerminalPane, type TermOptions, type TerminalHandle } from './TerminalPane'
import { TilingView } from './TilingView'

export interface AgentPanelHandle {
  focus(): void
  /** 焦点分身的终端会话编号 */
  pty(): number | null
  /** 在焦点分身旁边再开一个分身；空间不够时返回 false */
  split(): boolean
  /** 关掉焦点分身；只剩一个时什么都不做、返回 false（交给调用方隐藏面板） */
  closeFocused(): boolean
}

interface Props {
  /** agent 跑在哪台主机上 */
  host: HostInfo | null
  /** 可选的主机，换主机会在那台主机上重新检测、启动 */
  hosts: HostInfo[]
  onSelectHost: (id: string) => void
  /** null 表示还在检测；'offline' 表示 SSH 主机没连上，没法检测 */
  agents: DetectedAgent[] | null | 'offline'
  /** agent 启动时所在目录 */
  cwd: string | null
  home: string | null
  visible: boolean
  width: number
  /** 键盘焦点在 agent 面板里 */
  focused: boolean
  /** 每次重启加 1：所有分身关掉，重新开一个 */
  run: number
  options: TermOptions
  onResize: (width: number) => void
  onHide: () => void
  onRestart: () => void
  /** 换到资源管理器当前所在的目录重新启动 */
  onUseExplorerDir: () => void
  onFocus: () => void
  onCwdChange: (cwd: string) => void
  onNotice: (text: string) => void
}

/** 一个分身：跑哪个 agent、是不是分叉出来的；gen 变了就重新挂载（换 agent 时用） */
interface Clone {
  agent: AgentId
  fork: boolean
  gen: number
}

const EMPTY: Workspace = { layout: null, focused: null }

/**
 * 右侧的 agent 面板。里面也是平铺的：分身（Ctrl+Shift+Enter 或标题栏按钮）把焦点分身的位置一分为二，
 * 在 claude 里敲 /fork 会开一个分叉了当前对话的新分身。
 * 隐藏时只是不显示，所有分身的会话都还在；重启或换主机才会全部结束。
 */
export const AgentPanel = forwardRef<AgentPanelHandle, Props>(function AgentPanel(props, ref) {
  const { host, hosts, agents, cwd, home, visible, width, focused, run, options } = props
  const [chosen, setChosen] = useState<AgentId | null>(() => load('agent.selected', null))
  const [ws, setWs] = useState<Workspace>(EMPTY)
  const [exited, setExited] = useState(false)
  // 改了分身的 agent 后要重新渲染一次
  const [, setTick] = useState(0)
  const clones = useRef(new Map<string, Clone>())
  const ptys = useRef(new Map<string, number>())
  const cwds = useRef(new Map<string, string>())
  const handles = useRef(new Map<string, TerminalHandle>())
  const tilesRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const list = Array.isArray(agents) ? agents : []

  const apply = (action: Parameters<typeof workspaceReducer>[1]): void => setWs((s) => workspaceReducer(s, action))

  const newClone = (clone: Omit<Clone, 'gen'>): string => {
    const id = `a${nextId.current++}`
    clones.current.set(id, { ...clone, gen: 0 })
    return id
  }

  // 主机、检测结果或重启次数变了：所有分身作废，重新开一个
  const resetKey = `${host?.id}|${run}|${Array.isArray(agents) ? agents.map((a) => a.id).join(',') : String(agents)}`
  useEffect(() => {
    clones.current.clear()
    ptys.current.clear()
    cwds.current.clear()
    setExited(false)
    if (!host || list.length === 0) {
      setWs(EMPTY)
      return
    }
    const agent = list.find((a) => a.id === chosen)?.id ?? list[0].id
    const id = newClone({ agent, fork: false })
    setWs({ layout: { type: 'pane', id }, focused: id })
  }, [resetKey])

  useEffect(() => {
    if (!ws.focused) return
    const c = cwds.current.get(ws.focused)
    if (c) props.onCwdChange(c)
    if (focused) handles.current.get(ws.focused)?.focus()
  }, [ws.focused])

  const split = (target: string, fork: boolean): boolean => {
    const layout = ws.layout
    const box = tilesRef.current
    const src = clones.current.get(target)
    if (!layout || !box || !src || !containsPane(layout, target)) return false
    const rect = computeLayout(layout).panes.get(target)!
    const dir = chooseSplitDir(rect, box.clientWidth, box.clientHeight)
    if (!dir) {
      props.onNotice('agent 面板空间不够了：把面板拉宽一点，或者关掉一个分身')
      return false
    }
    const id = newClone({ agent: fork ? 'claude' : src.agent, fork })
    apply({ type: 'split', target, id, splitId: `as${nextId.current++}`, dir })
    return true
  }

  const close = (id: string, byExit = false): void => {
    const last = ws.layout?.type === 'pane'
    apply({ type: 'close', id })
    clones.current.delete(id)
    ptys.current.delete(id)
    cwds.current.delete(id)
    // 最后一个分身里的 agent 自己退出了：显示"已退出"，等用户点重新启动
    if (last && byExit) setExited(true)
  }

  const switchAgent = (id: string, agent: AgentId): void => {
    const c = clones.current.get(id)
    if (!c || c.agent === agent) return
    clones.current.set(id, { agent, fork: false, gen: c.gen + 1 })
    ptys.current.delete(id)
    setChosen(agent)
    save('agent.selected', agent)
    setTick((t) => t + 1)
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (ws.focused) handles.current.get(ws.focused)?.focus()
    },
    pty: () => (ws.focused ? (ptys.current.get(ws.focused) ?? null) : null),
    split: () => (ws.focused ? split(ws.focused, false) : false),
    closeFocused: () => {
      if (!ws.focused || ws.layout?.type !== 'split') return false
      close(ws.focused)
      return true
    }
  }))

  // 拖左边缘调宽度，往左拖变宽
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent): void => props.onResize(startWidth + startX - ev.clientX)
    const end = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const empty = (title: string, text: ReactNode, retry = '重新检测') => (
    <div className="agent-empty glass">
      <h3>{title}</h3>
      {text}
      <div className="agent-empty-actions">
        <button className="btn" onClick={props.onRestart}>
          {retry}
        </button>
        <button className="btn ghost" onClick={props.onHide}>
          隐藏
        </button>
      </div>
    </div>
  )

  let content
  if (!host) {
    content = empty('还没有可用的主机', <p>添加一台服务器后，agent 会在那台主机上运行。</p>)
  } else if (agents === null) {
    content = <div className="agent-empty glass">正在 {host.name} 上检测 agent CLI…</div>
  } else if (agents === 'offline') {
    content = empty(`还没连接 ${host.name}`, <p>先在终端里登录这台服务器，再点"重新检测"。</p>)
  } else if (list.length === 0) {
    content = empty(
      `${host.name} 上没有 agent CLI`,
      <>
        <p>在这台主机上装好下面任意一个，再点"重新检测"：</p>
        <div className="install-list">
          {AGENTS.map((a) => (
            <div key={a.id}>
              <span>{a.name}</span>
              <code>{a.install}</code>
            </div>
          ))}
        </div>
      </>
    )
  } else if (exited || !ws.layout) {
    content = empty('agent 已退出', null, '重新启动')
  } else {
    const multi = ws.layout.type === 'split'
    content = (
      <div className="agent-tiles">
        <TilingView
          layout={ws.layout}
          containerRef={tilesRef}
          onRatioChange={(splitId, ratio) => apply({ type: 'resize', splitId, ratio })}
          renderPane={(id) => {
            const clone = clones.current.get(id)
            if (!clone) return null
            return (
              <TerminalPane
                key={`${id}:${clone.gen}`}
                ref={(h) => {
                  if (h) handles.current.set(id, h)
                  else handles.current.delete(id)
                }}
                hostId={host.id}
                hostName={host.name}
                flavor={host.kind === 'windows' ? 'powershell' : 'posix'}
                cwd={cwd}
                home={home}
                label={clone.fork ? `${clone.agent} · 分叉` : clone.agent}
                agent={clone.agent}
                fork={clone.fork}
                autoFocus={focused}
                focused={focused && id === ws.focused}
                options={options}
                onReady={(pty) => ptys.current.set(id, pty)}
                onCwdChange={(c) => {
                  cwds.current.set(id, c)
                  if (id === ws.focused) props.onCwdChange(c)
                }}
                onFocus={() => {
                  apply({ type: 'focus', id })
                  props.onFocus()
                }}
                onExit={() => close(id, true)}
                onCommand={(line) => {
                  // 在 claude 里敲 /fork：开一个分叉了当前对话的新分身，原来的继续用
                  if (line !== '/fork' || clone.agent !== 'claude') return false
                  split(id, true)
                  return true
                }}
                actions={
                  <>
                    {list.length > 1 && (
                      <span className="seg">
                        {list.map((a) => (
                          <button
                            key={a.id}
                            className={`seg-btn${a.id === clone.agent ? ' on' : ''}`}
                            title={a.path}
                            onClick={() => switchAgent(id, a.id)}
                          >
                            {a.id}
                          </button>
                        ))}
                      </span>
                    )}
                    <button className="icon-btn small" title="分身（Ctrl+Shift+Enter）" onClick={() => split(id, false)}>
                      <SplitIcon />
                    </button>
                    {multi && (
                      <button className="icon-btn small" title="关闭这个分身（Ctrl+Shift+W）" onClick={() => close(id)}>
                        <CloseIcon />
                      </button>
                    )}
                  </>
                }
              />
            )
          }}
        />
      </div>
    )
  }

  return (
    <aside className="agent-panel" hidden={!visible} style={{ width }}>
      <div
        className="agent-resizer"
        title="拖动调整宽度"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={startResize}
      />
      <div className="agent-body">
        <div className="agent-toolbar glass">
          <AgentIcon />
          <select
            className="agent-host"
            value={host?.id ?? ''}
            title="agent 运行在哪台主机上"
            onChange={(e) => props.onSelectHost(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className="agent-dir" title={cwd ?? '主目录'}>
            {cwd ? (home ? tildify(cwd, home) : cwd) : '~'}
          </span>
          <button className="icon-btn small" title="在资源管理器当前目录启动" onClick={props.onUseExplorerDir}>
            <FolderIcon />
          </button>
          <button className="icon-btn small" title="全部重新启动" onClick={props.onRestart}>
            <RestartIcon />
          </button>
          <button className="icon-btn small" title="隐藏（Ctrl+Shift+A）" onClick={props.onHide}>
            <HideIcon />
          </button>
        </div>
        {content}
      </div>
    </aside>
  )
})
