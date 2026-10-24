// node --test 用：让测试能导入源码里不带扩展名的相对路径（'./scripts' → './scripts.ts'）
import { register } from 'node:module'

register('./resolve-ts.mjs', import.meta.url)
