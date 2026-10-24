import { useEffect, useState, type FormEvent } from 'react'
import type { SshHostDraft } from '../../../shared/types'

interface Props {
  /** 编辑已有服务器时传入它的配置，添加时为 null */
  initial: SshHostDraft | null
  /** 编辑时：本机是否已经加密保存了它的密码 */
  savedPassword?: boolean
  onSave: (draft: SshHostDraft) => Promise<void>
  onDelete?: () => Promise<void>
  onForgetPassword?: () => Promise<void>
  onClose: () => void
}

const EMPTY: SshHostDraft = { name: '', host: '', port: 22, username: 'root', keyPath: '', savePassword: true }

/** 添加 / 编辑 SSH 服务器。对话框里不填密码：连接时在终端里输入，勾了"记住密码"就加密保存 */
export function HostDialog({ initial, savedPassword, onSave, onDelete, onForgetPassword, onClose }: Props) {
  const [draft, setDraft] = useState<SshHostDraft>(initial ?? EMPTY)
  const [suggestions, setSuggestions] = useState<SshHostDraft[]>([])
  const [keys, setKeys] = useState<string[]>([])
  const [hasSaved, setHasSaved] = useState(!!savedPassword)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!initial) window.api.hosts.sshConfigSuggestions().then(setSuggestions)
    window.api.hosts.keyCandidates().then(setKeys)
  }, [initial])

  const set = <K extends keyof SshHostDraft>(key: K, value: SshHostDraft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!draft.host.trim()) return setError('填一下服务器地址')
    if (!draft.username.trim()) return setError('填一下用户名')
    setBusy(true)
    try {
      await onSave(draft)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal glass" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{initial ? '编辑服务器' : '添加服务器'}</h2>
        {suggestions.length > 0 && (
          <div className="suggestions">
            <span>从 ~/.ssh/config 填入：</span>
            {suggestions.map((s) => (
              <button type="button" key={s.name} className="chip" onClick={() => setDraft(s)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid">
          <label>
            名称
            <input
              autoFocus
              value={draft.name}
              placeholder="我的云服务器"
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <label className="span-2">
            地址
            <input value={draft.host} placeholder="47.100.1.2 或 example.com" onChange={(e) => set('host', e.target.value)} />
          </label>
          <label>
            端口
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => set('port', Number(e.target.value))}
            />
          </label>
          <label className="span-2">
            用户名
            <input value={draft.username} placeholder="root" onChange={(e) => set('username', e.target.value)} />
          </label>
          <label className="span-3">
            私钥文件（可选）
            <input
              list="wb-key-candidates"
              value={draft.keyPath ?? ''}
              placeholder="留空：先试 ssh-agent 和 ~/.ssh 下的默认私钥，再在终端里问密码"
              onChange={(e) => set('keyPath', e.target.value)}
            />
            <datalist id="wb-key-candidates">
              {keys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={!!draft.savePassword}
            onChange={(e) => set('savePassword', e.target.checked)}
          />
          <span>记住密码：登录成功后用 Windows 加密保存在本机，下次自动登录</span>
        </label>
        {hasSaved && onForgetPassword && (
          <p className="hint">
            已保存这台服务器的密码。
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                await onForgetPassword()
                setHasSaved(false)
              }}
            >
              清除已保存的密码
            </button>
          </p>
        )}
        <p className="hint">密码不在这里填：连接时在终端里输入。</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          {onDelete && (
            <button type="button" className="btn danger" onClick={() => void onDelete()}>
              删除
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {initial ? '保存' : '添加并连接'}
          </button>
        </div>
      </form>
    </div>
  )
}
