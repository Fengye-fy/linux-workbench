import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type ReactNode
} from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AgentId } from '../../../shared/agents'
import { pathForInsert } from '../../../shared/shell'
import { PATH_MIME, tildify } from '../paths'

export interface TerminalHandle {
  focus: () => void
}

interface Props {
  /** 只在创建时使用，之后切目录走 cd */
  cwd: string
  home: string
  /** 标题栏里 · 前面的名字：shell 名或 agent 名 */
  label: string
  /** 设置后终端里跑的是这个 agent，拖入路径时插入 @相对路径 */
  agent?: AgentId
  focused: boolean
  /** 创建后立刻抢键盘焦点（agent 面板后台启动，不抢） */
  autoFocus?: boolean
  /** 标题栏右侧的按钮 */
  actions?: ReactNode
  onReady: (id: number) => void
  onCwdChange: (cwd: string) => void
  onFocus: () => void
  /** shell 自己退出了（比如输入 exit） */
  onExit: () => void
}

const theme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  selectionBackground: '#264f78'
}

export const TerminalPane = forwardRef<TerminalHandle, Props>(function TerminalPane(
  { cwd, home, label, agent, focused, autoFocus, actions, onReady, onCwdChange, onFocus, onExit },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [title, setTitle] = useState(cwd)
  const [dropping, setDropping] = useState(false)
  // 回调放进 ref，effect 只跑一次也能拿到最新的
  const callbacks = useRef({ onReady, onCwdChange, onExit })
  callbacks.current = { onReady, onCwdChange, onExit }

  useImperativeHandle(ref, () => ({ focus: () => termRef.current?.focus() }), [])

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      theme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fit.fit()
    termRef.current = term

    let id: number | null = null
    let disposed = false
    let cwdTimer: number | undefined
    let fitTimer: number | undefined

    const refreshCwd = (): void => {
      if (id === null) return
      window.api.pty.cwd(id).then((c) => {
        if (!c || disposed) return
        setTitle(c)
        callbacks.current.onCwdChange(c)
      })
    }

    const offData = window.api.pty.onData((pid, data) => {
      if (pid !== id) return
      term.write(data)
      // 输出停下 300ms 再查一次 cwd，避免每个数据块都去读 /proc
      window.clearTimeout(cwdTimer)
      cwdTimer = window.setTimeout(refreshCwd, 300)
    })
    const offExit = window.api.pty.onExit((pid) => {
      if (pid === id) callbacks.current.onExit()
    })
    const inputSub = term.onData((data) => {
      if (id !== null) window.api.pty.write(id, data)
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (id !== null) window.api.pty.resize(id, cols, rows)
    })
    // 平铺动画和拖动分隔条时尺寸每帧都在变，停下来再重算行列，免得 shell 每帧都重排输出
    const ro = new ResizeObserver(() => {
      window.clearTimeout(fitTimer)
      fitTimer = window.setTimeout(() => fit.fit(), 80)
    })
    ro.observe(hostRef.current!)

    window.api.pty.create({ cols: term.cols, rows: term.rows, cwd, agent }).then((newId) => {
      // StrictMode 下 effect 会先卸载一次，创建回来时组件可能已经没了
      if (disposed) {
        window.api.pty.kill(newId)
        return
      }
      id = newId
      callbacks.current.onReady(newId)
      refreshCwd()
    })
    if (autoFocus) term.focus()

    return () => {
      disposed = true
      window.clearTimeout(cwdTimer)
      window.clearTimeout(fitTimer)
      ro.disconnect()
      inputSub.dispose()
      resizeSub.dispose()
      offData()
      offExit()
      if (id !== null) window.api.pty.kill(id)
      term.dispose()
      termRef.current = null
    }
  }, [])

  // 只接资源管理器拖来的路径；preventDefault 同时挡住浏览器把文字塞进 xterm 输入框的默认行为
  const acceptsDrag = (e: DragEvent): boolean => e.dataTransfer.types.includes(PATH_MIME)
  const onDragOver = (e: DragEvent): void => {
    if (!acceptsDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDragLeave = (e: DragEvent<HTMLElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
  }
  const onDrop = (e: DragEvent): void => {
    const path = e.dataTransfer.getData(PATH_MIME)
    setDropping(false)
    if (!path || !termRef.current) return
    e.preventDefault()
    // 走 paste：程序开了括号粘贴模式时（agent 一般都开）整段当粘贴处理，不会被逐字当快捷键
    termRef.current.paste(pathForInsert(path, title, agent !== undefined))
    termRef.current.focus()
  }

  return (
    <section
      className={`pane${focused ? ' focused' : ''}${dropping ? ' dropping' : ''}`}
      onFocus={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="pane-header" onClick={() => termRef.current?.focus()}>
        <span className="pane-title">
          {label} · {tildify(title, home)}
        </span>
        {/* 按钮不冒泡到 header，否则 header 会把焦点抢回这个终端 */}
        <span className="pane-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </header>
      <div className="pane-body">
        <div className="term-host" ref={hostRef} />
      </div>
    </section>
  )
})
