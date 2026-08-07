/**
 * Глобальні гарячі клавіші.
 *
 * Сенс саме в тому, що вони працюють, коли додаток згорнутий: перемкнути маску
 * посеред розмови в Discord, не шукаючи наше вікно. Тому globalShortcut, а не
 * обробник клавіш у вікні.
 */
import { BrowserWindow, globalShortcut } from 'electron'

export type HotkeyAction =
  | { type: 'mask'; index: number }
  | { type: 'mask-next' }
  | { type: 'mask-prev' }
  | { type: 'mask-off' }
  | { type: 'voice-toggle' }
  | { type: 'broadcast-toggle' }
  | { type: 'capture' }

interface Binding {
  accelerator: string
  action: HotkeyAction
  /** Опис для вікна налаштувань. */
  label: string
}

/**
 * Ctrl+Alt навмисно: одиночні клавіші перехоплювали б набір тексту всюди,
 * а Ctrl+Shift часто зайнятий іграми й самим Discord.
 */
export const BINDINGS: Binding[] = [
  { accelerator: 'Control+Alt+1', action: { type: 'mask', index: 0 }, label: 'Маска 1' },
  { accelerator: 'Control+Alt+2', action: { type: 'mask', index: 1 }, label: 'Маска 2' },
  { accelerator: 'Control+Alt+3', action: { type: 'mask', index: 2 }, label: 'Маска 3' },
  { accelerator: 'Control+Alt+4', action: { type: 'mask', index: 3 }, label: 'Маска 4' },
  { accelerator: 'Control+Alt+5', action: { type: 'mask', index: 4 }, label: 'Маска 5' },
  { accelerator: 'Control+Alt+0', action: { type: 'mask-off' }, label: 'Без маски' },
  { accelerator: 'Control+Alt+Right', action: { type: 'mask-next' }, label: 'Наступна маска' },
  { accelerator: 'Control+Alt+Left', action: { type: 'mask-prev' }, label: 'Попередня маска' },
  { accelerator: 'Control+Alt+V', action: { type: 'voice-toggle' }, label: 'Голос увімк/вимк' },
  { accelerator: 'Control+Alt+B', action: { type: 'broadcast-toggle' }, label: 'Трансляція' },
  { accelerator: 'Control+Alt+S', action: { type: 'capture' }, label: 'Зняти фото' }
]

export interface HotkeyInfo {
  accelerator: string
  label: string
  registered: boolean
}

let registered: HotkeyInfo[] = []

export function registerHotkeys(): HotkeyInfo[] {
  globalShortcut.unregisterAll()

  registered = BINDINGS.map(({ accelerator, action, label }) => {
    // Комбінацію могла зайняти інша програма — це не привід падати,
    // просто покажемо в налаштуваннях, що вона недоступна.
    const ok = globalShortcut.register(accelerator, () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('hotkey', action)
      }
    })
    return { accelerator, label, registered: ok }
  })

  return registered
}

export const getHotkeys = (): HotkeyInfo[] => registered

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
  registered = []
}
