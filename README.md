# Linux Workbench（MVP）

资源管理器 + 平铺多终端 + 右侧 agent CLI：双击文件夹，焦点终端就 `cd` 过去；把文件拖进终端或 agent，插入它的路径。后续计划：Linux 指令提示。

技术栈：Electron + React + TypeScript + xterm.js + node-pty，用 electron-vite 构建。

## 运行（Linux / WSL）

需要 Node 22+，以及编译 node-pty 用的 `gcc`、`make`、`python3`。

```bash
npm install
npm run dev          # 开发模式，改代码自动刷新
npm run build && npx electron . ~/dev_ws   # 指定资源管理器打开的目录（默认是 home）
npm run typecheck
npm test             # 单元测试：布局树、路径引号
npm run smoke        # 冒烟测试：启动真实窗口，走一遍 agent 面板、拖放、终端、双击 cd、拆分、拖动、关闭
```

WSL 默认没有中文字体，界面里的中文会显示成方框，装一下即可：

```bash
sudo apt install fonts-noto-cjk
```

## 交互

| 操作 | 方式 |
| --- | --- |
| 新建终端（拆分焦点终端） | `Ctrl+Shift+Enter`，或标题栏的拆分按钮 |
| 关闭终端 | `Ctrl+Shift+W`、标题栏的 ×，或在 shell 里 `exit` |
| 显示 / 隐藏 agent 面板 | `Ctrl+Shift+A`，或面板标题栏的箭头、隐藏后右侧的竖条 |
| 切换焦点 | 点击终端或 agent |
| 调整大小 | 拖动终端之间的缝隙（双击恢复对半）；拖 agent 面板左边缘 |
| 插入路径 | 从资源管理器把文件 / 文件夹拖进终端或 agent |
| 开发者工具 | `F12`（仅开发模式） |

终端：

- 拆分沿焦点终端较长的那条边对半切，新终端继承焦点终端当前的目录；切完太小会换方向或提示空间不够
- 拖进 shell 插入绝对路径，带空格、引号等字符时自动加引号

资源管理器：

- 单击文件夹展开 / 收起，双击让焦点终端 `cd` 过去；双击顶部路径让终端回到根目录
- 右上角箭头：资源管理器切到上一级
- 高亮跟随焦点终端的实际目录（读 `/proc/<pid>/cwd`）
- 终端前台有程序在跑（vim、`ros2 launch`、agent…）时不会往里打 `cd`，右下角给出提示。判断依据是终端的前台进程组是不是 shell 自己

agent 面板：

- 启动时在你的登录 shell 里检测 `claude`、`codex`、`gemini`（`$SHELL -ilc 'command -v …'`），所以 nvm、`~/.local/bin`、`.bashrc` 里的 alias 都认得；fish 暂不支持
- agent 在资源管理器当前的根目录启动，环境和平时开终端一样；agent 退出后留在 shell 里，可以再手动运行
- 装了多个时标题栏可以切换（会结束当前 agent）；重启按钮会用资源管理器当前的根目录重新启动
- 隐藏只是不显示，会话保留；`Ctrl+Shift+W` 在 agent 上也是隐藏
- 拖进 agent 插入 `@相对路径`，agent 会当作文件引用
- 一个都没装时显示安装命令，装好后点"重新检测"
- 面板宽度、是否显示、上次选的 agent 记在本地

其他：去掉了 Electron 默认菜单，`Ctrl+W`、`Ctrl+R` 等按键都交给 shell。

## 结构

```
src/
  main/       主进程：index.ts 窗口和 IPC，pty.ts 终端会话、cd、忙碌判断，agents.ts 检测 agent，fs.ts 列目录
  preload/    通过 contextBridge 暴露 window.api
  shared/     三端共用：types.ts 类型，agents.ts 支持的 agent，shell.ts 路径引号
  renderer/   React 界面
    src/layout.ts                二叉分割树：计算位置、拆分、关闭、调比例（纯函数）
    src/components/TilingView    所有窗格绝对定位在同一层，树怎么变终端都不重建
    src/components/TerminalPane  xterm.js 终端，接收拖入的路径
    src/components/AgentPanel    右侧 agent 面板
    src/components/Explorer      资源管理器
tests/*.test.mts        单元测试（node --test）
scripts/smoke.mjs       基于 playwright-core 的端到端冒烟测试（临时 HOME + 假 agent，不读个人配置）
```
