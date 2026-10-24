import type { ReactNode } from 'react'
import { ACCENTS, DEFAULTS, GRADIENTS, TERM_FONTS, type Settings } from '../settings'
import { CloseIcon, ImageIcon } from './icons'

interface Props {
  settings: Settings
  wallpaperUrl: string | null
  onChange: (patch: Partial<Settings>) => void
  onChooseWallpaper: () => void
  onClearWallpaper: () => void
  onClose: () => void
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="setting-row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>{props.format(props.value)}</output>
    </label>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="settings-section">
    <h3>{title}</h3>
    {children}
  </section>
)

const pct = (v: number): string => `${Math.round(v * 100)}%`
const px = (v: number): string => `${v}px`

export function SettingsPanel({ settings: s, wallpaperUrl, onChange, onChooseWallpaper, onClearWallpaper, onClose }: Props) {
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer glass" role="dialog" aria-label="设置" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="drawer-header">
          <h2>设置</h2>
          <button className="icon-btn" title="关闭（Esc）" onClick={onClose} autoFocus>
            <CloseIcon />
          </button>
        </header>

        <div className="drawer-body">
          <Section title="壁纸">
            <div className="wallpapers">
              <button
                className={`wp-tile image${s.wallpaper === 'image' ? ' on' : ''}`}
                style={wallpaperUrl ? { backgroundImage: `url("${wallpaperUrl}")` } : undefined}
                title={wallpaperUrl ? '使用我的图片' : '选择一张图片'}
                onClick={() => (wallpaperUrl ? onChange({ wallpaper: 'image' }) : onChooseWallpaper())}
              >
                {!wallpaperUrl && <ImageIcon />}
                <span>我的图片</span>
              </button>
              {(Object.keys(GRADIENTS) as (keyof typeof GRADIENTS)[]).map((k) => (
                <button
                  key={k}
                  className={`wp-tile${s.wallpaper === k ? ' on' : ''}`}
                  style={{ background: GRADIENTS[k].css }}
                  onClick={() => onChange({ wallpaper: k })}
                >
                  <span>{GRADIENTS[k].name}</span>
                </button>
              ))}
            </div>
            <div className="setting-buttons">
              <button className="btn" onClick={onChooseWallpaper}>
                {wallpaperUrl ? '换一张图片…' : '选择图片…'}
              </button>
              {wallpaperUrl && (
                <button className="btn ghost" onClick={onClearWallpaper}>
                  移除图片
                </button>
              )}
            </div>
            <Slider label="模糊" value={s.wallpaperBlur} min={0} max={30} step={1} format={px} onChange={(v) => onChange({ wallpaperBlur: v })} />
            <Slider label="压暗" value={s.wallpaperDim} min={0} max={0.85} step={0.05} format={pct} onChange={(v) => onChange({ wallpaperDim: v })} />
          </Section>

          <Section title="外观">
            <Slider label="面板不透明度" value={s.panelOpacity} min={0.3} max={1} step={0.02} format={pct} onChange={(v) => onChange({ panelOpacity: v })} />
            <div className="setting-row">
              <span>强调色</span>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    className={`swatch${s.accent === c ? ' on' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => onChange({ accent: c })}
                  />
                ))}
              </div>
            </div>
            <label className="setting-row">
              <span>动画</span>
              <input type="checkbox" checked={s.animations} onChange={(e) => onChange({ animations: e.target.checked })} />
            </label>
          </Section>

          <Section title="字体">
            <Slider label="界面字号" value={s.uiFontSize} min={12} max={18} step={0.5} format={px} onChange={(v) => onChange({ uiFontSize: v })} />
            <Slider label="终端字号" value={s.termFontSize} min={11} max={24} step={0.5} format={px} onChange={(v) => onChange({ termFontSize: v })} />
            <Slider label="终端行高" value={s.termLineHeight} min={1} max={1.6} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => onChange({ termLineHeight: v })} />
            <label className="setting-row">
              <span>终端字体</span>
              <select value={s.termFontFamily} onChange={(e) => onChange({ termFontFamily: e.target.value })}>
                {TERM_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title="光标">
            <div className="setting-row">
              <span>样式</span>
              <div className="seg">
                {(['bar', 'block', 'underline'] as const).map((c) => (
                  <button
                    key={c}
                    className={`seg-btn${s.cursorStyle === c ? ' on' : ''}`}
                    onClick={() => onChange({ cursorStyle: c })}
                  >
                    {{ bar: '竖线', block: '方块', underline: '下划线' }[c]}
                  </button>
                ))}
              </div>
            </div>
            <label className="setting-row">
              <span>闪烁</span>
              <input type="checkbox" checked={s.cursorBlink} onChange={(e) => onChange({ cursorBlink: e.target.checked })} />
            </label>
          </Section>

          <Section title="快捷键">
            <dl className="shortcuts">
              <dt>Ctrl+Shift+Enter</dt>
              <dd>拆分焦点终端</dd>
              <dt>Ctrl+Shift+W</dt>
              <dd>关闭终端 / 隐藏 agent</dd>
              <dt>Ctrl+Shift+A</dt>
              <dd>显示 / 隐藏 agent 面板</dd>
              <dt>Ctrl+= / Ctrl+- / Ctrl+0</dt>
              <dd>放大 / 缩小 / 还原终端字号</dd>
              <dt>Ctrl+,</dt>
              <dd>打开设置</dd>
            </dl>
          </Section>

          <button className="btn ghost reset" onClick={() => onChange(DEFAULTS)}>
            恢复默认设置
          </button>
        </div>
      </aside>
    </div>
  )
}
