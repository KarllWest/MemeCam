import type { JSX } from 'react'
import { VOICE_PRESETS } from '../audio/presets'
import type { VoiceStats } from '../useVoice'

interface Props {
  on: boolean
  presetId: string
  stats: VoiceStats
  onPreset: (id: string) => void
}

/**
 * Вузька смуга з голосами. Вибір мікрофона й виходу навмисно не тут:
 * разом вони перетворювали низ вікна на звалище однакових полів.
 */
export function VoiceBar({ on, presetId, stats, onPreset }: Props): JSX.Element {
  return (
    <div className={`voice ${on ? 'on' : ''}`}>
      <span className="voice-label">
        Голос
        {on && <span className="voice-latency">{stats.latencyMs.toFixed(0)} мс</span>}
      </span>

      <div className="level" title="Рівень сигналу">
        <div className="level-fill" style={{ width: `${Math.round(stats.level * 100)}%` }} />
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
    </div>
  )
}
