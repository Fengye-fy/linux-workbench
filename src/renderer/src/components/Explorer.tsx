import { useEffect, useState, type DragEvent } from 'react'
import type { DirEntry, HostInfo } from '../../../shared/types'
import { isRootDir, parentDir, pathMime, tildify } from '../paths'
import { RestartIcon, UpIcon } from './icons'

interface Props {
  host: HostInfo | null
  /** 根目录；SSH 主机还没连上时为 null */
  root: string | null
  home: string | null
  /** 焦点终端当前所在目录，高亮显示 */
  activeDir: string | null
  onRootChange: (dir: string) => void
  onOpenDir: (dir: string) => void
  /** SSH 主机没连上时，点按钮开一个终端去登录 */
  onConnect: () => void
}

interface TreeProps {
  hostId: string
  depth: number
  activeDir: string | null
  onOpenDir: (dir: string) => void
}

const indent = (depth: number): number => 10 + depth * 14

/** 文件和文件夹都能拖进同一台主机的终端，插入它的路径 */
const dragPath = (hostId: string, path: string) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData(pathMime(hostId), path)
    e.dataTransfer.setData('text/plain', path)
    e.dataTransfer.effectAllowed = 'copy'
  }
})

export function Explorer({ host, root, home, activeDir, onRootChange, onOpenDir, onConnect }: Props) {
  // 点刷新时加 1，作为目录树的 key 让它整个重新读
  const [reload, setReload] = useState(0)

  let body
  if (!host) {
    body = <div className="explorer-msg">还没有可用的主机</div>
  } else if (!root) {
    body =
      host.kind === 'ssh' && host.status !== 'connected' ? (
        <div className="explorer-msg">
          {host.status === 'connecting' ? '正在连接，在终端里完成登录…' : '还没连接这台服务器'}
          {host.status === 'disconnected' && (
            <button className="btn small" onClick={onConnect}>
              打开终端登录
            </button>
          )}
        </div>
      ) : (
        <div className="explorer-msg">正在读取…</div>
      )
  } else {
    body = (
      <div className="tree" role="tree">
        <DirChildren
          key={`${host.id}:${root}:${host.status}:${reload}`}
          hostId={host.id}
          dir={root}
          depth={0}
          activeDir={activeDir}
          onOpenDir={onOpenDir}
        />
      </div>
    )
  }

  return (
    <aside className="explorer glass">
      <header className="explorer-header">
        <span className="explorer-title">资源管理器</span>
        <span className="explorer-tools">
          <button className="icon-btn" title="刷新" disabled={!root} onClick={() => setReload((r) => r + 1)}>
            <RestartIcon />
          </button>
          <button
            className="icon-btn"
            title="上一级目录"
            disabled={!root || isRootDir(root)}
            onClick={() => root && onRootChange(parentDir(root))}
          >
            <UpIcon />
          </button>
        </span>
      </header>
      {root && (
        <div
          className={`explorer-root${activeDir === root ? ' active' : ''}`}
          title={`${root}（双击进入）`}
          onDoubleClick={() => onOpenDir(root)}
        >
          {home ? tildify(root, home) : root}
        </div>
      )}
      {body}
    </aside>
  )
}

function DirChildren({ dir, ...rest }: TreeProps & { dir: string }) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.listDir(rest.hostId, dir).then(
      (e) => alive && setEntries(e),
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [rest.hostId, dir])

  const msg = failed ? '无法读取' : entries?.length === 0 ? '空文件夹' : null
  if (msg) {
    return (
      <div className="tree-msg" style={{ paddingLeft: indent(rest.depth) + 16 }}>
        {msg}
      </div>
    )
  }
  return (
    <div className="tree-group">
      {entries?.map((e) =>
        e.isDir ? (
          <DirNode key={e.path} entry={e} {...rest} />
        ) : (
          <div
            key={e.path}
            role="treeitem"
            className="tree-row file"
            style={{ paddingLeft: indent(rest.depth) }}
            title={e.path}
            {...dragPath(rest.hostId, e.path)}
          >
            <span className="chevron" />
            <span className="name">{e.name}</span>
          </div>
        )
      )}
    </div>
  )
}

function DirNode({ entry, depth, ...rest }: TreeProps & { entry: DirEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        role="treeitem"
        aria-expanded={open}
        className={`tree-row dir${rest.activeDir === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: indent(depth) }}
        title={`${entry.path}（双击进入）`}
        {...dragPath(rest.hostId, entry.path)}
        // 双击的第二下不再切换展开，否则会闪一下收起
        onClick={(ev) => ev.detail === 1 && setOpen((o) => !o)}
        onDoubleClick={() => {
          setOpen(true)
          rest.onOpenDir(entry.path)
        }}
      >
        <span className={`chevron${open ? ' open' : ''}`} />
        <span className="name">{entry.name}</span>
      </div>
      {open && <DirChildren dir={entry.path} depth={depth + 1} {...rest} />}
    </>
  )
}
