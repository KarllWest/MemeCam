import { useEffect, useState, type JSX } from 'react'
import {
  ANCHOR_DEFAULTS,
  ANCHOR_LABELS,
  type AnchorPreset,
  type UserMask,
  type UserOverlay
} from '../masks/userMasks'
import { Slider } from './Slider'

interface Props {
  /** Маска для правки; null означає створення нової. */
  editing: UserMask | null
  /** Викликається на кожну зміну — щоб було видно результат просто на камері. */
  onPreview: (mask: UserMask | null) => void
  onSaved: (masks: UserMask[]) => void
  onClose: () => void
}

const EMOJI = ['🖼', '😎', '👑', '🔥', '💀', '🐸', '👽', '🤖', '🎩', '⭐', '💥', '🌈']

function newMask(): UserMask {
  return {
    id: `user-${Date.now().toString(36)}`,
    name: 'Моя маска',
    icon: '🖼',
    overlays: []
  }
}

/**
 * Редактор власної маски.
 *
 * Замість індексів точок обличчя пропонує людські прив'язки: «на очі»,
 * «над головою». Результат видно одразу на камері — підбирати розмір наосліп
 * по числах неможливо.
 */
export function MaskEditor({ editing, onPreview, onSaved, onClose }: Props): JSX.Element {
  const [mask, setMask] = useState<UserMask>(() => editing ?? newMask())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Кожна правка одразу йде в перегляд, а при закритті — знімається.
  useEffect(() => {
    onPreview(mask.overlays.length > 0 ? mask : null)
    return () => onPreview(null)
  }, [mask, onPreview])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addImage = async (): Promise<void> => {
    setError(null)
    const texture = await window.memecam.masks.pickImage()
    if (!texture) return

    const anchor: AnchorPreset = 'head'
    const d = ANCHOR_DEFAULTS[anchor]
    const overlay: UserOverlay = {
      texture,
      anchor,
      scale: d.scale,
      offsetX: 0,
      offsetY: d.offsetY,
      rotate: true,
      opacity: 1
    }
    setMask((m) => ({ ...m, overlays: [...m.overlays, overlay] }))
  }

  const patch = (i: number, next: Partial<UserOverlay>): void =>
    setMask((m) => ({
      ...m,
      overlays: m.overlays.map((o, k) => (k === i ? { ...o, ...next } : o))
    }))

  const removeOverlay = (i: number): void =>
    setMask((m) => ({ ...m, overlays: m.overlays.filter((_, k) => k !== i) }))

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await window.memecam.masks.save(mask))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="modal-head">
          <div>
            <h2>{editing ? 'Правка маски' : 'Нова маска'}</h2>
            <p className="modal-sub">Результат видно на камері одразу</p>
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
                value={mask.name}
                maxLength={64}
                onChange={(e) => setMask((m) => ({ ...m, name: e.target.value }))}
              />
            </label>
          </div>

          <h3>Значок</h3>
          <div className="emoji-row">
            {EMOJI.map((e) => (
              <button
                key={e}
                className={`emoji ${mask.icon === e ? 'active' : ''}`}
                onClick={() => setMask((m) => ({ ...m, icon: e }))}
              >
                {e}
              </button>
            ))}
          </div>

          <h3>Картинки</h3>
          {mask.overlays.length === 0 && (
            <p className="panel-note">
              Додай картинку — підійде будь-який PNG з прозорим тлом. Далі обереш, куди
              вона кріпиться.
            </p>
          )}

          {mask.overlays.map((o, i) => (
            <section key={`${o.texture}-${i}`} className="overlay-card">
              <div className="overlay-head">
                <img src={`usermask://local/${o.texture}`} alt="" />
                <select
                  value={o.anchor}
                  onChange={(e) => {
                    const anchor = e.target.value as AnchorPreset
                    // Разом із прив'язкою підставляємо розумний розмір: інакше
                    // картинка стрибає кудись за межі кадру.
                    patch(i, { anchor, ...ANCHOR_DEFAULTS[anchor] })
                  }}
                >
                  {Object.entries(ANCHOR_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="btn sm ghost" onClick={() => removeOverlay(i)}>
                  Прибрати
                </button>
              </div>

              <Slider label="Розмір" value={o.scale} min={0.1} max={4} step={0.01}
                onChange={(v) => patch(i, { scale: v })} />
              <Slider label="Зсув угору" value={o.offsetY} min={-1.5} max={1.5} step={0.01}
                onChange={(v) => patch(i, { offsetY: v })} />
              <Slider label="Зсув убік" value={o.offsetX} min={-1.5} max={1.5} step={0.01}
                onChange={(v) => patch(i, { offsetX: v })} />
              <Slider label="Прозорість" value={o.opacity} min={0.05} max={1} step={0.01}
                onChange={(v) => patch(i, { opacity: v })} />

              <label className="check">
                <input
                  type="checkbox"
                  checked={o.rotate}
                  onChange={(e) => patch(i, { rotate: e.target.checked })}
                />
                Хилити разом з головою
              </label>
            </section>
          ))}

          <button className="btn sm" onClick={() => void addImage()}>
            + Додати картинку
          </button>

          {error && <p className="notice err">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Скасувати
          </button>
          <button
            className="btn primary"
            onClick={() => void save()}
            disabled={busy || mask.overlays.length === 0}
          >
            Зберегти маску
          </button>
        </div>
      </div>
    </div>
  )
}
