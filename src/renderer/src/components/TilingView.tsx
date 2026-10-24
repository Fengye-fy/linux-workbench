import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import {
  computeLayout,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  type Divider,
  type LayoutNode,
  type Rect
} from '../layout'

interface Props {
  layout: LayoutNode
  containerRef: RefObject<HTMLDivElement | null>
  onRatioChange: (splitId: string, ratio: number) => void
  renderPane: (id: string) => ReactNode
}

const pct = (v: number): string => `${v * 100}%`

const tileStyle = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) })

const dividerStyle = ({ dir, rect: r, ratio }: Divider) =>
  dir === 'row'
    ? { left: pct(r.x + r.w * ratio), top: pct(r.y), height: pct(r.h) }
    : { top: pct(r.y + r.h * ratio), left: pct(r.x), width: pct(r.w) }

/**
 * 所有窗格平铺在同一层，用绝对定位摆放：树结构怎么变，终端组件都不会被卸载重建，
 * 位置变化交给 CSS transition 做动画。
 */
export function TilingView({ layout, containerRef, onRatioChange, renderPane }: Props) {
  const { panes, dividers } = useMemo(() => computeLayout(layout), [layout])
  const [dragging, setDragging] = useState(false)

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, d: Divider): void => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setDragging(true)

    const row = d.dir === 'row'
    const start = row ? box.left + d.rect.x * box.width : box.top + d.rect.y * box.height
    const size = row ? d.rect.w * box.width : d.rect.h * box.height
    const min = Math.min((row ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT) / size, 0.5)

    const move = (ev: PointerEvent): void => {
      const ratio = ((row ? ev.clientX : ev.clientY) - start) / size
      onRatioChange(d.splitId, Math.min(Math.max(ratio, min), 1 - min))
    }
    const end = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setDragging(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  return (
    <div ref={containerRef} className={`tiles${dragging ? ' dragging' : ''}`}>
      {[...panes].map(([id, r]) => (
        <div key={id} className="tile" style={tileStyle(r)}>
          {renderPane(id)}
        </div>
      ))}
      {dividers.map((d) => (
        <div
          key={d.splitId}
          className={`divider ${d.dir}`}
          style={dividerStyle(d)}
          title="拖动调整大小，双击恢复对半"
          // 不让分隔条抢走终端的键盘焦点
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => startDrag(e, d)}
          onDoubleClick={() => onRatioChange(d.splitId, 0.5)}
        />
      ))}
    </div>
  )
}
