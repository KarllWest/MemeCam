import type { VoiceParams } from './presets'

/**
 * Мікрофон -> обробка -> вибраний вихід.
 *
 * Куди веде цей вихід — вирішує користувач. Навушники дають почути себе,
 * віртуальний аудіокабель (VB-CABLE і подібні) робить оброблений голос
 * мікрофоном для Discord. Своїм драйвером тут не обійтися: віртуальний мікрофон
 * у Windows — це драйвер режиму ядра, а такі вимагають підпису WHQL.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private micStream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private levelBuffer: Float32Array<ArrayBuffer> | null = null
  /** Той самий оброблений голос, але як потік — його забирає запис відео. */
  private tap: MediaStreamAudioDestinationNode | null = null

  /** Потік з обробленим голосом або null, якщо мікрофон вимкнено. */
  get stream(): MediaStream | null {
    return this.tap?.stream ?? null
  }

  get running(): boolean {
    return this.ctx !== null
  }

  /**
   * @param inputDeviceId мікрофон; порожній рядок — системний за замовчуванням
   * @param outputDeviceId куди віддавати оброблений звук
   */
  async start(inputDeviceId: string, outputDeviceId: string, params: VoiceParams): Promise<void> {
    await this.stop()

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
        // Обробка браузера тут тільки заважає: вона «вирівнює» голос,
        // з якого ми потім робимо ефект.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    })

    // latencyHint 'interactive' просить найкоротший буфер: чути себе із затримкою
    // у півсекунди неможливо.
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx

    await ctx.audioWorklet.addModule('worklets/voice.js')

    if (outputDeviceId && 'setSinkId' in ctx) {
      await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> })
        .setSinkId(outputDeviceId)
        .catch(() => {
          // Пристрій зник або зайнятий — лишаємось на системному виході.
        })
    }

    this.source = ctx.createMediaStreamSource(this.micStream)
    this.node = new AudioWorkletNode(ctx, 'memecam-voice', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    })
    this.apply(params)

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.levelBuffer = new Float32Array(this.analyser.fftSize)

    // Відгалуження для запису йде паралельно з динаміками: якщо його чіпляти
    // послідовно, зупинка запису обірвала б і звук у навушниках.
    this.tap = ctx.createMediaStreamDestination()

    this.source.connect(this.node)
    this.node.connect(this.analyser)
    this.analyser.connect(ctx.destination)
    this.analyser.connect(this.tap)

    if (ctx.state === 'suspended') await ctx.resume()
  }

  /** Міняє ефект на льоту, без розриву звуку. */
  apply(params: VoiceParams): void {
    const node = this.node
    if (!node) return

    for (const [name, value] of Object.entries(params)) {
      const param = node.parameters.get(name)
      if (param) param.value = value
    }
  }

  /** Поточна гучність 0..1 — для індикатора рівня. */
  level(): number {
    if (!this.analyser || !this.levelBuffer) return 0
    this.analyser.getFloatTimeDomainData(this.levelBuffer)

    let peak = 0
    for (const sample of this.levelBuffer) {
      const v = Math.abs(sample)
      if (v > peak) peak = v
    }
    return Math.min(1, peak)
  }

  /** Затримка тракту в мілісекундах, як її бачить браузер. */
  latencyMs(): number {
    if (!this.ctx) return 0
    return (this.ctx.baseLatency + this.ctx.outputLatency) * 1000
  }

  async stop(): Promise<void> {
    this.node?.port.postMessage('stop')
    this.node?.disconnect()
    this.analyser?.disconnect()
    this.source?.disconnect()
    this.micStream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})

    this.tap?.disconnect()

    this.node = null
    this.analyser = null
    this.tap = null
    this.source = null
    this.micStream = null
    this.ctx = null
    this.levelBuffer = null
  }
}
