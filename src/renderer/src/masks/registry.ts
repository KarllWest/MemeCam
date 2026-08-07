import { DEFAULT_PARAMS, type LensParams } from '../gl/LensRenderer'
import { LM, isLens, type Mask } from './types'

/**
 * Базові параметри для масок без шейдерних ефектів: звичайна камера,
 * лише легка віньєтка й трохи bloom, щоб накладки не виглядали наклеєними.
 */
export const NEUTRAL_PARAMS: LensParams = {
  ...DEFAULT_PARAMS,
  exposure: 1,
  contrast: 1.04,
  saturation: 1,
  intensity: 0,
  streakGain: 0,
  beamGain: 0,
  smokeAmount: 0,
  boltCount: 0,
  bloomStrength: 0.5,
  bloomThreshold: 0.85,
  vignette: 0.22
}

const glasses = (texture: string, scale: number): Mask['layers'][number] => ({
  kind: 'overlay',
  texture,
  anchor: { axis: [LM.eyeOuterL, LM.eyeOuterR] },
  scale,
  offset: [0, 0.02],
  rotate: true
})

/** Вісь через вилиці — стабільна база для всього, що надягається на голову. */
const head = (
  texture: string,
  scale: number,
  offset: [number, number],
  extra: Partial<{ rotate: boolean; center: number; opacity: number; blend: 'alpha' | 'add' }> = {}
): Mask['layers'][number] => ({
  kind: 'overlay',
  texture,
  anchor: { axis: [LM.cheekL, LM.cheekR], center: extra.center },
  scale,
  offset,
  rotate: extra.rotate ?? true,
  opacity: extra.opacity,
  blend: extra.blend
})

export const MASKS: Mask[] = [
  {
    id: 'clean',
    name: 'Без маски',
    icon: '🚫',
    layers: []
  },
  {
    id: 'laser',
    name: 'Лазерні очі',
    icon: '👁',
    layers: [{ kind: 'lens', params: { ...DEFAULT_PARAMS } }]
  },
  {
    id: 'storm',
    name: 'Гроза',
    icon: '⚡',
    layers: [
      {
        kind: 'lens',
        params: {
          ...DEFAULT_PARAMS,
          sharpness: 7,
          color: [0.55, 0.85, 1.0],
          boltColor: [0.75, 0.88, 1.0],
          boltCount: 4,
          boltRate: 0.9,
          boltLen: 0.55,
          boltFlash: 0.26,
          smokeAmount: 0.75,
          smokeHeight: 0.36,
          exposure: 0.5
        }
      }
    ]
  },
  {
    id: 'hell',
    name: 'Пекло',
    icon: '🔥',
    layers: [
      head('horns.svg', 1.25, [0, 0.5]),
      {
        kind: 'lens',
        params: {
          ...DEFAULT_PARAMS,
          intensity: 2.2,
          sharpness: 5,
          color: [1.0, 0.28, 0.12],
          boltColor: [1.0, 0.5, 0.2],
          boltCount: 3,
          boltRate: 0.8,
          smokeAmount: 0.85,
          smokeColor: [0.5, 0.34, 0.32],
          bloomStrength: 1.8,
          exposure: 0.45,
          vignette: 0.75
        }
      }
    ]
  },
  {
    id: 'deal',
    name: 'Deal With It',
    icon: '😎',
    layers: [glasses('sunglasses-deal.svg', 1.55)]
  },
  {
    id: 'mafia',
    name: 'Мафія',
    icon: '🕶',
    layers: [
      glasses('sunglasses-deal.svg', 1.55),
      head('mustache.svg', 0.62, [0, -0.06], { center: LM.noseBottom })
    ]
  },
  {
    id: 'dog',
    name: 'Собака',
    icon: '🐶',
    layers: [
      head('dog-ears.svg', 1.5, [0, 0.55]),
      head('dog-nose.svg', 0.3, [0, 0], { center: LM.noseTip })
    ]
  },
  {
    id: 'cat',
    name: 'Кіт',
    icon: '🐱',
    layers: [
      head('cat-ears.svg', 1.35, [0, 0.55]),
      head('whiskers.svg', 1.15, [0, -0.04], { center: LM.noseBottom })
    ]
  },
  {
    id: 'king',
    name: 'Король',
    icon: '👑',
    layers: [head('crown.svg', 1.15, [0, 0.62])]
  },
  {
    id: 'angel',
    name: 'Янгол',
    icon: '😇',
    layers: [
      // Німб не хилиться разом з головою: так він читається як окремий предмет у повітрі.
      head('halo.svg', 1.0, [0, 0.88], { rotate: false, blend: 'add' }),
      {
        kind: 'lens',
        params: {
          ...NEUTRAL_PARAMS,
          bloomStrength: 1.1,
          bloomThreshold: 0.7,
          exposure: 1.08,
          vignette: 0.35
        }
      }
    ]
  },
  {
    id: 'nerd',
    name: 'Ботан',
    icon: '🤓',
    layers: [
      glasses('glasses-round.svg', 1.5),
      head('mustache.svg', 0.5, [0, -0.05], { center: LM.noseBottom })
    ]
  }
]

/** Параметри шейдерів для маски: нейтральна база плюс те, що маска перевизначає. */
export function paramsForMask(mask: Mask): LensParams {
  const lens = mask.layers.find(isLens)
  return lens ? { ...NEUTRAL_PARAMS, ...lens.params } : { ...NEUTRAL_PARAMS }
}

export const findMask = (id: string): Mask => MASKS.find((m) => m.id === id) ?? MASKS[0]
