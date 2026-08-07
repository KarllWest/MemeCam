import type { JSX } from 'react'
import type { LensParams } from '../gl/LensRenderer'
import type { Mask } from '../masks/types'
import { Slider } from './Slider'
import { ColorInput } from './ColorInput'

interface Props {
  mask: Mask
  params: LensParams
  hasOverlays: boolean
  onChange: <K extends keyof LensParams>(key: K, value: LensParams[K]) => void
  onReset: () => void
  onClose: () => void
}

/** Тонке налаштування поточної маски. Виїжджає збоку, щоб не тіснити кадр. */
export function SettingsPanel({
  mask,
  params,
  hasOverlays,
  onChange,
  onReset,
  onClose
}: Props): JSX.Element {
  const set = onChange

  return (
    <aside className="panel">
      <header className="panel-head">
        <div>
          <h2>
            <span aria-hidden="true">{mask.icon}</span> {mask.name}
          </h2>
          <p className="panel-note">Правки діють на цю маску й скидаються при перемиканні.</p>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Закрити налаштування">
          ✕
        </button>
      </header>

      <div className="panel-body">
        <div className="panel-row">
          <label className="check">
            <input
              type="checkbox"
              checked={params.mirror}
              onChange={(e) => set('mirror', e.target.checked)}
            />
            Дзеркалити (селфі)
          </label>
          <button className="btn sm ghost" onClick={onReset}>
            Скинути
          </button>
        </div>

        {hasOverlays && (
          <>
            <h3>Посадка накладок</h3>
            <Slider label="Розмір" value={params.overlayScale} min={0.4} max={2} step={0.01}
              onChange={(v) => set('overlayScale', v)} />
            <Slider label="Зсув по вертикалі" value={params.overlayOffsetY} min={-0.6} max={0.6}
              step={0.01} onChange={(v) => set('overlayOffsetY', v)} />
          </>
        )}

        <h3>Сяйво</h3>
        <ColorInput label="Колір лазера" value={params.color} onChange={(v) => set('color', v)} />
        <Slider label="Чіткість" value={params.sharpness} min={2} max={8} step={0.1}
          onChange={(v) => set('sharpness', v)} />
        <Slider label="Сила" value={params.intensity} min={0} max={4} step={0.05}
          onChange={(v) => set('intensity', v)} />
        <Slider label="Ядро в зіниці" value={params.coreSize} min={0.004} max={0.05} step={0.001}
          onChange={(v) => set('coreSize', v)} />
        <Slider label="Bloom" value={params.bloomStrength} min={0} max={3} step={0.05}
          onChange={(v) => set('bloomStrength', v)} />
        <Slider label="Поріг bloom" value={params.bloomThreshold} min={0.1} max={1.5} step={0.01}
          onChange={(v) => set('bloomThreshold', v)} />

        <h3>Горизонтальний штрих</h3>
        <Slider label="Сила" value={params.streakGain} min={0} max={2} step={0.05}
          onChange={(v) => set('streakGain', v)} />
        <Slider label="Довжина" value={params.streakLen} min={0.01} max={0.4} step={0.005}
          onChange={(v) => set('streakLen', v)} />
        <Slider label="Товщина" value={params.streakWidth} min={0.002} max={0.03} step={0.0005}
          onChange={(v) => set('streakWidth', v)} />

        <h3>Направлений промінь</h3>
        <Slider label="Сила" value={params.beamGain} min={0} max={2.5} step={0.05}
          onChange={(v) => set('beamGain', v)} />
        <Slider label="Довжина" value={params.beamLen} min={0.05} max={1.5} step={0.01}
          onChange={(v) => set('beamLen', v)} />
        <Slider label="Товщина" value={params.beamWidth} min={0.004} max={0.08} step={0.001}
          onChange={(v) => set('beamWidth', v)} />
        <Slider label="Розхід" value={params.beamSpread} min={0} max={0.2} step={0.005}
          onChange={(v) => set('beamSpread', v)} />

        <h3>Дим унизу</h3>
        <ColorInput label="Колір диму" value={params.smokeColor}
          onChange={(v) => set('smokeColor', v)} />
        <Slider label="Щільність" value={params.smokeAmount} min={0} max={1.5} step={0.01}
          onChange={(v) => set('smokeAmount', v)} />
        <Slider label="Висота шару" value={params.smokeHeight} min={0.05} max={0.7} step={0.01}
          onChange={(v) => set('smokeHeight', v)} />
        <Slider label="Швидкість" value={params.smokeSpeed} min={0} max={1.5} step={0.01}
          onChange={(v) => set('smokeSpeed', v)} />
        <Slider label="Дрібність клубів" value={params.smokeScale} min={1} max={8} step={0.1}
          onChange={(v) => set('smokeScale', v)} />

        <h3>Блискавки вгорі</h3>
        <ColorInput label="Колір розряду" value={params.boltColor}
          onChange={(v) => set('boltColor', v)} />
        <Slider label="Кількість" value={params.boltCount} min={0} max={4} step={1}
          onChange={(v) => set('boltCount', v)} />
        <Slider label="Частота ударів" value={params.boltRate} min={0.1} max={2} step={0.05}
          onChange={(v) => set('boltRate', v)} />
        <Slider label="Довжина" value={params.boltLen} min={0.1} max={1} step={0.01}
          onChange={(v) => set('boltLen', v)} />
        <Slider label="Товщина" value={params.boltWidth} min={0.001} max={0.015} step={0.0005}
          onChange={(v) => set('boltWidth', v)} />
        <Slider label="Ореол" value={params.boltGlow} min={0} max={3} step={0.05}
          onChange={(v) => set('boltGlow', v)} />
        <Slider label="Спалах кадру" value={params.boltFlash} min={0} max={0.8} step={0.01}
          onChange={(v) => set('boltFlash', v)} />

        <h3>Картинка</h3>
        <Slider label="Яскравість сцени" value={params.exposure} min={0.1} max={1.5} step={0.01}
          onChange={(v) => set('exposure', v)} />
        <Slider label="Контраст" value={params.contrast} min={0.5} max={2} step={0.01}
          onChange={(v) => set('contrast', v)} />
        <Slider label="Насиченість" value={params.saturation} min={0} max={1.5} step={0.01}
          onChange={(v) => set('saturation', v)} />
        <Slider label="Віньєтка" value={params.vignette} min={0} max={1.5} step={0.01}
          onChange={(v) => set('vignette', v)} />
        <Slider label="Згладжування руху" value={params.smoothing} min={0} max={0.95} step={0.01}
          onChange={(v) => set('smoothing', v)} />
      </div>
    </aside>
  )
}
