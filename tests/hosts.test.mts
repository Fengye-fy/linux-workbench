import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import {
  agentDetectScript,
  parseAgentDetect,
  parseListing,
  PidMarkerFilter,
  shellLaunchScript
} from '../src/main/hosts/scripts.ts'
import { checkHostKey, formatKnownHost, keyTypeOf, parseKnownHosts } from '../src/main/hosts/known-hosts.ts'
import { parseSshConfig } from '../src/main/hosts/ssh-config.ts'

test('启动脚本：先报 pid，目录加引号，最后 exec 登录 shell', () => {
  const s = shellLaunchScript({ cwd: "/home/ros/it's src" })
  const lines = s.split('\n')
  assert.match(lines[0], /^printf '\\033\]7777;wb-pid=%s\\007' \$\$$/)
  assert.ok(s.includes(`cd -- '/home/ros/it'\\''s src' 2>/dev/null || cd`))
  assert.match(lines.at(-1)!, /^exec "\$s" -l$/)
  assert.ok(shellLaunchScript({ cwd: null }).includes('\ncd\n'))
  assert.ok(!s.includes('[2J'))
  // WSL：报完 pid 立刻清屏，连 ConPTY 的缓冲一起清掉
  assert.equal(shellLaunchScript({ cwd: null, clear: true }).split('\n')[1], String.raw`printf '\033[H\033[2J\033[3J'`)
})

test('启动 agent：在登录交互 shell 里跑，退出后留在 shell', () => {
  const s = shellLaunchScript({ cwd: '/ws', agent: 'claude', pathPrefix: '/tmp/fake bin' })
  assert.ok(s.includes(`PATH='/tmp/fake bin':$PATH; export PATH`))
  assert.match(s.split('\n').at(-1)!, /^exec "\$s" -ilc 'claude; exec "\$SHELL" -il'$/)
})

test('目录列表：NUL 分隔，文件夹在前，根目录拼路径不多斜杠', () => {
  const out = 'f/b.txt\0d/src\0f/a b\0d/.git\0'
  assert.deepEqual(parseListing('/ws/', out), [
    { name: '.git', path: '/ws/.git', isDir: true },
    { name: 'src', path: '/ws/src', isDir: true },
    { name: 'a b', path: '/ws/a b', isDir: false },
    { name: 'b.txt', path: '/ws/b.txt', isDir: false }
  ])
  assert.deepEqual(parseListing('/', 'd/etc\0').map((e) => e.path), ['/etc'])
})

test('pid 标记：跨数据块也能截下来，并从输出里去掉', () => {
  let pid = 0
  const f = new PidMarkerFilter((p) => (pid = p))
  assert.equal(f.push('\x1b]7777;wb-'), '')
  assert.equal(f.push('pid=4242\x07hello'), 'hello')
  assert.equal(pid, 4242)
  assert.equal(f.push(' world'), ' world')
  // 一直等不到标记就原样吐出
  const g = new PidMarkerFilter(() => assert.fail())
  assert.equal(g.push('x'.repeat(9000)).length, 9000)
  // dropBefore：标记前 wsl.exe 打的警告丢掉，标记后的照常输出
  const w = new PidMarkerFilter(() => {}, true)
  assert.equal(w.push('wsl: A localhost proxy configuration…\r\n\x1b]7777;wb-pid=7\x07$ '), '$ ')
  // dropBefore 但一直没标记（wsl.exe 出错）：照常显示
  const e = new PidMarkerFilter(() => {}, true)
  e.push('wsl: 找不到发行版')
  assert.equal(e.flush(), 'wsl: 找不到发行版')
})

test('agent 检测：只认 found: 开头的行', () => {
  assert.ok(agentDetectScript(['claude']).includes('exec "$s" -ilc'))
  const found = parseAgentDetect('Welcome!\nfound:claude:/usr/bin/claude\nfound:codex:alias codex=x\nfound:claude:/opt/claude\n')
  assert.deepEqual([...found], [
    ['claude', '/usr/bin/claude'],
    ['codex', 'alias codex=x']
  ])
})

