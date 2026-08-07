import { useEffect, useRef, type JSX } from 'react'
import { MASKS } from '../masks/registry'

interface Props {
  selected: string
  onSelect: (id: string) => void
}

/** Стрічка масок, що лежить поверх нижнього краю кадру — як у камерах телефонів. */
export function MaskCarousel({ selected, onSelect }: Props): JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null)

  // Коли маску перемикають стрілками, вона може бути за межами видимої частини.
  useEffect(() => {
    const active = stripRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selected])

  return (
    <div className="carousel" ref={stripRef} role="radiogroup" aria-label="Маски">
      {MASKS.map((m) => (
        <button
          key={m.id}
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
      ))}
    </div>
  )
}
