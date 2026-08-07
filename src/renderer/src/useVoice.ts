import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { findVoicePreset, type VoiceParams } from './audio/presets'

export interface VoiceStats {
  level: number
  latencyMs: number
}

/** Мікрофон з ефектами: вмикання, вибір пресета й індикатор рівня. */
export function useVoice() {
  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioEngine()

  const [on, setOn] = useState(false)
  const [presetId, setPresetId] = useState('slowed')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<VoiceStats>({ level: 0, latencyMs: 0 })

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
    setStats({ level: 0, latencyMs: 0 })
  }, [])

  const selectPreset = useCallback((id: string) => {
    setPresetId(id)
    paramsRef.current = findVoicePreset(id).params
    engineRef.current!.apply(paramsRef.current)
  }, [])

  /** Точкова правка поверх пресета — наприклад, глибина зсуву тону. */
  const tune = useCallback(<K extends keyof VoiceParams>(key: K, value: VoiceParams[K]) => {
    paramsRef.current = { ...paramsRef.current, [key]: value }
    engineRef.current!.apply(paramsRef.current)
  }, [])

  // Індикатор рівня оновлюємо рідше за кадри: 20 разів на секунду цілком досить,
  // а зайві перемальовки React коштують дорожче за сам звук.
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => {
      const engine = engineRef.current!
      setStats({ level: engine.level(), latencyMs: engine.latencyMs() })
    }, 50)
    return () => clearInterval(id)
  }, [on])

  useEffect(() => {
    const engine = engineRef.current!
    return () => void engine.stop()
  }, [])

  return { on, presetId, error, stats, params: paramsRef.current, start, stop, selectPreset, tune }
}
