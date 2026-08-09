import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { findVoicePreset, type VoiceParams } from './audio/presets'

export interface VoiceStats {
  level: number
  latencyMs: number
  /** Скільки мілісекунд поспіль з мікрофона йде тиша. */
  silentMs: number
}

/** Мікрофон з ефектами: вмикання, вибір пресета й індикатор рівня. */
export function useVoice() {
  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioEngine()

  const [on, setOn] = useState(false)
  const [presetId, setPresetId] = useState('slowed')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<VoiceStats>({ level: 0, latencyMs: 0, silentMs: 0 })

  const paramsRef = useRef<VoiceParams>(findVoicePreset('slowed').params)

  const start = useCallback(
    async (inputDeviceId: string, outputDeviceId: string) => {
      setError(null)
      try {
        await engineRef.current!.start(inputDeviceId, outputDeviceId, paramsRef.current)
        setOn(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setOn(false)
      }
    },
    []
  )

  const stop = useCallback(async () => {
    await engineRef.current!.stop()
    setOn(false)
    setStats({ level: 0, latencyMs: 0, silentMs: 0 })
  }, [])

  /**
   * @param params набір для власних пресетів; для вбудованих береться з реєстру
   */
  const selectPreset = useCallback((id: string, params?: VoiceParams) => {
    setPresetId(id)
    paramsRef.current = params ? { ...params } : findVoicePreset(id).params
    engineRef.current!.apply(paramsRef.current)
  }, [])

  /** Точкова правка поверх пресета — наприклад, глибина зсуву тону. */
  const tune = useCallback(<K extends keyof VoiceParams>(key: K, value: VoiceParams[K]) => {
    paramsRef.current = { ...paramsRef.current, [key]: value }
    engineRef.current!.apply(paramsRef.current)
  }, [])

  /** Ставить одразу весь набір — це редактор під час правки. */
  const applyParams = useCallback((params: VoiceParams) => {
    paramsRef.current = { ...params }
    engineRef.current!.apply(paramsRef.current)
  }, [])

  // Індикатор рівня оновлюємо рідше за кадри: 20 разів на секунду цілком досить,
  // а зайві перемальовки React коштують дорожче за сам звук.
  useEffect(() => {
    if (!on) return

    const PERIOD = 50
    let silent = 0

    const id = window.setInterval(() => {
      const engine = engineRef.current!
      const level = engine.level()
      // Поріг трохи вище нуля: у тиші мікрофон однаково дає ледь чутний шум.
      silent = level > 0.01 ? 0 : silent + PERIOD
      setStats({ level, latencyMs: engine.latencyMs(), silentMs: silent })
    }, PERIOD)

    return () => clearInterval(id)
  }, [on])

  useEffect(() => {
    const engine = engineRef.current!
    return () => void engine.stop()
  }, [])

  return {
    on,
    presetId,
    error,
    stats,
    params: paramsRef.current,
    /** Оброблений голос як потік — його підмішує запис відео. */
    stream: on ? engineRef.current.stream : null,
    start,
    stop,
    selectPreset,
    tune,
    applyParams
  }
}
