// Ганяє у віртуальну камеру кольорові смуги, щоб перевірити формат черги OBS
// незалежно від решти додатка. Поки скрипт живий, камера видима в системі.
//
// Запуск: node scripts/test-virtualcam.mjs [секунди] [memecam|obs]
// Паралельно перевіряти так:
//   ffmpeg -f dshow -i video="Meme Cam" -frames:v 1 -update 1 out.png
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seconds = Number(process.argv[2] ?? 20)
const target = process.argv[3] ?? 'memecam'

const WIDTH = 1280
const HEIGHT = 720
const FPS = 30

/** Класичні кольорові смуги: одразу видно і кольори, і орієнтацію. */
const BARS = [
  [255, 255, 255],
  [255, 255, 0],
  [0, 255, 255],
  [0, 255, 0],
  [255, 0, 255],
  [255, 0, 0],
  [0, 0, 255],
  [0, 0, 0]
]

/** BT.601, обмежений діапазон — саме його чекає DirectShow від NV12. */
function rgbToYuv([r, g, b]) {
  return [
    Math.round(16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255),
    Math.round(128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255),
    Math.round(128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255)
  ]
}

function makeFrame(phase) {
  const ySize = WIDTH * HEIGHT
  const buf = Buffer.alloc((ySize * 3) / 2)
  const yuv = BARS.map(rgbToYuv)
  const barWidth = WIDTH / BARS.length

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const bar = yuv[Math.min(BARS.length - 1, Math.floor(x / barWidth))]
      // Рухома діагональ — по ній видно, що кадри реально оновлюються.
      const onStripe = (x + y + phase) % 160 < 12
      buf[y * WIDTH + x] = onStripe ? 235 : bar[0]
    }
  }

  // Площина кольоровості вдвічі менша по обох осях, U та V чергуються.
  for (let y = 0; y < HEIGHT / 2; y++) {
    for (let x = 0; x < WIDTH / 2; x++) {
      const bar = yuv[Math.min(BARS.length - 1, Math.floor((x * 2) / barWidth))]
      const i = ySize + y * WIDTH + x * 2
      buf[i] = bar[1]
      buf[i + 1] = bar[2]
    }
  }

  return buf
}

// Бандл кладемо всередину проєкту: інакше require('koffi') з нього не резолвиться.
const tmp = join(root, 'node_modules/.cache/memecam')
const bundlePath = join(tmp, 'virtualCamera.cjs')
await mkdir(tmp, { recursive: true })

try {
  await build({
    entryPoints: [join(root, 'src/main/virtualCamera.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['koffi'],
    logLevel: 'warning'
  })

  const require = createRequire(join(root, 'package.json'))
  const { VirtualCamera } = require(bundlePath)

  const cam = new VirtualCamera()
  cam.start(WIDTH, HEIGHT, FPS, target)
  console.log(`✓ Камера "${target}" запущена: ${WIDTH}x${HEIGHT}@${FPS}, тримаю ${seconds} с`)

  let phase = 0
  let frames = 0
  const started = process.hrtime.bigint()

  const timer = setInterval(() => {
    const now = process.hrtime.bigint()
    cam.writeFrame(makeFrame(phase), (now - started) / 100n)
    phase = (phase + 3) % 160
    frames++
  }, 1000 / FPS)

  await new Promise((r) => setTimeout(r, seconds * 1000))
  clearInterval(timer)
  cam.stop()
  console.log(`✓ Зупинено, віддано ${frames} кадрів`)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
