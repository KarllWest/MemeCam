/**
 * Віддає кадри у віртуальну камеру OBS напряму, без запуску самого OBS.
 *
 * Фільтр OBS Virtual Camera — це DirectShow-пристрій, зареєстрований у системі
 * інсталятором OBS. Кадри він бере зі спільної пам'яті з іменем OBSVirtualCamVideo:
 * її створює той, хто пише, а фільтр лише приєднується. Тому достатньо створити
 * мапінг з правильним заголовком — і Discord побачить «OBS Virtual Camera».
 *
 * Формат черги неофіційний, узятий зі структури queue_header у
 * plugins/win-dshow/shared-memory-queue.c вихідників OBS. Оновлення OBS теоретично
 * може його змінити — тоді камера просто не запуститься, аварії не буде.
 */

/**
 * Куди віддавати кадри.
 *
 * `memecam` — наш власний DirectShow-фільтр: окремий пристрій «Meme Cam» у списку
 * камер, працює незалежно від OBS. `obs` — черга віртуальної камери OBS; лишається
 * як запасний варіант, якщо наш фільтр не зареєстровано.
 */
export type CameraTarget = 'memecam' | 'obs'

const MAPPING_NAMES: Record<CameraTarget, string> = {
  memecam: 'MemeCamVideo',
  obs: 'OBSVirtualCamVideo'
}

// Розкладка queue_header, 80 байтів з урахуванням вирівнювання uint64 на 40.
const OFF_WRITE_IDX = 0
const OFF_STATE = 8
const OFF_OFFSETS = 12
const OFF_TYPE = 24
const OFF_CX = 28
const OFF_CY = 32
const OFF_INTERVAL = 40
const HEADER_SIZE = 80

const FRAME_COUNT = 3
const TIMESTAMP_SIZE = 8

const STATE_STOPPING = 3
const STATE_READY = 2
const STATE_STARTING = 1
const TYPE_VIDEO = 0

const PAGE_READWRITE = 0x04
const FILE_MAP_ALL_ACCESS = 0xf001f
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn

/** koffi віддає 64-бітні значення то числом, то BigInt — зводимо до одного типу. */
const toBig = (v: number | bigint): bigint => (typeof v === 'bigint' ? v : BigInt(v))

interface Win32 {
  CreateFileMappingW: (...args: unknown[]) => number | bigint
  MapViewOfFile: (...args: unknown[]) => number | bigint
  UnmapViewOfFile: (addr: bigint) => boolean
  CloseHandle: (h: bigint) => boolean
  RtlMoveMemory: (dest: bigint, src: Buffer, len: number) => void
  GetLastError: () => number
}

let win32: Win32 | null = null
let loadError: string | null = null

/** Прив'язка до kernel32 через FFI — жодного компілятора не потрібно. */
function loadWin32(): Win32 | null {
  if (win32 || loadError) return win32

  if (process.platform !== 'win32') {
    loadError = 'Віртуальна камера працює лише на Windows'
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const k = koffi.load('kernel32.dll')

    // Хендли й адреси тримаємо як uintptr_t: koffi не вміє арифметики над
    // непрозорими вказівниками, а нам треба писати за зміщенням від бази.
    win32 = {
      CreateFileMappingW: k.func(
        'uintptr_t __stdcall CreateFileMappingW(uintptr_t hFile, uintptr_t lpAttributes, uint32_t flProtect, uint32_t dwMaximumSizeHigh, uint32_t dwMaximumSizeLow, str16 lpName)'
      ),
      MapViewOfFile: k.func(
        'uintptr_t __stdcall MapViewOfFile(uintptr_t hFileMappingObject, uint32_t dwDesiredAccess, uint32_t dwFileOffsetHigh, uint32_t dwFileOffsetLow, size_t dwNumberOfBytesToMap)'
      ),
      UnmapViewOfFile: k.func('bool __stdcall UnmapViewOfFile(uintptr_t lpBaseAddress)'),
      CloseHandle: k.func('bool __stdcall CloseHandle(uintptr_t hObject)'),
      RtlMoveMemory: k.func(
        'void __stdcall RtlMoveMemory(uintptr_t dest, const void* src, size_t length)'
      ),
      GetLastError: k.func('uint32_t __stdcall GetLastError()')
    }
    return win32
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
    return null
  }
}

export interface VirtualCameraInfo {
  width: number
  height: number
  fps: number
  target: CameraTarget
}

export class VirtualCamera {
  private api: Win32 | null = null
  private handle = 0n
  private base = 0n
  private width = 0
  private height = 0
  private frameSize = 0
  private writeIdx = 0
  private frameOffsets: number[] = []

  /** Дрібні буфери під заголовкові поля — щоб не алокувати їх щокадру. */
  private readonly u32 = Buffer.alloc(4)
  private readonly u64 = Buffer.alloc(8)

  get running(): boolean {
    return this.base !== 0n
  }

