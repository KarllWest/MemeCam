import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'

/**
 * Відділяє людину від фону.
 *
 * Тримається окремо від трекера обличчя навмисно: маска фону змінюється повільно
 * й не потребує кожного кадру, а модель важча за пошук точок. Ганяти її на
 * 60 кадрах означало б палити ресурс на те, чого око не побачить.
 */
export class Segmenter {
  private segmenter: ImageSegmenter | null = null
  private lastTimestamp = -1
  /** Маска як байти 0..255: 255 — людина, 0 — фон. */
  private mask: Uint8Array | null = null
  private maskWidth = 0
  private maskHeight = 0

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks('mediapipe/wasm')

    const options = {
      baseOptions: {
        modelAssetPath: 'mediapipe/selfie_segmenter.tflite',
        delegate: 'GPU' as const
      },
      runningMode: 'VIDEO' as const,
      outputCategoryMask: true,
      outputConfidenceMasks: false
    }

    try {
      this.segmenter = await ImageSegmenter.createFromOptions(fileset, options)
    } catch {
      // На частині інтегрованих GPU делегат падає — CPU повільніший, але робочий.
      this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' }
      })
    }
  }

  get ready(): boolean {
    return this.segmenter !== null
  }

  get width(): number {
    return this.maskWidth
  }

  get height(): number {
    return this.maskHeight
  }

  /**
   * Рахує маску для поточного кадру. Повертає null, якщо нічого нового немає.
   * Масив перевикористовується між викликами.
   */
  segment(video: HTMLVideoElement, timestampMs: number): Uint8Array | null {
    const seg = this.segmenter
    if (!seg || video.readyState < 2) return null

    // MediaPipe вимагає строго зростаючих міток часу.
    if (timestampMs <= this.lastTimestamp) timestampMs = this.lastTimestamp + 1
    this.lastTimestamp = timestampMs

    let out: Uint8Array | null = null

    seg.segmentForVideo(video, timestampMs, (result) => {
      const category = result.categoryMask
      if (!category) return

      const data = category.getAsUint8Array()
      this.maskWidth = category.width
      this.maskHeight = category.height

      if (!this.mask || this.mask.length !== data.length) {
        this.mask = new Uint8Array(data.length)
      }
      // Модель позначає фон нулем, людину — одиницею. Розтягуємо до 0..255,
      // щоб віддати це шейдеру як звичайну текстуру яскравості.
      for (let i = 0; i < data.length; i++) this.mask[i] = data[i] ? 255 : 0

      out = this.mask
      // Результат живе лише всередині зворотного виклику — далі його звільнять.
      result.close()
    })

    return out
  }

  dispose(): void {
    this.segmenter?.close()
    this.segmenter = null
    this.mask = null
  }
}
