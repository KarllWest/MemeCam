// Заглушка мосту для знімка інтерфейсу: справжній main-процес тут не потрібен,
// нас цікавить лише вигляд і розкладка.
const { contextBridge } = require('electron')

const state = {
  phase: 'available',
  version: '0.3.0',
  notes: 'Пробний опис релізу з GitHub.',
  progress: 0,
  message: null,
  currentVersion: '0.2.0'
}

contextBridge.exposeInMainWorld('memecam', {
  savePhoto: async () => 'C:\\Users\\me\\Pictures\\MemeCam\\memecam.png',
  revealInFolder: async () => {},
  showError: async () => {},
  updates: {
    state: async () => state,
    check: async () => state,
    download: async () => {},
    install: async () => {},
    onChange: () => () => {}
  },
  hotkeys: {
    list: async () => [],
    onPress: () => () => {}
  },
  masks: {
    list: async () => [],
    save: async () => [],
    remove: async () => [],
    pickImage: async () => null,
    exportMask: async () => null,
    importMask: async () => null
  },
  settings: {
    load: async () => ({ favorites: ['deal', 'dog'] }),
    save: async () => {}
  },
  filter: {
    status: async () => ({ available: true, registered: true, current: true, dllPath: '' }),
    register: async () => {},
    unregister: async () => {}
  },
  virtualCamera: {
    start: async () => {},
    sendFrame: () => {},
    stop: async () => {},
    status: async () => null
  }
})

// Заглушка власних масок для знімка інтерфейсу.
