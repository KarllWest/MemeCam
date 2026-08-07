// Готує локальні ассети MediaPipe, щоб додаток працював офлайн без CDN.
// Запуск: node scripts/setup-assets.mjs
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'src/renderer/public/mediapipe')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const modelPath = resolve(publicDir, 'face_landmarker.task')

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

await mkdir(publicDir, { recursive: true })

// 1. WASM-рантайм копіюємо з node_modules — версія завжди збігається з пакетом.
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm')
await cp(wasmSrc, resolve(publicDir, 'wasm'), { recursive: true })
console.log('✓ wasm скопійовано з node_modules')

// 2. Модель обличчя (~3.8 МБ) — качаємо один раз.
if (await exists(modelPath)) {
  console.log('✓ face_landmarker.task вже на місці, пропускаю')
} else {
  console.log('⇣ качаю face_landmarker.task ...')
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`Не вдалось завантажити модель: HTTP ${res.status}`)
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()))
  console.log('✓ модель завантажено')
}

console.log('\nГотово. Ассети в src/renderer/public/mediapipe/')