// 一个假的 ed25519 公钥 blob：uint32 长度 + 类型名 + 随便的内容
const blob = (name: string, fill: number): Buffer => {
  const n = Buffer.from(name)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(n.length)
  return Buffer.concat([len, n, Buffer.alloc(32, fill)])
}

test('known_hosts：明文、端口、通配符、否定', () => {
  const k1 = blob('ssh-ed25519', 1).toString('base64')
  const k2 = blob('ssh-ed25519', 2).toString('base64')
  assert.equal(keyTypeOf(blob('ssh-ed25519', 1)), 'ssh-ed25519')
  const entries = parseKnownHosts(
    [
      '# comment',
      `example.com,1.2.3.4 ssh-ed25519 ${k1}`,
      `[example.com]:2222 ssh-ed25519 ${k2}`,
      `*.lab,!bad.lab ssh-ed25519 ${k1}`
    ].join('\n')
  )
  assert.equal(checkHostKey(entries, 'example.com', 22, 'ssh-ed25519', k1), 'ok')
  assert.equal(checkHostKey(entries, '1.2.3.4', 22, 'ssh-ed25519', k1), 'ok')
  assert.equal(checkHostKey(entries, 'example.com', 22, 'ssh-ed25519', k2), 'mismatch')
  assert.equal(checkHostKey(entries, 'example.com', 2222, 'ssh-ed25519', k2), 'ok')
  assert.equal(checkHostKey(entries, 'example.com', 22, 'ecdsa-sha2-nistp256', k2), 'unknown')
  assert.equal(checkHostKey(entries, 'pi.lab', 22, 'ssh-ed25519', k1), 'ok')
  assert.equal(checkHostKey(entries, 'bad.lab', 22, 'ssh-ed25519', k1), 'unknown')
  assert.equal(checkHostKey(entries, 'other.com', 22, 'ssh-ed25519', k1), 'unknown')
  assert.equal(formatKnownHost('h', 2222, 'ssh-ed25519', k1), `[h]:2222 ssh-ed25519 ${k1}\n`)
})

test('known_hosts：哈希条目和吊销', () => {
  const k = blob('ssh-ed25519', 3).toString('base64')
  const salt = randomBytes(20)
  const hash = createHmac('sha1', salt).update('[10.0.0.5]:2200').digest()
  const entries = parseKnownHosts(
    `|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-ed25519 ${k}\n@revoked * ssh-ed25519 ${blob('ssh-ed25519', 9).toString('base64')}`
  )
  assert.equal(checkHostKey(entries, '10.0.0.5', 2200, 'ssh-ed25519', k), 'ok')
  assert.equal(checkHostKey(entries, '10.0.0.5', 22, 'ssh-ed25519', k), 'unknown')
  assert.equal(checkHostKey(entries, 'any', 22, 'ssh-ed25519', blob('ssh-ed25519', 9).toString('base64')), 'revoked')
})

test('ssh config：取主机、端口、用户、私钥，跳过通配符', () => {
  const text = `
Host *
  User everyone
Host cloud myvps
  HostName 47.1.2.3
  Port 2222
  User root
  IdentityFile ~/.ssh/cloud_key
Host pi
  HostName 192.168.1.9
Match host x
  User nobody
`
  assert.deepEqual(parseSshConfig(text, 'me', '/home/me'), [
    { alias: 'cloud', host: '47.1.2.3', port: 2222, username: 'root', keyPath: '/home/me/.ssh/cloud_key' },
    { alias: 'myvps', host: '47.1.2.3', port: 2222, username: 'root', keyPath: '/home/me/.ssh/cloud_key' },
    { alias: 'pi', host: '192.168.1.9', port: 22, username: 'me', keyPath: undefined }
  ])
})
