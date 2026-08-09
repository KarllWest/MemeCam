// Міряє, наскільки шумозаглушення гасить зерно і чи не з'їдає воно рух.
//
// Подаємо рівне сіре поле плюс свіжий випадковий шум на кожен кадр — саме так
// поводиться сенсор у темряві. Далі рахуємо розкид яскравості: чим він менший,
// тим чистіша картинка.
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')

const TEST = `(function () {
  const W = 256, H = 256;

  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');

  // Сіре поле з новим шумом на кожен кадр. Друга половина кадру — рухома смуга,
  // на ній перевіряємо, чи не тягнеться шлейф.
  function paint(frame, withMotion) {
    const img = c.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0;
      let base = 90;
      if (withMotion && y > H / 2) {
        // Смуга, що їде поперек кадру.
        base = Math.abs(x - ((frame * 7) % W)) < 16 ? 220 : 60;
      }
      const noise = (Math.random() - 0.5) * 60;
      const v = Math.max(0, Math.min(255, base + noise));
      img.data[i*4] = v; img.data[i*4+1] = v; img.data[i*4+2] = v; img.data[i*4+3] = 255;
    }
    c.putImageData(img, 0, 0);
  }

  function spread(data, x0, y0, x1, y1, W) {
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += data[(y*W+x)*4]; n++; }
    const mean = sum / n;
    let acc = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const d = data[(y*W+x)*4] - mean; acc += d * d;
    }
    return Math.sqrt(acc / n);
  }

  function run(denoise) {
    const out = document.createElement('canvas');
    const renderer = new MemeCamGL.LensRenderer(out);
    renderer.resize(W, H);

    const p = Object.assign({}, MemeCamGL.NEUTRAL_PARAMS, {
      mirror: false, smoothing: 0, denoise
    });

    // Кілька десятків кадрів: усередненню треба час, щоб набрати історію.
    for (let f = 0; f < 40; f++) { paint(f, true); renderer.render(src, null, p); }

    const read = document.createElement('canvas');
    read.width = W; read.height = H;
    const rc = read.getContext('2d', { willReadFrequently: true });
    rc.drawImage(out, 0, 0);
    const data = rc.getImageData(0, 0, W, H).data;

    return {
      // Верх кадру нерухомий — тут шум має впасти.
      still: +spread(data, 20, 20, W - 20, H / 2 - 20, W).toFixed(2),
      // Низ рухається — тут перевіряємо, що смуга лишилась контрастною.
      moving: +spread(data, 20, H / 2 + 20, W - 20, H - 20, W).toFixed(2)
    };
  }

  return { off: run(0), on: run(0.65) };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')

  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const r = await win.webContents.executeJavaScript(TEST)

    const drop = (1 - r.on.still / r.off.still) * 100
    const kept = (r.on.moving / r.off.moving) * 100

    console.log(`нерухома ділянка: розкид ${r.off.still} -> ${r.on.still}`)
    console.log(`                  шум прибрано на ${drop.toFixed(0)}%`)
    console.log(`рухома смуга:     розкид ${r.off.moving} -> ${r.on.moving}`)
    console.log(`                  контраст збережено на ${kept.toFixed(0)}%`)

    // Шум має помітно впасти, а рух — лишитись живим, не змазаним у кашу.
    const ok = drop > 25 && kept > 70
    console.log(
      ok
        ? '\n✓ Шум гаситься, рух не змазується'
        : '\n✗ Або шум не гаситься, або за рухом тягнеться шлейф'
    )
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
