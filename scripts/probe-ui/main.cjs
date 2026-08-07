// Знімає інтерфейс зібраного додатка, щоб оцінити вигляд без запуску камери.
const { app, BrowserWindow, protocol, net } = require('electron')
const { writeFileSync } = require('node:fs')
const { join, normalize, sep } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '../..')
const rendererRoot = join(root, 'out/renderer')
const outDir = process.env.UI_OUT

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shoot(win, name) {
  const image = await win.webContents.capturePage()
  writeFileSync(join(outDir, name), image.toPNG())
  console.log(`  ${name}`)
}

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const target = normalize(join(rendererRoot, decodeURIComponent(pathname)))
    if (target !== rendererRoot && !target.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })

  const win = new BrowserWindow({
    show: false,
    width: 1180,
    height: 820,
    backgroundColor: '#0a0a10',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: false }
  })

  try {
    await win.loadURL('app://local/index.html')
    await wait(1200)
    await shoot(win, 'ui-main.png')

    // Панель тонкого налаштування.
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Тонке налаштування"]').click()`
    )
    await wait(400)
    await shoot(win, 'ui-settings.png')

    // Вікно «Що нового».
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Що нового"]').click()`
    )
    await wait(500)
    await shoot(win, 'ui-updates.png')

    console.log('✓ Знімки готові')
    app.exit(0)
  } catch (e) {
    console.error('Знімок впав:', e)
    app.exit(1)
  }
})
