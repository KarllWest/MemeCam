// Перевіряє шейдер пакування NV12: рендерить відомий візерунок через LensRenderer,
// знімає readNv12 і зберігає сирий буфер. Далі його розкодовує ffmpeg — якщо кольори
// й орієнтація збіглися з візерунком, весь шлях до віртуальної камери правильний.
const { app, BrowserWindow } = require('electron')
const { writeFileSync, readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')
const outPath = process.env.NV12_OUT

const TEST = `(function () {
  const W = 1280, H = 720;

  // Візерунок: смуги по горизонталі + мітки в кутах, щоб побачити будь-який переворот.
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');

  const bars = ['#ffffff','#ffff00','#00ffff','#00ff00','#ff00ff','#ff0000','#0000ff','#000000'];
  bars.forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(i * W / bars.length, 0, W / bars.length, H);
  });

  // Верх притемнюємо — так видно, де верх, а де низ.
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(0, 0, W, H / 2);

  // Мітка рівно у верхньому лівому куті.
  c.fillStyle = '#ff8000';
  c.fillRect(0, 0, 160, 90);

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);

  // Нейтральні параметри: перевіряємо саме конвертацію, а не грейд і сяйво.
  const p = Object.assign({}, MemeCamGL.DEFAULT_PARAMS, {
    mirror: false, exposure: 1, contrast: 1, saturation: 1,
    vignette: 0, bloomStrength: 0, smokeAmount: 0, boltCount: 0
  });

  renderer.render(src, null, p);
  const nv12 = renderer.readNv12(W, H);

  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < nv12.length; i += chunk) {
    bin += String.fromCharCode.apply(null, nv12.subarray(i, i + chunk));
  }
  return { length: nv12.length, expected: W * H * 1.5, base64: btoa(bin) };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const r = await win.webContents.executeJavaScript(TEST)
    writeFileSync(outPath, Buffer.from(r.base64, 'base64'))
    console.log(`✓ NV12 знято: ${r.length} Б (очікувалось ${r.expected}) -> ${outPath}`)
    app.exit(r.length === r.expected ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
