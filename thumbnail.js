// The OS's thumbnail of a picture (it reads what the OS can: WebP and AVIF too), its long side `long` or its short side `short`.
// Windows fits the picture into a square as wide as it is asked for; macOS draws it into the box it is asked for, squashed when the
// box hasn't the picture's shape. So the shape comes first: from the file's header, else as Windows' square measures it.
// ponytail: a JPEG's EXIF rotation isn't read, so on macOS a rotated photo comes out squashed; read the orientation if that bites.
const { nativeImage } = require('electron')
const fs = require('fs')
const MAC = process.platform === 'darwin'

// Width and height from a PNG, GIF, JPEG or WebP header (its first 64 KB); null for anything else.
const measure = file => {
  const b = Buffer.alloc(65536), fd = fs.openSync(file, 'r'), n = fs.readSync(fd, b, 0, b.length, 0)
  fs.closeSync(fd)
  const tag = (at, s) => b.toString('latin1', at, at + s.length) === s
  if (tag(1, 'PNG')) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (tag(0, 'GIF')) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  if (tag(0, 'RIFF') && tag(8, 'WEBP')) return tag(12, 'VP8X') ? { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    : tag(12, 'VP8L') ? { width: 1 + (b.readUInt32LE(21) & 0x3fff), height: 1 + (b.readUInt32LE(21) >> 14 & 0x3fff) }
    : { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  if (b[0] === 0xff && b[1] === 0xd8) for (let i = 2; i + 9 < n;) { // markers to the frame header (SOFn, not DHT/JPG/DAC)
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xff) { i++; continue } // fill
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

const thumbnail = async (file, { long, short }) => {
  const ask = (width, height) => nativeImage.createThumbnailFromPath(file, { width, height })
  const { width: w, height: h } = measure(file) ?? (await ask(400, 400)).getSize()
  const k = long ? long / Math.max(w, h) : short / Math.min(w, h), W = Math.round(w * k), H = Math.round(h * k)
  return MAC ? ask(W, H) : ask(Math.max(W, H), Math.max(W, H))
}

module.exports = { thumbnail, measure }
