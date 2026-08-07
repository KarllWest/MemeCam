// Готує іконку застосунку: приводить джерело до 512x512 і кладе туди, де його
// чекають electron-builder (build/icon.png) і сам додаток (public/icon.png).
//
// Джерело — build/icon-source.png, якщо він є, інакше намальований build/icon.svg.
// Растеризацію робить Chromium, тому сторонніх бібліотек не потрібно.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const root = process.env.ICON_ROOT

const pngSource = join(root, 'build/icon-source.png')
const svgSource = join(root, 'build/icon.svg')
const usePng = existsSync(pngSource)

const dataUrl = usePng
  ? `data:image/png;base64,${readFileSync(pngSource).toString('base64')}`
  : `data:image/svg+xml;base64,${Buffer.from(readFileSync(svgSource, 'utf8')).toString('base64')}`

const targets = [join(root, 'build/icon.png'), join(root, 'src/renderer/public/icon.png')]

const RENDER = `(async function (src) {
  const img = new Image();
  img.width = 512; img.height = 512;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });

  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const c = canvas.getContext('2d');

  // Вписуємо зі збереженням пропорцій: іконка має бути квадратною, і краще
  // лишити поля, ніж розтягнути тролфейс.
  const scale = Math.min(512 / img.naturalWidth, 512 / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  c.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);

  return canvas.toDataURL('image/png');
})(${JSON.stringify(dataUrl)})`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  try {
    const out = await win.webContents.executeJavaScript(RENDER)
    const bytes = Buffer.from(out.split(',')[1], 'base64')
    for (const target of targets) writeFileSync(target, bytes)

    console.log(`✓ Іконку зроблено з ${usePng ? 'build/icon-source.png' : 'build/icon.svg'}`)
    for (const target of targets) console.log(`  ${target}`)
    app.exit(0)
  } catch (e) {
    console.error('Растеризація впала:', e)
    app.exit(1)
  }
})
