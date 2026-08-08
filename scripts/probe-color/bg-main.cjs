// Перевіряє заміну фону: чи лягає маска тим боком і чи підмінюється саме фон.
//
// Переворот маски — найтихіша помилка тут: модель віддає її рядками згори вниз,
// а кадр камери лежить у текстурі догори дриґом. Помилка дає дзеркальний результат,
// який без камери нізащо не помітиш.
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')

const TEST = `(function () {
  const W = 256, H = 256;

  // Кадр суцільно червоний — так одразу видно, де його підмінили.
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');
  c.fillStyle = 'rgb(255,0,0)';
  c.fillRect(0, 0, W, H);

  // Маска: верхня половина — людина, нижня — фон. Рядок 0 у масиві — верх кадру.
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) mask[y * W + x] = y < H / 2 ? 255 : 0;
  }

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);
  renderer.setMask(mask, W, H);

  const p = Object.assign({}, MemeCamGL.NEUTRAL_PARAMS, {
    mirror: false, smoothing: 0,
    bgMode: 2, bgColor: [0, 1, 0]   // фон заливаємо зеленим
  });
  renderer.render(src, null, p);

  const read = document.createElement('canvas');
  read.width = W; read.height = H;
  const rc = read.getContext('2d', { willReadFrequently: true });
  rc.drawImage(out, 0, 0);
  const data = rc.getImageData(0, 0, W, H).data;

  const at = (x, y) => {
    // Координати обов'язково цілі: дробовий індекс у масиві дає undefined.
    const i = (Math.floor(y) * W + Math.floor(x)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  return { top: at(W / 2, H * 0.2), bottom: at(W / 2, H * 0.8) };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')

  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const r = await win.webContents.executeJavaScript(TEST)

    // Верх маски — людина, отже там має лишитись червоний кадр.
    const topOk = r.top[0] > 200 && r.top[1] < 60
    // Низ — фон, отже зелена заливка.
    const bottomOk = r.bottom[1] > 200 && r.bottom[0] < 60

    console.log(`${topOk ? '✓' : '✗'} верх (людина): [${r.top}] — очікувався червоний`)
    console.log(`${bottomOk ? '✓' : '✗'} низ (фон):     [${r.bottom}] — очікувався зелений`)

    if (topOk && bottomOk) {
      console.log('\n✓ Фон підмінюється правильним боком')
      app.exit(0)
    } else {
      console.log('\n✗ Маска лягає не так — імовірно переворот по вертикалі')
      app.exit(1)
    }
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
