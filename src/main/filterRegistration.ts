/**
 * Реєстрація нашого DirectShow-фільтра в системі.
 *
 * DllRegisterServer у самій бібліотеці пише в HKCU\Software\Classes, тому
 * встановлення камери не потребує прав адміністратора: Windows зводить цю гілку
 * з HKLM у HKEY_CLASSES_ROOT, і камеру бачать усі застосунки користувача.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, unlink, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Має збігатися з kFilterClsid у native/memecam-filter/guids.h */
const FILTER_CLSID = '{D28DD6E3-627F-4C05-AC7F-513441A10980}'
const REG_KEY = `HKCU\\Software\\Classes\\CLSID\\${FILTER_CLSID}\\InprocServer32`

export interface FilterStatus {
  /** Чи є звідки взяти бібліотеку. */
  available: boolean
  /** Чи зареєстрована камера в системі. */
  registered: boolean
  /** Чи вказує реєстрація на робочу бібліотеку в постійному місці. */
  current: boolean
  dllPath: string
}

/** Звідки беремо бібліотеку: з ресурсів застосунку або зі збірки в деві. */
function sourceDllPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'memecam-filter.dll')
    : join(app.getAppPath(), 'native', 'build', 'memecam-filter.dll')
}

/**
 * Куди кладемо бібліотеку перед реєстрацією.
 *
 * Два рішення, обидва вимушені:
 *
 * Тека користувача, а не тека застосунку — бо портативна збірка розпаковується
 * в Temp, яка зникає після закриття, і в системі лишалась би камера, що вказує
 * в порожнечу.
 *
 * Номер версії в імені — бо Windows тримає зареєстровану бібліотеку завантаженою
 * в кожному застосунку, який колись перелічував камери. Перезаписати чи навіть
 * перейменувати її не вийде, тож нову версію кладемо поруч під новим іменем.
 */
export function filterDllPath(): string {
  return join(driverDir(), `memecam-filter-${app.getVersion()}.dll`)
}

function driverDir(): string {
  return join(app.getPath('userData'), 'driver')
}

/**
 * Позначка «камеру колись ставили».
 *
 * Потрібна, бо оновлення застосунку знімає реєстрацію: інсталятор спершу
 * запускає деінсталятор попередньої версії. Без цієї позначки додаток не міг би
 * відрізнити «користувач ще не ставив камеру» від «щойно її в нас забрали».
 */
const markerPath = (): string => join(app.getPath('userData'), 'driver-installed')

const wasInstalled = (): boolean => existsSync(markerPath())

/** Шлях, на який зараз указує реєстрація, або null. */
async function registeredPath(): Promise<string | null> {
  try {
    const { stdout } = await run('reg', ['query', REG_KEY, '/ve'])
    // Формат рядка: "    (Default)    REG_SZ    C:\...\memecam-filter.dll"
    const match = stdout.match(/REG_SZ\s+(.+?)\s*$/m)
    return match ? match[1].trim() : null
  } catch {
    return null // ключа немає — фільтр не зареєстровано
  }
}

export async function getFilterStatus(): Promise<FilterStatus> {
  const dllPath = filterDllPath()
  const registered = await registeredPath()

  return {
    available: existsSync(sourceDllPath()),
    registered: registered !== null,
    // Реєстрація вважається справною, лише якщо вказує на постійну копію і та
    // копія на місці. Інакше в системі висить камера, яку неможливо завантажити.
    current:
      registered !== null &&
      registered.toLowerCase() === dllPath.toLowerCase() &&
      existsSync(dllPath),
    dllPath
  }
}

/** Прибирає бібліотеки від попередніх версій, які вже ніхто не тримає. */
async function removeOldDrivers(keep: string): Promise<void> {
  const dir = driverDir()
  for (const name of await readdir(dir).catch(() => [])) {
    const full = join(dir, name)
    if (name.startsWith('memecam-filter') && full !== keep) {
      await run('regsvr32', ['/s', '/u', full]).catch(() => {})
      await unlink(full).catch(() => {})
    }
  }
}

/**
 * Тихо перереєстровує камеру, якщо вона вказує на бібліотеку від старої версії.
 *
 * Без цього після оновлення додатка в системі лишався б старий драйвер, і нові
 * можливості камери просто не працювали б — при тому що зовні все виглядало б
 * справним.
 */
export async function syncFilterIfStale(): Promise<void> {
  const status = await getFilterStatus()
  if (status.current || !status.available) return

  // Відновлюємо або оновлюємо лише те, що користувач уже погоджувався поставити.
  if (!status.registered && !wasInstalled()) return

  await registerFilter().catch(() => {
    // Не вийшло — спробуємо наступного запуску, стара камера поки працює.
  })
}

/**
 * Ставить камеру: копіює бібліотеку в постійну теку й реєструє її.
 * Повторний виклик безпечний — просто перезапише те саме.
 */
export async function registerFilter(): Promise<void> {
  const source = sourceDllPath()
  if (!existsSync(source)) {
    throw new Error(`Не знайдено бібліотеку камери: ${source}`)
  }

  const dllPath = filterDllPath()
  await mkdir(driverDir(), { recursive: true })

  // Ім'я містить версію, тож файл завжди новий і блокувань не буває.
  if (!existsSync(dllPath)) await copyFile(source, dllPath)

  try {
    await run('regsvr32', ['/s', dllPath])
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`Не вдалось зареєструвати камеру: ${detail}`)
  }

  const status = await getFilterStatus()
  if (!status.current) {
    throw new Error('Реєстрація пройшла без помилки, але камера в системі не з’явилась')
  }

  await writeFile(markerPath(), dllPath, 'utf8').catch(() => {})

  // Робимо це вже після успіху: краще лишити зайвий файл, ніж зняти робочу камеру.
  await removeOldDrivers(dllPath)
}

export async function unregisterFilter(): Promise<void> {
  // Знімаємо все, що лежить у теці драйвера: після оновлень там могли
  // накопичитись бібліотеки від попередніх версій.
  await removeOldDrivers('')
  await unlink(markerPath()).catch(() => {})
}
