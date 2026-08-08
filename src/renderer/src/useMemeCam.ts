import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { LensRenderer, type LensParams } from './gl/LensRenderer'
import { FaceTracker, type TrackedFace } from './face/FaceTracker'
import { Segmenter } from './face/Segmenter'
import type { OverlayLayer } from './masks/types'

export type CamStatus = 'idle' | 'loading' | 'running' | 'error'

/** Куди віддавати кадри: власний фільтр «Meme Cam» чи камера OBS. */
export type CameraTarget = 'memecam' | 'obs'

interface Stats {
  fps: number
  faceFound: boolean
  /** Скільки мілісекунд у середньому коштує віддати кадр у віртуальну камеру. */
  packMs: number
}

/** Зроблений знімок: шлях на диску й посилання на мініатюру в пам'яті. */
export interface Shot {
  path: string
  url: string
}

/** Скільки останніх знімків тримати в стрічці. */
const SHOT_HISTORY = 8

/** Кадр віртуальної камери. Ширина кратна 4 і парна висота — вимога пакування NV12. */
export const VCAM_WIDTH = 1280
export const VCAM_HEIGHT = 720
export const VCAM_FPS = 60

/**
 * Як часто шукаємо обличчя. Навмисно рідше за кадри: детекція — найдорожча
 * частина кадру, а обличчя не рухається настільки швидко, щоб це було помітно.
 */
const DETECT_MS = 1000 / 30

/**
 * Як часто перераховувати маску фону. Ще рідше за обличчя: модель важча, а межа
 * людини й стіни змінюється повільно — на 15 разах за секунду око різниці не бачить.
 */
const SEGMENT_MS = 1000 / 15

function timestampName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `memecam-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`
}

/**
 * Тримає весь конвеєр: камера -> трекер обличчя -> WebGL-лінза -> canvas.
 * Параметри читаються через ref, щоб рух повзунка не перезапускав цикл рендеру.
 */
