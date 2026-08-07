import { useEffect, useState, type JSX } from 'react'
import { CHANGE_LABELS, RELEASES, type ChangeKind } from '../changelog'

type UpdateState = Awaited<ReturnType<typeof window.memecam.updates.state>>

interface Props {
  onClose: () => void
}

const ORDER: ChangeKind[] = ['added', 'changed', 'fixed', 'removed']

/** Короткий рядок стану під заголовком: що зараз відомо про оновлення. */
function statusLine(state: UpdateState | null): { text: string; tone: string } {
  if (!state) return { text: 'Перевіряю…', tone: '' }

  switch (state.phase) {
    case 'checking':
      return { text: 'Перевіряю наявність оновлень…', tone: '' }
    case 'available':
      return { text: `Доступна версія ${state.version}`, tone: 'ok' }
    case 'downloading':
      return { text: `Завантажую… ${state.progress}%`, tone: '' }
    case 'ready':
      return { text: `Версія ${state.version} готова до встановлення`, tone: 'ok' }
    case 'up-to-date':
      return { text: 'У тебе найновіша версія', tone: 'ok' }
    case 'unsupported':
      return { text: state.message ?? 'Оновлення недоступні', tone: 'muted' }
    case 'error':
      return { text: state.message ?? 'Не вдалось перевірити оновлення', tone: 'err' }
    default:
      return { text: 'Натисни «Перевірити», щоб пошукати оновлення', tone: 'muted' }
  }
}

export function UpdatesDialog({ onClose }: Props): JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.memecam.updates.state().then(setState)
    const off = window.memecam.updates.onChange(setState)
    return off
  }, [])

  // Escape закриває — звична поведінка для модального вікна.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const status = statusLine(state)
  const busy = state?.phase === 'checking' || state?.phase === 'downloading'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Що нового"
      >
        <header className="modal-head">
          <div>
            <h2>Що нового</h2>
            <p className="modal-sub">
              Встановлена версія {state?.currentVersion ?? RELEASES[0].version}
            </p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        <div className="update-status">
          <span className={`update-dot ${status.tone}`} />
          <span className={status.tone === 'err' ? 'err' : undefined}>{status.text}</span>

          <span className="spacer" />

          {state?.phase === 'available' && (
            <button className="btn primary sm" onClick={() => void window.memecam.updates.download()}>
              Завантажити
            </button>
          )}
          {state?.phase === 'ready' && (
            <button className="btn primary sm" onClick={() => void window.memecam.updates.install()}>
              Встановити й перезапустити
            </button>
          )}
          {state?.phase !== 'available' && state?.phase !== 'ready' && (
            <button
              className="btn sm"
              onClick={() => void window.memecam.updates.check()}
              disabled={busy}
            >
              {busy ? 'Зачекай…' : 'Перевірити'}
            </button>
          )}
        </div>

        {state?.notes && (
          <div className="release-notes">
            <h4>Опис нової версії</h4>
            <p>{state.notes}</p>
          </div>
        )}

        <div className="modal-body">
          {RELEASES.map((release) => (
            <section key={release.version} className="release">
              <div className="release-head">
                <h3>{release.version}</h3>
                <time>{release.date}</time>
                {release.version === state?.currentVersion && (
                  <span className="chip now">встановлена</span>
                )}
              </div>
              {release.summary && <p className="release-summary">{release.summary}</p>}

              {ORDER.map((kind) => {
                const items = release.changes.filter((c) => c.kind === kind)
                if (items.length === 0) return null
                return (
                  <div key={kind} className="change-group">
                    <h4>
                      <span aria-hidden="true">{CHANGE_LABELS[kind].icon}</span>
                      {CHANGE_LABELS[kind].label}
                    </h4>
                    <ul>
                      {items.map((c) => (
                        <li key={c.text}>{c.text}</li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
