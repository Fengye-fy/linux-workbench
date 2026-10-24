import { load, save } from './storage'

// 外观设置：存 localStorage，改了立刻生效。壁纸图片本身由主进程保存，这里只记用哪种壁纸

export type CursorStyle = 'bar' | 'block' | 'underline'

export interface Settings {
  /** 'image' 用自己选的图片，其他是内置的渐变 */
  wallpaper: 'image' | keyof typeof GRADIENTS
  wallpaperBlur: number
  wallpaperDim: number
  /** 面板不透明度 0.3~1，越低越能透出壁纸 */
  panelOpacity: number
  accent: string
  uiFontSize: number
  termFontSize: number
  termFontFamily: string
  termLineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  animations: boolean
}

/** 内置壁纸：Catppuccin 色系的柔和渐变，没选图片时用 */
export const GRADIENTS = {
  aurora: {
    name: '极光',
    css: 'radial-gradient(at 15% 20%, #3b4a7a 0, transparent 55%), radial-gradient(at 85% 15%, #5b3f6e 0, transparent 50%), radial-gradient(at 70% 85%, #1f5a63 0, transparent 55%), #11111b'
  },
  dusk: {
    name: '暮色',
    css: 'radial-gradient(at 20% 80%, #7a4a3b 0, transparent 55%), radial-gradient(at 80% 20%, #4a3b7a 0, transparent 55%), radial-gradient(at 50% 50%, #2a2440 0, transparent 70%), #141018'
  },
  ink: {
    name: '水墨',
    css: 'radial-gradient(at 30% 30%, #4a4f5c 0, transparent 50%), radial-gradient(at 75% 70%, #2e333d 0, transparent 60%), linear-gradient(160deg, #3a3d45, #121317)'
  },
  night: {
    name: '深夜',
    css: '#11111b'
  }
} as const

export const ACCENTS = ['#7fc8ff', '#b4befe', '#a6e3a1', '#fab387', '#f5c2e7', '#f9e2af']

export const TERM_FONTS = [
  { value: '"JetBrainsMono Nerd Font", "JetBrains Mono"', label: 'JetBrains Mono' },
  { value: '"Cascadia Mono", "Cascadia Code"', label: 'Cascadia Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: '"DejaVu Sans Mono"', label: 'DejaVu Sans Mono' }
]

/** 16 寸笔记本（150% 缩放）上看着舒服的默认值 */
export const DEFAULTS: Settings = {
  wallpaper: 'aurora',
  wallpaperBlur: 0,
  wallpaperDim: 0.35,
  panelOpacity: 0.72,
  accent: '#7fc8ff',
  uiFontSize: 14,
  termFontSize: 15,
  termFontFamily: TERM_FONTS[0].value,
  termLineHeight: 1.2,
  cursorStyle: 'bar',
  cursorBlink: true,
  animations: true
}

/** 字体没装时依次退到这些，最后是中文字体 */
export const termFontStack = (family: string): string =>
  `${family}, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Microsoft YaHei UI", "Noto Sans Mono CJK SC", monospace`

export function loadSettings(): Settings {
  const saved = load<Partial<Settings>>('settings', {})
  const merged = { ...DEFAULTS, ...saved }
  if (merged.wallpaper !== 'image' && !(merged.wallpaper in GRADIENTS)) merged.wallpaper = DEFAULTS.wallpaper
  return merged
}

export const saveSettings = (s: Settings): void => save('settings', s)

/** 设置里和 CSS 有关的部分写成 :root 上的变量 */
export function applySettings(s: Settings): void {
  const root = document.documentElement.style
  root.setProperty('--accent', s.accent)
  root.setProperty('--panel-alpha', String(s.panelOpacity))
  root.setProperty('--ui-size', `${s.uiFontSize}px`)
  root.setProperty('--wp-blur', `${s.wallpaperBlur}px`)
  root.setProperty('--wp-dim', String(s.wallpaperDim))
  document.documentElement.classList.toggle('no-motion', !s.animations)
}
