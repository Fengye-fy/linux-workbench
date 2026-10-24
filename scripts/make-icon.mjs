// 由 src/renderer/src/assets/icon.svg 生成打包用的 build/icon.png（512）和 build/icon.ico（多尺寸）
// 用法：npm run icon
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('src/renderer/src/assets/icon.svg')
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', render(512))

// ICO 文件：6 字节头 + 每个尺寸 16 字节目录项 + 各尺寸的 PNG 数据（Vista 以后都支持 PNG 格式的图标）
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const pngs = sizes.map(render)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0)
  e.writeUInt8(size >= 256 ? 0 : size, 1)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...pngs]))
console.log(`build/icon.png、build/icon.ico（${sizes.join('/')}）`)
