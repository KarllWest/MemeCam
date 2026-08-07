/**
 * Обробка голосу в реальному часі.
 *
 * Живе в окремому аудіопотоці, тому не залежить від завантаженості інтерфейсу:
 * навіть коли головний потік захлинається, звук не заїкається.
 *
 * Головне обмеження, через яке все влаштовано саме так: справжнє сповільнення
 * в лайві неможливе. Розтяг часу робить вихід довшим за вхід, і затримка росла б
 * нескінченно. Тому «сповільнення» тут — зсув тону вниз без зміни темпу: звучить
 * так само низько й тягуче, але затримка лишається сталою.
 */

/**
 * Зсув тону на затримці зі змінною позицією читання.
 *
 * Позиція читання повзе відносно запису, і коли доповзає до краю вікна —
 * перестрибує назад. Щоб стрибок не було чути, читаємо двома голосами, зсунутими
 * на пів вікна, і зважуємо трикутним вікном: гучність кожного падає до нуля рівно
 * там, де він стрибає.
 */
class PitchShifter {
  constructor(sampleRate) {
    this.size = Math.ceil(sampleRate * 0.2)
    this.buffer = new Float32Array(this.size)
    this.write = 0
    // Вікно ~60 мс: коротше дає металевий призвук, довше — помітне відлуння.
    this.window = Math.ceil(sampleRate * 0.06)
    this.phase = 0
  }

  process(input, ratio) {
    const { buffer, size, window } = this
    buffer[this.write] = input

    let out = 0
    for (let tap = 0; tap < 2; tap++) {
      let delay = this.phase + (tap * window) / 2
      if (delay >= window) delay -= window

      let read = this.write - delay
      while (read < 0) read += size

      const i0 = Math.floor(read) % size
      const i1 = (i0 + 1) % size
      const frac = read - Math.floor(read)
      const sample = buffer[i0] * (1 - frac) + buffer[i1] * frac

      // Два трикутники, зсунуті на пів вікна, у сумі дають рівно одиницю.
      const gain = 1 - Math.abs((2 * delay) / window - 1)
      out += sample * gain
    }

    this.phase += 1 - ratio
    if (this.phase >= window) this.phase -= window
    if (this.phase < 0) this.phase += window

    this.write = (this.write + 1) % size
    return out
  }
}

/** Затримка зі зворотним зв'язком — від легкої кімнати до печери. */
class Echo {
  constructor(sampleRate) {
    this.size = Math.ceil(sampleRate * 1.5)
    this.buffer = new Float32Array(this.size)
    this.pos = 0
  }

  process(input, delaySamples, feedback, mix) {
    if (mix <= 0.001) return input

    const delay = Math.min(Math.max(delaySamples, 1), this.size - 1)
    let read = this.pos - delay
    while (read < 0) read += this.size

    const i0 = Math.floor(read) % this.size
    const i1 = (i0 + 1) % this.size
    const frac = read - Math.floor(read)
    const delayed = this.buffer[i0] * (1 - frac) + this.buffer[i1] * frac

    this.buffer[this.pos] = input + delayed * feedback
    this.pos = (this.pos + 1) % this.size

    return input * (1 - mix) + delayed * mix
  }
}

class VoiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Півтони: -12 — октава вниз, +12 — вгору.
      { name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      // Ринг-модуляція: частота несучої в герцах, 0 — вимкнено.
      { name: 'ringHz', defaultValue: 0, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'ringMix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'echoMs', defaultValue: 180, minValue: 10, maxValue: 1400, automationRate: 'k-rate' },
      { name: 'echoFeedback', defaultValue: 0, minValue: 0, maxValue: 0.92, automationRate: 'k-rate' },
      { name: 'echoMix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Скільки обробленого голосу лишити: 0 — чистий мікрофон.
      { name: 'wet', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'outputGain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' }
    ]
  }

  constructor() {
    super()
    this.pitch = new PitchShifter(sampleRate)
    this.echo = new Echo(sampleRate)
    this.ringPhase = 0
    this.alive = true
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false
    }
  }

  process(inputs, outputs, params) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return this.alive

    const src = input && input.length > 0 ? input[0] : null
    const dst = output[0]

    const ratio = Math.pow(2, params.semitones[0] / 12)
    const ringHz = params.ringHz[0]
    const ringMix = params.ringMix[0]
    const echoSamples = (params.echoMs[0] / 1000) * sampleRate
    const feedback = params.echoFeedback[0]
    const echoMix = params.echoMix[0]
    const wet = params.wet[0]
    const gain = params.outputGain[0]

    const ringStep = (2 * Math.PI * ringHz) / sampleRate

    for (let i = 0; i < dst.length; i++) {
      const dry = src ? src[i] : 0

      let v = this.pitch.process(dry, ratio)

      if (ringMix > 0.001 && ringHz > 0) {
        const carrier = Math.sin(this.ringPhase)
        this.ringPhase += ringStep
        if (this.ringPhase > 2 * Math.PI) this.ringPhase -= 2 * Math.PI
        v = v * (1 - ringMix) + v * carrier * ringMix
      }

      v = this.echo.process(v, echoSamples, feedback, echoMix)

      // Обмежувач: ехо зі зворотним зв'язком легко виводить сигнал за межі.
      let out = (dry * (1 - wet) + v * wet) * gain
      if (out > 1) out = 1
      else if (out < -1) out = -1

      dst[i] = out
    }

    // Другий канал, якщо вихід стерео — той самий сигнал.
    for (let ch = 1; ch < output.length; ch++) output[ch].set(dst)

    return this.alive
  }
}

registerProcessor('memecam-voice', VoiceProcessor)
