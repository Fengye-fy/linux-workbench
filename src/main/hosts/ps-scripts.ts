// Windows 本机的 PowerShell 脚本：纯函数，方便单测。
// 没有 /proc，靠提示符里的 OSC 9;9（Windows Terminal 用的同一个序列）报告当前目录。

/** 提示符里带出来的当前目录 */
export const PROMPT_CWD = /\x1b\]9;9;([^\x07]*)\x07/g

/** PowerShell 单引号字符串字面量 */
export const psString = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** -EncodedCommand 要的格式：UTF-16LE 再 base64，命令行上就不用管任何引号转义 */
export const encodeCommand = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

export interface PsLaunchOptions {
  cwd: string | null
  agent?: string
  agentArgs?: readonly string[]
  pathPrefix?: string
}

/**
 * 交互 PowerShell 的启动脚本（配合 -NoExit）：输出改成 UTF-8；包一层用户原来的 prompt，
 * 前面加上报告当前目录的 OSC 序列；进入目录；指定了 agent 就直接运行，退出后留在 PowerShell 里。
 */
export function psLaunchScript({ cwd, agent, agentArgs = [], pathPrefix }: PsLaunchOptions): string {
  const call = (target: string): string => ['&', target, ...agentArgs.map(psString)].join(' ')
  return [
    '[Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()',
    pathPrefix ? `$env:Path = ${psString(pathPrefix)} + ';' + $env:Path` : '',
    '$global:__wbPrompt = $function:prompt',
    'function global:prompt { "$([char]27)]9;9;$($executionContext.SessionState.Path.CurrentLocation.ProviderPath)$([char]7)" + (& $global:__wbPrompt) }',
    `Set-Location -LiteralPath ${cwd ? psString(cwd) : '$HOME'} -ErrorAction SilentlyContinue`,
    // 只找可执行程序（exe / cmd），不走 .ps1，免得被执行策略拦住
    agent
      ? `$c = Get-Command ${agent} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { ${call('$c.Source')} } else { ${call(agent)} }`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** 查 agent 命令，输出和 Linux 那边一样的 found:名字:路径 行 */
export function psAgentDetectScript(ids: readonly string[], pathPrefix?: string): string {
  return [
    pathPrefix ? `$env:Path = ${psString(pathPrefix)} + ';' + $env:Path` : '',
    `Get-Command ${ids.join(',')} -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { 'found:' + [IO.Path]::GetFileNameWithoutExtension($_.Name) + ':' + $_.Source }`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 从 PowerShell 的输出里截下提示符的当前目录，并从输出里去掉。
 * 序列可能被拆在两个数据块里：没收尾的那段先留着，和下一块拼起来再看。
 */
export class PromptTracker {
  private carry = ''
  private onPrompt: (cwd: string) => void

  constructor(onPrompt: (cwd: string) => void) {
    this.onPrompt = onPrompt
  }

  push(data: string): string {
    let text = this.carry + data
    this.carry = ''
    const open = text.lastIndexOf('\x1b]9;9;')
    if (open !== -1 && text.indexOf('\x07', open) === -1 && text.length - open < 4096) {
      this.carry = text.slice(open)
      text = text.slice(0, open)
    }
    return text.replace(PROMPT_CWD, (_m, cwd: string) => {
      this.onPrompt(cwd)
      return ''
    })
  }
}
