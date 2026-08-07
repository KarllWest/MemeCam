import type { JSX } from 'react'

export type Rgb = [number, number, number]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function rgbToHex([r, g, b]: Rgb): string {
  const to255 = (v: number): string =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to255(r)}${to255(g)}${to255(b)}`
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface ColorInputProps {
  label: string
  value: Rgb
  onChange: (value: Rgb) => void
}

/** Швидкі варіанти — щоб не колупатись у системній піпетці заради базового кольору. */
const SWATCHES: Rgb[] = [
  [1.0, 0.93, 0.78], // тепле біле
  [1.0, 0.24, 0.18], // червоний
  [0.35, 0.8, 1.0], // крижаний
  [0.45, 1.0, 0.55], // отруйно-зелений
  [0.85, 0.35, 1.0], // фіолетовий
  [1.0, 0.6, 0.1] // помаранчевий
]

export function ColorInput({ label, value, onChange }: ColorInputProps): JSX.Element {
  return (
    <div className="color">
      <span className="color-head">
        <span>{label}</span>
        <input
          type="color"
          value={rgbToHex(value)}
          onChange={(e) => onChange(hexToRgb(e.target.value))}
        />
      </span>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={rgbToHex(c)}
            type="button"
            className="swatch"
            style={{ background: rgbToHex(c) }}
            title={rgbToHex(c)}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  )
}
