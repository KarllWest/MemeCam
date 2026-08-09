/**
 * Власні пресети голосу.
 *
 * На відміну від масок, тут немає жодних файлів — лише числа. Тому й обмін
 * простіший: пресет цілком уміщається в один невеликий json, який можна
 * прочитати очима й за потреби виправити руками.
 *
 * Межі значень навмисно повторюють ті, що оголошені в воркліті: якщо сюди
 * потрапить щось поза ними, воркліт однаково обріже, але вже мовчки.
 */
import { app, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface VoiceParams {
  semitones: number
  ringHz: number
  ringMix: number
  echoMs: number
  echoFeedback: number
  echoMix: number
  wet: number
  outputGain: number
}

export interface UserVoice {
  id: string
  name: string
  icon: string
  params: VoiceParams
}

const BOUNDS: Record<keyof VoiceParams, [number, number, number]> = {
  // [мінімум, максимум, значення за замовчуванням]
  semitones: [-24, 24, 0],
  ringHz: [0, 2000, 0],
  ringMix: [0, 1, 0],
  echoMs: [10, 1400, 180],
  echoFeedback: [0, 0.92, 0],
  echoMix: [0, 1, 0],
  wet: [0, 1, 1],
  outputGain: [0, 4, 1]
}

const filePath = (): string => join(app.getPath('userData'), 'user-voices.json')

function sanitizeVoice(raw: unknown): UserVoice | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const id = typeof r.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(r.id) ? r.id : null
  const name = typeof r.name === 'string' ? r.name.slice(0, 64) : null
  if (!id || !name) return null

  const src = (typeof r.params === 'object' && r.params !== null ? r.params : {}) as Record<
    string,
    unknown
  >

  const params = {} as VoiceParams
  for (const [key, [min, max, def]] of Object.entries(BOUNDS)) {
    const v = src[key]
    params[key as keyof VoiceParams] =
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
  }

  return {
    id,
    name,
    icon: typeof r.icon === 'string' ? r.icon.slice(0, 8) : '🎚',
    params
  }
}

export async function loadUserVoices(): Promise<UserVoice[]> {
  try {
    const raw = JSON.parse(await readFile(filePath(), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.map(sanitizeVoice).filter((v): v is UserVoice => v !== null)
  } catch {
    return [] // немає файлу або він побитий — починаємо з порожнього списку
  }
}

async function persist(voices: UserVoice[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(filePath(), JSON.stringify(voices, null, 2), 'utf8')
}

export async function saveUserVoice(raw: unknown): Promise<UserVoice[]> {
  const voice = sanitizeVoice(raw)
  if (!voice) throw new Error('Пресет має неповний опис')

  const voices = await loadUserVoices()
  const i = voices.findIndex((v) => v.id === voice.id)
  if (i >= 0) voices[i] = voice
  else voices.push(voice)

  await persist(voices)
  return voices
}

export async function deleteUserVoice(id: unknown): Promise<UserVoice[]> {
  if (typeof id !== 'string') return loadUserVoices()

  const voices = (await loadUserVoices()).filter((v) => v.id !== id)
  await persist(voices)
  return voices
}

export async function exportUserVoice(id: unknown): Promise<string | null> {
  if (typeof id !== 'string') return null

  const voice = (await loadUserVoices()).find((v) => v.id === id)
  if (!voice) return null

  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: 'Куди зберегти пресет',
    defaultPath: `${voice.name}.memevoice`,
    filters: [{ name: 'Голос Meme Cam', extensions: ['memevoice'] }]
  })
  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, JSON.stringify({ version: 1, voice }, null, 2), 'utf8')
  return result.filePath
}

export async function importUserVoice(): Promise<UserVoice[] | null> {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: 'Оберіть файл пресета',
    properties: ['openFile'],
    filters: [{ name: 'Голос Meme Cam', extensions: ['memevoice', 'json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const bundle = JSON.parse(await readFile(result.filePaths[0], 'utf8'))
  const voice = sanitizeVoice(bundle?.voice)
  if (!voice) throw new Error('Це не схоже на пресет Meme Cam')

  // Свій ідентифікатор, інакше імпорт затирав би однойменний власний пресет.
  voice.id = randomUUID()

  const voices = await loadUserVoices()
  voices.push(voice)
  await persist(voices)
  return voices
}
