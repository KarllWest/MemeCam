// Готує локальні ассети MediaPipe, щоб додаток працював офлайн без CDN.
// Запуск: node scripts/setup-assets.mjs
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'src/renderer/public/mediapipe')

const MODELS = [
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    about: 'точки обличчя'
  },
  {
    name: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    about: 'відділення людини від фону'
  }
]

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

// 2. Моделі — качаємо один раз, далі додаток працює без інтернету.
for (const model of MODELS) {
  const path = resolve(publicDir, model.name)
  if (await exists(path)) {
    console.log(`✓ ${model.name} вже на місці, пропускаю`)
    continue
  }

  console.log(`⇣ качаю ${model.name} (${model.about}) ...`)
  const res = await fetch(model.url)
  if (!res.ok) throw new Error(`Не вдалось завантажити ${model.name}: HTTP ${res.status}`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  console.log(`✓ ${model.name} завантажено`)
}

console.log('\nГотово. Ассети в src/renderer/public/mediapipe/')
