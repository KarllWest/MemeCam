import { useEffect, useRef, type JSX } from 'react'
import type { Mask } from '../masks/types'

interface Props {
  masks: Mask[]
  /** Які з масок створив користувач — лише їх можна правити. */
  userMaskIds: string[]
  selected: string
  favorites: string[]
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onEdit: (id: string) => void
  onCreate: () => void
}

/** Стрічка масок, що лежить поверх нижнього краю кадру — як у камерах телефонів. */
export function MaskCarousel({
  masks,
  userMaskIds,
  selected,
  favorites,
  onSelect,
  onToggleFavorite,
  onEdit,
  onCreate
}: Props): JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null)

  // Улюблені попереду: інакше потрібну маску доводиться щоразу шукати гортанням.
  const ordered = [
    ...masks.filter((m) => favorites.includes(m.id)),
    ...masks.filter((m) => !favorites.includes(m.id))
  ]

  // Коли маску перемикають стрілками, вона може бути за межами видимої частини.
  useEffect(() => {
    const active = stripRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selected])

  return (
    <div className="carousel" ref={stripRef} role="radiogroup" aria-label="Маски">
      {ordered.map((m) => {
        const fav = favorites.includes(m.id)
        return (
          <div key={m.id} className={`mask-slot ${m.id === selected ? 'active' : ''}`}>
            <button
              className={`mask ${m.id === selected ? 'active' : ''}`}
              data-active={m.id === selected}
              onClick={() => onSelect(m.id)}
              role="radio"
              aria-checked={m.id === selected}
              title={m.name}
            >
              <span className="mask-icon">{m.icon}</span>
              <span className="mask-name">{m.name}</span>
            </button>

            <button
              className={`star ${fav ? 'on' : ''}`}
              onClick={() => onToggleFavorite(m.id)}
              title={fav ? 'Прибрати з улюблених' : 'Додати в улюблені'}
              aria-label={fav ? 'Прибрати з улюблених' : 'Додати в улюблені'}
            >
              {fav ? '★' : '☆'}
            </button>

            {/* Правити можна лише свої: вбудовані живуть у коді. */}
            {userMaskIds.includes(m.id) && (
              <button
                className="edit-mask"
                onClick={() => onEdit(m.id)}
                title="Змінити маску"
                aria-label="Змінити маску"
              >
                ✎
              </button>
            )}
          </div>
        )
      })}

      <button className="mask add" onClick={onCreate} title="Створити свою маску">
        <span className="mask-icon">＋</span>
        <span className="mask-name">Своя</span>
      </button>
    </div>
  )
}
