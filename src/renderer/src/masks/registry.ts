import { DEFAULT_PARAMS, type LensParams } from '../gl/LensRenderer'
import { LM, isLens, type Mask } from './types'

/**
 * Базові параметри для масок без шейдерних ефектів.
 *
 * Навмисно повністю прозорі: картинка має виглядати рівно так, як її віддає
 * камера. Будь-яке «легке покращення» тут помітне одразу — користувач порівнює
 * не з ідеалом, а зі своєю ж камерою у звичайному застосунку.
 */
export const NEUTRAL_PARAMS: LensParams = {
  ...DEFAULT_PARAMS,
  exposure: 1,
  contrast: 1,
  saturation: 1,
  intensity: 0,
  streakGain: 0,
  beamGain: 0,
  smokeAmount: 0,
  boltCount: 0,
  bloomStrength: 0,
  bloomThreshold: 1,
  vignette: 0
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
  },
  {
    id: 'pirate',
    name: 'Пірат',
    icon: '🏴‍☠️',
    layers: [
      // Пов'язка сидить на осі очей: так вона лягає рівно на одне око.
      {
        kind: 'overlay',
        texture: 'eyepatch.svg',
        anchor: { axis: [LM.eyeOuterL, LM.eyeOuterR] },
        scale: 1.6,
        offset: [0, 0.04],
        rotate: true
      },
      head('mustache.svg', 0.66, [0, -0.06], { center: LM.noseBottom })
    ]
  },
  {
    id: 'cowboy',
    name: 'Ковбой',
    icon: '🤠',
    layers: [head('cowboy-hat.svg', 1.55, [0, 0.66])]
  },
  {
    id: 'clown',
    name: 'Клоун',
    icon: '🤡',
    layers: [
      head('clown-nose.svg', 0.3, [0, 0], { center: LM.noseTip }),
      head('party-hat.svg', 0.62, [0.16, 0.92])
    ]
  },
  {
    id: 'party',
    name: 'Свято',
    icon: '🎉',
    layers: [
      head('party-hat.svg', 0.6, [0, 0.95]),
      {
        kind: 'lens',
        params: {
          ...NEUTRAL_PARAMS,
          bloomStrength: 1.0,
          bloomThreshold: 0.72,
          exposure: 1.06,
          saturation: 1.18
        }
      }
    ]
  },
  {
    id: 'bigeyes',
    name: 'Великі очі',
    icon: '👀',
    layers: [
      { kind: 'warp', points: [LM.irisL, LM.irisR], radius: 0.075, strength: 0.38 },
      { kind: 'lens', params: { ...NEUTRAL_PARAMS, saturation: 1.1 } }
    ]
  },
  {
    id: 'balloon',
    name: 'Кулька',
    icon: '🎈',
    layers: [
      // Один широкий осередок по центру обличчя надуває голову цілком.
      { kind: 'warp', points: [LM.noseTip], radius: 0.34, strength: 0.3 },
      { kind: 'lens', params: { ...NEUTRAL_PARAMS } }
    ]
  },
  {
    id: 'pinhead',
    name: 'Голка',
    icon: '📌',
    layers: [
      // Від'ємна сила втягує: голова стискається, ніс лишається на місці.
      { kind: 'warp', points: [LM.noseTip], radius: 0.36, strength: -0.34 },
      { kind: 'lens', params: { ...NEUTRAL_PARAMS } }
    ]
  },
  {
    id: 'bignose',
    name: 'Носяра',
    icon: '👃',
    layers: [
      { kind: 'warp', points: [LM.noseTip], radius: 0.08, strength: 0.42 },
      { kind: 'lens', params: { ...NEUTRAL_PARAMS } }
    ]
  },
  {
    id: 'chad',
    name: 'Чед',
    icon: '💪',
    layers: [
      // Широка щелепа й вужчі очі — карикатура на «сильне» обличчя.
      { kind: 'warp', points: [LM.chin], radius: 0.2, strength: 0.24 },
      { kind: 'warp', points: [LM.irisL, LM.irisR], radius: 0.06, strength: -0.2 },
      glasses('sunglasses-deal.svg', 1.5)
    ]
  },
  {
    id: 'terminator',
    name: 'Термінатор',
    icon: '🦾',
    layers: [
      {
        kind: 'lens',
        params: {
          ...DEFAULT_PARAMS,
          color: [1.0, 0.14, 0.1],
          sharpness: 7,
          intensity: 1.9,
          coreSize: 0.013,
          streakLen: 0.05,
          streakGain: 0.45,
          beamGain: 1.3,
          beamLen: 0.8,
          beamWidth: 0.012,
          smokeAmount: 0.4,
          smokeColor: [0.42, 0.3, 0.3],
          boltCount: 0,
          exposure: 0.44,
          contrast: 1.34,
          saturation: 0.5,
          vignette: 0.82,
          bloomStrength: 1.5
        }
      }
    ]
  },
  {
    id: 'matrix',
    name: 'Матриця',
    icon: '💊',
    layers: [
      glasses('sunglasses-deal.svg', 1.5),
      {
        kind: 'lens',
        params: {
          ...DEFAULT_PARAMS,
          color: [0.3, 1.0, 0.42],
          boltColor: [0.35, 1.0, 0.5],
          smokeColor: [0.24, 0.5, 0.3],
          sharpness: 6.5,
          intensity: 1.3,
          streakGain: 0.6,
          beamGain: 0.9,
          boltCount: 2,
          boltRate: 0.6,
          smokeAmount: 0.5,
          exposure: 0.5,
          saturation: 0.62,
          vignette: 0.7
        }
      }
    ]
  }
]

/** Параметри шейдерів для маски: нейтральна база плюс те, що маска перевизначає. */
export function paramsForMask(mask: Mask): LensParams {
  const lens = mask.layers.find(isLens)
  return lens ? { ...NEUTRAL_PARAMS, ...lens.params } : { ...NEUTRAL_PARAMS }
}

export const findMask = (id: string): Mask => MASKS.find((m) => m.id === id) ?? MASKS[0]
