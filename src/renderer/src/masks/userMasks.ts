import { LM, type Anchor, type Mask, type OverlayLayer } from './types'

export type AnchorPreset = 'eyes' | 'head' | 'nose' | 'mouth' | 'face'

export interface UserOverlay {
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

/**
 * Людські назви прив'язок замість індексів точок.
 *
 * Користувач не має знати, що зовнішні кутики очей — це 33 і 263. Він обирає
 * «на очі», а куди саме це лягає, вирішуємо ми.
 */
export const ANCHOR_LABELS: Record<AnchorPreset, string> = {
  eyes: 'На очі',
  head: 'Над головою',
  nose: 'На ніс',
  mouth: 'На рот',
  face: 'На все обличчя'
}

/** Підказки з розумним початковим розміром для кожної прив'язки. */
export const ANCHOR_DEFAULTS: Record<AnchorPreset, { scale: number; offsetY: number }> = {
  eyes: { scale: 1.5, offsetY: 0.02 },
  head: { scale: 1.3, offsetY: 0.6 },
  nose: { scale: 0.35, offsetY: 0 },
  mouth: { scale: 0.7, offsetY: -0.05 },
  face: { scale: 1.15, offsetY: 0.05 }
}

function toAnchor(preset: AnchorPreset): Anchor {
  switch (preset) {
    case 'eyes':
      return { axis: [LM.eyeOuterL, LM.eyeOuterR] }
    case 'nose':
      return { axis: [LM.cheekL, LM.cheekR], center: LM.noseTip }
    case 'mouth':
      return { axis: [LM.cheekL, LM.cheekR], center: LM.noseBottom }
    // «Над головою» і «на все обличчя» різняться лише зсувом, який задає користувач.
    default:
      return { axis: [LM.cheekL, LM.cheekR] }
  }
}

/** Перетворює власну маску на шари, які вже вміє малювати рендерер. */
export function toMask(user: UserMask): Mask {
  const layers: OverlayLayer[] = user.overlays.map((o) => ({
    kind: 'overlay',
    // Картинки лежать поза застосунком, тож ідуть власною схемою.
    texture: `usermask://local/${o.texture}`,
    anchor: toAnchor(o.anchor),
    scale: o.scale,
    offset: [o.offsetX, o.offsetY],
    rotate: o.rotate,
    opacity: o.opacity
  }))

  return { id: user.id, name: user.name, icon: user.icon || '🖼', layers }
}
