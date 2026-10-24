import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseSplitDir,
  computeLayout,
  neighborAfterClose,
  removePane,
  setRatio,
  splitPane,
  workspaceReducer,
  type LayoutNode,
  type Workspace
} from '../src/renderer/src/layout.ts'

const pane = (id: string): LayoutNode => ({ type: 'pane', id })

// p1 | (p2 / p3)
const three = (): LayoutNode =>
  splitPane(splitPane(pane('p1'), 'p1', 'p2', 's1', 'row'), 'p2', 'p3', 's2', 'column')

test('单个窗格占满容器', () => {
  const { panes, dividers } = computeLayout(pane('p1'))
  assert.deepEqual(panes.get('p1'), { x: 0, y: 0, w: 1, h: 1 })
  assert.equal(dividers.length, 0)
})

test('嵌套拆分的矩形和分隔条', () => {
  const { panes, dividers } = computeLayout(three())
  assert.deepEqual([...panes.keys()], ['p1', 'p2', 'p3'])
  assert.deepEqual(panes.get('p1'), { x: 0, y: 0, w: 0.5, h: 1 })
  assert.deepEqual(panes.get('p2'), { x: 0.5, y: 0, w: 0.5, h: 0.5 })
  assert.deepEqual(panes.get('p3'), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  assert.deepEqual(
    dividers.map((d) => [d.splitId, d.dir, d.rect]),
    [
      ['s1', 'row', { x: 0, y: 0, w: 1, h: 1 }],
      ['s2', 'column', { x: 0.5, y: 0, w: 0.5, h: 1 }]
    ]
  )
})

test('拆分不改变已有窗格的先后顺序', () => {
  const t = splitPane(three(), 'p1', 'p4', 's3', 'column')
  assert.deepEqual([...computeLayout(t).panes.keys()], ['p1', 'p4', 'p2', 'p3'])
})

test('关闭窗格由兄弟节点接管空间', () => {
  const t = removePane(three(), 'p1')!
  assert.deepEqual(computeLayout(t).panes.get('p2'), { x: 0, y: 0, w: 1, h: 0.5 })
  assert.equal(removePane(pane('p1'), 'p1'), null)
  // 删不存在的 id 原样返回
  const orig = three()
  assert.equal(removePane(orig, 'nope'), orig)
})

test('setRatio 只改对应的分割节点', () => {
  const t = setRatio(three(), 's1', 0.3)
  const { panes } = computeLayout(t)
  assert.equal(panes.get('p1')!.w, 0.3)
  assert.ok(Math.abs(panes.get('p2')!.w - 0.7) < 1e-9)
})

test('关闭后焦点交给紧挨着的窗格', () => {
  const t = three()
  assert.equal(neighborAfterClose(t, 'p3'), 'p2')
  assert.equal(neighborAfterClose(t, 'p2'), 'p3')
  // p1 的兄弟是 (p2 / p3)，紧挨 p1 的是它最靠左上的 p2
  assert.equal(neighborAfterClose(t, 'p1'), 'p2')
  assert.equal(neighborAfterClose(pane('p1'), 'p1'), null)
})

test('拆分方向沿较长的边，太小时换方向或拒绝', () => {
  const full = { x: 0, y: 0, w: 1, h: 1 }
  assert.equal(chooseSplitDir(full, 1000, 800), 'row')
  assert.equal(chooseSplitDir(full, 600, 800), 'column')
  assert.equal(chooseSplitDir(full, 900, 200), 'row')
  // 宽 400 切不成两个 240，但高度够
  assert.equal(chooseSplitDir(full, 400, 300), 'column')
  assert.equal(chooseSplitDir(full, 400, 200), null)
})

test('reducer：拆分聚焦新窗格，关闭焦点窗格后焦点转移，关完变空', () => {
  let s: Workspace = { layout: pane('p1'), focused: 'p1' }
  s = workspaceReducer(s, { type: 'split', target: 'p1', id: 'p2', splitId: 's1', dir: 'row' })
  assert.equal(s.focused, 'p2')
  s = workspaceReducer(s, { type: 'focus', id: 'p1' })
  s = workspaceReducer(s, { type: 'close', id: 'p2' })
  assert.equal(s.focused, 'p1')
  // 已经关掉的窗格再发 focus 不生效
  assert.equal(workspaceReducer(s, { type: 'focus', id: 'p2' }), s)
  assert.deepEqual(s.layout, pane('p1'))
  s = workspaceReducer(s, { type: 'close', id: 'p1' })
  assert.deepEqual(s, { layout: null, focused: null })
  s = workspaceReducer(s, { type: 'open', id: 'p3' })
  assert.deepEqual(s, { layout: pane('p3'), focused: 'p3' })
})
