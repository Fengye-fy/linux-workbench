import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cdCommand, pathForInsert, psQuote } from '../src/shared/shell.ts'
import { encodeCommand, PromptTracker, psAgentDetectScript, psLaunchScript } from '../src/main/hosts/ps-scripts.ts'
import { isRootDir, parentDir, tildify } from '../src/renderer/src/paths.ts'

test('PowerShell 引号：普通 Windows 路径不加，空格和单引号才加', () => {
  assert.equal(psQuote('C:\\Users\\Admin1'), 'C:\\Users\\Admin1')
  assert.equal(psQuote('C:\\My Files'), "'C:\\My Files'")
  assert.equal(psQuote("C:\\it's"), "'C:\\it''s'")
  assert.equal(psQuote('C:\\$env'), "'C:\\$env'")
})

test('cd 命令：POSIX 先清行再 cd --，PowerShell 用 Set-Location -LiteralPath', () => {
  assert.equal(cdCommand('/tmp/a b', 'posix'), "\x05\x15cd -- '/tmp/a b'\r")
  assert.equal(cdCommand('C:\\Users\\Public', 'powershell'), 'Set-Location -LiteralPath C:\\Users\\Public\r')
})

test('拖进 PowerShell / Windows 上的 agent', () => {
  assert.equal(pathForInsert('C:\\ws\\a b.txt', 'C:\\ws', false, 'powershell'), "'C:\\ws\\a b.txt' ")
  assert.equal(pathForInsert('C:\\ws\\src\\a.py', 'C:\\ws', true, 'powershell'), '@src\\a.py ')
  // Windows 路径不区分大小写
  assert.equal(pathForInsert('c:\\WS\\src\\a.py', 'C:\\ws', true, 'powershell'), '@src\\a.py ')
  assert.equal(pathForInsert('D:\\x.md', 'C:\\ws', true, 'powershell'), '@D:\\x.md ')
})

test('PowerShell 启动脚本：UTF-8、包住原来的 prompt、进目录、跑 agent', () => {
  const s = psLaunchScript({ cwd: "C:\\it's here", agent: 'claude', pathPrefix: 'C:\\fake bin' })
  const lines = s.split('\n')
  assert.match(lines[0], /OutputEncoding = \[Text\.UTF8Encoding\]::new\(\)/)
  assert.equal(lines[1], "$env:Path = 'C:\\fake bin' + ';' + $env:Path")
  assert.ok(s.includes('function global:prompt'))
  assert.ok(s.includes(']9;9;'))
  assert.ok(s.includes("Set-Location -LiteralPath 'C:\\it''s here'"))
  assert.match(lines.at(-1)!, /^\$c = Get-Command claude -CommandType Application/)
  assert.ok(psLaunchScript({ cwd: null }).includes('Set-Location -LiteralPath $HOME'))
  assert.ok(!psLaunchScript({ cwd: null }).includes('Get-Command'))
  assert.match(psAgentDetectScript(['claude', 'codex']), /^Get-Command claude,codex -CommandType Application/)
  // -EncodedCommand 是 UTF-16LE 的 base64
  assert.equal(Buffer.from(encodeCommand('dir 中'), 'base64').toString('utf16le'), 'dir 中')
})

test('提示符里的当前目录：截下来、从输出去掉，跨数据块也行', () => {
  const seen: string[] = []
  const t = new PromptTracker((c) => seen.push(c))
  assert.equal(t.push('hello\r\n\x1b]9;9;C:\\Us'), 'hello\r\n')
  assert.equal(t.push('ers\x07PS C:\\Users> '), 'PS C:\\Users> ')
  assert.equal(t.push('\x1b]9;9;C:\\\x07PS C:\\> '), 'PS C:\\> ')
  assert.deepEqual(seen, ['C:\\Users', 'C:\\'])
})

test('Windows 路径：上一级、根目录判断、~ 缩写', () => {
  assert.equal(parentDir('C:\\Users\\Admin1'), 'C:\\Users')
  assert.equal(parentDir('C:\\Users'), 'C:\\')
  assert.equal(parentDir('C:\\'), 'C:\\')
  assert.equal(parentDir('/home/ros'), '/home')
  assert.equal(parentDir('/home'), '/')
  assert.ok(isRootDir('C:\\') && isRootDir('/') && !isRootDir('C:\\Users'))
  assert.equal(tildify('C:\\Users\\Admin1\\Desktop', 'C:\\Users\\Admin1'), '~\\Desktop')
  assert.equal(tildify('c:\\users\\admin1', 'C:\\Users\\Admin1'), '~')
  assert.equal(tildify('/home/ros/ws', '/home/ros'), '~/ws')
  assert.equal(tildify('/home/rosa', '/home/ros'), '/home/rosa')
})
