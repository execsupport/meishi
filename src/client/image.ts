// Resize on the device before upload: longest side 1280px, JPEG quality 0.8 (about 150-300 KB).
const MAX = 1280

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; done(): void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

export async function resizeImage(file: Blob): Promise<Blob> {
  const { src, w, h, done } = await decode(file)
  try {
    const scale = Math.min(1, MAX / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, cw, ch)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, cw, ch)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
    if (!blob) throw new Error('encode failed')
    return blob
  } finally {
    done()
  }
}
