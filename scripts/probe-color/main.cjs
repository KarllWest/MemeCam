// Перевіряє, що без ефектів кадр проходить крізь пайплайн незмінним.
//
// Саме тут легко зіпсувати картинку непомітно: тонмап або грейд тягнуть тони,
// і камера виглядає гірше, ніж у звичайному застосунку, хоча «нічого не ввімкнено».
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')

const TEST = `(async function () {
  const W = 512, H = 256;

  // Сіра шкала плюс кольорові плашки: видно і зсув яскравості, і зсув відтінку.
  const steps = [0, 32, 64, 96, 128, 160, 192, 224, 255];
  const colors = [[255,0,0],[0,255,0],[0,0,255],[255,255,0]];

  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');
  steps.forEach((v, i) => {
    c.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    c.fillRect(i * (W / steps.length), 0, W / steps.length, H / 2);
  });
  colors.forEach((col, i) => {
    c.fillStyle = 'rgb(' + col.join(',') + ')';
    c.fillRect(i * (W / colors.length), H / 2, W / colors.length, H / 2);
  });

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);

  const p = Object.assign({}, MemeCamGL.NEUTRAL_PARAMS, { mirror: false, smoothing: 0 });
  renderer.render(src, null, p);

  // Знімаємо результат через 2D-полотно: те саме, що бачить око.
  const read = document.createElement('canvas');
  read.width = W; read.height = H;
  const rc = read.getContext('2d', { willReadFrequently: true });
  rc.drawImage(out, 0, 0);
  const data = rc.getImageData(0, 0, W, H).data;

  const sample = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const gray = steps.map((v, i) => {
    const got = sample(Math.floor((i + 0.5) * (W / steps.length)), Math.floor(H * 0.25));
    return { expected: v, got: got[0], drift: got[0] - v };
  });

  const tint = colors.map((col, i) => {
    const got = sample(Math.floor((i + 0.5) * (W / colors.length)), Math.floor(H * 0.75));
    return { expected: col, got: got };
  });

  return { gray, tint };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')

  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const r = await win.webContents.executeJavaScript(TEST)

    let ok = true
    console.log('Сіра шкала (вхід -> вихід):')
    for (const g of r.gray) {
      // Допуск 3 рівні: округлення при 8 бітах на канал неминуче.
      const good = Math.abs(g.drift) <= 3
      if (!good) ok = false
      console.log(
        `  ${good ? '✓' : '✗'} ${String(g.expected).padStart(3)} -> ${String(g.got).padStart(3)}` +
          (g.drift === 0 ? '' : `  (зсув ${g.drift > 0 ? '+' : ''}${g.drift})`)
      )
    }

    console.log('Кольори:')
    for (const t of r.tint) {
      const good = t.expected.every((v, i) => Math.abs(v - t.got[i]) <= 3)
      if (!good) ok = false
      console.log(`  ${good ? '✓' : '✗'} [${t.expected}] -> [${t.got}]`)
    }

    console.log(ok ? '\n✓ Без ефектів кадр не змінюється' : '\n✗ Пайплайн псує картинку')
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
