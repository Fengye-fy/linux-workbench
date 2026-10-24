import { useEffect, useState, type DragEvent } from 'react'
import type { DirEntry } from '../../../shared/types'
import { PATH_MIME, parentDir, tildify } from '../paths'
import { UpIcon } from './icons'

interface Props {
  root: string
  home: string
  /** 终端当前所在目录，高亮显示 */
  activeDir: string | null
  onRootChange: (dir: string) => void
  onOpenDir: (dir: string) => void
}

type TreeProps = Pick<Props, 'activeDir' | 'onOpenDir'> & { depth: number }

const indent = (depth: number): number => 8 + depth * 14

/** 文件和文件夹都能拖进终端，插入它的路径 */
const dragPath = (path: string) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData(PATH_MIME, path)
    e.dataTransfer.setData('text/plain', path)
    e.dataTransfer.effectAllowed = 'copy'
  }
})

export function Explorer({ root, home, activeDir, onRootChange, onOpenDir }: Props) {
  return (
    <aside className="explorer">
      <header className="explorer-header">
        <span className="explorer-title">资源管理器</span>
        <button
          className="icon-btn"
          title="上一级目录"
          disabled={root === '/'}
          onClick={() => onRootChange(parentDir(root))}
        >
          <UpIcon />
        </button>
      </header>
      <div
        className={`explorer-root${activeDir === root ? ' active' : ''}`}
        title={`${root}（双击进入）`}
        onDoubleClick={() => onOpenDir(root)}
      >
        {tildify(root, home)}
      </div>
      <div className="tree" role="tree">
        <DirChildren key={root} dir={root} depth={0} activeDir={activeDir} onOpenDir={onOpenDir} />
      </div>
    </aside>
  )
}

function DirChildren({ dir, ...rest }: TreeProps & { dir: string }) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.listDir(dir).then(
      (e) => alive && setEntries(e),
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [dir])

  const msg = failed ? '无法读取' : entries?.length === 0 ? '空文件夹' : null
  if (msg) {
    return (
      <div className="tree-msg" style={{ paddingLeft: indent(rest.depth) + 16 }}>
        {msg}
      </div>
    )
  }
  return (
    <>
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
            {...dragPath(e.path)}
          >
            <span className="chevron" />
            <span className="name">{e.name}</span>
          </div>
        )
      )}
    </>
  )
}

function DirNode({ entry, depth, activeDir, onOpenDir }: TreeProps & { entry: DirEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        role="treeitem"
        aria-expanded={open}
        className={`tree-row dir${activeDir === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: indent(depth) }}
        title={`${entry.path}（双击进入）`}
        {...dragPath(entry.path)}
        // 双击的第二下不再切换展开，否则会闪一下收起
        onClick={(ev) => ev.detail === 1 && setOpen((o) => !o)}
        onDoubleClick={() => {
          setOpen(true)
          onOpenDir(entry.path)
        }}
      >
        <span className={`chevron${open ? ' open' : ''}`} />
        <span className="name">{entry.name}</span>
      </div>
      {open && (
        <DirChildren dir={entry.path} depth={depth + 1} activeDir={activeDir} onOpenDir={onOpenDir} />
      )}
    </>
  )
}
