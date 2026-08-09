import { useEffect, useState, type JSX } from 'react'
import type { VoiceParams } from '../audio/presets'
import { Slider } from './Slider'

export interface UserVoice {
  id: string
  name: string
  icon: string
  params: VoiceParams
}

interface Props {
  /** Пресет для правки; null означає створення нового. */
  editing: UserVoice | null
  /** Звідки почати, якщо створюємо новий — зазвичай поточний вибраний. */
  startFrom: VoiceParams
  /** Чи ввімкнений мікрофон: без нього правку не почути. */
  micOn: boolean
  /** Кожна зміна одразу йде в обробку, щоб було чути результат. */
  onPreview: (params: VoiceParams | null) => void
  onSaved: (voices: UserVoice[]) => void
  onClose: () => void
}

const EMOJI = ['🎚', '👹', '🐤', '🛸', '📢', '🥁', '🫧', '🎻', '🔊', '🌀', '🧊', '🔥']

/**
 * Редактор пресета голосу.
 *
 * Усі повзунки одразу чути на живому мікрофоні: голосовий ефект неможливо
 * підібрати за числами, його треба почути.
 */
export function VoiceEditor({
  editing,
  startFrom,
  micOn,
  onPreview,
  onSaved,
  onClose
}: Props): JSX.Element {
  const [voice, setVoice] = useState<UserVoice>(
    () =>
      editing ?? {
        id: `voice-${Date.now().toString(36)}`,
        name: 'Мій голос',
        icon: '🎚',
        params: { ...startFrom }
      }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onPreview(voice.params)
    return () => onPreview(null)
  }, [voice.params, onPreview])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof VoiceParams>(key: K, value: VoiceParams[K]): void =>
    setVoice((v) => ({ ...v, params: { ...v.params, [key]: value } }))

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await window.memecam.voices.save(voice))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const p = voice.params

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="modal-head">
          <div>
            <h2>{editing ? 'Правка голосу' : 'Новий голос'}</h2>
            <p className="modal-sub">
              {micOn ? 'Говори — зміни чути одразу' : 'Увімкни мікрофон, щоб чути правки'}
            </p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="editor-row">
            <label className="device">
              <span>Назва</span>
              <input
                className="text-input"
                value={voice.name}
                maxLength={64}
                onChange={(e) => setVoice((v) => ({ ...v, name: e.target.value }))}
              />
            </label>
          </div>

          <h3>Значок</h3>
          <div className="emoji-row">
            {EMOJI.map((e) => (
              <button
                key={e}
                className={`emoji ${voice.icon === e ? 'active' : ''}`}
                onClick={() => setVoice((v) => ({ ...v, icon: e }))}
              >
                {e}
              </button>
            ))}
          </div>

          <h3>Тон</h3>
          <Slider label="Зсув, півтонів" value={p.semitones} min={-18} max={12} step={1}
            onChange={(v) => set('semitones', v)} />
          <p className="panel-note">
            Мінус — нижче й тягучіше, плюс — вище. Це зсув тону, а не сповільнення:
            темп мовлення лишається твоїм.
          </p>

          <h3>Механічний призвук</h3>
          <Slider label="Сила" value={p.ringMix} min={0} max={1} step={0.01}
            onChange={(v) => set('ringMix', v)} />
          <Slider label="Частота, Гц" value={p.ringHz} min={0} max={800} step={1}
            onChange={(v) => set('ringHz', v)} />
          <p className="panel-note">
            Низька частота дає робота, висока — брязкіт рації.
          </p>

          <h3>Відлуння</h3>
          <Slider label="Гучність" value={p.echoMix} min={0} max={1} step={0.01}
            onChange={(v) => set('echoMix', v)} />
          <Slider label="Затримка, мс" value={p.echoMs} min={10} max={900} step={5}
            onChange={(v) => set('echoMs', v)} />
          <Slider label="Повторення" value={p.echoFeedback} min={0} max={0.92} step={0.01}
            onChange={(v) => set('echoFeedback', v)} />

          <h3>Загальне</h3>
          <Slider label="Скільки ефекту" value={p.wet} min={0} max={1} step={0.01}
            onChange={(v) => set('wet', v)} />
          <Slider label="Гучність" value={p.outputGain} min={0} max={3} step={0.01}
            onChange={(v) => set('outputGain', v)} />

          {error && <p className="notice err">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            Зберегти голос
          </button>
        </div>
      </div>
    </div>
  )
}
