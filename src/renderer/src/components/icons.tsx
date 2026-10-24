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
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" />
    <path d="M8 3v10" stroke="currentColor" />
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
