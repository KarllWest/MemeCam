import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

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

  /** Показує файл у Провіднику. */
  revealInFolder: (fullPath: string): Promise<void> =>
    ipcRenderer.invoke('capture:reveal', fullPath),

  /** Системне вікно з помилкою. */
  showError: (title: string, message: string): Promise<void> =>
    ipcRenderer.invoke('app:error', title, message),

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
