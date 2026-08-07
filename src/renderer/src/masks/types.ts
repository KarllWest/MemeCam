import type { LensParams } from '../gl/LensRenderer'

/**
 * Індекси точок MediaPipe Face Landmarker, які нам потрібні для прив'язки.
 * Ліво і право тут з погляду камери, а не людини.
 */
export const LM = {
  /** Зовнішні кутики очей — природна вісь для окулярів */
  eyeOuterL: 33,
  eyeOuterR: 263,
  irisL: 468,
  irisR: 473,
  /** Краї обличчя на рівні вух — вісь для всього, що надягається на голову */
  cheekL: 234,
  cheekR: 454,
  noseTip: 1,
  noseBottom: 2,
  glabella: 168,
  forehead: 10,
  chin: 152,
  mouthL: 61,
  mouthR: 291,
  lipTop: 0,
  lipBottom: 17
} as const

/**
 * Прив'язка накладки до обличчя.
 *
 * Дві точки осі задають одразу і масштаб, і кут нахилу — тому накладка
 * автоматично росте, коли підходиш ближче, і хилиться разом з головою.
 */
export interface Anchor {
  /** Пара індексів точок: відстань між ними — одиниця виміру, напрямок — кут */
  axis: [number, number]
  /** Навколо якої точки центрувати. За замовчуванням — середина осі. */
  center?: number
}

export interface OverlayLayer {
  kind: 'overlay'
  /** Файл у public/masks */
  texture: string
  anchor: Anchor
  /** Ширина накладки у частках довжини осі */
  scale: number
  /** Зсув від центру в тих самих частках, уже в поверненій системі координат */
  offset?: [number, number]
  /** Чи хилити накладку разом з головою. Німб, наприклад, краще лишати рівним. */
  rotate?: boolean
  opacity?: number
  blend?: 'alpha' | 'add'
}

/** Шар, що вмикає шейдерні ефекти лінзи з власними параметрами. */
export interface LensLayer {
  kind: 'lens'
  params: Partial<LensParams>
}

export type MaskLayer = OverlayLayer | LensLayer

export interface Mask {
  id: string
  name: string
  /** Значок для стрічки вибору */
  icon: string
  layers: MaskLayer[]
}

export const isOverlay = (l: MaskLayer): l is OverlayLayer => l.kind === 'overlay'
export const isLens = (l: MaskLayer): l is LensLayer => l.kind === 'lens'
