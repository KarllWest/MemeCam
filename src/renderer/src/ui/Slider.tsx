import type { JSX } from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export function Slider({ label, value, min, max, step, onChange }: SliderProps): JSX.Element {
  // Кількість знаків беремо з кроку, щоб 0.0005 не показувався як 0.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))

  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <b>{value.toFixed(decimals)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
