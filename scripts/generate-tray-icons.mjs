/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS, no annotations */
/**
 * Renders the macOS menu bar icon (resources/trayTemplate.png and @2x) from the shield in
 * build/icon.svg. It's a template image: black plus alpha, which macOS tints to match the menu bar.
 *
 * Run with `node scripts/generate-tray-icons.mjs` after changing the shield.
 */
import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'
import { join } from 'path'
import { fileURLToPath } from 'url'

const OUT = fileURLToPath(new URL('../resources', import.meta.url))
/** Area of the 1024px icon to draw, around the shield (x 308-716, y 250-794) */
const VIEW = { x: 222, y: 232, size: 580 }
const SAMPLES = 8

const cubic = (p0, p1, p2, p3, steps = 32) =>
  Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps
    const u = 1 - t
    return [0, 1].map(
      (k) => u ** 3 * p0[k] + 3 * u ** 2 * t * p1[k] + 3 * u * t ** 2 * p2[k] + t ** 3 * p3[k]
    )
  })

const shield = [
  [512, 250],
  [716, 326],
  [716, 500],
  ...cubic([716, 500], [716, 646], [630, 742], [512, 794]),
  ...cubic([512, 794], [394, 742], [308, 646], [308, 500]),
  [308, 326]
]
const keyholeStem = [
  [484, 500],
  [462, 652],
  [466, 662],
  [558, 662],
  [562, 652],
  [540, 500]
]

function inPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const filled = (x, y) =>
  inPolygon(x, y, shield) &&
  !inPolygon(x, y, keyholeStem) &&
  (x - 512) ** 2 + (y - 468) ** 2 > 62 ** 2

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = VIEW.size / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = VIEW.x + (px + (sx + 0.5) / SAMPLES) * scale
          const y = VIEW.y + (py + (sy + 0.5) / SAMPLES) * scale
          if (filled(x, y)) hits++
        }
      }
      pixels[(py * size + px) * 4 + 3] = Math.round((hits / SAMPLES ** 2) * 255)
    }
  }
  return encodePng(size, pixels)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

writeFileSync(join(OUT, 'trayTemplate.png'), render(18))
writeFileSync(join(OUT, 'trayTemplate@2x.png'), render(36))
