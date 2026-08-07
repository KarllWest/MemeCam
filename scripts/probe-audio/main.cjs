// Перевіряє обробку голосу без мікрофона: подає чистий тон і міряє, що вийшло.
// Ловить мовчання, NaN і неправильний коефіцієнт зсуву тону.
const { app, BrowserWindow, protocol, net } = require('electron')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const publicDir = join(__dirname, '../../src/renderer/public')

protocol.registerSchemesAsPrivileged([
  { scheme: 'probe', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const TEST = `(async function () {
  const SR = 48000;
  const INPUT_HZ = 440;

  // Рахуємо частоту за переходами через нуль: для чистого тону цього досить,
  // а FFT сюди тягнути ні до чого.
  function dominantHz(data, sampleRate) {
    let crossings = 0;
    // Пропускаємо початок: там ще розганяється затримка в зсуві тону.
    const from = Math.floor(sampleRate * 0.35);
    for (let i = from + 1; i < data.length; i++) {
      if (data[i - 1] <= 0 && data[i] > 0) crossings++;
    }
    const seconds = (data.length - from) / sampleRate;
    return crossings / seconds;
  }

  async function render(semitones) {
    const ctx = new OfflineAudioContext(1, SR, SR);
    await ctx.audioWorklet.addModule('worklets/voice.js');

    const osc = ctx.createOscillator();
    osc.frequency.value = INPUT_HZ;

    const node = new AudioWorkletNode(ctx, 'memecam-voice', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    node.parameters.get('semitones').value = semitones;
    node.parameters.get('wet').value = 1;

    osc.connect(node);
    node.connect(ctx.destination);
    osc.start();

    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);

    let peak = 0, nan = 0;
    for (const v of data) {
      if (!Number.isFinite(v)) nan++;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }

    return {
      semitones,
      hz: Math.round(dominantHz(data, SR)),
      expectedHz: Math.round(INPUT_HZ * Math.pow(2, semitones / 12)),
      peak: +peak.toFixed(3),
      nan
    };
  }

  return [await render(0), await render(-12), await render(-5), await render(7)];
})()`

app.whenReady().then(async () => {
  protocol.handle('probe', (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/probe.html') {
      return new Response('<!doctype html><meta charset="utf-8"><body>', {
        headers: { 'content-type': 'text/html' }
      })
    }
    return net.fetch(pathToFileURL(join(publicDir, decodeURIComponent(pathname))).toString())
  })

  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('probe://local/probe.html')

  try {
    const rows = await win.webContents.executeJavaScript(TEST)
    let ok = true
    for (const r of rows) {
      // Допуск 6%: вимір за переходами через нуль трохи гуляє.
      const drift = Math.abs(r.hz - r.expectedHz) / r.expectedHz
      const good = r.nan === 0 && r.peak > 0.1 && drift < 0.06
      if (!good) ok = false
      console.log(
        `${good ? '✓' : '✗'} ${String(r.semitones).padStart(3)} півтонів: ` +
          `${r.hz} Гц (очікувалось ${r.expectedHz}), пік ${r.peak}, NaN ${r.nan}`
      )
    }
    console.log(ok ? '\n✓ Обробка голосу працює' : '\n✗ Є проблеми')
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
