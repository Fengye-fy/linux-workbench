import type { HostInfo } from '../../../shared/types'
import iconUrl from '../assets/icon.svg'
import { EditIcon, PlusIcon, ServerIcon, SettingsIcon, TerminalIcon, WindowsIcon } from './icons'

interface Props {
  hosts: HostInfo[]
  currentHostId: string | null
  onSelectHost: (id: string) => void
  onAddHost: () => void
  onEditHost: (id: string) => void
  onOpenSettings: () => void
}

const STATUS_TEXT = { connected: '已连接', connecting: '连接中', disconnected: '未连接' } as const

/** 自绘标题栏：可拖动窗口，右侧留出系统的最小化 / 最大化 / 关闭按钮 */
export function TitleBar({ hosts, currentHostId, onSelectHost, onAddHost, onEditHost, onOpenSettings }: Props) {
  return (
    <header className="titlebar">
      <div className="brand">
        <img src={iconUrl} alt="" />
        <span>Linux Workbench</span>
      </div>
      <nav className="hosts" aria-label="主机">
        {hosts.map((h) => (
          <button
            key={h.id}
            className={`host-chip${h.id === currentHostId ? ' on' : ''}`}
            title={`${h.name} · ${h.detail} · ${STATUS_TEXT[h.status]}`}
            onClick={() => onSelectHost(h.id)}
          >
            <span className={`status-dot ${h.status}`} />
            {h.kind === 'ssh' ? <ServerIcon /> : h.kind === 'windows' ? <WindowsIcon /> : <TerminalIcon />}
            <span className="host-name">{h.name}</span>
            {h.kind === 'ssh' && (
              <span
                className="chip-edit"
                role="button"
                title="编辑服务器"
                onClick={(e) => {
                  e.stopPropagation()
                  onEditHost(h.id)
                }}
              >
                <EditIcon />
              </span>
            )}
          </button>
        ))}
        <button className="host-add" title="添加服务器" onClick={onAddHost}>
          <PlusIcon />
          <span>服务器</span>
        </button>
      </nav>
      <div className="titlebar-drag" />
      <button className="icon-btn titlebar-btn" title="设置（Ctrl+,）" onClick={onOpenSettings}>
        <SettingsIcon />
      </button>
    </header>
  )
}
