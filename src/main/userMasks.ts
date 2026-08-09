/**
 * Власні маски користувача.
 *
 * Живуть у теці даних, а не всередині застосунку: інакше оновлення затирало б
 * усе, що людина зробила сама. Картинки віддаються сторінці через власну схему
 * usermask:// — читати їх напряму з диска вікно не має права.
 */
import { app, dialog, protocol, net, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

/** Куди прив'язується накладка. Індекси точок ховаємо: користувачу вони ні до чого. */
export type AnchorPreset = 'eyes' | 'head' | 'nose' | 'mouth' | 'face'

export interface UserOverlay {
  /** Ім'я файлу в теці картинок. */
  texture: string
  anchor: AnchorPreset
  scale: number
  offsetX: number
  offsetY: number
  rotate: boolean
  opacity: number
}

export interface UserMask {
  id: string
  name: string
  icon: string
  overlays: UserOverlay[]
}

const masksDir = (): string => join(app.getPath('userData'), 'masks')
const filesDir = (): string => join(masksDir(), 'files')
const indexPath = (): string => join(masksDir(), 'user-masks.json')

const PRESETS: AnchorPreset[] = ['eyes', 'head', 'nose', 'mouth', 'face']

/** Приводимо до відомого вигляду: у файл могло потрапити будь-що. */
function sanitizeMask(raw: unknown): UserMask | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const id = typeof r.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(r.id) ? r.id : null
  const name = typeof r.name === 'string' ? r.name.slice(0, 64) : null
  if (!id || !name) return null

  const overlays: UserOverlay[] = []
  for (const o of Array.isArray(r.overlays) ? r.overlays : []) {
    if (typeof o !== 'object' || o === null) continue
    const v = o as Record<string, unknown>

    // Ім'я файлу без шляхів: інакше маска могла б указати на будь-що на диску.
    const texture = typeof v.texture === 'string' ? basename(v.texture) : ''
    if (!texture) continue

    const num = (x: unknown, def: number, min: number, max: number): number =>
      typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def

    overlays.push({
      texture,
      anchor: PRESETS.includes(v.anchor as AnchorPreset) ? (v.anchor as AnchorPreset) : 'head',
      scale: num(v.scale, 1, 0.05, 6),
      offsetX: num(v.offsetX, 0, -3, 3),
      offsetY: num(v.offsetY, 0, -3, 3),
      rotate: v.rotate !== false,
      opacity: num(v.opacity, 1, 0, 1)
    })
  }
  if (overlays.length === 0) return null

  return {
    id,
    name,
    icon: typeof r.icon === 'string' ? r.icon.slice(0, 8) : '🖼',
    overlays
  }
}

