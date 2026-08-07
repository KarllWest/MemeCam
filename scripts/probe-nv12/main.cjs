// Перевіряє, чи вміє WebCodecs у цій версії Electron віддавати кадр canvas одразу в NV12.
// Якщо вміє — конвертацію робить Chromium, і нам не треба свій шейдер.
const { app, BrowserWindow } = require('electron')

const PROBE = `(async function () {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 640, 360)

  const out = { hasVideoFrame: typeof VideoFrame !== 'undefined', formats: {} }
  if (!out.hasVideoFrame) return out

  for (const format of ['NV12', 'I420', 'RGBA', 'BGRA']) {
    try {
      const frame = new VideoFrame(canvas, { timestamp: 0 })
      const size = frame.allocationSize({ format })
      const buf = new ArrayBuffer(size)
      const layout = await frame.copyTo(buf, { format })
      const bytes = new Uint8Array(buf)
      frame.close()
      out.formats[format] = {
        ok: true,
        size,
        planes: layout.length,
        first8: Array.from(bytes.slice(0, 8))
      }
    } catch (e) {
      out.formats[format] = { ok: false, error: String(e && e.message || e) }
    }
  }

  // Скільки коштує конвертація одного кадру 1280x720 — це піде в реальний час.
  const big = document.createElement('canvas')
  big.width = 1280
  big.height = 720
  big.getContext('2d').fillRect(0, 0, 1280, 720)
  if (out.formats.NV12 && out.formats.NV12.ok) {
    const t0 = performance.now()
    const N = 30
    for (let i = 0; i < N; i++) {
      const f = new VideoFrame(big, { timestamp: i })
      const b = new ArrayBuffer(f.allocationSize({ format: 'NV12' }))
      await f.copyTo(b, { format: 'NV12' })
      f.close()
    }
    out.msPerFrame720p = (performance.now() - t0) / N
  }

  return out
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  try {
    const result = await win.webContents.executeJavaScript(PROBE)
    console.log(JSON.stringify(result, null, 2))
    app.exit(0)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
