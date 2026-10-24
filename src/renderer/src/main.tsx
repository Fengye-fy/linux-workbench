import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App'
import { applySettings, loadSettings } from './settings'

// 先套上保存的外观设置，第一帧就是对的颜色和字号
applySettings(loadSettings())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
