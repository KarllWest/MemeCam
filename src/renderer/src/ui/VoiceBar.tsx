import type { JSX } from 'react'
import type { VoicePreset } from '../audio/presets'
import type { VoiceStats } from '../useVoice'

interface Props {
  on: boolean
  presetId: string
  presets: VoicePreset[]
  /** Які з пресетів створив користувач — лише їх можна правити. */
  userVoiceIds: string[]
  stats: VoiceStats
  error: string | null
  /** Куди йде оброблений голос — щоб було видно, що він не в ті навушники. */
  outputLabel: string
  onPreset: (id: string) => void
  onEdit: (id: string) => void
  onCreate: () => void
}

/**
 * Вузька смуга з голосами. Вибір мікрофона й виходу навмисно не тут:
 * разом вони перетворювали низ вікна на звалище однакових полів.
 */
export function VoiceBar({
  on,
  presetId,
  presets,
  userVoiceIds,
  stats,
  error,
  outputLabel,
  onPreset,
  onEdit,
  onCreate
}: Props): JSX.Element {
  // Мовчання довше трьох секунд майже завжди означає, що мікрофон зайняв
  // хтось інший — сам по собі він так надовго не замовкає.
  const noSignal = on && stats.silentMs > 3000

  return (
    <div className={`voice ${on ? 'on' : ''}`}>
      <div className="voice-row">
        <span className="voice-label">
          Голос
          {on && <span className="voice-latency">{stats.latencyMs.toFixed(0)} мс</span>}
        </span>

        <div className="level" title="Рівень сигналу з мікрофона">
          <div className="level-fill" style={{ width: `${Math.round(stats.level * 100)}%` }} />
        </div>

        <div className="voice-presets">
          {presets.map((p) => (
            <div key={p.id} className="vp-slot">
              <button
                className={`vp ${p.id === presetId ? 'active' : ''}`}
                onClick={() => onPreset(p.id)}
                title={p.hint}
              >
                <span className="vp-icon">{p.icon}</span>
                <span className="vp-name">{p.name}</span>
              </button>

              {/* Правити можна лише свої: вбудовані живуть у коді. */}
              {userVoiceIds.includes(p.id) && (
                <button
                  className="edit-voice"
                  onClick={() => onEdit(p.id)}
                  title="Змінити голос"
                  aria-label="Змінити голос"
                >
                  ✎
                </button>
              )}
            </div>
          ))}

          <button className="vp add" onClick={onCreate} title="Створити свій голос">
            <span className="vp-icon">＋</span>
            <span className="vp-name">Свій</span>
          </button>
        </div>
      </div>

      {error && <p className="voice-hint err">Мікрофон не запустився: {error}</p>}

      {noSignal && (
        <p className="voice-hint warn">
          Сигналу з мікрофона немає. Перевір, чи не зайняв його інший застосунок — Voicemod,
          Discord чи гра — і чи обраний потрібний мікрофон у налаштуваннях.
        </p>
      )}

      {on && !noSignal && !error && (
        <p className="voice-hint">
          Голос іде у <b>{outputLabel}</b>. Не чути — перевір, що це той пристрій, у якому
          ти слухаєш.
        </p>
      )}
    </div>
  )
}
