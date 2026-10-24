// 冒烟测试：启动真实窗口，把 agent 面板、拖放路径、终端、双击 cd、平铺多开、拖动、关闭都走一遍
// 用法：npm run smoke [截图路径]
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'workbench-smoke-'))
// 目录名带空格和单引号，顺便测 cd 的引号转义
const tricky = "it's src"
mkdirSync(join(root, tricky, 'pkg'), { recursive: true })
writeFileSync(join(root, 'notes.md'), '# notes\n')
const shot = process.argv[2] ?? 'out/smoke.png'
const agentShot = shot.replace(/(\.png)?$/, '-agent.png')
// 临时 HOME：shell 不读个人的 .bashrc，启动快且结果稳定
const home = mkdtempSync(join(tmpdir(), 'workbench-home-'))
// 假的 claude / codex：打印启动目录，然后把收到的每一行回显出来。gemini 故意不装
const bin = join(home, 'bin')
mkdirSync(bin)
for (const name of ['claude', 'codex']) {
  const script = `#!/bin/bash\necho "FAKE-${name.toUpperCase()} cwd=$PWD"\nwhile IFS= read -r line; do echo "got:$line"; done\n`
  writeFileSync(join(bin, name), script, { mode: 0o755 })
}

const app = await electron.launch({
  args: ['.', root],
  // PATH 只留系统目录，免得测到本机真装的 agent
  env: { ...process.env, HOME: home, PATH: `${bin}:/usr/local/bin:/usr/bin:/bin` }
})
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))

const step = (name) => console.log(`✓ ${name}`)
const rowsText = (i) =>
  page.evaluate(
    (i) => (document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? '').replace(/ /g, ' '),
    i
  )
const paneHas = (i, text) =>
  page.waitForFunction(
    ([i, t]) =>
      (document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? '')
        .replace(/ /g, ' ')
        .includes(t),
    [i, text],
    { timeout: 8000 }
  )
const headerHas = (i, text) =>
  page.waitForFunction(
    ([i, t]) => document.querySelectorAll('.tile .pane-header')[i]?.textContent.includes(t),
    [i, text],
    { timeout: 8000 }
  )
const paneCount = (n) =>
  page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, n, { timeout: 5000 })
const focusedIndex = () =>
  page.evaluate(() => [...document.querySelectorAll('.tile')].findIndex((t) => t.querySelector('.pane.focused')))
const run = async (cmd) => {
  await page.keyboard.type(cmd)
  await page.keyboard.press('Enter')
}
const agentHas = (text) =>
  page.waitForFunction(
    (t) => (document.querySelector('.agent-panel .xterm-rows')?.textContent ?? '').replace(/ /g, ' ').includes(t),
    text,
    { timeout: 10000 }
  )
const box = (sel, i = 0) => page.locator(sel).nth(i).boundingBox()
// 布局变化有 0.22s 的过渡动画，量尺寸前先等它走完
const settle = () => page.waitForTimeout(400)
let marker = 0
/** 在焦点终端里查询 shell 看到的列数，用唯一标记从屏幕文字里取结果 */
const ptyCols = async (i) => {
  const m = `C${++marker}`
  await run(`echo ${m}=$(tput cols)=`)
  await page.waitForFunction(
    ([i, m]) => new RegExp(`${m}=\\d+=`).test(document.querySelectorAll('.tile .xterm-rows')[i]?.textContent ?? ''),
    [i, m],
    { timeout: 8000 }
  )
  return Number((await rowsText(i)).match(new RegExp(`${m}=(\\d+)=`))[1])
}

