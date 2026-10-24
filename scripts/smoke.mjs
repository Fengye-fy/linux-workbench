// 冒烟测试（Windows + WSL）：启动真实窗口，把 WSL 终端、agent 面板、设置、平铺、拖放、
// 以及经由本地测试 SSH 服务器的远程终端和资源管理器都走一遍。
// 用法：npm run smoke [截图路径]；默认用默认的 WSL 发行版，可用 WORKBENCH_TEST_DISTRO 指定
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startTestServer } from './ssh-test-server.mjs'

function defaultDistro() {
  const r = spawnSync('wsl.exe', ['-l', '-v'], { encoding: 'utf16le' })
  const m = /^\s*\*\s*(\S+)/m.exec(r.stdout ?? '')
  if (!m) throw new Error('没有找到默认的 WSL 发行版')
  return m[1]
}
const DISTRO = process.env.WORKBENCH_TEST_DISTRO || defaultDistro()

/** 在 WSL 里跑脚本（和应用一样走 WSLENV，避开 Windows 命令行转义） */
const wsl = (script) =>
  spawnSync('wsl.exe', ['-d', DISTRO, '--exec', 'sh', '-c', 'eval "$WB_SCRIPT"'], {
    encoding: 'utf8',
    env: { ...process.env, WB_SCRIPT: script, WSLENV: 'WB_SCRIPT/u' }
  }).stdout

// WSL 里的测试目录：带空格和单引号的目录名测引号转义；假的 claude / codex 打印启动目录并回显输入
const root = wsl(String.raw`root=$(mktemp -d /tmp/wb-smoke-XXXXXX)
mkdir -p "$root/it's src/pkg" "$root/bin"
printf '# notes\n' > "$root/notes.md"
for n in claude codex; do
  printf '#!/bin/sh\necho "FAKE-%s cwd=$PWD"\nwhile IFS= read -r line; do echo "got:$line"; done\n' "$(echo $n | tr a-z A-Z)" > "$root/bin/$n"
  chmod +x "$root/bin/$n"
done
printf '%s' "$root"`)
assert.match(root, /^\/tmp\/wb-smoke-/, '没能在 WSL 里建测试目录')
const tricky = "it's src"
const dataDir = mkdtempSync(join(tmpdir(), 'wb-smoke-data-'))
// Windows 上的假 claude：打印启动目录，读一行再回显。放在 PATH 最前面，盖过本机真装的 claude
const winBin = mkdtempSync(join(tmpdir(), 'wb-smoke-bin-'))
writeFileSync(
  join(winBin, 'claude.cmd'),
  ['@echo off', 'echo FAKE-WIN-CLAUDE %CD%', 'set /p line=', 'echo got:%line%', ''].join('\r\n')
)
const shot = process.argv[2] ?? 'out/smoke.png'
const sideShot = (name) => shot.replace(/(\.png)?$/, `-${name}.png`)
const wallpaperFile = resolve('build/icon.png')

const app = await electron.launch({
  args: ['.', root],
  env: {
    ...process.env,
    WORKBENCH_USER_DATA: dataDir,
    WORKBENCH_PATH_PREFIX: `${root}/bin`,
    WORKBENCH_WIN_PATH_PREFIX: winBin
  }
})
const page = await app.firstWindow()
// 真实鼠标停在窗口上时，Chromium 会按它的位置补发移动事件，打断模拟的拖动；
// 测试期间让窗口不接系统鼠标事件，只收测试注入的（顺便防止误碰）
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setIgnoreMouseEvents(true))
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))
let server = null

const step = (name) => console.log(`✓ ${name}`)
const norm = (s) => (s ?? '').replace(/ /g, ' ')
const rowsText = (i) =>
  page.evaluate((i) => (document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? '').replace(/ /g, ' '), i)
const paneHas = (i, text, timeout = 15000) =>
  page.waitForFunction(
    ([i, t]) => (document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? '').replace(/ /g, ' ').includes(t),
    [i, text],
    { timeout }
  )
const agentHas = (text) =>
  page.waitForFunction(
    (t) => (document.querySelector('.agent-panel .xterm-rows')?.textContent ?? '').replace(/ /g, ' ').includes(t),
    text,
    { timeout: 20000 }
  )
