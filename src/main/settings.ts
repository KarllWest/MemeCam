/**
 * Збереження налаштувань між запусками.
 *
 * Файл шифрується через safeStorage — це ключ, який Windows тримає прив'язаним
 * до облікового запису (DPAPI). Інший користувач на тій самій машині файл не
 * прочитає, і скопійований на чужий комп'ютер він теж марний.
 *
 * Чесна межа: від зловмисника, який уже виконує код **під твоїм** обліковим
 * записом, це не захищає — він попросить у тієї ж системи розшифрувати файл і
 * отримає його. Шифрування тут проти витоку файлу, а не проти зараженої машини.
 */
import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const filePath = (): string => join(app.getPath('userData'), 'settings.dat')

/** Що саме зберігаємо. Все безпечне — жодних токенів чи паролів. */
export interface Settings {
  maskId?: string
  voicePresetId?: string
  semitones?: number
  cameraId?: string
  micId?: string
  outputId?: string
  target?: 'memecam' | 'obs'
  captureFps?: number
  mirror?: boolean
}

/** Обмежуємо те, що приймаємо з рендерера: чужі поля просто відкидаємо. */
function sanitize(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length <= 256 ? v : undefined

  return {
    maskId: str(r.maskId),
    voicePresetId: str(r.voicePresetId),
    semitones:
      typeof r.semitones === 'number' && Number.isFinite(r.semitones)
        ? Math.min(24, Math.max(-24, r.semitones))
        : undefined,
    cameraId: str(r.cameraId),
    micId: str(r.micId),
    outputId: str(r.outputId),
    target: r.target === 'obs' || r.target === 'memecam' ? r.target : undefined,
    captureFps: r.captureFps === 30 || r.captureFps === 60 ? r.captureFps : undefined,
    mirror: typeof r.mirror === 'boolean' ? r.mirror : undefined
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(filePath())

    // Перший байт позначає, чи вміст зашифрований: на системах без безпечного
    // сховища доводиться писати відкритим текстом, і читач має це розрізняти.
    const encrypted = raw[0] === 1
    const body = raw.subarray(1)

    const json =
      encrypted && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(body)
        : body.toString('utf8')

    return sanitize(JSON.parse(json))
  } catch {
    return {} // немає файлу, битий або з чужим ключем — починаємо з чистого
  }
}

export async function saveSettings(raw: unknown): Promise<void> {
  const clean = sanitize(raw)
  const json = JSON.stringify(clean)

  const canEncrypt = safeStorage.isEncryptionAvailable()
  const body = canEncrypt ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  const out = Buffer.concat([Buffer.from([canEncrypt ? 1 : 0]), body])

  const path = filePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, out)
}
