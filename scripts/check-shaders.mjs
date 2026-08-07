// Компілює всі шейдери в справжньому WebGL2, щоб помилка GLSL не спливала
// аж під час запуску камери. tsc такого не ловить — для нього це просто рядки.
//
// Запуск: npm run check:shaders
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// У звичайному Node пакет electron експортує шлях до exe — беремо його напряму,
// щоб не залежати від того, чи є node_modules/.bin у PATH дочірньої оболонки.
const electronExe = createRequire(import.meta.url)('electron')
const tmp = await mkdtemp(join(tmpdir(), 'memecam-shaders-'))
const bundlePath = join(tmp, 'shaders.cjs')
let exitCode = 1

try {
  // Шейдери лежать у .ts — збираємо їх у CJS, щоб Electron просто зробив require.
  await build({
    entryPoints: [join(root, 'src/renderer/src/gl/shaders.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'warning'
  })

  const env = { ...process.env, SHADER_BUNDLE: bundlePath }
  delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

  const code = await new Promise((res) => {
    const child = spawn(electronExe, [join(root, 'scripts/shader-check/main.cjs')], {
      stdio: 'inherit',
      env
    })
    child.on('error', (e) => {
      console.error('Не вдалось запустити electron:', e.message)
      res(1)
    })
    child.on('exit', (c) => res(c ?? 1))
  })

  exitCode = code
} finally {
  await rm(tmp, { recursive: true, force: true })
}

process.exit(exitCode)
