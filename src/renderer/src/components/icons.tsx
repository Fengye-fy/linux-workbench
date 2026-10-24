// 线条图标，统一 14px、跟随文字颜色

const svg = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
const line = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const UpIcon = () => (
  <svg {...svg}>
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" {...line} />
  </svg>
)

export const SplitIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" {...line} strokeWidth={1.3} />
    <path d="M8 3v10" {...line} strokeWidth={1.3} />
  </svg>
)

export const CloseIcon = () => (
  <svg {...svg}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" {...line} />
  </svg>
)

export const RestartIcon = () => (
  <svg {...svg}>
    <path d="M12.8 9.5A5 5 0 1 1 11.5 4.5M12 2v3h-3" {...line} />
  </svg>
)

export const HideIcon = () => (
  <svg {...svg}>
    <path d="M6 4l4 4-4 4" {...line} />
  </svg>
)

export const AgentIcon = () => (
  <svg {...svg}>
    <path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.2 4.2l1.6 1.6M10.2 10.2l1.6 1.6M11.8 4.2l-1.6 1.6M5.8 10.2l-1.6 1.6" {...line} />
  </svg>
)

export const SettingsIcon = () => (
  <svg {...svg}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" {...line} />
    <circle cx="10" cy="4.5" r="1.5" {...line} />
    <circle cx="6" cy="11.5" r="1.5" {...line} />
  </svg>
)

export const PlusIcon = () => (
  <svg {...svg}>
    <path d="M8 3.5v9M3.5 8h9" {...line} />
  </svg>
)

export const EditIcon = () => (
  <svg {...svg}>
    <path d="M10.5 3.5l2 2L6 12H4v-2l6.5-6.5z" {...line} />
  </svg>
)

/** WSL / 本机：终端提示符 */
export const TerminalIcon = () => (
  <svg {...svg}>
    <rect x="2" y="3" width="12" height="10" rx="2" {...line} strokeWidth={1.3} />
    <path d="M5 6.5l2 1.5-2 1.5M8.5 10H11" {...line} strokeWidth={1.3} />
  </svg>
)

/** 在资源管理器当前目录启动 */
export const FolderIcon = () => (
  <svg {...svg}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" {...line} strokeWidth={1.3} />
  </svg>
)

/** Windows 本机 */
export const WindowsIcon = () => (
  <svg {...svg}>
    <path d="M2.5 3.8l4.6-.7v4.4H2.5zM8.4 2.9l5.1-.8v5.4H8.4zM2.5 8.6h4.6V13l-4.6-.7zM8.4 8.6h5.1v5.3l-5.1-.8z" fill="currentColor" />
  </svg>
)

/** SSH 服务器 */
export const ServerIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.5" {...line} strokeWidth={1.3} />
    <rect x="2.5" y="9" width="11" height="4.5" rx="1.5" {...line} strokeWidth={1.3} />
    <path d="M5 4.75h.01M5 11.25h.01" {...line} strokeWidth={2} />
  </svg>
)

export const ImageIcon = () => (
  <svg {...svg}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" {...line} strokeWidth={1.3} />
    <path d="M2.5 11l3-3 2.5 2.5L10 8.5l3.5 3.5" {...line} strokeWidth={1.3} />
    <circle cx="10.5" cy="5.8" r="1" fill="currentColor" />
  </svg>
)
