import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// main / preload 默认把 node_modules 依赖外部化（node-pty 是原生模块，不能打包）
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
