import { Program, RenderTarget, createFullscreenQuad } from './glUtils'
import { OverlayRenderer } from './OverlayRenderer'
import type { OverlayLayer } from '../masks/types'
import {
  QUAD_VS,
  SCENE_FS,
  BEAM_FS,
  FX_FS,
  BRIGHT_FS,
  BLUR_FS,
  COMPOSITE_FS,
  BLIT_FS,
  NV12_FS
} from './shaders'

/** Поза обличчя в екранних uv (0..1, початок унизу зліва). */
export interface FacePose {
  /** Усі точки обличчя, парами x,y — до них прив'язуються накладки. */
  points: Float32Array
  eyeL: [number, number]
  eyeR: [number, number]
  /** Напрямок погляду в екранних uv, нормалізований в аспект-скоригованому просторі. */
  dir: [number, number]
  /** 0..1 — наскільки голова відвернута від камери; гасить направлений промінь у фас. */
  dirStrength: number
}

export interface LensParams {
  mirror: boolean
  /** Грейд сцени */
  exposure: number
  contrast: number
  saturation: number
  /** Промені */
  intensity: number
  coreSize: number
  streakLen: number
  streakWidth: number
  streakGain: number
  beamLen: number
  beamWidth: number
  beamSpread: number
  beamGain: number
  /** Показник профілю: 2 = м'який гаус, 6+ = різкий лазер */
  sharpness: number
  color: [number, number, number]
  /** Дим по низу кадру */
  smokeAmount: number
  smokeHeight: number
  smokeSpeed: number
  smokeScale: number
  smokeColor: [number, number, number]
  /** Блискавки згори */
  boltCount: number
  boltRate: number
  boltLen: number
  boltWidth: number
  boltGlow: number
  boltFlash: number
  boltColor: [number, number, number]
  /** Ручна підгонка посадки накладок, спільна для всіх шарів маски */
  overlayScale: number
  overlayOffsetY: number
  /** Пост */
  bloomStrength: number
  bloomThreshold: number
  vignette: number
  /** Наскільки швидко ефект тягнеться за обличчям: 0 = миттєво, 1 = не рухається */
  smoothing: number
}

