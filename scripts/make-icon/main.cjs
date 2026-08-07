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
  const SIZE = 512;

  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });

  const W = img.naturalWidth, H = img.naturalHeight;

  // Знімаємо пікселі, щоб знайти справжні межі значка.
  const probe = document.createElement('canvas');
  probe.width = W; probe.height = H;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  pc.drawImage(img, 0, 0);
  const data = pc.getImageData(0, 0, W, H).data;

  // Тло — прозоре або майже біле. Білим у самому тролфейсі це не заважає:
  // він усередині кольорового значка й до країв не дотикається.
  const isBackground = (i) => {
    const a = data[i + 3];
    if (a < 8) return true;
    return data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244;
  };

  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  const rowHasContent = (y) => {
    for (let x = 0; x < W; x++) if (!isBackground((y * W + x) * 4)) return true;
    return false;
  };
  const colHasContent = (x) => {
    for (let y = 0; y < H; y++) if (!isBackground((y * W + x) * 4)) return true;
    return false;
  };
  while (top < bottom && !rowHasContent(top)) top++;
  while (bottom > top && !rowHasContent(bottom)) bottom--;
  while (left < right && !colHasContent(left)) left++;
  while (right > left && !colHasContent(right)) right--;

  // Робимо виріз квадратним, щоб значок не сплюснуло.
  let cw = right - left + 1, ch = bottom - top + 1;
  const side = Math.max(cw, ch);
  let sx = left - (side - cw) / 2;
  let sy = top - (side - ch) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const c = canvas.getContext('2d');

  // Кути робимо прозорими: інакше на панелі задач значок читається як білий квадрат.
  const r = SIZE * 0.185;
  c.beginPath();
  c.moveTo(r, 0);
  c.arcTo(SIZE, 0, SIZE, SIZE, r);
  c.arcTo(SIZE, SIZE, 0, SIZE, r);
  c.arcTo(0, SIZE, 0, 0, r);
  c.arcTo(0, 0, SIZE, 0, r);
  c.closePath();
  c.clip();

  c.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return { png: canvas.toDataURL('image/png'), crop: [left, top, cw, ch], source: [W, H] };
})(${JSON.stringify(dataUrl)})`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  try {
    const out = await win.webContents.executeJavaScript(RENDER)
    const bytes = Buffer.from(out.png.split(',')[1], 'base64')
    for (const target of targets) writeFileSync(target, bytes)

    console.log(`✓ Іконку зроблено з ${usePng ? 'build/icon-source.png' : 'build/icon.svg'}`)
    console.log(
      `  джерело ${out.source[0]}x${out.source[1]}, значок знайдено в ` +
        `[${out.crop[0]},${out.crop[1]}] ${out.crop[2]}x${out.crop[3]}`
    )
    for (const target of targets) console.log(`  ${target}`)
    app.exit(0)
  } catch (e) {
    console.error('Растеризація впала:', e)
    app.exit(1)
  }
})
