// 平铺布局：二叉分割树 + 纯函数操作。矩形坐标都是容器宽高的 0~1 比例

/** row：左右并排；column：上下叠放 */
export type SplitDir = 'row' | 'column'

export interface PaneNode {
  type: 'pane'
  id: string
}

export interface SplitNode {
  type: 'split'
  id: string
  dir: SplitDir
  /** 第一个子节点占的比例 */
  ratio: number
  a: LayoutNode
  b: LayoutNode
}

export type LayoutNode = PaneNode | SplitNode

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  splitId: string
  dir: SplitDir
  /** 整个分割节点占的区域，分隔条位于其中 ratio 处 */
  rect: Rect
  ratio: number
}

/** 拆分和拖动时每个终端的最小像素尺寸 */
export const MIN_PANE_WIDTH = 240
export const MIN_PANE_HEIGHT = 120

/** 算出每个窗格的位置和每条分隔条；窗格按树的先序排列，拆分 / 关闭都不会改变已有窗格的相对顺序 */
export function computeLayout(root: LayoutNode): { panes: Map<string, Rect>; dividers: Divider[] } {
  const panes = new Map<string, Rect>()
  const dividers: Divider[] = []
  const walk = (node: LayoutNode, r: Rect): void => {
    if (node.type === 'pane') {
      panes.set(node.id, r)
      return
    }
    dividers.push({ splitId: node.id, dir: node.dir, rect: r, ratio: node.ratio })
    if (node.dir === 'row') {
      const w = r.w * node.ratio
      walk(node.a, { ...r, w })
      walk(node.b, { ...r, x: r.x + w, w: r.w - w })
    } else {
      const h = r.h * node.ratio
      walk(node.a, { ...r, h })
      walk(node.b, { ...r, y: r.y + h, h: r.h - h })
    }
  }
  walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return { panes, dividers }
}

/** 沿较长的边对半切（bspwm 的 dwindle）；这个方向切完太小就换另一个方向，都不行返回 null */
export function chooseSplitDir(r: Rect, width: number, height: number): SplitDir | null {
  const w = r.w * width
  const h = r.h * height
  const rowFits = w / 2 >= MIN_PANE_WIDTH
  const columnFits = h / 2 >= MIN_PANE_HEIGHT
  if (w >= h) return rowFits ? 'row' : columnFits ? 'column' : null
  return columnFits ? 'column' : rowFits ? 'row' : null
}

/** 把 target 窗格一分为二，新窗格放在右边 / 下边 */
export function splitPane(
  node: LayoutNode,
  target: string,
  newId: string,
  splitId: string,
  dir: SplitDir
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== target) return node
    return { type: 'split', id: splitId, dir, ratio: 0.5, a: node, b: { type: 'pane', id: newId } }
  }
  const a = splitPane(node.a, target, newId, splitId, dir)
  const b = splitPane(node.b, target, newId, splitId, dir)
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

/** 删掉窗格，兄弟节点接管父节点的位置；删的是最后一个窗格时返回 null */
export function removePane(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === id ? null : node
  const a = removePane(node.a, id)
  const b = removePane(node.b, id)
  if (!a) return b
  if (!b) return a
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node
  if (node.id === splitId) return { ...node, ratio }
  const a = setRatio(node.a, splitId, ratio)
  const b = setRatio(node.b, splitId, ratio)
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

export const containsPane = (node: LayoutNode, id: string): boolean =>
  node.type === 'pane' ? node.id === id : containsPane(node.a, id) || containsPane(node.b, id)

const edgePane = (node: LayoutNode, side: 'a' | 'b'): string =>
  node.type === 'pane' ? node.id : edgePane(node[side], side)

/** 关掉 id 之后接手焦点的窗格：腾出来的空间归兄弟节点，取其中紧挨着它的那个 */
export function neighborAfterClose(node: LayoutNode, id: string): string | null {
  if (node.type === 'pane') return null
  if (node.a.type === 'pane' && node.a.id === id) return edgePane(node.b, 'a')
  if (node.b.type === 'pane' && node.b.id === id) return edgePane(node.a, 'b')
  return neighborAfterClose(node.a, id) ?? neighborAfterClose(node.b, id)
}

export interface Workspace {
  layout: LayoutNode | null
  focused: string | null
}

export type WorkspaceAction =
  | { type: 'open'; id: string }
  | { type: 'split'; target: string; id: string; splitId: string; dir: SplitDir }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'resize'; splitId: string; ratio: number }

export function workspaceReducer(s: Workspace, a: WorkspaceAction): Workspace {
  switch (a.type) {
    case 'open':
      return s.layout ? s : { layout: { type: 'pane', id: a.id }, focused: a.id }
    case 'split':
      if (!s.layout) return s
      return { layout: splitPane(s.layout, a.target, a.id, a.splitId, a.dir), focused: a.id }
    case 'close': {
      if (!s.layout) return s
      const focused = s.focused === a.id ? neighborAfterClose(s.layout, a.id) : s.focused
      return { layout: removePane(s.layout, a.id), focused }
    }
    case 'focus':
      // 正在关闭的窗格可能还会触发一次 focus 事件，不在树里的直接忽略
      if (s.focused === a.id || !s.layout || !containsPane(s.layout, a.id)) return s
      return { ...s, focused: a.id }
    case 'resize':
      return s.layout ? { ...s, layout: setRatio(s.layout, a.splitId, a.ratio) } : s
  }
}