export const DEFAULT_PARAMS: LensParams = {
  mirror: true,
  exposure: 0.62,
  contrast: 1.22,
  saturation: 0.78,
  intensity: 1.5,
  coreSize: 0.016,
  streakLen: 0.11,
  streakWidth: 0.0075,
  streakGain: 1.0,
  beamLen: 0.55,
  beamWidth: 0.02,
  beamSpread: 0.055,
  beamGain: 0.85,
  sharpness: 4.5,
  color: [1.0, 0.93, 0.78],
  smokeAmount: 0.55,
  smokeHeight: 0.3,
  smokeSpeed: 0.35,
  smokeScale: 3.2,
  smokeColor: [0.62, 0.66, 0.78],
  boltCount: 2,
  boltRate: 0.45,
  boltLen: 0.42,
  boltWidth: 0.0035,
  boltGlow: 1.0,
  boltFlash: 0.16,
  boltColor: [0.72, 0.86, 1.0],
  overlayScale: 1,
  overlayOffsetY: 0,
  bloomStrength: 1.15,
  bloomThreshold: 0.72,
  vignette: 0.55,
  smoothing: 0.55
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export class LensRenderer {
  readonly canvas: HTMLCanvasElement

  private readonly gl: WebGL2RenderingContext
  private readonly quad: WebGLVertexArrayObject
  private readonly videoTex: WebGLTexture

  private readonly sceneProg: Program
  private readonly beamProg: Program
  private readonly fxProg: Program
  private readonly brightProg: Program
  private readonly blurProg: Program
  private readonly compositeProg: Program
  private readonly blitProg: Program
  private readonly nv12Prog: Program
  private readonly overlays: OverlayRenderer

  private readonly sceneRT: RenderTarget
  private readonly brightRT: RenderTarget
  private readonly nearA: RenderTarget
  private readonly nearB: RenderTarget
  private readonly farA: RenderTarget
  private readonly farB: RenderTarget
  /** Готовий кадр: з нього і на екран, і у віртуальну камеру. */
  private readonly outRT: RenderTarget
  /** Кадр, упакований у NV12; створюється лише коли ввімкнена віртуальна камера. */
  private packRT: RenderTarget | null = null
  private packBuffer: Uint8Array | null = null
  /**
   * Два буфери для асинхронного знімання кадру. Поки GPU наповнює один,
   * ми забираємо готовий попередній — CPU не стоїть і не чекає.
   */
  private readonly pboSlots: { pbo: WebGLBuffer | null; fence: WebGLSync | null }[] = [
    { pbo: null, fence: null },
    { pbo: null, fence: null }
  ]
  private pboNext = 0
  private pboSize = 0

  /** Згладжена поза — прибирає тремтіння детектора між кадрами. */
  private smoothed: FacePose | null = null
  /** 0..1, плавна поява/зникнення ефекту разом з обличчям. */
  private active = 0
  /** Час у секундах від створення — анімує дим і блискавки. */
  private readonly startTime = performance.now()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL2 недоступний — оновіть драйвери відеокарти')
    this.gl = gl

    // HDR-буфери потрібні, щоб bloom брав дійсно перепалені значення, а не обрізані на 1.0.
    const hdr = gl.getExtension('EXT_color_buffer_float') !== null

    this.quad = createFullscreenQuad(gl)

    const tex = gl.createTexture()
    if (!tex) throw new Error('Не вдалось створити текстуру відео')
    this.videoTex = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.sceneProg = new Program(gl, QUAD_VS, SCENE_FS)
    this.beamProg = new Program(gl, QUAD_VS, BEAM_FS)
    this.fxProg = new Program(gl, QUAD_VS, FX_FS)
    this.brightProg = new Program(gl, QUAD_VS, BRIGHT_FS)
    this.blurProg = new Program(gl, QUAD_VS, BLUR_FS)
    this.compositeProg = new Program(gl, QUAD_VS, COMPOSITE_FS)
    this.blitProg = new Program(gl, QUAD_VS, BLIT_FS)
    this.nv12Prog = new Program(gl, QUAD_VS, NV12_FS)
    this.overlays = new OverlayRenderer(gl)

    this.sceneRT = new RenderTarget(gl, hdr)
    this.brightRT = new RenderTarget(gl, hdr)
    this.nearA = new RenderTarget(gl, hdr)
    this.nearB = new RenderTarget(gl, hdr)
    this.farA = new RenderTarget(gl, hdr)
    this.farB = new RenderTarget(gl, hdr)
    // Готовий кадр уже після тонмапу — 8 біт достатньо, і саме його читає NV12.
    this.outRT = new RenderTarget(gl, false)
  }

  /** Розмір буфера рендеру. Викликати при зміні розміру вікна або відео. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.sceneRT.resize(w, h)
    this.outRT.resize(w, h)

    const hw = Math.max(1, w >> 1)
    const hh = Math.max(1, h >> 1)
    this.brightRT.resize(hw, hh)
    this.nearA.resize(hw, hh)
    this.nearB.resize(hw, hh)

    const qw = Math.max(1, w >> 3)
    const qh = Math.max(1, h >> 3)
    this.farA.resize(qw, qh)
    this.farB.resize(qw, qh)
  }

  private draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  /** Один прохід розмиття: src -> dst по осі axis. */
  private blurPass(src: RenderTarget, dst: RenderTarget, axis: 'x' | 'y', radius: number): void {
    dst.bind()
    const stepX = axis === 'x' ? radius / src.width : 0
    const stepY = axis === 'y' ? radius / src.height : 0
    this.blurProg.use().tex('uTex', 0, src.texture).v2('uStep', stepX, stepY)
    this.draw()
  }

  /**
   * Малює кадр. pose = null означає, що обличчя не знайдено — ефект плавно згасає
   * на останній відомій позиції, а не смикається.
   */
  render(
    video: HTMLVideoElement,
    pose: FacePose | null,
    p: LensParams,
    overlayLayers: OverlayLayer[] = []
  ): void {
    const gl = this.gl

    // Згладжування пози. smoothing=0 — миттєво за детектором, 1 — майже стоїть.
    const t = 1 - Math.min(Math.max(p.smoothing, 0), 0.98)
    if (pose) {
      if (!this.smoothed || this.smoothed.points.length !== pose.points.length) {
        this.smoothed = {
          points: Float32Array.from(pose.points),
          eyeL: [...pose.eyeL],
          eyeR: [...pose.eyeR],
          dir: [...pose.dir],
          dirStrength: pose.dirStrength
        }
      } else {
        const s = this.smoothed
        s.eyeL = [lerp(s.eyeL[0], pose.eyeL[0], t), lerp(s.eyeL[1], pose.eyeL[1], t)]
        s.eyeR = [lerp(s.eyeR[0], pose.eyeR[0], t), lerp(s.eyeR[1], pose.eyeR[1], t)]
        s.dir = [lerp(s.dir[0], pose.dir[0], t), lerp(s.dir[1], pose.dir[1], t)]
        s.dirStrength = lerp(s.dirStrength, pose.dirStrength, t)

        // Точки згладжуємо тим самим коефіцієнтом — інакше накладки тремтіли б
        // окремо від променів, і маска «жила» б своїм життям.
        const sp = s.points
        const pp = pose.points
        for (let i = 0; i < sp.length; i++) sp[i] = lerp(sp[i], pp[i], t)
      }
    }
    this.active = lerp(this.active, pose ? 1 : 0, 0.15)

    gl.bindVertexArray(this.quad)
    gl.disable(gl.BLEND)

    // --- 1. Кадр камери у текстуру ---
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    // --- 2. Сцена: відео + грейд ---
    this.sceneRT.bind()
    this.sceneProg
      .use()
      .tex('uVideo', 0, this.videoTex)
      .f('uMirror', p.mirror ? 1 : 0)
      .f('uExposure', p.exposure)
      .f('uContrast', p.contrast)
      .f('uSaturation', p.saturation)
    this.draw()

    const aspect = this.canvas.width / this.canvas.height

    // --- 3. Атмосфера: дим унизу, блискавки згори ---
    // Преммультиплікована альфа: дим змішується як шар, блискавка лягає адитивно.
    if (p.smokeAmount > 0.001 || p.boltCount > 0) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      this.fxProg
        .use()
        .f('uTime', (performance.now() - this.startTime) / 1000)
        .f('uAspect', aspect)
        .f('uSmokeAmount', p.smokeAmount)
        .f('uSmokeHeight', p.smokeHeight)
        .f('uSmokeSpeed', p.smokeSpeed)
        .f('uSmokeScale', p.smokeScale)
        .v3('uSmokeColor', p.smokeColor[0], p.smokeColor[1], p.smokeColor[2])
        .f('uBoltCount', p.boltCount)
        .f('uBoltRate', p.boltRate)
        .f('uBoltLen', p.boltLen)
        .f('uBoltWidth', p.boltWidth)
        .f('uBoltGlow', p.boltGlow)
        .f('uFlash', p.boltFlash)
        .v3('uBoltColor', p.boltColor[0], p.boltColor[1], p.boltColor[2])
      this.draw()
      gl.disable(gl.BLEND)
    }

    const s = this.smoothed

    // --- 4. Накладки маски ---
    // До променів: лазер має бити крізь окуляри, а не ховатись за ними.
    if (s && overlayLayers.length > 0) {
      this.overlays.draw(
        overlayLayers,
        s.points,
        aspect,
        { scale: p.overlayScale, offsetY: p.overlayOffsetY },
        this.active
      )
      // Накладки малюють своїм VAO — повертаємо повноекранний квад для решти проходів.
      gl.bindVertexArray(this.quad)
    }

    // --- 5. Промені, адитивно поверх усього ---
    if (s && this.active > 0.001) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      this.beamProg
        .use()
        .v2('uEyeL', s.eyeL[0], s.eyeL[1])
        .v2('uEyeR', s.eyeR[0], s.eyeR[1])
        .v2('uDir', s.dir[0], s.dir[1])
        .f('uAspect', aspect)
        .f('uActive', this.active)
        .f('uSharpness', p.sharpness)
        .f('uCoreSize', p.coreSize)
        .f('uStreakLen', p.streakLen)
        .f('uStreakWidth', p.streakWidth)
        .f('uStreakGain', p.streakGain)
        .f('uBeamLen', p.beamLen)
        .f('uBeamWidth', p.beamWidth)
        .f('uBeamSpread', p.beamSpread)
        .f('uBeamGain', p.beamGain * s.dirStrength)
        .f('uIntensity', p.intensity)
        .v3('uColor', p.color[0], p.color[1], p.color[2])
      this.draw()
      gl.disable(gl.BLEND)
    }

    // --- 6. Bright pass ---
    this.brightRT.bind()
    this.brightProg
      .use()
      .tex('uTex', 0, this.sceneRT.texture)
      .f('uThreshold', p.bloomThreshold)
      .f('uKnee', 0.35)
    this.draw()

    // --- 7. Два ланцюги розмиття: тісний ореол і широке сяйво ---
    this.blurPass(this.brightRT, this.nearA, 'x', 1.0)
    this.blurPass(this.nearA, this.nearB, 'y', 1.0)
    this.blurPass(this.nearB, this.farA, 'x', 1.6)
    this.blurPass(this.farA, this.farB, 'y', 1.6)

    // --- 8. Композит у текстуру готового кадру ---
    this.outRT.bind()
    this.compositeProg
      .use()
      .tex('uScene', 0, this.sceneRT.texture)
      .tex('uBloomNear', 1, this.nearB.texture)
      .tex('uBloomFar', 2, this.farB.texture)
      .f('uBloomStrength', p.bloomStrength)
      .f('uVignette', p.vignette)
    this.draw()

    // --- 9. Той самий кадр на екран ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.blitProg.use().tex('uTex', 0, this.outRT.texture)
    this.draw()

    gl.bindVertexArray(null)
  }

  /**
   * Пакує останній кадр у NV12 для віртуальної камери й асинхронно знімає його з GPU.
   * Джерело масштабується під потрібний розмір зі збереженням пропорцій;
   * що не влізло — чорні поля.
   *
   * Знімання йде через пару pixel buffer object: readPixels у буфер повертається
   * одразу, а дані ми забираємо наступного разу, коли огорожа вже спрацювала.
   * Прямий readPixels у масив зупиняв би CPU до кінця роботи GPU щокадру.
   *
   * Повертає null, поки перший кадр ще не готовий — це нормально на старті.
   * Буфер перевикористовується, тож віддавати його далі можна лише синхронно.
   */
  readNv12(outWidth: number, outHeight: number): Uint8Array | null {
    if (outWidth % 4 !== 0 || outHeight % 2 !== 0) {
      throw new Error(`NV12 потребує ширину кратну 4 і парну висоту, дано ${outWidth}x${outHeight}`)
    }

    const gl = this.gl
    const packW = outWidth / 4
    const packH = (outHeight * 3) / 2
    const needed = outWidth * outHeight * 1.5

    if (!this.packRT) this.packRT = new RenderTarget(gl, false)
    this.packRT.resize(packW, packH)

    if (!this.packBuffer || this.packBuffer.length !== needed) {
      this.packBuffer = new Uint8Array(needed)
    }
    if (this.pboSize !== needed) this.allocatePbos(needed)

    // Вписуємо джерело в кадр камери: ширший бік визначає, де будуть поля.
    const srcAspect = this.canvas.width / this.canvas.height
    const outAspect = outWidth / outHeight
    const fitX = outAspect > srcAspect ? outAspect / srcAspect : 1
    const fitY = outAspect > srcAspect ? 1 : srcAspect / outAspect

    gl.bindVertexArray(this.quad)
    gl.disable(gl.BLEND)
    this.packRT.bind()
    this.nv12Prog
      .use()
      .tex('uTex', 0, this.outRT.texture)
      .v2('uSize', outWidth, outHeight)
      .v2('uFitScale', fitX, fitY)
    this.draw()

    // Запускаємо знімання поточного кадру.
    const write = this.pboSlots[this.pboNext]
    if (write.fence) {
      // Не встигли забрати — кадр застарілий, кидаємо його й читаємо свіжий.
      gl.deleteSync(write.fence)
      write.fence = null
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, write.pbo)
    gl.readPixels(0, 0, packW, packH, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    write.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.flush()

    // І забираємо попередній, якщо GPU вже впорався.
    const read = this.pboSlots[1 - this.pboNext]
    let result: Uint8Array | null = null
    if (read.fence && gl.clientWaitSync(read.fence, 0, 0) !== gl.TIMEOUT_EXPIRED) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.pbo)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.packBuffer)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      gl.deleteSync(read.fence)
      read.fence = null
      result = this.packBuffer
    }

    this.pboNext = 1 - this.pboNext
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)

    return result
  }

  private allocatePbos(size: number): void {
    const gl = this.gl
    for (const slot of this.pboSlots) {
      if (slot.fence) {
        gl.deleteSync(slot.fence)
        slot.fence = null
      }
      if (slot.pbo) gl.deleteBuffer(slot.pbo)
      slot.pbo = gl.createBuffer()
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ)
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.pboSize = size
  }

  dispose(): void {
    const gl = this.gl
    this.sceneProg.dispose()
    this.beamProg.dispose()
    this.fxProg.dispose()
    this.brightProg.dispose()
    this.blurProg.dispose()
    this.compositeProg.dispose()
    this.blitProg.dispose()
    this.nv12Prog.dispose()
    this.overlays.dispose()
    this.outRT.dispose()
    this.packRT?.dispose()
    for (const slot of this.pboSlots) {
      if (slot.fence) gl.deleteSync(slot.fence)
      if (slot.pbo) gl.deleteBuffer(slot.pbo)
    }
    this.sceneRT.dispose()
    this.brightRT.dispose()
    this.nearA.dispose()
    this.nearB.dispose()
    this.farA.dispose()
    this.farB.dispose()
    gl.deleteTexture(this.videoTex)
    gl.deleteVertexArray(this.quad)
  }
}