const headerHas = (i, text) =>
  page.waitForFunction(
    ([i, t]) => document.querySelectorAll('.tile .pane-title')[i]?.textContent.includes(t),
    [i, text],
    { timeout: 15000 }
  )
const paneCount = (n) =>
  page.waitForFunction((n) => document.querySelectorAll('.tile:not(.leaving)').length === n, n, { timeout: 8000 })
const focusedIndex = () =>
  page.evaluate(() => [...document.querySelectorAll('.tile:not(.leaving)')].findIndex((t) => t.querySelector('.pane.focused')))
const tileOfHost = (name) =>
  page.evaluate(
    (name) => [...document.querySelectorAll('.tile:not(.leaving)')].findIndex((t) => t.querySelector('.pane-host')?.textContent === name),
    name
  )
const run = async (cmd) => {
  await page.keyboard.type(cmd)
  await page.keyboard.press('Enter')
}
const box = (sel, i = 0) => page.locator(sel).nth(i).boundingBox()
// 布局变化有 0.32s 的过渡动画，量尺寸前先等它走完
const settle = () => page.waitForTimeout(450)
let marker = 0
/** 在焦点终端里查询 shell 看到的列数，用唯一标记从屏幕文字里取结果 */
const ptyCols = async (i) => {
  const m = `C${++marker}`
  await run(`echo ${m}=$(tput cols)=`)
  await page.waitForFunction(
    ([i, m]) => new RegExp(`${m}=\\d+=`).test(document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? ''),
    [i, m],
    { timeout: 10000 }
  )
  return Number((await rowsText(i)).match(new RegExp(`${m}=(\\d+)=`))[1])
}
const termFontSize = () => page.evaluate(() => getComputedStyle(document.querySelector('.tile .xterm-rows')).fontSize)
const dirRow = (name) => page.locator('.tree-row.dir', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })

