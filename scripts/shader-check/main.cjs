// Electron-частина перевірки шейдерів: піднімає приховане вікно з WebGL2,
// компілює кожен фрагментний шейдер і лінкує його з нашим вертексним.
const { app, BrowserWindow } = require('electron')

const shaders = require(process.env.SHADER_BUNDLE)

// Кожен фрагментний шейдер лінкуємо з «своїм» вертексним (X_FS з X_VS),
// а за його відсутності — з повноекранним QUAD_VS.
const payload = {
  pairs: Object.entries(shaders)
    .filter(([name]) => name.endsWith('_FS'))
    .map(([name, src]) => {
      const own = name.replace(/_FS$/, '_VS')
      return {
        name,
        vsName: shaders[own] ? own : 'QUAD_VS',
        vs: shaders[own] ?? shaders.QUAD_VS,
        fs: src
      }
    })
}

const CHECK = `(function (data) {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return [{ name: '*', error: 'WebGL2 недоступний у цьому середовищі' }]

  function compile(type, src) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh)
      gl.deleteShader(sh)
      return { error: log }
    }
    return { shader: sh }
  }

  const errors = []

  for (const pair of data.pairs) {
    const vs = compile(gl.VERTEX_SHADER, pair.vs)
    if (vs.error) {
      errors.push({ name: pair.vsName, error: vs.error })
      continue
    }
    const fs = compile(gl.FRAGMENT_SHADER, pair.fs)
    if (fs.error) {
      errors.push({ name: pair.name, error: fs.error })
      gl.deleteShader(vs.shader)
      continue
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, vs.shader)
    gl.attachShader(prog, fs.shader)
    gl.bindAttribLocation(prog, 0, 'aPos')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      errors.push({
        name: pair.vsName + ' + ' + pair.name + ' (лінк)',
        error: gl.getProgramInfoLog(prog)
      })
    }
    gl.deleteProgram(prog)
    gl.deleteShader(fs.shader)
    gl.deleteShader(vs.shader)
  }

  return errors
})(${JSON.stringify(payload)})`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64 })
  await win.loadURL('about:blank')

  let errors
  try {
    errors = await win.webContents.executeJavaScript(CHECK)
  } catch (e) {
    console.error('Перевірка впала:', e)
    app.exit(2)
    return
  }

  if (errors.length === 0) {
    const pairs = payload.pairs.map((p) => `${p.vsName}+${p.name}`).join(', ')
    console.log(`✓ Усі ${payload.pairs.length} пар шейдерів компілюються і лінкуються`)
    console.log(`  ${pairs}`)
    app.exit(0)
  } else {
    for (const e of errors) console.error(`✗ ${e.name}:\n${e.error}\n`)
    app.exit(1)
  }
})
