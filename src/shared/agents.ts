// 支持的 agent CLI，命令名就是 id

export const AGENTS = [
  { id: 'claude', name: 'Claude Code', install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex CLI', install: 'npm install -g @openai/codex' },
  { id: 'gemini', name: 'Gemini CLI', install: 'npm install -g @google/gemini-cli' }
] as const

export type AgentId = (typeof AGENTS)[number]['id']

export const isAgentId = (v: unknown): v is AgentId => AGENTS.some((a) => a.id === v)