export async function loadUserMasks(): Promise<UserMask[]> {
  try {
    const raw = JSON.parse(await readFile(indexPath(), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.map(sanitizeMask).filter((m): m is UserMask => m !== null)
  } catch {
    return [] // немає файлу або він побитий — починаємо з порожнього списку
  }
}

async function saveIndex(masks: UserMask[]): Promise<void> {
  await mkdir(masksDir(), { recursive: true })
  await writeFile(indexPath(), JSON.stringify(masks, null, 2), 'utf8')
}

/** Питає файл картинки й кладе копію до себе. Повертає ім'я файлу. */
export async function pickImage(): Promise<string | null> {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: 'Оберіть картинку для маски',
    properties: ['openFile'],
    filters: [{ name: 'Картинки', extensions: ['png', 'webp', 'svg', 'gif', 'jpg', 'jpeg'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const source = result.filePaths[0]
  const ext = extname(source).toLowerCase() || '.png'
  const name = `${randomUUID()}${ext}`

  await mkdir(filesDir(), { recursive: true })
  await writeFile(join(filesDir(), name), await readFile(source))
  return name
}

export async function saveUserMask(raw: unknown): Promise<UserMask[]> {
  const mask = sanitizeMask(raw)
  if (!mask) throw new Error('Маска має неповний опис')

  const masks = await loadUserMasks()
  const i = masks.findIndex((m) => m.id === mask.id)
  if (i >= 0) masks[i] = mask
  else masks.push(mask)

  await saveIndex(masks)
  return masks
}

export async function deleteUserMask(id: unknown): Promise<UserMask[]> {
  if (typeof id !== 'string') return loadUserMasks()

  const masks = await loadUserMasks()
  const gone = masks.find((m) => m.id === id)
  const rest = masks.filter((m) => m.id !== id)
  await saveIndex(rest)

  // Картинки прибираємо лише ті, які більше нікому не потрібні.
  const stillUsed = new Set(rest.flatMap((m) => m.overlays.map((o) => o.texture)))
  for (const o of gone?.overlays ?? []) {
    if (!stillUsed.has(o.texture)) await unlink(join(filesDir(), o.texture)).catch(() => {})
  }

  return rest
}

/**
 * Викладає маску в один файл: опис і картинки разом, у base64.
 * Так її можна просто надіслати — нічого не загубиться дорогою.
 */
export async function exportUserMask(id: unknown): Promise<string | null> {
  if (typeof id !== 'string') return null

  const mask = (await loadUserMasks()).find((m) => m.id === id)
  if (!mask) return null

  const files: Record<string, string> = {}
  for (const o of mask.overlays) {
    const path = join(filesDir(), o.texture)
    if (existsSync(path)) files[o.texture] = (await readFile(path)).toString('base64')
  }

  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    title: 'Куди зберегти маску',
    defaultPath: `${mask.name}.memecam`,
    filters: [{ name: 'Маска Meme Cam', extensions: ['memecam'] }]
  })
  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, JSON.stringify({ version: 1, mask, files }, null, 2), 'utf8')
  return result.filePath
}

/** Приймає файл .memecam і додає маску до себе. */
export async function importUserMask(): Promise<UserMask[] | null> {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    title: 'Оберіть файл маски',
    properties: ['openFile'],
    filters: [{ name: 'Маска Meme Cam', extensions: ['memecam', 'json'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const bundle = JSON.parse(await readFile(result.filePaths[0], 'utf8'))
  const mask = sanitizeMask(bundle?.mask)
  if (!mask) throw new Error('Це не схоже на маску Meme Cam')

  // Свій ідентифікатор: інакше імпорт затирав би однойменну власну маску.
  mask.id = randomUUID()

  await mkdir(filesDir(), { recursive: true })
  const files = (bundle?.files ?? {}) as Record<string, string>

  for (const o of mask.overlays) {
    const data = files[o.texture]
    if (typeof data !== 'string') throw new Error(`У файлі бракує картинки ${o.texture}`)

    const ext = extname(o.texture).toLowerCase() || '.png'
    const name = `${randomUUID()}${ext}`
    await writeFile(join(filesDir(), name), Buffer.from(data, 'base64'))
    o.texture = name
  }

  const masks = await loadUserMasks()
  masks.push(mask)
  await saveIndex(masks)
  return masks
}

/** Прибирає картинки, на які вже ніхто не посилається. */
export async function pruneUnusedImages(): Promise<void> {
  const used = new Set((await loadUserMasks()).flatMap((m) => m.overlays.map((o) => o.texture)))
  for (const name of await readdir(filesDir()).catch(() => [])) {
    if (!used.has(name)) await unlink(join(filesDir(), name)).catch(() => {})
  }
}

/** Схема usermask:// — єдиний шлях, яким сторінка дістає ці картинки. */
export function registerUserMaskProtocol(): void {
  protocol.handle('usermask', (request) => {
    const { pathname } = new URL(request.url)
    const dir = filesDir()
    const target = normalize(join(dir, basename(decodeURIComponent(pathname))))

    if (!target.startsWith(dir + sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })
}
