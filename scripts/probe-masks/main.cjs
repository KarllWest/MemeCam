// Перевіряє геометрію посадки накладок без живої камери.
//
// Точки обличчя підставляються синтетичні, з відомими координатами, і поверх них
// малюється схема голови. Якщо накладка сіла не туди — це одразу видно на знімку:
// корона під підборіддям, окуляри догори дриґом, дзеркальний переворот тощо.
const { app, BrowserWindow, protocol, net } = require('electron')
const { writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const bundleSrc = readFileSync(process.env.MASK_BUNDLE, 'utf8')
const outDir = process.env.MASK_OUT
const publicDir = join(__dirname, '../../src/renderer/public')

protocol.registerSchemesAsPrivileged([
  { scheme: 'probe', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const TEST = `(async function () {
  const W = 960, H = 720;
  const LM = MemeCamGL.LM;

  // Схематичне обличчя в екранних uv (нуль унизу зліва).
  const face = {
    [LM.cheekL]:    [0.36, 0.50],
    [LM.cheekR]:    [0.64, 0.50],
    [LM.eyeOuterL]: [0.425, 0.565],
    [LM.eyeOuterR]: [0.575, 0.565],
    [LM.irisL]:     [0.455, 0.565],
    [LM.irisR]:     [0.545, 0.565],
    [LM.noseTip]:   [0.50, 0.495],
    [LM.noseBottom]:[0.50, 0.462],
    [LM.forehead]:  [0.50, 0.66],
    [LM.chin]:      [0.50, 0.34],
    [LM.mouthL]:    [0.465, 0.425],
    [LM.mouthR]:    [0.535, 0.425],
    [LM.lipTop]:    [0.50, 0.435],
    [LM.lipBottom]: [0.50, 0.410]
  };

  const points = new Float32Array(478 * 2);
  for (let i = 0; i < 478; i++) { points[i*2] = 0.5; points[i*2+1] = 0.5; }
  for (const [idx, [x, y]] of Object.entries(face)) {
    points[idx*2] = x; points[idx*2+1] = y;
  }

  // Джерело: схема голови рівно по тих самих координатах.
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');
  const px = (u) => u * W;
  const py = (v) => (1 - v) * H;

  c.fillStyle = '#20242e'; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#7d8598'; c.lineWidth = 3;
  c.fillStyle = '#39404f';
  c.beginPath();
  c.ellipse(px(0.5), py(0.5), px(0.64) - px(0.36), (py(0.34) - py(0.66)) / 2, 0, 0, Math.PI * 2);
  c.fill(); c.stroke();

  c.fillStyle = '#ffd27a';
  for (const [idx, [x, y]] of Object.entries(face)) {
    c.beginPath(); c.arc(px(x), py(y), 5, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#ff6b6b';
  c.beginPath(); c.arc(px(0.5), py(0.66), 9, 0, Math.PI * 2); c.fill();
  c.font = '18px sans-serif';
  c.fillText('лоб', px(0.52), py(0.66));

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);

  const pose = { points: points, eyeL: face[LM.irisL], eyeR: face[LM.irisR], dir: [0,0], dirStrength: 0 };

  const shots = {};
  for (const mask of MemeCamGL.MASKS) {
    const overlays = mask.layers.filter(MemeCamGL.isOverlay);
    if (overlays.length === 0) continue;

    const p = Object.assign(MemeCamGL.paramsForMask(mask), {
      mirror: false, exposure: 1, contrast: 1, saturation: 1,
      vignette: 0, bloomStrength: 0, smokeAmount: 0, boltCount: 0,
      intensity: 0, smoothing: 0
    });

    // Кілька кадрів поспіль: перший іде на завантаження текстур і розгін згасання.
    for (let i = 0; i < 40; i++) {
      renderer.render(src, pose, p, overlays);
      await new Promise((r) => setTimeout(r, 12));
    }
    renderer.render(src, pose, p, overlays);
    shots[mask.id] = out.toDataURL('image/png');
  }
  return shots;
})()`

app.whenReady().then(async () => {
  protocol.handle('probe', (request) => {
    const { pathname } = new URL(request.url)
    // Порожню сторінку віддаємо на льоту, щоб не тримати тестовий файл серед ассетів.
    if (pathname === '/probe.html') {
      return new Response('<!doctype html><meta charset="utf-8"><title>probe</title><body>', {
        headers: { 'content-type': 'text/html' }
      })
    }
    return net.fetch(pathToFileURL(join(publicDir, decodeURIComponent(pathname))).toString())
  })

  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  // Сторінку віддаємо через власну схему, щоб відносний шлях masks/*.svg резолвився.
  await win.loadURL('probe://local/probe.html')

  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const shots = await win.webContents.executeJavaScript(TEST)
    for (const [id, dataUrl] of Object.entries(shots)) {
      writeFileSync(join(outDir, `mask-${id}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    }
    console.log(`✓ Знято ${Object.keys(shots).length} масок -> ${outDir}`)
    app.exit(0)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