try {
  // —— agent 面板 ——
  await page.waitForFunction(() => document.querySelector('.tile .xterm-rows')?.textContent.trim())
  await agentHas(`FAKE-CLAUDE cwd=${root}`)
  assert.deepEqual(await page.locator('.agent-panel .seg-btn').allTextContents(), ['claude', 'codex'])
  assert.ok(
    await page.evaluate(() => document.activeElement?.closest('.tile') !== null),
    'agent 后台启动不应抢走主终端的焦点'
  )
  step('检测到 claude、codex（没装的 gemini 不出现），claude 在根目录后台启动，不抢焦点')

  await page.dragAndDrop('.tree-row.file:has-text("notes.md")', '.agent-panel .term-host')
  await page.keyboard.press('Enter')
  await agentHas('got:@notes.md')
  step('从资源管理器拖文件进 agent：插入 @相对路径')

  await page.dblclick(`.tree-row.dir:has-text("${tricky}")`)
  await page.waitForSelector('.notice:has-text("claude")', { timeout: 4000 })
  step('agent 运行中双击文件夹不会 cd，提示正在运行 claude')

  await page.click('.agent-panel .seg-btn:has-text("codex")')
  await agentHas('FAKE-CODEX')
  await page.click('.agent-panel .term-host')
  await run('hello-codex')
  await agentHas('got:hello-codex')
  step('切换到 codex')

  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'hidden' })
  await page.click('.agent-rail')
  await page.waitForSelector('.agent-panel', { state: 'visible' })
  await agentHas('got:hello-codex')
  step('Ctrl+Shift+A 隐藏、点侧边条显示，agent 会话还在')

  const p1 = await box('.agent-panel')
  const r = await box('.agent-resizer')
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2 - 120, r.y + r.height / 2, { steps: 6 })
  await page.mouse.up()
  const p2 = await box('.agent-panel')
  assert.ok(Math.abs(p2.width - p1.width - 120) < 3, `面板宽度 ${p1.width} → ${p2.width}`)
  step(`拖左边缘调宽 agent 面板：${p1.width} → ${p2.width}`)
  await settle()
  await page.screenshot({ path: agentShot })

  await page.keyboard.press('Control+Shift+A')
  await page.waitForSelector('.agent-panel', { state: 'hidden' })

  // —— 平铺终端 ——
  await page.click('.tile .term-host')
  await run('echo hello-$((6*7))')
  await paneHas(0, 'hello-42')
  step('终端执行命令')

  await page.keyboard.type('echo ')
  await page.dragAndDrop(`.tree-row.dir:has-text("${tricky}")`, '.tile .term-host')
  await page.keyboard.press('Enter')
  await paneHas(0, join(root, tricky))
  step('拖文件夹进 shell：插入加了引号的绝对路径')

  // 默认菜单里 Ctrl+W 是关窗口；去掉菜单后应交给 shell 删掉前一个词
  await page.keyboard.type('echo w$((1+1)) drop')
  await page.keyboard.press('Control+W')
  await page.keyboard.press('Enter')
  await paneHas(0, 'w2')
  assert.ok(!(await rowsText(0)).includes('w2 drop'), 'Ctrl+W 没有删掉词')
  step('Ctrl+W 交给 shell 删词，不会关窗口')

  await page.dblclick(`.tree-row.dir:has-text("${tricky}")`)
  await headerHas(0, tricky)
  await run('pwd')
  await paneHas(0, join(root, tricky))
  await page.waitForSelector(`.tree-row.active:has-text("${tricky}")`)
  step('双击文件夹 cd 过去，标题和高亮跟着变')

  await run('sleep 5')
  await page.waitForTimeout(300)
  await page.dblclick('.tree-row.dir:has-text("pkg")')
  await page.waitForSelector('.notice:has-text("sleep")', { timeout: 4000 })
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

  await page.dblclick('.tree-row.dir:has-text("pkg")')
  await headerHas(1, join(tricky, 'pkg'))
  assert.ok(!(await page.locator('.tile .pane-header').nth(0).textContent()).includes('pkg'))
  await run('pwd')
  await paneHas(1, join(root, tricky, 'pkg'))
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
  step('再拆一次：窄高的窗格改为上下拆分')
  await page.screenshot({ path: shot })

  await page.keyboard.press('Control+Shift+W')
  await paneCount(2)
  assert.equal(await focusedIndex(), 1)
  step('Ctrl+Shift+W 关闭，焦点交给紧挨着的终端')

  await run('exit')
  await paneCount(1)
  await settle()
  const [full, tiles] = [await box('.tile', 0), await box('.tiles')]
  assert.ok(full.width > tiles.width - 2, '剩下的终端应占满')
  step('shell 里 exit 自动关闭窗格，剩下的占满')

  await page.click('.tile .pane-actions button[title^="关闭"]')
  await page.waitForSelector('.empty')
  await page.click('.empty .btn')
  await paneCount(1)
  await page.waitForFunction(() => document.querySelector('.tile .xterm-rows')?.textContent.trim())
  step('关掉最后一个后显示空状态，可以重新新建')

  assert.deepEqual(pageErrors, [], '页面有报错')
  console.log(`截图：${shot}、${agentShot}`)
} catch (e) {
  const failShot = shot.replace(/(\.png)?$/, '-fail.png')
  await page.screenshot({ path: failShot }).catch(() => {})
  console.error(`失败截图：${failShot}\n页面报错：${JSON.stringify(pageErrors)}`)
  throw e
} finally {
  await app.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
