// Перевіряє спотворення геометрії: чи гнеться картинка навколо правильної точки
// і чи не з'їхало все дзеркально.
//
// Малюємо шахівницю й ставимо осередок збоку від центру. Якщо спотворення
// працює, клітинки біля осередку розтягуються, а на протилежному боці — ні.
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')

const bundleSrc = readFileSync(process.env.GL_BUNDLE, 'utf8')

const TEST = `(function () {
  const W = 400, H = 400;
  const CELL = 20;

  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const c = src.getContext('2d');
  for (let y = 0; y < H / CELL; y++) {
    for (let x = 0; x < W / CELL; x++) {
      c.fillStyle = (x + y) % 2 ? '#ffffff' : '#000000';
      c.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  const out = document.createElement('canvas');
  const renderer = new MemeCamGL.LensRenderer(out);
  renderer.resize(W, H);

  // Точки обличчя підставляємо самі: осередок ставимо в лівій чверті кадру.
  const points = new Float32Array(478 * 2);
  for (let i = 0; i < 478; i++) { points[i*2] = 0.5; points[i*2+1] = 0.5; }
  points[1*2] = 0.25; points[1*2+1] = 0.5;   // точка 1 — «ніс»

  const pose = { points, eyeL: [0.25,0.5], eyeR: [0.25,0.5], dir: [0,0], dirStrength: 0 };
  const p = Object.assign({}, MemeCamGL.NEUTRAL_PARAMS, { mirror: false, smoothing: 0 });

  // Кілька кадрів: сила спотворення наростає разом з появою обличчя.
  const warps = [{ kind: 'warp', points: [1], radius: 0.18, strength: 0.45 }];
  for (let i = 0; i < 60; i++) renderer.render(src, pose, p, [], warps);

  const read = document.createElement('canvas');
  read.width = W; read.height = H;
  const rc = read.getContext('2d', { willReadFrequently: true });
  rc.drawImage(out, 0, 0);
  const data = rc.getImageData(0, 0, W, H).data;

  // Рахуємо середню ширину клітинки: підрахунок самих переходів надто грубий,
  // він не відрізняє розтяг на чверть від його відсутності.
  function cellWidth(y, fromX, toX) {
    const edges = [];
    let prev = -1;
    for (let x = fromX; x < toX; x++) {
      const v = data[(y * W + x) * 4] > 128 ? 1 : 0;
      if (prev !== -1 && v !== prev) edges.push(x);
      prev = v;
    }
    if (edges.length < 2) return 0;
    return (edges[edges.length - 1] - edges[0]) / (edges.length - 1);
  }

  const y = Math.floor(H * 0.5);
  return {
    nearWarp: +cellWidth(y, Math.floor(W * 0.12), Math.floor(W * 0.38)).toFixed(2),
    farSide: +cellWidth(y, Math.floor(W * 0.62), Math.floor(W * 0.95)).toFixed(2)
  };
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')

  try {
    await win.webContents.executeJavaScript(bundleSrc)
    const r = await win.webContents.executeJavaScript(TEST)

    console.log(`ширина клітинки біля осередку: ${r.nearWarp} px`)
    console.log(`ширина клітинки на іншому боці: ${r.farSide} px`)

    // Біля осередку картинка розтягнута, отже клітинки помітно ширші.
    const ok = r.farSide > 0 && r.nearWarp > r.farSide * 1.1
    console.log(
      ok
        ? '\n✓ Спотворення діє саме навколо своєї точки'
        : '\n✗ Спотворення не діє або зачіпає не той бік'
    )
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