try {
  // —— 启动 ——
  await page.waitForFunction(() => document.querySelector('.tile .xterm-rows')?.textContent.includes('$'), null, {
    timeout: 40000
  })
  assert.equal(await page.locator('.host-chip.on .host-name').textContent(), DISTRO)
  await page.waitForSelector(`.explorer-root:has-text("${root}")`)
  assert.ok(!(await rowsText(0)).includes('localhost proxy'), 'wsl.exe 的代理警告不应出现在终端里')
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.tile .xterm-viewport')).backgroundColor),
    'rgba(0, 0, 0, 0)',
    '终端背景应该透明'
  )
  step(`启动后进入 WSL（${DISTRO}），资源管理器在命令行给的目录，终端背景透明、没有 wsl.exe 的警告`)

  // —— agent 面板 ——
  await agentHas(`FAKE-CLAUDE cwd=${root}`)
  assert.deepEqual(await page.locator('.agent-panel .seg-btn').allTextContents(), ['claude', 'codex'])
  assert.ok(await page.evaluate(() => document.activeElement?.closest('.tile') !== null), 'agent 后台启动不应抢焦点')
  step('在 WSL 上检测到 claude、codex，claude 在根目录后台启动，不抢焦点')

  await page.dragAndDrop('.tree-row.file:has-text("notes.md")', '.agent-panel .term-host')
  await page.keyboard.press('Enter')
  await agentHas('got:@notes.md')
  step('从资源管理器拖文件进 agent：插入 @相对路径')

  await dirRow(tricky).dblclick()
  await page.waitForSelector('.toast:has-text("claude")', { timeout: 6000 })
  step('agent 运行中双击文件夹不会 cd，提示正在运行 claude')

  await page.click('.agent-panel .seg-btn:has-text("codex")')
  await agentHas('FAKE-CODEX')
  await page.click('.agent-panel .term-host')
  await run('hello-codex')
  await agentHas('got:hello-codex')
  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'hidden' })
  await page.click('.agent-rail')
  await page.waitForSelector('.agent-panel', { state: 'visible' })
  await agentHas('got:hello-codex')
  step('切换到 codex；隐藏再显示，会话还在')

  // —— 设置 ——
  await page.keyboard.press('Control+Comma')
  await page.waitForSelector('.drawer')
  await page.click('.swatch[title="#a6e3a1"]')
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),
    '#a6e3a1'
  )
  // 把选图对话框换成直接返回测试图片
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, wallpaperFile)
  await page.click('.setting-buttons .btn >> nth=0')
  await page.waitForFunction(() => document.querySelector('.wallpaper')?.style.background.includes('wb://wallpaper'))
  const wpWidth = await page.evaluate(async () => {
    const url = /url\("?([^")]+)/.exec(document.querySelector('.wallpaper').style.background)[1]
    const img = new Image()
    img.src = url
    await img.decode()
    return img.naturalWidth
  })
  assert.equal(wpWidth, 512)
  await page.waitForTimeout(400)
  await page.screenshot({ path: sideShot('settings') })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.drawer', { state: 'detached' })
  step('设置：换强调色立刻生效；选图片当壁纸，经 wb:// 协议加载成功；Esc 关闭')

  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'hidden' })
  await page.click('.tile .term-host')
  assert.equal(await termFontSize(), '15px')
  await page.keyboard.press('Control+Equal')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.tile .xterm-rows')).fontSize === '16px')
  await page.keyboard.press('Control+Digit0')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.tile .xterm-rows')).fontSize === '15px')
  step('终端默认 15px（16 寸屏），Ctrl+= 放大、Ctrl+0 还原')

  // —— 平铺终端（WSL）——
  await run('echo hello-$((6*7))')
  await paneHas(0, 'hello-42')
  await page.keyboard.type('echo ')
  await page.dragAndDrop(`.tree-row.dir:has-text("${tricky}")`, '.tile .term-host')
  await page.keyboard.press('Enter')
  await paneHas(0, `${root}/${tricky}`)
  step('终端执行命令；拖文件夹进 shell 插入加了引号的路径')

  await page.keyboard.type('echo w$((1+1)) drop')
  await page.keyboard.press('Control+W')
  await page.keyboard.press('Enter')
  await paneHas(0, 'w2')
  assert.ok(!(await rowsText(0)).includes('w2 drop'), 'Ctrl+W 没有删掉词')
  step('Ctrl+W 交给 shell 删词，不会关窗口')

  await dirRow(tricky).dblclick()
  await headerHas(0, tricky)
  await run('pwd')
  await paneHas(0, `${root}/${tricky}`)
  await page.waitForSelector(`.tree-row.active:has-text("${tricky}")`)
  step('双击文件夹 cd 过去，标题和高亮跟着变')

  await run('sleep 5')
  await page.waitForTimeout(400)
  await dirRow('pkg').dblclick()
  await page.waitForSelector('.toast:has-text("sleep")', { timeout: 6000 })
  await page.keyboard.press('Control+C')
  step('前台有程序时不 cd，给出提示')

  await page.keyboard.press('Control+Shift+Enter')
  await paneCount(2)
  assert.equal(await focusedIndex(), 1)
  await headerHas(1, tricky)
  await settle()
  const [a, b] = [await box('.tile', 0), await box('.tile', 1)]
  assert.ok(b.x > a.x + a.width / 2 && Math.abs(a.y - b.y) < 2, '宽窗口应左右拆分')
  step('Ctrl+Shift+Enter 拆分：左右并排，新终端获得焦点并继承目录')

  await dirRow('pkg').dblclick()
  await headerHas(1, `${tricky}/pkg`)
  assert.ok(!(await page.locator('.tile .pane-title').nth(0).textContent()).includes('pkg'))
  step('双击 cd 只作用在焦点终端')

  const colsBefore = await ptyCols(1)
  const d = await box('.divider')
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2)
  await page.mouse.down()
  await page.mouse.move(d.x + d.width / 2 + 200, d.y + d.height / 2, { steps: 8 })
  await page.mouse.up()
  await settle()
  const [a2, b2] = [await box('.tile', 0), await box('.tile', 1)]
  assert.ok(a2.width - b2.width > 300, `拖动后宽度没变：${a2.width} / ${b2.width}`)
  assert.equal(await focusedIndex(), 1, '拖动分隔条不应改变焦点')
  const colsAfter = await ptyCols(1)
  assert.ok(colsAfter < colsBefore - 10, `shell 列数没跟着变：${colsBefore} → ${colsAfter}`)
  step(`拖动分隔条：窗格变窄，shell 列数 ${colsBefore} → ${colsAfter}，焦点不丢`)

  await page.keyboard.press('Control+Shift+Enter')
  await paneCount(3)
  await settle()
  const [t1, t2] = [await box('.tile', 1), await box('.tile', 2)]
  assert.ok(t2.y > t1.y + t1.height / 2 && Math.abs(t1.x - t2.x) < 2, '窄高的窗格应上下拆分')
  assert.ok(!(await rowsText(0)).includes('localhost proxy'), '改变尺寸后 wsl.exe 的警告不应被 ConPTY 重绘出来')
  step('再拆一次：窄高的窗格改为上下拆分；改变尺寸后 wsl.exe 的警告也没有回来')
  await page.screenshot({ path: shot })

  await page.keyboard.press('Control+Shift+W')
  await paneCount(2)
  assert.equal(await focusedIndex(), 1)
  await run('exit')
  await paneCount(1)
  await settle()
  const [full, tiles] = [await box('.tile', 0), await box('.tiles')]
  assert.ok(full.width > tiles.width - 2, '剩下的终端应占满')
  step('Ctrl+Shift+W 关闭、shell 里 exit 关闭，焦点交给旁边的终端，剩下的占满')

  // —— Windows 本机（PowerShell）——
  await page.click('.host-chip:has-text("本机")')
  await paneCount(2)
  const w = await tileOfHost('本机')
  assert.equal(await focusedIndex(), w)
  await paneHas(w, 'PS ', 40000)
  await run('Write-Output "ps-$(2*3) 中文"')
  await paneHas(w, 'ps-6 中文')
  await page.waitForSelector('.explorer-root:text-is("~")')
  step('点"本机"开 PowerShell 终端：中文正常，资源管理器显示 Windows 的 home')

  await page.click('.explorer-tools button[title="上一级目录"]')
  await page.waitForSelector(String.raw`.explorer-root:text-is("C:\\Users")`)
  await dirRow('Public').dblclick()
  await headerHas(w, String.raw`C:\Users\Public`)
  step('PowerShell 里双击 cd：Set-Location 过去，标题跟着提示符报告的目录变')

  await run('Start-Sleep 4')
  await page.waitForTimeout(400)
  await page.dblclick('.explorer-root')
  await page.waitForSelector('.toast:has-text("正在运行程序")', { timeout: 6000 })
  step('PowerShell 在跑命令时不 cd，给出提示')
  await page.waitForTimeout(4000)

  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'visible' })
  await page.selectOption('.agent-panel select.agent-host', 'windows')
  await agentHas('FAKE-WIN-CLAUDE')
  await page.click('.agent-panel .term-host')
  await run('hi-win')
  await agentHas('got:hi-win')
  step('agent 面板选"本机"：在 Windows 上检测到 claude 并启动')
  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'hidden' })
  await page.keyboard.press('Control+Shift+W')
  await paneCount(1)

  // —— SSH 服务器（本地测试服务器，背后是 WSL）——
  server = await startTestServer({ distro: DISTRO })
  await page.click('.host-add')
  await page.waitForSelector('.modal')
  await page.fill('.modal input[placeholder="我的云服务器"]', '测试服务器')
  await page.fill('.modal input[placeholder^="47.100"]', '127.0.0.1')
  await page.fill('.modal input[type=number]', String(server.port))
  await page.fill('.modal input[placeholder="root"]', 'tester')
  await page.click('.modal .btn.primary')
  await page.waitForSelector('.host-chip:has-text("测试服务器")')
  await paneCount(2)
  const s = await tileOfHost('测试服务器')
  assert.equal(await focusedIndex(), s, '新开的服务器终端应获得焦点')
  await paneHas(s, '确认这是你的服务器')
  assert.match(await rowsText(s), /ssh-ed25519 指纹 SHA256:/)
  await run('yes')
  await paneHas(s, 'tester@127.0.0.1 的密码：')
  await run('nope')
  await paneHas(s, '密码不对')
  await run('test')
  await run('echo ssh-ok-$((2+3))')
  await paneHas(s, 'ssh-ok-5', 20000)
  assert.ok(!(await rowsText(s)).includes('nope'), '密码不应回显')
  await page.waitForSelector('.host-chip:has-text("测试服务器") .status-dot.connected')
  step('添加服务器后自动连接：确认主机指纹、输错密码重试，密码不回显，状态变为已连接')

  assert.equal(await page.locator('.host-chip.on .host-name').textContent(), '测试服务器')
  await page.waitForSelector('.explorer-root:has-text("~")')
  await page.waitForSelector('.tree-row')
  step('资源管理器跟着焦点切到服务器，显示远程 home')

  await page.click('.explorer-tools button[title="上一级目录"]')
  await page.click('.explorer-tools button[title="上一级目录"]')
  await page.waitForSelector('.explorer-root:text-is("/")')
  await dirRow('tmp').dblclick()
  await headerHas(s, '/tmp')
  step('远程双击 cd：经 SSH 判断空闲、切换目录，标题跟着变')

  await page.keyboard.press('Control+Shift+Enter')
  await paneCount(3)
  const s2 = await focusedIndex()
  await run('echo second-$((1+1))')
  await paneHas(s2, 'second-2', 20000)
  assert.ok(!(await rowsText(s2)).includes('密码'), '第二个终端不应再要密码')
  await settle()
  await page.screenshot({ path: sideShot('ssh') })
  step('同一台服务器再开终端：共用连接，不用再登录')

  const known = readFileSync(join(dataDir, 'known_hosts'), 'utf8')
  assert.ok(known.includes(`[127.0.0.1]:${server.port} ssh-ed25519 `), 'known_hosts 里应记下测试服务器')
  step('确认过的主机写进应用自己的 known_hosts')

  const secrets = JSON.parse(readFileSync(join(dataDir, 'secrets.json'), 'utf8'))
  const enc = Object.values(secrets)[0]
  assert.ok(enc && !Buffer.from(enc, 'base64').toString('latin1').includes('test'), '密码应加密保存')
  step('勾着"记住密码"：登录成功后加密保存，文件里没有明文')

  await page.hover('.host-chip:has-text("测试服务器")')
  await page.click('.host-chip:has-text("测试服务器") .chip-edit')
  await page.waitForSelector('.modal:has-text("已保存这台服务器的密码")')
  // 保存会断开旧连接、关掉这台服务器的终端
  await page.click('.modal .btn.primary')
  await page.waitForSelector('.modal', { state: 'detached' })
  await paneCount(1)
  await page.click('.host-chip:has-text("测试服务器")')
  await paneCount(2)
  const s3 = await tileOfHost('测试服务器')
  await paneHas(s3, '使用保存的密码登录')
  await run('echo saved-$((4+4))')
  await paneHas(s3, 'saved-8', 20000)
  assert.ok(!(await rowsText(s3)).includes('的密码：'), '用保存的密码不应再问')
  step('重新连接时自动用保存的密码登录，不再询问')

  await page.click(`.host-chip:has-text("${DISTRO}")`)
  assert.equal(await page.locator('.host-chip.on .host-name').textContent(), DISTRO)
  assert.equal(await focusedIndex(), await tileOfHost(DISTRO))
  await page.waitForSelector(`.explorer-root:has-text("${root}")`)
  step('点 WSL 切回本地终端，资源管理器也切回来')

  await server.close()
  server = null
  await paneHas(s3, '连接已断开', 20000)
  await page.waitForSelector('.host-chip:has-text("测试服务器") .status-dot.disconnected')
  step('服务器断开：终端提示可按回车重连，状态变为未连接')

  assert.deepEqual(pageErrors, [], '页面有报错')
  console.log(`截图：${shot}、${sideShot('ssh')}、${sideShot('settings')}`)
} catch (e) {
  const failShot = shot.replace(/(\.png)?$/, '-fail.png')
  await page.screenshot({ path: failShot }).catch(() => {})
  console.error(`失败截图：${failShot}\n页面报错：${JSON.stringify(pageErrors)}`)
  throw e
} finally {
  await app.close()
  await server?.close()
  wsl(`rm -rf -- '${root}'`)
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(winBin, { recursive: true, force: true })
}
