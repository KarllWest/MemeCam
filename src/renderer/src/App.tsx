import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LensParams } from './gl/LensRenderer'
import { MASKS, findMask, paramsForMask } from './masks/registry'
import { isOverlay } from './masks/types'
import { useMemeCam, VCAM_FPS, type CameraTarget } from './useMemeCam'
import { useVoice } from './useVoice'
import { findVoicePreset } from './audio/presets'
import { MaskCarousel } from './ui/MaskCarousel'
import { VoiceBar } from './ui/VoiceBar'
import { DevicesSection } from './ui/DevicesSection'
import { SettingsPanel } from './ui/SettingsPanel'
import { UpdatesDialog } from './ui/UpdatesDialog'

type FilterStatus = Awaited<ReturnType<typeof window.memecam.filter.status>>
type UpdateState = Awaited<ReturnType<typeof window.memecam.updates.state>>

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [maskId, setMaskId] = useState('laser')
  const mask = useMemo(() => findMask(maskId), [maskId])
  const overlayLayers = useMemo(() => mask.layers.filter(isOverlay), [mask])

  const [params, setParams] = useState<LensParams>(() => paramsForMask(findMask('laser')))
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [audioIn, setAudioIn] = useState<MediaDeviceInfo[]>([])
  const [audioOut, setAudioOut] = useState<MediaDeviceInfo[]>([])
  const [micId, setMicId] = useState('')
  const [outId, setOutId] = useState('')
  const [semitones, setSemitones] = useState(-5)
  const [target, setTarget] = useState<CameraTarget>('memecam')
  const [filter, setFilter] = useState<FilterStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [restored, setRestored] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'err' } | null>(null)

  const { status, error, stats, lastPhoto, start, stop, capture, vcamOn, startVirtualCamera, stopVirtualCamera } =
    useMemeCam(canvasRef, params, overlayLayers)

  const voice = useVoice()

  const running = status === 'running'
  const needsDriver = target === 'memecam' && filter !== null && !filter.current

  const selectMask = useCallback((id: string) => {
    setMaskId(id)
    setParams(paramsForMask(findMask(id)))
  }, [])

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    setDevices(all.filter((d) => d.kind === 'videoinput'))
    setAudioIn(all.filter((d) => d.kind === 'audioinput'))
    setAudioOut(all.filter((d) => d.kind === 'audiooutput'))
  }, [])

  const toggleVoice = useCallback(async () => {
    if (voice.on) await voice.stop()
    else {
      await voice.start(micId, outId)
      // Мітки пристроїв стають видимі лише після дозволу на мікрофон.
      await refreshDevices()
    }
  }, [voice, micId, outId, refreshDevices])

  const refreshFilter = useCallback(async () => {
    setFilter(await window.memecam.filter.status())
  }, [])

  useEffect(() => {
    void refreshDevices()
    void refreshFilter()
    void window.memecam.updates.state().then(setUpdate)
    return window.memecam.updates.onChange(setUpdate)
  }, [refreshDevices, refreshFilter])

  // Відновлюємо вибір з минулого запуску. Робиться один раз, до першої взаємодії.
  useEffect(() => {
    void window.memecam.settings.load().then((s) => {
      if (typeof s.maskId === 'string') selectMask(s.maskId)
      if (typeof s.voicePresetId === 'string') voice.selectPreset(s.voicePresetId)
      if (typeof s.semitones === 'number') {
        setSemitones(s.semitones)
        voice.tune('semitones', s.semitones)
      }
      if (typeof s.cameraId === 'string') setDeviceId(s.cameraId)
      if (typeof s.micId === 'string') setMicId(s.micId)
      if (typeof s.outputId === 'string') setOutId(s.outputId)
      if (s.target === 'obs' || s.target === 'memecam') setTarget(s.target)
      setRestored(true)
    })
    // Свідомо один раз при старті: далі стан веде користувач.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Зберігаємо після кожної зміни, але тільки коли відновлення вже позаду —
  // інакше перший же запис затер би збережене значеннями за замовчуванням.
  useEffect(() => {
    if (!restored) return
    void window.memecam.settings.save({
      maskId,
      voicePresetId: voice.presetId,
      semitones,
      cameraId: deviceId,
      micId,
      outputId: outId,
      target,
      mirror: params.mirror
    })
  }, [restored, maskId, voice.presetId, semitones, deviceId, micId, outId, target, params.mirror])

  useEffect(() => {
    if (running) void refreshDevices()
  }, [running, refreshDevices])

  const set = useCallback(<K extends keyof LensParams>(key: K, value: LensParams[K]): void => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const installDriver = async (): Promise<void> => {
    setInstalling(true)
    setNotice(null)
    try {
      await window.memecam.filter.register()
      setNotice({ text: 'Камеру «Meme Cam» встановлено', tone: 'info' })
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), tone: 'err' })
    } finally {
      setInstalling(false)
      await refreshFilter()
    }
  }

  const toggleBroadcast = async (): Promise<void> => {
    setNotice(null)
    try {
      if (vcamOn) await stopVirtualCamera()
      else await startVirtualCamera(target)
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), tone: 'err' })
    }
  }

  // Пробіл — затвор, стрілки — гортання масок.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (showUpdates) return

      if (e.code === 'Space' && running) {
        e.preventDefault()
        capture()
        return
      }
      const step = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0
      if (step !== 0) {
        e.preventDefault()
        const i = MASKS.findIndex((m) => m.id === maskId)
        selectMask(MASKS[(i + step + MASKS.length) % MASKS.length].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [capture, running, maskId, selectMask, showUpdates])

  // Гарячі клавіші приходять з main і працюють, коли вікно згорнуте.
  useEffect(() => {
    return window.memecam.hotkeys.onPress((action) => {
      switch (action.type) {
        case 'mask':
          if (action.index < MASKS.length) selectMask(MASKS[action.index].id)
          break
        case 'mask-off':
          selectMask(MASKS[0].id)
          break
        case 'mask-next':
        case 'mask-prev': {
          const step = action.type === 'mask-next' ? 1 : -1
          const i = MASKS.findIndex((m) => m.id === maskId)
          selectMask(MASKS[(i + step + MASKS.length) % MASKS.length].id)
          break
        }
        case 'capture':
          if (running) capture()
          break
        case 'voice-toggle':
          void toggleVoice()
          break
        case 'broadcast-toggle':
          if (running && !needsDriver) void toggleBroadcast()
          break
      }
    })
  })

  const updateReady = update?.phase === 'available' || update?.phase === 'ready'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="icon.png" alt="" width={26} height={26} />
          <span className="brand-name">Meme Cam</span>
          <span className="brand-version">{update?.currentVersion ?? ''}</span>
        </div>

        <div className="topbar-status">
          {running && (
            <>
              <span className="pill">{stats.fps} fps</span>
              <span className={`pill ${stats.faceFound ? 'ok' : 'warn'}`}>
                {stats.faceFound ? 'обличчя знайдено' : 'обличчя не видно'}
              </span>
              {vcamOn && (
                <span className="pill live">
                  <span className="dot" /> у Discord · {stats.packMs.toFixed(1)} мс
                </span>
              )}
            </>
          )}
        </div>

        <div className="topbar-actions">
          <button
            className={`iconbtn ${updateReady ? 'badged' : ''}`}
            onClick={() => setShowUpdates(true)}
            title="Що нового"
            aria-label="Що нового"
          >
            🔔
          </button>
          <button
            className={`iconbtn ${showSettings ? 'on' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Тонке налаштування"
            aria-label="Тонке налаштування"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="workspace">
        <main className="stage">
          <div className="viewport">
            <canvas ref={canvasRef} className={running ? 'live' : 'idle'} />

            {!running && (
              <div className="placeholder">
                {status === 'loading' && (
                  <>
                    <img src="icon.png" alt="" width={96} height={96} />
                    <p className="title">Вмикаю камеру</p>
                    <p>вантажу модель обличчя…</p>
                  </>
                )}
                {status === 'idle' && (
                  <>
                    <img src="icon.png" alt="" width={96} height={96} />
                    <p className="title">Готовий до мемів</p>
                    <p>Тисни «Увімкнути камеру», щоб почати</p>
                    <p className="keys">
                      <kbd>Space</kbd> фото
                      <kbd>← →</kbd> маски
                      <kbd>Ctrl + Alt + V</kbd> голос
                    </p>
                  </>
                )}
                {status === 'error' && (
                  <>
                    <img src="icon.png" alt="" width={96} height={96} />
                    <p className="title err">Не вдалось запустити камеру</p>
                    <p className="detail">{error}</p>
                  </>
                )}
              </div>
            )}

            <MaskCarousel selected={maskId} onSelect={selectMask} />
          </div>

          <div className="actionbar">
            <div className="ab-side">
              <button
                className={`btn wide ${running ? '' : 'primary'}`}
                onClick={() => (running ? stop() : void start(deviceId || undefined))}
                disabled={status === 'loading'}
              >
                {running ? '⏹ Вимкнути камеру' : '▶ Увімкнути камеру'}
              </button>

              <button
                className={`btn wide ${voice.on ? 'live' : 'accent'}`}
                onClick={() => void toggleVoice()}
                title="Ctrl + Alt + V"
              >
                {voice.on ? '🎤 Голос іде' : '🎤 Увімкнути голос'}
              </button>
            </div>

            <button
              className="shutter"
              onClick={capture}
              disabled={!running}
              title="Зняти фото (Пробіл)"
              aria-label="Зняти фото"
            >
              <span />
            </button>

            <div className="ab-side right">
              <button
                className={`btn wide ${vcamOn ? 'live' : 'accent'}`}
                onClick={() => void toggleBroadcast()}
                disabled={!running || needsDriver}
                title={`Віддає ${VCAM_FPS} кадрів/с у систему як звичайну веб-камеру`}
              >
                {vcamOn ? '⏹ Зупинити трансляцію' : '📡 Транслювати в Discord'}
              </button>
            </div>
          </div>

          <VoiceBar
            on={voice.on}
            presetId={voice.presetId}
            stats={voice.stats}
            error={voice.error}
            outputLabel={
              audioOut.find((d) => d.deviceId === outId)?.label || 'системний вихід за замовчуванням'
            }
            onPreset={(id) => {
              voice.selectPreset(id)
              setSemitones(findVoicePreset(id).params.semitones)
            }}
          />

          <div className="notices">
            {needsDriver && (
              <p className="notice">
                {filter?.available ? (
                  <>
                    Камеру «Meme Cam» ще не встановлено в систему.
                    <button className="link" onClick={() => void installDriver()} disabled={installing}>
                      {installing ? 'встановлюю…' : 'встановити'}
                    </button>
                    <span className="dim">Права адміністратора не потрібні.</span>
                  </>
                ) : (
                  <span className="err">
                    Не знайдено бібліотеку камери. Збери її: <code>npm run build:filter</code>
                  </span>
                )}
              </p>
            )}

            {vcamOn && (
              <p className="notice">
                Обери <b>{target === 'memecam' ? 'Meme Cam' : 'OBS Virtual Camera'}</b> у
                налаштуваннях камери Discord. Додаток має лишатися відкритим.
              </p>
            )}

            {notice && (
              <p className={`notice ${notice.tone === 'err' ? 'err' : ''}`}>{notice.text}</p>
            )}

            {lastPhoto && (
              <p className="notice">
                Збережено: <code>{lastPhoto}</code>
                <button className="link" onClick={() => void window.memecam.revealInFolder(lastPhoto)}>
                  показати в теці
                </button>
              </p>
            )}
          </div>
        </main>

        {showSettings && (
          <SettingsPanel
            mask={mask}
            params={params}
            hasOverlays={overlayLayers.length > 0}
            semitones={semitones}
            onChange={set}
            onSemitones={(v) => {
              setSemitones(v)
              voice.tune('semitones', v)
            }}
            onReset={() => selectMask(maskId)}
            onClose={() => setShowSettings(false)}
          >
            <DevicesSection
              cameras={devices}
              mics={audioIn}
              outputs={audioOut}
              cameraId={deviceId}
              micId={micId}
              outputId={outId}
              target={target}
              cameraLocked={running}
              voiceLocked={voice.on}
              targetLocked={vcamOn}
              onCamera={setDeviceId}
              onMic={setMicId}
              onOutput={setOutId}
              onTarget={setTarget}
            />
          </SettingsPanel>
        )}
      </div>

      {showUpdates && <UpdatesDialog onClose={() => setShowUpdates(false)} />}
    </div>
  )
}
