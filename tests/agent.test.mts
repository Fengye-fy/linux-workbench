import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPath } from '../src/shared/hostpath.ts'
import { shellLaunchScript } from '../src/main/hosts/scripts.ts'
import { psLaunchScript } from '../src/main/hosts/ps-scripts.ts'

const wsl = { id: 'wsl:Ubuntu-24.04', kind: 'wsl' as const }
const win = { id: 'windows', kind: 'windows' as const }
const ssh = { id: 'ssh:abcd', kind: 'ssh' as const }

test('WSL 目录给 Windows 用：换成 \\\\wsl.localhost 路径', () => {
  assert.equal(mapPath('/home/ros/dev_ws', wsl, win), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ros\\dev_ws')
  assert.equal(mapPath('/', wsl, win), '\\\\wsl.localhost\\Ubuntu-24.04\\')
})

test('Windows 目录给 WSL 用：盘符换成 /mnt/x，wsl.localhost 换回 Linux 路径', () => {
  assert.equal(mapPath('C:\\Users\\Admin1\\Desktop', win, wsl), '/mnt/c/Users/Admin1/Desktop')
  assert.equal(mapPath('D:\\', win, wsl), '/mnt/d')
  assert.equal(mapPath('\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\x', win, wsl), '/tmp/x')
  assert.equal(mapPath('\\\\wsl$\\ubuntu-24.04', win, wsl), '/')
  // 别的发行版的目录不行
  assert.equal(mapPath('\\\\wsl.localhost\\Debian\\tmp', win, wsl), null)
})

test('服务器上的目录别的主机打不开，同一台主机原样返回', () => {
  assert.equal(mapPath('/root', ssh, win), null)
  assert.equal(mapPath('/root', ssh, wsl), null)
  assert.equal(mapPath('C:\\x', win, ssh), null)
  assert.equal(mapPath('/root', ssh, ssh), '/root')
})

test('分叉的 agent：Linux 主机上带 --continue --fork-session，退出后留在 shell', () => {
  const s = shellLaunchScript({ cwd: '/ws', agent: 'claude', agentArgs: ['--continue', '--fork-session'] })
  assert.match(s.split('\n').at(-1)!, /^exec "\$s" -ilc 'claude --continue --fork-session; exec "\$SHELL" -il'$/)
})

test('分叉的 agent：PowerShell 里也带上参数', () => {
  const s = psLaunchScript({ cwd: null, agent: 'claude', agentArgs: ['--continue', '--fork-session'] })
  assert.ok(s.endsWith("if ($c) { & $c.Source '--continue' '--fork-session' } else { & claude '--continue' '--fork-session' }"))
  const plain = psLaunchScript({ cwd: null, agent: 'claude' })
  assert.ok(plain.endsWith('if ($c) { & $c.Source } else { & claude }'))
})
