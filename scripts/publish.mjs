// Збирає й публікує реліз на GitHub, беручи токен з файлу .env.
//
// electron-builder читає лише змінні оточення, тому токен підставляємо ми.
// Сам .env у git не потрапляє — інакше токен став би публічним разом з кодом.
//
// Запуск: npm run publish
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')

/** Розбирає .env: рядки KEY=VALUE, порожні й з # — пропускаємо. */
function loadEnv(path) {
  if (!existsSync(path)) return {}

  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq < 1) continue

    const key = trimmed.slice(0, eq).trim()
    // Лапки навколо значення прибираємо: їх часто ставлять за звичкою.
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')

    if (value) out[key] = value
  }
  return out
}

const fromFile = loadEnv(envPath)
const token = fromFile.GH_TOKEN || process.env.GH_TOKEN

if (!token) {
  console.error('Не знайдено GH_TOKEN.\n')
  console.error(existsSync(envPath) ? `Відкрий ${envPath}` : `Створи файл ${envPath}`)
  console.error('і встав рядок:\n')
  console.error('  GH_TOKEN=ghp_твій_токен\n')
  console.error('Токен: GitHub -> Settings -> Developer settings -> Personal access tokens')
  console.error('       -> Tokens (classic) -> Generate new -> позначити scope "repo"')
  process.exit(1)
}

// Показуємо лише хвіст, щоб було видно, що підхопився саме той токен.
console.log(`Токен знайдено (…${token.slice(-4)}), публікую реліз\n`)

const require = createRequire(import.meta.url)
const builder = join(dirname(require.resolve('electron-builder/package.json')), 'out/cli/cli.js')

const env = { ...process.env, ...fromFile, GH_TOKEN: token }
delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

const child = spawn(process.execPath, [builder, '--win', '--publish', 'always'], {
  stdio: 'inherit',
  cwd: root,
  env
})

child.on('exit', (code) => process.exit(code ?? 1))
