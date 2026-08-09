/** Дрібні обгортки над WebGL2, щоб LensRenderer читався як пайплайн, а не як каша з gl.*  */

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('Не вдалось створити шейдер')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Помилка компіляції шейдера:\n${log}`)
  }
  return sh
}

/** Програма з кешем локацій юніформів. */
export class Program {
  readonly program: WebGLProgram
  private readonly gl: WebGL2RenderingContext
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
    this.gl = gl
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
    const p = gl.createProgram()
    if (!p) throw new Error('Не вдалось створити програму')
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p)
      gl.deleteProgram(p)
      throw new Error(`Помилка лінкування програми:\n${log}`)
    }
    this.program = p
  }

  use(): this {
    this.gl.useProgram(this.program)
    return this
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name)
      this.locations.set(name, l)
    }
    return l
  }

  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v)
    return this
  }

  v2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y)
    return this
  }

  v3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z)
    return this
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v)
    return this
  }

  /** Масиви для юніформів-масивів: передаються одним викликом. */
  fv(name: string, values: Float32Array | number[]): this {
    this.gl.uniform1fv(this.loc(name), values)
    return this
  }

  v2v(name: string, values: Float32Array | number[]): this {
    this.gl.uniform2fv(this.loc(name), values)
    return this
  }

  /** Прив'язує текстуру до слота і передає його номер у юніформ. */
  tex(name: string, unit: number, texture: WebGLTexture): this {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(this.loc(name), unit)
    return this
  }

  dispose(): void {
    this.gl.deleteProgram(this.program)
  }
}

/** Офскрін-ціль рендеру. За наявності float-буферів тримає HDR, інакше 8 біт. */
export class RenderTarget {
  texture: WebGLTexture
  readonly framebuffer: WebGLFramebuffer
  width = 0
  height = 0

  private readonly gl: WebGL2RenderingContext
  private readonly hdr: boolean

  constructor(gl: WebGL2RenderingContext, hdr: boolean) {
    this.gl = gl
    this.hdr = hdr

    const tex = gl.createTexture()
    const fbo = gl.createFramebuffer()
    if (!tex || !fbo) throw new Error('Не вдалось створити render target')
    this.texture = tex
    this.framebuffer = fbo

    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (this.hdr) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
  }

  bind(): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.viewport(0, 0, this.width, this.height)
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteFramebuffer(this.framebuffer)
  }
}

/** Один VAO з повноекранним квадом — рисуємо ним усі проходи. */
export function createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  const vbo = gl.createBuffer()
  if (!vao || !vbo) throw new Error('Не вдалось створити quad')

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  return vao
}
