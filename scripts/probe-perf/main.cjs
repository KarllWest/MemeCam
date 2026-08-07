// Порівнює вартість знімання кадру для віртуальної камери двома способами:
// синхронний readPixels у масив проти асинхронного через пару PBO.
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')

const BENCH = `(async function () {
  const W = 1280, H = 720;
  const N = 120;

  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ff5030'); g.addColorStop(1, '#3050ff');
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);
  const p = MemeCamGL.DEFAULT_PARAMS;

  const gl = out.getContext('webgl2');

  // Розігрів: перші кадри включають компіляцію та алокації.
  for (let i = 0; i < 20; i++) { renderer.render(src, null, p); renderer.readNv12(W, H); }

  // --- Асинхронно, як у додатку ---
  let t0 = performance.now();
  let got = 0;
  for (let i = 0; i < N; i++) {
    renderer.render(src, null, p);
    if (renderer.readNv12(W, H)) got++;
  }
  const asyncMs = (performance.now() - t0) / N;

  // --- Синхронно, як було раніше ---
  const buf = new Uint8Array(W * H * 1.5);
  const packW = W / 4, packH = H * 1.5;
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    renderer.render(src, null, p);
    renderer.readNv12(W, H);
    // Те саме читання, але прямо в пам'ять CPU — саме воно і зупиняло конвеєр.
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.packRT.framebuffer);
    gl.readPixels(0, 0, packW, packH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  const syncMs = (performance.now() - t0) / N;

  // Скільки коштує сам рендер без знімання — база для порівняння.
  t0 = performance.now();
  for (let i = 0; i < N; i++) renderer.render(src, null, p);
  gl.finish();
  const renderMs = (performance.now() - t0) / N;

  // --- Головна перевірка: реальний темп 30 кадрів/с ---
  // У щільному циклі огорожа не встигає спрацювати, і це нормально. Значення має
  // лише те, чи доходять кадри при справжньому інтервалі між тактами.
  const PACED = 45;
  let paced = 0;
  let pacedMs = 0;
  for (let i = 0; i < PACED; i++) {
    await new Promise((r) => setTimeout(r, 33));
    const t = performance.now();
    renderer.render(src, null, p);
    if (renderer.readNv12(W, H)) paced++;
    pacedMs += performance.now() - t;
  }

  return {
    renderMs: +renderMs.toFixed(2),
    asyncTightLoopMs: +asyncMs.toFixed(2),
    syncTightLoopMs: +syncMs.toFixed(2),
    tightLoopDelivered: got + '/' + N,
    pacedDelivered: paced + '/' + PACED,
    pacedMsPerFrame: +(pacedMs / PACED).toFixed(2)
  };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')
  try {
    await win.webContents.executeJavaScript(bundleSrc)
    console.log(JSON.stringify(await win.webContents.executeJavaScript(BENCH), null, 2))
    app.exit(0)
  } catch (e) {
    console.error('Бенчмарк впав:', e)
    app.exit(1)
  }
})
