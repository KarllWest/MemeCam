import { app, shell, BrowserWindow, ipcMain, session, dialog, protocol, net } from 'electron'
import { join, normalize, sep } from 'node:path'
import { loadSettings, saveSettings } from './settings'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { VirtualCamera, type CameraTarget } from './virtualCamera'
import {
  getFilterStatus,
  registerFilter,
  unregisterFilter,
  syncFilterIfStale
} from './filterRegistration'
import { registerHotkeys, getHotkeys, unregisterHotkeys } from './hotkeys'
import {
  initUpdater,
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  installUpdate
} from './updater'

const isDev = !app.isPackaged

let vcam: VirtualCamera | null = null
let vcamEpoch = 0n

/**
 * Коли користувач у Discord, наше вікно приховане, і Chromium за замовчуванням
 * присипляє його: rAF падає приблизно до кадру на секунду, таймери гальмуються,
 * а віртуальна камера перетворюється на слайдшоу. Вимикаємо все це — інакше
 * трансляція працює лише поки на додаток дивляться.
 */
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

/** Куди складаємо знімки: Зображення/MemeCam */
function captureDir(): string {
  return join(app.getPath('pictures'), 'MemeCam')
}

/** Куди складаємо відео: Відео/MemeCam */
function videoDir(): string {
  return join(app.getPath('videos'), 'MemeCam')
}

/** Ім'я формує рендерер — лишаємо тільки базову частину, без шляхів. */
async function writeCapture(dir: string, data: Uint8Array, filename: string): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  await mkdir(dir, { recursive: true })
  const full = join(dir, safe)
  await writeFile(full, Buffer.from(data))
  return full
}

/**
 * Рендерер віддаємо через власну схему, а не file://.
 * З file:// Chromium блокує fetch(), а MediaPipe саме ним тягне свій wasm і модель.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')

  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const target = normalize(join(rendererRoot, rel))

    // Не даємо вийти за межі теки рендерера через ../
    if (target !== rendererRoot && !target.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}

function applyContentSecurityPolicy(): void {
  // У деві Vite потребує inline-скриптів і websocket для HMR — у продакшені все закручуємо.
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws://localhost:* http://localhost:*; media-src 'self' blob: mediastream:"
    : [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: mediastream:",
        "connect-src 'self' data: blob:"
      ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#07070d',
    autoHideMenuBar: true,
    title: 'Meme Cam',
    // Ховаємо системну рамку, але лишаємо рідні кнопки вікна накладкою: так
    // інтерфейс суцільно темний, а Snap Layouts і поведінка кнопок не ламаються.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e0e18',
      symbolColor: '#9494b0',
      height: 56
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Пісочниця вмикається, бо preload користується лише ipcRenderer.
      // Нативні модулі живуть у головному процесі, куди сторінка не дістає.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Разом з ключами вище тримає цикл рендеру живим, поки вікно згорнуте.
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Зовнішні посилання — у системний браузер, не в наше вікно.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Вікно має показувати лише наш інтерфейс. Якби сторонній вміст сюди потрапив,
  // він отримав би доступ до мосту, а через нього — до камери й мікрофона.
  const allowedOrigins = ['app://local', process.env['ELECTRON_RENDERER_URL'] ?? '']
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowedOrigins.some((o) => o && url.startsWith(o))) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Веб-сторінки не мають права підвантажувати сюди свої нативні модулі.
  win.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'audioCapture', 'videoCapture'].includes(permission)
  )

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadURL('app://local/index.html')
  }
}

app.whenReady().then(() => {
  // Камера й мікрофон дозволені, решта прошень відхиляється.
  const allowed = new Set(['media', 'audioCapture', 'videoCapture'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  registerAppProtocol()
  applyContentSecurityPolicy()

  ipcMain.handle('capture:save', async (_e, data: Uint8Array, filename: string) =>
    writeCapture(captureDir(), data, filename)
  )

  ipcMain.handle('capture:saveVideo', async (_e, data: Uint8Array, filename: string) =>
    writeCapture(videoDir(), data, filename)
  )

  ipcMain.handle('capture:reveal', async (_e, fullPath: unknown) => {
    // Показуємо лише те, що самі ж і зберегли: інакше через міст можна було б
    // попросити відкрити провідник на будь-якому файлі системи.
    if (typeof fullPath !== 'string') return
    const target = normalize(fullPath)
    const allowed = [captureDir(), videoDir()]
    if (!allowed.some((dir) => target.startsWith(dir + sep))) return
    shell.showItemInFolder(fullPath)
  })

  ipcMain.handle('app:error', async (_e, title: string, message: string) => {
    dialog.showErrorBox(title, message)
  })

  // --- Віртуальна камера ---

  ipcMain.handle(
    'vcam:start',
    (_e, width: unknown, height: unknown, fps: unknown, target: unknown) => {
      // Розміри йдуть у розрахунок буфера спільної пам'яті, тож перевіряємо їх
      // тут, а не покладаємось на те, що рендерер надішле щось притомне.
      const isSize = (v: unknown, max: number): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max
      if (!isSize(width, 7680) || !isSize(height, 4320) || !isSize(fps, 240)) {
        throw new Error('Некоректні параметри камери')
      }
      const dest: CameraTarget = target === 'obs' ? 'obs' : 'memecam'

      vcam?.stop()
      vcam = new VirtualCamera()
      vcam.start(width, height, fps, dest) // помилка полетить у рендерер як відхилена обіцянка
      vcamEpoch = process.hrtime.bigint()
    }
  )

  // send, а не invoke: на кожен кадр зайвий зворотний рейс нам ні до чого.
  ipcMain.on('vcam:frame', (_e, bytes: unknown) => {
    if (!vcam?.running) return
    if (!(bytes instanceof Uint8Array)) return
    const frame = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    vcam.writeFrame(frame, (process.hrtime.bigint() - vcamEpoch) / 100n)
  })

  ipcMain.handle('vcam:stop', () => {
    vcam?.stop()
    vcam = null
  })

  ipcMain.handle('vcam:status', () => vcam?.info ?? null)

  // --- Реєстрація камери в системі ---

  // Якщо в застосунку свіжіший драйвер за встановлений — підміняємо тихо.
  void syncFilterIfStale()

  ipcMain.handle('filter:status', () => getFilterStatus())
  ipcMain.handle('filter:register', () => registerFilter())
  ipcMain.handle('filter:unregister', () => unregisterFilter())

  // --- Налаштування (шифруються ключем системи) ---

  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_e, data: unknown) => saveSettings(data))

  // --- Гарячі клавіші ---

  registerHotkeys()
  ipcMain.handle('hotkeys:list', () => getHotkeys())

  // --- Оновлення ---

  initUpdater()
  ipcMain.handle('update:state', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Мапінг живе, поки живий процес — прибираємо явно, щоб камера не «зависла» в системі.
app.on('before-quit', () => {
  vcam?.stop()
  vcam = null
  unregisterHotkeys()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
