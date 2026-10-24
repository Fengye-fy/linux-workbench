import { useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { AGENTS, type AgentId } from '../../../shared/agents'
import type { DetectedAgent } from '../../../shared/types'
import { load, save } from '../storage'
import { HideIcon, RestartIcon } from './icons'
import { TerminalPane, type TerminalHandle } from './TerminalPane'

interface Props {
  /** null 表示还在检测 */
  agents: DetectedAgent[] | null
  /** agent 启动时所在目录（资源管理器的根目录） */
  cwd: string
  home: string
  visible: boolean
  width: number
  focused: boolean
  terminalRef: Ref<TerminalHandle>
  onResize: (width: number) => void
  onHide: () => void
  onRedetect: () => void
  onFocus: () => void
  onReady: (pty: number) => void
  onCwdChange: (cwd: string) => void
}

/**
 * 右侧的 agent 面板：一个跑着 agent CLI 的终端。
 * 隐藏时只是不显示，终端和会话都还在；切换 agent 或重启才会结束当前进程。
 */
export function AgentPanel(props: Props) {
  const { agents, cwd, home, visible, width, focused, terminalRef, onResize, onHide, onRedetect } = props
  const [chosen, setChosen] = useState<AgentId | null>(() => load('agent.selected', null))
  // 每次重启加 1，作为终端的 key 让它重新挂载
  const [run, setRun] = useState(0)
  const [exited, setExited] = useState(false)
  const agent = agents?.find((a) => a.id === chosen) ?? agents?.[0] ?? null

  const choose = (id: AgentId): void => {
    setChosen(id)
    save('agent.selected', id)
    setExited(false)
  }
  const restart = (): void => {
    setExited(false)
    setRun((r) => r + 1)
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

  let content
  if (!agents) {
    content = <div className="agent-empty">正在检测 agent CLI…</div>
  } else if (!agent) {
    content = (
      <div className="agent-empty">
        <h3>没有检测到 agent CLI</h3>
        <p>装好下面任意一个，再点"重新检测"：</p>
        <div className="install-list">
          {AGENTS.map((a) => (
            <div key={a.id}>
              <span>{a.name}</span>
              <code>{a.install}</code>
            </div>
          ))}
        </div>
        <div className="agent-empty-actions">
          <button className="btn" onClick={onRedetect}>
            重新检测
          </button>
          <button className="btn" onClick={onHide}>
            隐藏
          </button>
        </div>
      </div>
    )
  } else if (exited) {
    content = (
      <div className="agent-empty">
        <h3>{agent.id} 已退出</h3>
        <div className="agent-empty-actions">
          <button className="btn" onClick={restart}>
            重新启动
          </button>
          {hideButton}
        </div>
      </div>
    )
  } else {
    content = (
      <TerminalPane
        key={`${agent.id}-${run}`}
        ref={terminalRef}
        cwd={cwd}
        home={home}
        label={agent.id}
        agent={agent.id}
        focused={focused}
        onReady={props.onReady}
        onCwdChange={props.onCwdChange}
        onFocus={props.onFocus}
        onExit={() => setExited(true)}
        actions={
          <>
            {agents.length > 1 && (
              <span className="seg">
                {agents.map((a) => (
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
            <button className="icon-btn small" title="重新启动" onClick={restart}>
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
