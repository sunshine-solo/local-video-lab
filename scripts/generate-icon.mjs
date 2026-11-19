import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

/*
 * 从 build/icon.svg 生成 1024x1024 PNG。
 * electron-builder 会自动把 PNG 转成 macOS .icns 与 Windows .ico。
 * 运行：npm run icons
 */

const svg = await readFile(new URL('../build/icon.svg', import.meta.url))
const png = await sharp(svg, { density: 256 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toBuffer()

await writeFile(new URL('../build/icon.png', import.meta.url), png)
console.log('已生成 build/icon.png（1024x1024）')
