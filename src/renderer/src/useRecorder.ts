import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecorderState {
  recording: boolean
  /** Тривалість поточного запису в секундах. */
  seconds: number
  error: string | null
  lastPath: string | null
}

/** Порядок переваги: беремо перший кодек, який ця збірка справді вміє. */
const CODECS = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm'
]

function pickCodec(): string | null {
  for (const type of CODECS) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

function timestampName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `memecam-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.webm`
}

/**
 * Запис відео з полотна разом з обробленим голосом.
 *
 * Пишемо саме полотно, а не камеру: у ньому вже є маски, фон і сяйво — тобто
 * рівно те, що бачить співрозмовник.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    recording: false,
    seconds: 0,
    error: null,
    lastPath: null
  })

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback((canvas: HTMLCanvasElement, fps: number, audio: MediaStream | null) => {
    if (recorderRef.current) return

    const codec = pickCodec()
    if (!codec) {
      setState((s) => ({ ...s, error: 'Ця збірка не вміє записувати відео' }))
      return
    }

    try {
      const stream = canvas.captureStream(fps)
      // Голос підмішуємо, лише якщо мікрофон увімкнений: інакше вийде німий файл
      // з порожньою звуковою доріжкою, і плеєри показують це як несправність.
      for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track)
      streamRef.current = stream

      const recorder = new MediaRecorder(stream, {
        mimeType: codec,
        videoBitsPerSecond: 8_000_000
      })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: codec })
        chunksRef.current = []
        void blob.arrayBuffer().then(async (buf) => {
          const path = await window.memecam.saveVideo(new Uint8Array(buf), timestampName())
          setState((s) => ({ ...s, lastPath: path }))
        })
      }

      // Ріжемо на секундні шматки: якщо додаток впаде, більшість запису вціліє.
      recorder.start(1000)
      recorderRef.current = recorder
      setState({ recording: true, seconds: 0, error: null, lastPath: null })
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return

    recorder.stop()
    recorderRef.current = null

    // Зупиняємо лише доріжку полотна: доріжка голосу належить AudioEngine,
    // і її зупинка обірвала б і моніторинг у навушниках.
    for (const track of streamRef.current?.getVideoTracks() ?? []) track.stop()
    streamRef.current = null

    setState((s) => ({ ...s, recording: false }))
  }, [])

  useEffect(() => {
    if (!state.recording) return
    const started = performance.now()
    const id = window.setInterval(() => {
      setState((s) => (s.recording ? { ...s, seconds: (performance.now() - started) / 1000 } : s))
    }, 250)
    return () => clearInterval(id)
  }, [state.recording])

  useEffect(() => {
    return () => {
      recorderRef.current?.stop()
      recorderRef.current = null
    }
  }, [])

  return { ...state, start, stop }
}
