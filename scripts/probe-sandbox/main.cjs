// Перевіряє, що міст у головний процес живий під пісочницею.
//
// Пісочниця обмежує preload кількома модулями Electron. Якщо він тягне щось
// іще, window.memecam просто не з'явиться — і застосунок буде мертвий,
// хоча збірка пройде без жодної помилки.
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')

app.whenReady().then(async () => {
  ipcMain.handle('settings:load', () => ({ maskId: 'laser' }))

  const win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: {
      preload: join(__dirname, '../../out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    await win.loadURL('about:blank')

    const result = await win.webContents.executeJavaScript(`(async function () {
      if (typeof window.memecam === 'undefined') return { bridge: false };

      const groups = ['updates', 'filter', 'virtualCamera', 'hotkeys', 'settings'];
      const missing = groups.filter((g) => !window.memecam[g]);

      // Перевіряємо не лише наявність, а й що виклик реально доходить до main.
      let roundTrip = null;
      try {
        roundTrip = await window.memecam.settings.load();
      } catch (e) {
        roundTrip = { error: String(e && e.message || e) };
      }

      return { bridge: true, missing, roundTrip };
    })()`)

    if (!result.bridge) {
      console.error('✗ window.memecam не існує — пісочниця зламала preload')
      app.exit(1)
      return
    }
    if (result.missing.length > 0) {
      console.error(`✗ бракує розділів мосту: ${result.missing.join(', ')}`)
      app.exit(1)
      return
    }
    if (!result.roundTrip || result.roundTrip.error) {
      console.error(`✗ виклик до main не дійшов: ${result.roundTrip?.error}`)
      app.exit(1)
      return
    }

    console.log('✓ Міст працює під пісочницею')
    console.log(`  розділи на місці, відповідь main: ${JSON.stringify(result.roundTrip)}`)
    app.exit(0)
  } catch (e) {
    console.error('Проба впала:', e)
    app.exit(1)
  }
})
