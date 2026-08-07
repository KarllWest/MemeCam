import { Program } from './glUtils'
import { OVERLAY_VS, OVERLAY_FS } from './shaders'
import type { OverlayLayer } from '../masks/types'

interface LoadedTexture {
  texture: WebGLTexture
  /** Висота відносно ширини — з нею накладка не спотворюється. */
  ratio: number
}

/** Точне налаштування посадки масок руками, спільне для всіх шарів. */
export interface OverlayTune {
  scale: number
  offsetY: number
}

/**
 * Малює накладки, посаджені на точки обличчя.
 *
 * Дві точки осі задають одразу масштаб і нахил: накладка сама росте, коли
 * підходиш ближче, і хилиться разом з головою. Асети — SVG, їх растеризує
 * сам Chromium, тому вони лишаються різкими на будь-якій роздільності.
 */
export class OverlayRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: Program
  private readonly vao: WebGLVertexArrayObject
  private readonly textures = new Map<string, LoadedTexture>()
  private readonly loading = new Set<string>()

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = new Program(gl, OVERLAY_VS, OVERLAY_FS)

    const vao = gl.createVertexArray()
    const vbo = gl.createBuffer()
    if (!vao || !vbo) throw new Error('Не вдалось створити quad для накладок')

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    // Смуга з двох трикутників: -1..1 по обох осях.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    this.vao = vao
  }

  /** Вантажить SVG у текстуру. До завершення шар просто не малюється. */
  private request(url: string): LoadedTexture | null {
    const ready = this.textures.get(url)
    if (ready) return ready
    if (this.loading.has(url)) return null

    this.loading.add(url)
    const img = new Image()
    img.onload = () => {
      const gl = this.gl
      const tex = gl.createTexture()
      if (!tex) return

      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      this.textures.set(url, { texture: tex, ratio: img.height / img.width })
      this.loading.delete(url)
    }
    img.onerror = () => this.loading.delete(url)
    img.src = `masks/${url}`

    return null
  }

  /**
   * @param points усі точки обличчя в екранних uv, парами x,y
   * @param alpha загальне згасання разом зі втратою обличчя
   */
  draw(
    layers: OverlayLayer[],
    points: Float32Array,
    aspect: number,
    tune: OverlayTune,
    alpha: number
  ): void {
    if (layers.length === 0 || alpha <= 0.001) return

    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND)
    this.program.use()

    for (const layer of layers) {
      const tex = this.request(layer.texture)
      if (!tex) continue

      const [ia, ib] = layer.anchor.axis
      let ax = points[ia * 2] * aspect
      let ay = points[ia * 2 + 1]
      let bx = points[ib * 2] * aspect
      let by = points[ib * 2 + 1]

      // Вісь завжди дивиться праворуч. Без цього дзеркалення міняє точки місцями
      // і накладка перевертається догори дриґом.
      if (bx < ax) {
        ;[ax, bx] = [bx, ax]
        ;[ay, by] = [by, ay]
      }

      const len = Math.hypot(bx - ax, by - ay)
      if (len < 1e-5) continue

      const angle = layer.rotate === false ? 0 : Math.atan2(by - ay, bx - ax)

      const c = layer.anchor.center
      let cx = c === undefined ? (ax + bx) / 2 : points[c * 2] * aspect
      let cy = c === undefined ? (ay + by) / 2 : points[c * 2 + 1]

      // Зсув задається в частках довжини осі й повертається разом з головою.
      const [offX, offY] = layer.offset ?? [0, 0]
      const ox = offX * len
      const oy = (offY + tune.offsetY) * len
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      cx += ox * cos - oy * sin
      cy += ox * sin + oy * cos

      const width = len * layer.scale * tune.scale

      gl.blendFunc(gl.SRC_ALPHA, layer.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
      this.program
        .tex('uTex', 0, tex.texture)
        .v2('uCenter', cx, cy)
        .v2('uHalfSize', width / 2, (width * tex.ratio) / 2)
        .f('uAngle', angle)
        .f('uAspect', aspect)
        .f('uOpacity', (layer.opacity ?? 1) * alpha)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    for (const { texture } of this.textures.values()) this.gl.deleteTexture(texture)
    this.textures.clear()
    this.program.dispose()
    this.gl.deleteVertexArray(this.vao)
  }
}
