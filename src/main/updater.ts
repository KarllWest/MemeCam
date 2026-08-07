/**
 * Перевірка й встановлення оновлень через релізи GitHub.
 *
 * Джерело задане в полі build.publish у package.json. Поки репозиторію немає
 * або він порожній, перевірка просто повідомляє про це — додаток працює далі.
 * У режимі розробки перевірка вимкнена: оновлювати нема чого, застосунок
 * запущений з теки, а не з інсталяції.
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'unsupported'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** Версія, яку пропонують поставити. */
  version: string | null
  /** Опис змін з релізу, як його написали на GitHub. */
  notes: string | null
  /** 0..100, поки йде завантаження. */
  progress: number
  message: string | null
  currentVersion: string
}

let state: UpdateState = {
  phase: 'idle',
  version: null,
  notes: null,
  progress: 0,
  message: null,
  currentVersion: app.getVersion()
}

function publish(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:state', state)
  }
}

/** Прибирає розмітку з описів релізів: показуємо їх звичайним текстом. */
function plainText(notes: unknown): string | null {
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim() || null
  if (Array.isArray(notes)) {
    return (
      notes
        .map((n) => (typeof n === 'string' ? n : (n?.note ?? '')))
        .join('\n\n')
        .replace(/<[^>]+>/g, '')
        .trim() || null
    )
  }
  return null
}

export function initUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', message: null }))

  autoUpdater.on('update-available', (info) =>
    publish({
      phase: 'available',
      version: info.version,
      notes: plainText(info.releaseNotes),
      message: null
    })
  )

  autoUpdater.on('update-not-available', () =>
    publish({ phase: 'up-to-date', version: null, notes: null, message: null })
  )

  autoUpdater.on('download-progress', (p) =>
    publish({ phase: 'downloading', progress: Math.round(p.percent) })
  )

  autoUpdater.on('update-downloaded', () => publish({ phase: 'ready', progress: 100 }))

  autoUpdater.on('error', (e) =>
    publish({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
  )
}

export function getUpdateState(): UpdateState {
  return state
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    publish({
      phase: 'unsupported',
      message: 'У режимі розробки оновлення не перевіряються'
    })
    return state
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    publish({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
  }
  return state
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/** Ставить завантажене оновлення й перезапускає додаток. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
