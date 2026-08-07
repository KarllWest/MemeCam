// Збирає DirectShow-фільтр у native/build/memecam-filter.dll (x64).
//
// Потрібні Visual Studio Build Tools з компонентом C++ і Windows SDK.
// Команди складаємо у .bat: cl.exe працює лише з оточенням від vcvars64,
// а bat-файл заразом знімає всі питання з лапками у шляхах на кшталт
// "Program Files (x86)" та "meme cam".
//
// Запуск: npm run build:filter
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'native/memecam-filter')
const out = join(root, 'native/build')
const force = process.argv.includes('--force')

const dllPath = join(out, 'memecam-filter.dll')

/**
 * Windows тримає зареєстровану бібліотеку завантаженою в кожному застосунку,
 * який колись перелічував камери (браузер, месенджери). Перезбирати незмінені
 * сирці означало б нариватися на «файл зайнятий» на рівному місці.
 */
function isUpToDate() {
  if (force || !existsSync(dllPath)) return false
  const built = statSync(dllPath).mtimeMs
  return readdirSync(src).every((f) => statSync(join(src, f)).mtimeMs <= built)
}

if (isUpToDate()) {
  console.log('✓ Фільтр уже зібраний і сирці не мінялись — пропускаю (--force щоб перезібрати)')
  process.exit(0)
}

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'

if (!existsSync(VSWHERE)) {
  console.error('Не знайдено vswhere.exe — Visual Studio Build Tools не встановлені.')
  process.exit(1)
}

const vsPath = execFileSync(VSWHERE, ['-latest', '-products', '*', '-property', 'installationPath'])
  .toString()
  .trim()

const vcvars = join(vsPath, 'VC/Auxiliary/Build/vcvars64.bat')
if (!vsPath || !existsSync(vcvars)) {
  console.error(`Не знайдено ${vcvars} — бракує компонента C++ у Build Tools.`)
  process.exit(1)
}

mkdirSync(out, { recursive: true })

/**
 * Прибирає з дороги попередню збірку.
 *
 * Windows не дає перезаписати завантажену бібліотеку, зате дозволяє її
 * перейменувати: відкриті дескриптори йдуть за файлом. Бібліотеку тримають усі
 * застосунки, які колись перелічували камери, і закривати їх заради збірки безглуздо.
 */
function displaceLockedDll() {
  // Спершу прибираємо старі відкладені копії, які вже ніхто не тримає.
  for (const f of readdirSync(out)) {
    if (f.startsWith('memecam-filter.old-')) {
      try {
        unlinkSync(join(out, f))
      } catch {
        // Ще завантажена — видалиться наступного разу.
      }
    }
  }

  if (!existsSync(dllPath)) return
  try {
    unlinkSync(dllPath)
  } catch {
    renameSync(dllPath, join(out, `memecam-filter.old-${Date.now()}.dll`))
  }
}

displaceLockedDll()

const dll = dllPath

// Прямі слеші навмисно: MSVC читає \" як екранування лапки, тому шлях, що
// закінчується на зворотний слеш (наприклад /Fo"...\build\"), склеює аргументи.
const w = (p) => p.replace(/\\/g, '/')
const objs = ['filter.obj', 'dllmain.obj'].map((o) => w(join(out, o)))

// Коментарі в .bat лишаємо англійськими: cmd.exe читає файл у кодуванні консолі.
const bat = [
  '@echo off',
  `call "${vcvars}" >nul || exit /b 1`,
  [
    'cl.exe /nologo /c /EHsc /O2 /MT /W3 /std:c++17',
    '/DWIN32 /DNDEBUG /D_WINDOWS /D_USRDLL',
    `/Fo"${w(out)}/"`,
    `"${w(join(src, 'filter.cpp'))}"`,
    `"${w(join(src, 'dllmain.cpp'))}"`,
    '|| exit /b 1'
  ].join(' '),
  [
    'link.exe /nologo /DLL',
    `/DEF:"${w(join(src, 'memecam.def'))}"`,
    `/OUT:"${w(dll)}"`,
    objs.map((o) => `"${o}"`).join(' '),
    'strmiids.lib ole32.lib oleaut32.lib uuid.lib advapi32.lib user32.lib',
    '|| exit /b 1'
  ].join(' '),
  'exit /b 0'
].join('\r\n')

const batPath = join(out, '_build.bat')
writeFileSync(batPath, bat, 'latin1')

const r = spawnSync('cmd.exe', ['/c', batPath], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error(`\nЗбірка фільтра впала з кодом ${r.status}`)
  console.error(
    'Якщо помилка LNK1104 «cannot open file» — бібліотеку тримає застосунок,\n' +
      'який перелічував камери (браузер, Discord). Закрий їх або зніми реєстрацію:\n' +
      `  regsvr32 /s /u "${dllPath}"`
  )
  process.exit(r.status ?? 1)
}

console.log(`\n✓ ${dll} (${statSync(dll).size} байт)`)
