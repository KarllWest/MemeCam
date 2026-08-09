import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type HotkeyAction =
  | { type: 'mask'; index: number }
  | { type: 'mask-next' }
  | { type: 'mask-prev' }
  | { type: 'mask-off' }
  | { type: 'voice-toggle' }
  | { type: 'broadcast-toggle' }
  | { type: 'capture' }
  | { type: 'record-toggle' }

export type AnchorPreset = 'eyes' | 'head' | 'nose' | 'mouth' | 'face'

export interface UserOverlay {
  texture: string
  anchor: AnchorPreset
  scale: number
  offsetX: number
  offsetY: number
  rotate: boolean
  opacity: number
}

export interface UserMask {
  id: string
  name: string
  icon: string
  overlays: UserOverlay[]
}

export interface UserVoice {
  id: string
  name: string
  icon: string
  params: {
    semitones: number
    ringHz: number
    ringMix: number
    echoMs: number
    echoFeedback: number
    echoMix: number
    wet: number
    outputGain: number
  }
}

export interface UpdateState {
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'up-to-date'
    | 'unsupported'
    | 'error'
  version: string | null
  notes: string | null
  progress: number
  message: string | null
  currentVersion: string
}

/** Вузький міст у main — рендерер не має прямого доступу до fs. */
const api = {
  /** Зберігає байти знімка в Зображення/MemeCam, повертає повний шлях. */
  savePhoto: (bytes: Uint8Array, filename: string): Promise<string> =>
    ipcRenderer.invoke('capture:save', bytes, filename),

  /** Зберігає записане відео в Відео/MemeCam, повертає повний шлях. */
  saveVideo: (bytes: Uint8Array, filename: string): Promise<string> =>
    ipcRenderer.invoke('capture:saveVideo', bytes, filename),

  /** Показує файл у Провіднику. */
  revealInFolder: (fullPath: string): Promise<void> =>
    ipcRenderer.invoke('capture:reveal', fullPath),

  /** Системне вікно з помилкою. */
  showError: (title: string, message: string): Promise<void> =>
    ipcRenderer.invoke('app:error', title, message),

  /** Власні маски: імпорт картинок, редагування, обмін файлами .memecam. */
  masks: {
    list: (): Promise<UserMask[]> => ipcRenderer.invoke('masks:list'),
    save: (mask: UserMask): Promise<UserMask[]> => ipcRenderer.invoke('masks:save', mask),
    remove: (id: string): Promise<UserMask[]> => ipcRenderer.invoke('masks:delete', id),
    /** Відкриває вибір файлу, повертає ім'я вже скопійованої картинки. */
    pickImage: (): Promise<string | null> => ipcRenderer.invoke('masks:pickImage'),
    exportMask: (id: string): Promise<string | null> => ipcRenderer.invoke('masks:export', id),
    importMask: (): Promise<UserMask[] | null> => ipcRenderer.invoke('masks:import')
  },

  /** Власні пресети голосу: створення, обмін файлами .memevoice. */
  voices: {
    list: (): Promise<UserVoice[]> => ipcRenderer.invoke('voices:list'),
    save: (voice: UserVoice): Promise<UserVoice[]> => ipcRenderer.invoke('voices:save', voice),
    remove: (id: string): Promise<UserVoice[]> => ipcRenderer.invoke('voices:delete', id),
    exportVoice: (id: string): Promise<string | null> => ipcRenderer.invoke('voices:export', id),
    importVoice: (): Promise<UserVoice[] | null> => ipcRenderer.invoke('voices:import')
  },

  /** Налаштування між запусками. Файл шифрується ключем операційної системи. */
  settings: {
    load: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:load'),
    save: (data: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('settings:save', data)
  },

  /** Гарячі клавіші, що працюють навіть коли додаток згорнутий. */
  hotkeys: {
    list: (): Promise<{ accelerator: string; label: string; registered: boolean }[]> =>
      ipcRenderer.invoke('hotkeys:list'),

    /** Підписка на натискання. Повертає функцію відписки. */
    onPress: (listener: (action: HotkeyAction) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, action: HotkeyAction): void => listener(action)
      ipcRenderer.on('hotkey', handler)
      return () => ipcRenderer.off('hotkey', handler)
    }
  },

  /** Оновлення через релізи GitHub. */
  updates: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),

    /** Підписка на зміни стану. Повертає функцію відписки. */
    onChange: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, state: UpdateState): void => listener(state)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.off('update:state', handler)
    }
  },

  /** Реєстрація нашого DirectShow-фільтра — саме він дає окремий пристрій «Meme Cam». */
  filter: {
    status: (): Promise<{
      available: boolean
      registered: boolean
      current: boolean
      dllPath: string
    }> => ipcRenderer.invoke('filter:status'),
    register: (): Promise<void> => ipcRenderer.invoke('filter:register'),
    unregister: (): Promise<void> => ipcRenderer.invoke('filter:unregister')
  },

  /** Віртуальна камера: наш кадр стає системним відеопристроєм для Discord тощо. */
  virtualCamera: {
    start: (
      width: number,
      height: number,
      fps: number,
      target: 'memecam' | 'obs'
    ): Promise<void> => ipcRenderer.invoke('vcam:start', width, height, fps, target),

    /** Кадр у NV12. Без зворотного рейсу — на 30 кадрах/с він зайвий. */
    sendFrame: (nv12: Uint8Array): void => ipcRenderer.send('vcam:frame', nv12),

    stop: (): Promise<void> => ipcRenderer.invoke('vcam:stop'),

    status: (): Promise<{
      width: number
      height: number
      fps: number
      target: 'memecam' | 'obs'
    } | null> => ipcRenderer.invoke('vcam:status')
  }
}

contextBridge.exposeInMainWorld('memecam', api)

export type MemeCamApi = typeof api
