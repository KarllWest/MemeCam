// Точка входу лише для перевірки посадки масок — збирається esbuild-ом у бандл,
// який виконується в прихованому вікні Electron.
export { LensRenderer, DEFAULT_PARAMS } from '../../src/renderer/src/gl/LensRenderer'
export { MASKS, paramsForMask, findMask, NEUTRAL_PARAMS } from '../../src/renderer/src/masks/registry'
export { isOverlay, LM } from '../../src/renderer/src/masks/types'