  get info(): VirtualCameraInfo | null {
    return this.running
      ? { width: this.width, height: this.height, fps: this.fps, target: this.target }
      : null
  }

  private fps = 30
  private target: CameraTarget = 'memecam'

  /** Розмір кадру NV12: повна площина яскравості + половина під кольоровість. */
  private static nv12Size(width: number, height: number): number {
    return (width * height * 3) / 2
  }

  start(width: number, height: number, fps: number, target: CameraTarget = 'memecam'): void {
    if (this.running) this.stop()

    // NV12 вимагає парних сторін: площина кольоровості вдвічі менша.
    if (width % 2 !== 0 || height % 2 !== 0) {
      throw new Error(`Розміри мають бути парними, отримано ${width}x${height}`)
    }

    const api = loadWin32()
    if (!api) throw new Error(loadError ?? 'Не вдалось завантажити kernel32')
    this.api = api

    const frameSize = VirtualCamera.nv12Size(width, height)
    const slotSize = TIMESTAMP_SIZE + frameSize
    const totalSize = HEADER_SIZE + FRAME_COUNT * slotSize

    const handle = toBig(
      api.CreateFileMappingW(
        INVALID_HANDLE_VALUE,
        0n,
        PAGE_READWRITE,
        Math.floor(totalSize / 2 ** 32),
        totalSize >>> 0,
        MAPPING_NAMES[target]
      )
    )
    if (handle === 0n) {
      throw new Error(`CreateFileMapping не вдався, код ${api.GetLastError()}`)
    }

    const base = toBig(api.MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, totalSize))
    if (base === 0n) {
      const code = api.GetLastError()
      api.CloseHandle(handle)
      throw new Error(`MapViewOfFile не вдався, код ${code}`)
    }

    this.handle = handle
    this.base = base
    this.width = width
    this.height = height
    this.fps = fps
    this.target = target
    this.frameSize = frameSize
    this.writeIdx = 0
    this.frameOffsets = Array.from({ length: FRAME_COUNT }, (_, i) => HEADER_SIZE + i * slotSize)

    // Заголовок пишемо одним шматком, щоб фільтр не побачив напівзаповнений стан.
    const header = Buffer.alloc(HEADER_SIZE)
    header.writeUInt32LE(0, OFF_WRITE_IDX)
    header.writeUInt32LE(STATE_STARTING, OFF_STATE)
    for (let i = 0; i < FRAME_COUNT; i++) {
      header.writeUInt32LE(this.frameOffsets[i], OFF_OFFSETS + i * 4)
    }
    header.writeUInt32LE(TYPE_VIDEO, OFF_TYPE)
    header.writeUInt32LE(width, OFF_CX)
    header.writeUInt32LE(height, OFF_CY)
    // Інтервал кадру в одиницях по 100 нс — так само рахує DirectShow.
    header.writeBigUInt64LE(BigInt(Math.round(10_000_000 / fps)), OFF_INTERVAL)

    api.RtlMoveMemory(base, header, HEADER_SIZE)
  }

  /**
   * Кладе кадр у чергу. Очікує щільно упакований NV12 без відступів у рядках.
   * @param timestamp100ns мітка часу в одиницях по 100 нс
   */
  writeFrame(nv12: Buffer, timestamp100ns: bigint): void {
    const api = this.api
    if (!api || !this.running) return

    if (nv12.length !== this.frameSize) {
      throw new Error(`Очікувався кадр ${this.frameSize} Б, отримано ${nv12.length} Б`)
    }

    const slot = this.base + BigInt(this.frameOffsets[this.writeIdx])

    this.u64.writeBigUInt64LE(timestamp100ns, 0)
    api.RtlMoveMemory(slot, this.u64, TIMESTAMP_SIZE)
    api.RtlMoveMemory(slot + BigInt(TIMESTAMP_SIZE), nv12, this.frameSize)

    // Індекс рухаємо тільки після того, як кадр повністю на місці.
    this.writeIdx = (this.writeIdx + 1) % FRAME_COUNT
    this.u32.writeUInt32LE(this.writeIdx, 0)
    api.RtlMoveMemory(this.base + BigInt(OFF_WRITE_IDX), this.u32, 4)

    this.u32.writeUInt32LE(STATE_READY, 0)
    api.RtlMoveMemory(this.base + BigInt(OFF_STATE), this.u32, 4)
  }

  stop(): void {
    const api = this.api
    if (!api || !this.running) return

    // Повідомляємо фільтру, що потік скінчився, інакше він тримає останній кадр.
    this.u32.writeUInt32LE(STATE_STOPPING, 0)
    api.RtlMoveMemory(this.base + BigInt(OFF_STATE), this.u32, 4)

    api.UnmapViewOfFile(this.base)
    api.CloseHandle(this.handle)

    this.base = 0n
    this.handle = 0n
    this.api = null
  }
}
