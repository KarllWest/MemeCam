import type { JSX } from 'react'
import { VOICE_PRESETS } from '../audio/presets'
import type { VoiceStats } from '../useVoice'

interface Props {
  on: boolean
  presetId: string
  stats: VoiceStats
  error: string | null
  inputs: MediaDeviceInfo[]
  outputs: MediaDeviceInfo[]
  inputId: string
  outputId: string
  semitones: number
  onInput: (id: string) => void
  onOutput: (id: string) => void
  onPreset: (id: string) => void
  onSemitones: (v: number) => void
  onToggle: () => void
}

/** Чи схожий пристрій на віртуальний кабель — саме через такий голос іде в Discord. */
const isVirtualCable = (label: string): boolean =>
  /cable|voicemeeter|virtual audio|vac /i.test(label)

export function VoiceBar({
  on,
  presetId,
  stats,
  error,
  inputs,
  outputs,
  inputId,
  outputId,
  semitones,
  onInput,
  onOutput,
  onPreset,
  onSemitones,
  onToggle
}: Props): JSX.Element {
  const routedToDiscord = isVirtualCable(
    outputs.find((d) => d.deviceId === outputId)?.label ?? ''
  )

  return (
    <section className="voice">
      <div className="voice-head">
        <button className={`btn ${on ? 'live' : 'accent'}`} onClick={onToggle}>
          {on ? 'Вимкнути голос' : 'Увімкнути голос'}
        </button>

        <div className="level" title="Рівень сигналу">
          <div className="level-fill" style={{ width: `${Math.round(stats.level * 100)}%` }} />
        </div>

        {on && <span className="pill">{stats.latencyMs.toFixed(0)} мс затримки</span>}

        <span className="spacer" />

        <select value={inputId} onChange={(e) => onInput(e.target.value)} disabled={on}
          title="Мікрофон">
          <option value="">Мікрофон за замовчуванням</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Мікрофон ${i + 1}`}
            </option>
          ))}
        </select>

        <select value={outputId} onChange={(e) => onOutput(e.target.value)} disabled={on}
          title="Куди віддавати оброблений голос">
          <option value="">Вихід за замовчуванням</option>
          {outputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Вихід ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div className="voice-presets">
        {VOICE_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`vp ${p.id === presetId ? 'active' : ''}`}
            onClick={() => onPreset(p.id)}
            title={p.hint}
          >
            <span className="vp-icon">{p.icon}</span>
            <span className="vp-name">{p.name}</span>
          </button>
        ))}
      </div>

      <label className="slider voice-slider">
        <span className="slider-head">
          <span>Глибина тону</span>
          <b>{semitones > 0 ? `+${semitones}` : semitones} півтонів</b>
        </span>
        <input
          type="range"
          min={-18}
          max={12}
          step={1}
          value={semitones}
          onChange={(e) => onSemitones(Number(e.target.value))}
        />
      </label>

      {error && <p className="notice err">{error}</p>}

      {on && !routedToDiscord && (
        <p className="notice">
          Зараз ти чуєш себе сам. Щоб голос пішов у Discord, вихід має вести у віртуальний
          аудіокабель — див. README.
        </p>
      )}

      {on && routedToDiscord && (
        <p className="notice">
          Обери відповідний <b>CABLE Output</b> як мікрофон у Discord.
        </p>
      )}
    </section>
  )
}
