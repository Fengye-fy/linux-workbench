import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathForInsert, shellQuote } from '../src/shared/shell.ts'

test('普通路径不加引号，特殊字符才加', () => {
  assert.equal(shellQuote('/home/ros/dev_ws/src'), '/home/ros/dev_ws/src')
  assert.equal(shellQuote('/tmp/a b'), "'/tmp/a b'")
  assert.equal(shellQuote("/tmp/it's"), `'/tmp/it'\\''s'`)
  assert.equal(shellQuote('/tmp/$HOME'), "'/tmp/$HOME'")
  assert.equal(shellQuote('~/x'), "'~/x'")
  assert.equal(shellQuote(''), "''")
})

test('拖进 shell：绝对路径 + 空格', () => {
  assert.equal(pathForInsert('/ws/src/a.py', '/ws', false), '/ws/src/a.py ')
  assert.equal(pathForInsert("/ws/it's src", '/ws', false), `'/ws/it'\\''s src' `)
})

test('拖进 agent：cwd 下用 @相对路径，外面用 @绝对路径，带空白退回引号路径', () => {
  assert.equal(pathForInsert('/ws/src/a.py', '/ws', true), '@src/a.py ')
  assert.equal(pathForInsert('/ws', '/ws', true), '@. ')
  assert.equal(pathForInsert('/wsx/a.py', '/ws', true), '@/wsx/a.py ')
  assert.equal(pathForInsert('/etc/hosts', null, true), '@/etc/hosts ')
  assert.equal(pathForInsert('/ws/my notes.md', '/ws', true), "'/ws/my notes.md' ")
})