export function useMemeCam(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  params: LensParams,
  overlayLayers: OverlayLayer[],
  /**
   * Частота зйомки. На 60 кадрах камера вдвічі коротше набирає світло, тож
   * у слабо освітленій кімнаті 30 дають помітно яскравішу картинку.
   */
  captureFps: number
) {
  const [status, setStatus] = useState<CamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({ fps: 0, faceFound: false, packMs: 0 })
  const [shots, setShots] = useState<Shot[]>([])

  // Через ref, а не залежність: зміна маски чи повзунка не має перезапускати цикл.
  const paramsRef = useRef(params)
  paramsRef.current = params
  const overlaysRef = useRef(overlayLayers)
  overlaysRef.current = overlayLayers

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rendererRef = useRef<LensRenderer | null>(null)
  const trackerRef = useRef<FaceTracker | null>(null)
  const segmenterRef = useRef<Segmenter | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const captureRef = useRef(false)
  const vcamRef = useRef(false)
  const [vcamOn, setVcamOn] = useState(false)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    rendererRef.current?.dispose()
    rendererRef.current = null

    trackerRef.current?.dispose()
    trackerRef.current = null

    segmenterRef.current?.dispose()
    segmenterRef.current = null

    videoRef.current = null

    // Без кадрів віртуальна камера показувала б застиглу картинку — гасимо разом.
    if (vcamRef.current) {
      vcamRef.current = false
      setVcamOn(false)
      void window.memecam.virtualCamera.stop()
    }

    setStatus('idle')
    setStats({ fps: 0, faceFound: false, packMs: 0 })
  }, [])

  const start = useCallback(
    async (deviceId?: string) => {
      const canvas = canvasRef.current
      if (!canvas) return

      setStatus('loading')
      setError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: VCAM_WIDTH },
            height: { ideal: VCAM_HEIGHT },
            frameRate: { ideal: captureFps }
          },
          audio: false
        })
        streamRef.current = stream

        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        videoRef.current = video

        const renderer = new LensRenderer(canvas)
        rendererRef.current = renderer

        const tracker = new FaceTracker()
        await tracker.init()
        trackerRef.current = tracker

        // Модель фону вантажимо в фоні: без неї камера вже працює, тож змушувати
        // чекати на неї при старті немає сенсу.
        const segmenter = new Segmenter()
        void segmenter
          .init()
          .then(() => {
            segmenterRef.current = segmenter
          })
          .catch(() => {
            // Заміна фону просто лишиться недоступною — решта працює.
          })

        setStatus('running')

        let lastPose: TrackedFace | null = null
        let lastVideoTime = -1
        let frames = 0
        let fpsClock = performance.now()
        let lastVcamSend = 0
        let packMs = 0
        let packCount = 0

        // Малюємо з частотою зйомки: віртуальна камера однаково оголошує 60
        // і повторює останній кадр, якщо ми пишемо рідше.
        const FRAME_MS = 1000 / captureFps
        let lastTick = 0
        let lastDetect = 0
        let lastSegment = 0

        /**
         * rAF прив'язаний до композитора вікна: варто перейти в Discord — і кадри
         * майже перестають надходити. Тому під час трансляції поруч працює
         * сторожовий таймер, який веде цикл сам, якщо rAF замовк.
         */
        function watchdog(): void {
          timerRef.current = window.setTimeout(watchdog, FRAME_MS)
          if (vcamRef.current && performance.now() - lastTick >= FRAME_MS * 1.5) tick()
        }

        function rafLoop(): void {
          rafRef.current = requestAnimationFrame(rafLoop)
          // Обмежуємо кадром камери: на моніторі 144 Гц рендерити втричі частіше,
          // ніж хтось побачить, немає сенсу — це просто нагрів відеокарти.
          if (performance.now() - lastTick < FRAME_MS * 0.9) return
          tick()
        }

        function tick(): void {
          lastTick = performance.now()

          const v = videoRef.current
          const r = rendererRef.current
          const t = trackerRef.current
          if (!v || !r || !t || v.readyState < 2) return

          const p = paramsRef.current
          r.resize(v.videoWidth, v.videoHeight)

          // Детекція обличчя — найдорожче в кадрі, і на 60 кадрах/с вона зайва:
          // обличчя не рухається так швидко, а згладжування в рендерері однаково
          // тягне позу між детекціями. Тому тримаємо її на 30 разах за секунду.
          const now = performance.now()
          if (v.currentTime !== lastVideoTime && now - lastDetect >= DETECT_MS) {
            lastVideoTime = v.currentTime
            lastDetect = now
            lastPose = t.detect(v, now, p.mirror)
          }

          // Маску рахуємо лише коли фон справді підмінюється.
          const seg = segmenterRef.current
          if (p.bgMode !== 0 && seg?.ready && now - lastSegment >= SEGMENT_MS) {
            lastSegment = now
            const mask = seg.segment(v, now)
            if (mask) r.setMask(mask, seg.width, seg.height)
          }

          r.render(v, lastPose, p, overlaysRef.current)

          if (captureRef.current) {
            captureRef.current = false
            // toBlob знімає буфер синхронно на момент виклику — саме тому одразу після render.
            r.canvas.toBlob((blob) => {
              if (!blob) return
              const url = URL.createObjectURL(blob)

              void blob.arrayBuffer().then(async (buf) => {
                const path = await window.memecam.savePhoto(new Uint8Array(buf), timestampName())
                setShots((prev) => {
                  const next = [{ path, url }, ...prev]
                  // Посилання на витіснені мініатюри звільняємо, інакше пам'ять
                  // тектиме на кожному знімку.
                  for (const old of next.slice(SHOT_HISTORY)) URL.revokeObjectURL(old.url)
                  return next.slice(0, SHOT_HISTORY)
                })
              })
            }, 'image/png')
          }

          // Поріг із запасом, інакше тремтіння таймера з'їдало б кожен другий кадр.
          if (vcamRef.current && now - lastVcamSend >= FRAME_MS * 0.8) {
            lastVcamSend = now
            try {
              const t0 = performance.now()
              const nv12 = r.readNv12(VCAM_WIDTH, VCAM_HEIGHT)
              // На старті кадру ще немає: перше знімання лише запускається.
              if (nv12) window.memecam.virtualCamera.sendFrame(nv12)
              packMs += performance.now() - t0
              packCount++
            } catch {
              // Один зірваний кадр не привід валити весь цикл рендеру.
            }
          }

          frames++
          if (now - fpsClock >= 500) {
            setStats({
              fps: Math.round((frames * 1000) / (now - fpsClock)),
              faceFound: lastPose !== null,
              packMs: packCount > 0 ? packMs / packCount : 0
            })
            frames = 0
            packMs = 0
            packCount = 0
            fpsClock = now
          }
        }

        rafLoop()
        watchdog()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setStatus('error')
        stop()
      }
    },
    [canvasRef, stop, captureFps]
  )

  /** Знімок буде зроблено на найближчому кадрі, вже з ефектом. */
  const capture = useCallback(() => {
    captureRef.current = true
  }, [])

  const startVirtualCamera = useCallback(async (target: CameraTarget) => {
    await window.memecam.virtualCamera.start(VCAM_WIDTH, VCAM_HEIGHT, VCAM_FPS, target)
    vcamRef.current = true
    setVcamOn(true)
  }, [])

  const stopVirtualCamera = useCallback(async () => {
    vcamRef.current = false
    setVcamOn(false)
    await window.memecam.virtualCamera.stop()
  }, [])

  useEffect(() => stop, [stop])

  return {
    status,
    error,
    stats,
    shots,
    start,
    stop,
    capture,
    vcamOn,
    startVirtualCamera,
    stopVirtualCamera
  }
}
