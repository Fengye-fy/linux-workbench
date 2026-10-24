// 冒烟测试用的本地 SSH 服务器：密码认证，收到的命令和终端都转发进 WSL 发行版里执行。
// 只监听 127.0.0.1，测试结束就关。
import ssh2 from 'ssh2'
import pty from 'node-pty'
import { spawn } from 'node:child_process'

const { Server, utils } = ssh2

/** 和应用里一样：脚本放在环境变量里通过 WSLENV 带进 WSL，避开 Windows 命令行转义 */
const wslArgs = (distro) => ['-d', distro, '--exec', 'sh', '-c', 'eval "$WB_SCRIPT"']
const wslEnv = (script) => ({
  ...process.env,
  WB_SCRIPT: script,
  TERM: 'xterm-256color',
  WSLENV: [process.env.WSLENV, 'WB_SCRIPT/u', 'TERM/u'].filter(Boolean).join(':')
})

export function startTestServer({ distro, username = 'tester', password = 'test' }) {
  const hostKey = utils.generateKeyPairSync('ed25519').private
  const clients = new Set()
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        let ptyInfo = null
        let term = null
        session.on('pty', (ok, _reject, info) => {
          ptyInfo = info
          ok?.()
        })
        session.on('window-change', (ok, _reject, info) => {
          term?.resize(info.cols, info.rows)
          ok?.()
        })
        session.on('exec', (ok, _reject, info) => {
          const ch = ok()
          if (ptyInfo) {
            term = pty.spawn('wsl.exe', wslArgs(distro), {
              cols: ptyInfo.cols,
              rows: ptyInfo.rows,
              // 用系统自带的 ConPTY：node-pty 自带的新版会发设备属性查询，应答经 SSH 绕回来会被当成输入
              env: wslEnv(info.command)
            })
            let exited = false
            term.onData((d) => ch.write(d))
            ch.on('data', (d) => term.write(d.toString('utf8')))
            ch.on('close', () => {
              if (!exited) term.kill()
            })
            term.onExit(({ exitCode }) => {
              exited = true
              ch.exit(exitCode)
              ch.end()
            })
          } else {
            const proc = spawn('wsl.exe', wslArgs(distro), { env: wslEnv(info.command), windowsHide: true })
            proc.stdout.pipe(ch, { end: false })
            proc.stderr.pipe(ch.stderr, { end: false })
            ch.pipe(proc.stdin)
            proc.on('close', (code) => {
              ch.exit(code ?? 1)
              ch.end()
            })
          }
        })
      })
    })
    client.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        /** 断开所有客户端（应用那边会看到"连接已断开"）并停止监听 */
        close: () =>
          new Promise((r) => {
            for (const c of clients) c.end()
            server.close(() => r())
          })
      })
    })
  })
}
