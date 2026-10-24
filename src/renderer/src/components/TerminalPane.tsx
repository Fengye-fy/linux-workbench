import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type ReactNode
} from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AgentId } from '../../../shared/agents'
import { pathForInsert, type ShellFlavor } from '../../../shared/shell'
import { pathMime, tildify } from '../paths'
import { termFontStack, type CursorStyle } from '../settings'

export interface TerminalHandle {
  focus: () => void
}

export interface TermOptions {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
}

interface Props {
  hostId: string
  hostName: string
  /** 主机上 shell 的类型，决定拖入路径时引号怎么加 */
  flavor: ShellFlavor
  /** 只在创建时使用，之后切目录走 cd；null 表示 home */
  cwd: string | null
  home: string | null
  /** 标题栏最前面的名字（agent 名），普通终端不显示 */
  label?: string
  /** 设置后终端里跑的是这个 agent，拖入路径时插入 @相对路径 */
  agent?: AgentId
  focused: boolean
  /** 创建后立刻抢键盘焦点（agent 面板后台启动，不抢） */
  autoFocus?: boolean
  options: TermOptions
  /** 标题栏右侧的按钮 */
  actions?: ReactNode
  onReady: (id: number) => void
  onCwdChange: (cwd: string) => void
  onFocus: () => void
  /** shell 自己退出了（比如输入 exit） */
  onExit: () => void
}

/** Catppuccin Mocha；背景透明，透出面板和壁纸 */
const theme: ITheme = {
  background: 'rgba(0, 0, 0, 0)',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(147, 153, 178, 0.35)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
}

export const TerminalPane = forwardRef<TerminalHandle, Props>(function TerminalPane(props, ref) {
  const { hostId, hostName, flavor, cwd, home, label, agent, focused, autoFocus, options, actions, onFocus } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [title, setTitle] = useState<string | null>(cwd)
  const [dropping, setDropping] = useState(false)
  // 回调放进 ref，effect 只跑一次也能拿到最新的
  const callbacks = useRef(props)
  callbacks.current = props

  useImperativeHandle(ref, () => ({ focus: () => termRef.current?.focus() }), [])

  useEffect(() => {
    const term = new Terminal({
      fontFamily: termFontStack(options.fontFamily),
      fontSize: options.fontSize,
      lineHeight: options.lineHeight,
      cursorStyle: options.cursorStyle,
      cursorBlink: options.cursorBlink,
      cursorInactiveStyle: 'outline',
      allowTransparency: true,
      scrollback: 5000,
      theme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // 和 Windows Terminal 一样：有选中内容时 Ctrl+C 复制，Ctrl+V 交给浏览器粘贴
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      return !(key === 'v')
    })

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
      // 输出停下 300ms 再查一次当前目录，避免每个数据块都去问主机
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

    window.api.pty.create({ hostId, cols: term.cols, rows: term.rows, cwd, agent }).then((newId) => {
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
      fitRef.current = null
    }
  }, [])

  // 设置里改字号、字体、光标，已经打开的终端也跟着变
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = termFontStack(options.fontFamily)
    term.options.fontSize = options.fontSize
    term.options.lineHeight = options.lineHeight
    term.options.cursorStyle = options.cursorStyle
    term.options.cursorBlink = options.cursorBlink
    fitRef.current?.fit()
  }, [options.fontFamily, options.fontSize, options.lineHeight, options.cursorStyle, options.cursorBlink])

  // 只接同一台主机的资源管理器拖来的路径；preventDefault 同时挡住浏览器把文字塞进 xterm 输入框
  const mime = pathMime(hostId)
  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer.types.includes(mime)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDragLeave = (e: DragEvent<HTMLElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
  }
  const onDrop = (e: DragEvent): void => {
    const path = e.dataTransfer.getData(mime)
    setDropping(false)
    if (!path || !termRef.current) return
    e.preventDefault()
    // 走 paste：程序开了括号粘贴模式时（agent 一般都开）整段当粘贴处理，不会被逐字当快捷键
    termRef.current.paste(pathForInsert(path, title, agent !== undefined, flavor))
    termRef.current.focus()
  }

  return (
    <section
      className={`pane glass${focused ? ' focused' : ''}${dropping ? ' dropping' : ''}`}
      onFocus={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="pane-header" onClick={() => termRef.current?.focus()}>
        {label && <span className="pane-label">{label}</span>}
        <span className="pane-host">{hostName}</span>
        <span className="pane-title">{title ? (home ? tildify(title, home) : title) : '~'}</span>
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
