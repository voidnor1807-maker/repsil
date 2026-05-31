// Generates build/icon.ico — an "R" lettermark in the Repsil palette
// (cyan accent #22d3ee on the dark shell). Renders each icon size separately
// for crispness, then packs them into a multi-resolution, PNG-compressed .ico.
//
// Uses @napi-rs/canvas (already a dependency; N-API so plain `node` loads it).
// Run: npm run icon
const fs = require('node:fs')
const path = require('node:path')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')

// Brand palette (mirror of src/renderer/theme/tokens.ts)
const ACCENT = '#22d3ee'
const BG_TOP = '#10172a'
const BG_BOTTOM = '#070a12'

// Bold sans for the letter. Arial Bold ships on every Windows install.
const FONT_PATH = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'arialbd.ttf')
let FONT_FAMILY = 'sans-serif'
if (fs.existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, 'RepsilIcon')
  FONT_FAMILY = 'RepsilIcon'
} else {
  console.warn('arialbd.ttf not found; falling back to default sans-serif')
}

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function renderPng(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Rounded tile with a soft vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, BG_TOP)
  grad.addColorStop(1, BG_BOTTOM)
  ctx.fillStyle = grad
  const radius = Math.max(2, Math.round(size * 0.22))
  roundRect(ctx, 0, 0, size, size, radius)
  ctx.fill()

  // Subtle accent hairline border (only where it reads — larger sizes)
  if (size >= 48) {
    ctx.lineWidth = Math.max(1, size * 0.012)
    ctx.strokeStyle = 'rgba(34,211,238,0.28)'
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth, radius)
    ctx.stroke()
  }

  // The "R"
  ctx.fillStyle = ACCENT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(size * 0.62)}px ${FONT_FAMILY}`
  ctx.fillText('R', size / 2, size * 0.54)

  return canvas.toBuffer('image/png')
}

function buildIco(pngs) {
  // ICONDIR (6) + N * ICONDIRENTRY (16), then PNG blobs.
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  pngs.forEach((p, i) => {
    const e = i * 16
    entries.writeUInt8(p.size >= 256 ? 0 : p.size, e + 0) // width (0 => 256)
    entries.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1) // height
    entries.writeUInt8(0, e + 2) // palette
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // color planes
    entries.writeUInt16LE(32, e + 6) // bits per pixel
    entries.writeUInt32LE(p.buf.length, e + 8) // bytes in resource
    entries.writeUInt32LE(offset, e + 12) // offset
    offset += p.buf.length
  })

  return Buffer.concat([header, entries, ...pngs.map((p) => p.buf)])
}

const pngs = SIZES.map((size) => ({ size, buf: renderPng(size) }))
const ico = buildIco(pngs)

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'icon.ico')
fs.writeFileSync(outPath, ico)

// Also drop a 256 PNG for convenience (Linux / docs / quick preview)
fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[pngs.length - 1].buf)

console.log(`Wrote ${outPath} (${SIZES.join(', ')} px, ${ico.length} bytes)`)
