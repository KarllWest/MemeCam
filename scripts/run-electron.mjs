// Запускає electron-vite з чистим оточенням.
//
// Термінал VS Code успадковує ELECTRON_RUN_AS_NODE=1 від хоста розширень.
// З цією змінною Electron стартує як звичайний Node: вікно не відкривається,
// а require('electron') повертає рядок зі шляхом замість API.
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('electron-vite', process.argv.slice(2), {
  stdio: 'inherit',
  env,
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
