// Ганяє справжній тракт мікрофона на фейковому пристрої Chromium.
//
// Перевіряє саме те, що ламається непомітно: дозвіл на мікрофон, завантаження
// воркліта за відносним шляхом і чи доходить сигнал до виходу. Сторінку віддаємо
// через ту саму схему app://, що й у зібраному додатку, — інакше перевірка
// стосувалася б не тих шляхів.
const { app, BrowserWindow, protocol, net, session } = require('electron')
const { readFileSync } = require('node:fs')
const { join, normalize, sep } = require('node:path')
const { pathToFileURL } = require('node:url')

const rendererRoot = join(__dirname, '../../out/renderer')
const bundleSrc = readFileSync(process.env.MIC_BUNDLE, 'utf8')

// Фейковий мікрофон: Chromium підсовує рівний тон замість справжнього пристрою.
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const TEST = `(async function () {
  const out = { steps: [] };
  const step = (name, ok, detail) => out.steps.push({ name, ok, detail: detail || '' });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    step('getUserMedia', true, stream.getAudioTracks()[0]?.label || '');
  } catch (e) {
    step('getUserMedia', false, String(e && e.message || e));
    return out;
  }
  stream.getTracks().forEach(t => t.stop());

  const engine = new MemeCamMic.AudioEngine();
  try {
    await engine.start('', '', MemeCamMic.findVoicePreset('slowed').params);
    step('AudioEngine.start', true);
  } catch (e) {
    step('AudioEngine.start', false, String(e && e.message || e));
    return out;
  }

  // Даємо сигналу дійти й дивимось, чи індикатор рівня взагалі ворушиться.
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 50));
    const l = engine.level();
    if (l > peak) peak = l;
  }
  step('сигнал проходить', peak > 0.01, 'пік ' + peak.toFixed(3));
  step('затримка', engine.latencyMs() > 0, engine.latencyMs().toFixed(1) + ' мс');

  await engine.stop();
  return out;
})()`

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true))

  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const target = normalize(join(rendererRoot, decodeURIComponent(pathname)))
    if (target !== rendererRoot && !target.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })

  const win = new BrowserWindow({ show: false, width: 64, height: 64 })

  try {
    // Порожня сторінка з того ж походження, що й додаток: воркліт вантажиться
    // відносним шляхом, тож походження має збігатися.
    await win.loadURL('app://local/index.html')
    await win.webContents.executeJavaScript(bundleSrc)
    const result = await win.webContents.executeJavaScript(TEST)

    let ok = true
    for (const s of result.steps) {
      if (!s.ok) ok = false
      console.log(`${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ': ' + s.detail : ''}`)
    }
    console.log(ok ? '\n✓ Мікрофон працює' : '\n✗ Тракт мікрофона зламаний')
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
