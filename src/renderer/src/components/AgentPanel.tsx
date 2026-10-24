import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { AGENTS, type AgentId } from '../../../shared/agents'
import type { DetectedAgent, HostInfo } from '../../../shared/types'
import { load, save } from '../storage'
import { HideIcon, RestartIcon } from './icons'
import { TerminalPane, type TermOptions, type TerminalHandle } from './TerminalPane'

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
  focused: boolean
  /** 每次重启加 1，和主机、agent 一起作为终端的 key */
  run: number
  options: TermOptions
  terminalRef: Ref<TerminalHandle>
  onResize: (width: number) => void
  onHide: () => void
  /** 重新检测并启动 */
  onRestart: () => void
  onFocus: () => void
  onReady: (pty: number) => void
  onCwdChange: (cwd: string) => void
}

/**
 * 右侧的 agent 面板：一个跑着 agent CLI 的终端。
 * 隐藏时只是不显示，终端和会话都还在；切换 agent 或重启才会结束当前进程。
 */
export function AgentPanel(props: Props) {
  const { host, hosts, agents, cwd, home, visible, width, focused, run, options, terminalRef, onResize, onHide, onRestart } =
    props
  const [chosen, setChosen] = useState<AgentId | null>(() => load('agent.selected', null))
  const [exited, setExited] = useState(false)
  const list = Array.isArray(agents) ? agents : []
  const agent = list.find((a) => a.id === chosen) ?? list[0] ?? null

  useEffect(() => setExited(false), [run, host?.id])

  const choose = (id: AgentId): void => {
    setChosen(id)
    save('agent.selected', id)
    setExited(false)
  }

  // 拖左边缘调宽度，往左拖变宽
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent): void => onResize(startWidth + startX - ev.clientX)
    const end = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const hideButton = (
    <button className="icon-btn small" title="隐藏（Ctrl+Shift+A）" onClick={onHide}>
      <HideIcon />
    </button>
  )

  const hostSelect = (
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
  )

  const empty = (title: string, text: ReactNode, retry = '重新检测') => (
    <div className="agent-empty glass">
      {hosts.length > 0 && <div className="agent-host-row">运行在 {hostSelect}</div>}
      <h3>{title}</h3>
      {text}
      <div className="agent-empty-actions">
        <button className="btn" onClick={onRestart}>
          {retry}
        </button>
        <button className="btn ghost" onClick={onHide}>
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
  } else if (!agent) {
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
  } else if (exited) {
    content = empty(`${agent.id} 已退出`, null, '重新启动')
  } else {
    content = (
      <TerminalPane
        key={`${host.id}-${agent.id}-${run}`}
        ref={terminalRef}
        hostId={host.id}
        hostName={host.name}
        flavor={host.kind === 'windows' ? 'powershell' : 'posix'}
        cwd={cwd}
        home={home}
        label={agent.id}
        agent={agent.id}
        focused={focused}
        options={options}
        onReady={props.onReady}
        onCwdChange={props.onCwdChange}
        onFocus={props.onFocus}
        onExit={() => setExited(true)}
        actions={
          <>
            {hostSelect}
            {list.length > 1 && (
              <span className="seg">
                {list.map((a) => (
                  <button
                    key={a.id}
                    className={`seg-btn${a.id === agent.id ? ' on' : ''}`}
                    title={a.path}
                    onClick={() => a.id !== agent.id && choose(a.id)}
                  >
                    {a.id}
                  </button>
                ))}
              </span>
            )}
            <button className="icon-btn small" title="重新启动" onClick={onRestart}>
              <RestartIcon />
            </button>
            {hideButton}
          </>
        }
      />
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
      {content}
    </aside>
  )
}
