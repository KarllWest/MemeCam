import type { JSX } from 'react'
import type { CameraTarget } from '../useMemeCam'

interface Props {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
  outputs: MediaDeviceInfo[]
  cameraId: string
  micId: string
  outputId: string
  target: CameraTarget
  cameraLocked: boolean
  voiceLocked: boolean
  targetLocked: boolean
  onCamera: (id: string) => void
  onMic: (id: string) => void
  onOutput: (id: string) => void
  onTarget: (t: CameraTarget) => void
}

function DeviceRow({
  label,
  value,
  options,
  fallback,
  disabled,
  onChange
}: {
  label: string
  value: string
  options: MediaDeviceInfo[]
  fallback: string
  disabled: boolean
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <label className="device">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{fallback}</option>
        {options.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Вибір пристроїв живе в налаштуваннях, а не на головній панелі.
 * Його чіпають раз на місяць, а місця він займав стільки ж, скільки затвор.
 */
export function DevicesSection(p: Props): JSX.Element {
  return (
    <>
      <h3>Пристрої</h3>

      <DeviceRow label="Камера" value={p.cameraId} options={p.cameras}
        fallback="За замовчуванням" disabled={p.cameraLocked} onChange={p.onCamera} />

      <DeviceRow label="Мікрофон" value={p.micId} options={p.mics}
        fallback="За замовчуванням" disabled={p.voiceLocked} onChange={p.onMic} />

      <DeviceRow label="Вихід голосу" value={p.outputId} options={p.outputs}
        fallback="За замовчуванням" disabled={p.voiceLocked} onChange={p.onOutput} />

      <label className="device">
        <span>Камера в Discord</span>
        <select
          value={p.target}
          onChange={(e) => p.onTarget(e.target.value as CameraTarget)}
          disabled={p.targetLocked}
        >
          <option value="memecam">Meme Cam</option>
          <option value="obs">OBS Virtual Camera</option>
        </select>
      </label>

      <p className="panel-note">
        Щоб оброблений голос пішов у Discord, вихід має вести у віртуальний аудіокабель.
      </p>
    </>
  )
}
