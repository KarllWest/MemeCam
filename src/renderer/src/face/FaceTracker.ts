import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

/** Центри зіниць у наборі з 478 точок MediaPipe. */
const IRIS_LEFT = 468
const IRIS_RIGHT = 473

export interface TrackedFace {
  /**
   * Усі точки обличчя в екранних uv, парами x,y. До них прив'язуються накладки.
   * Масив перевикористовується між кадрами — копіюй, якщо треба зберегти.
   */
  points: Float32Array
  /** Зіниці в екранних uv (0..1, початок унизу зліва). */
  eyeL: [number, number]
  eyeR: [number, number]
  /** Куди дивиться голова, в екранних uv. Одиничний вектор. */
  dir: [number, number]
  /**
   * Наскільки погляд відвернутий від камери, 0..1.
   * Коли людина дивиться прямо в об'єктив, промінь летить у камеру і збоку його
   * не видно — залишається тільки спалах. Це значення гасить промінь у такій позі.
   */
  dirStrength: number
}

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null
  private lastTimestamp = -1
  private points: Float32Array | null = null

  /** Вантажить модель. Усе локальне — інтернет не потрібен. */
  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks('mediapipe/wasm')

    const options = {
      baseOptions: {
        modelAssetPath: 'mediapipe/face_landmarker.task',
        delegate: 'GPU' as const
      },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false
    }

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options)
    } catch {
      // На частині інтегрованих GPU делегат падає — CPU повільніший, але робочий.
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' }
      })
    }
  }

  get ready(): boolean {
    return this.landmarker !== null
  }

  /**
   * Шукає обличчя в поточному кадрі відео.
   * @param mirror чи дзеркалиться картинка на екрані (селфі-режим)
   */
  detect(video: HTMLVideoElement, timestampMs: number, mirror: boolean): TrackedFace | null {
    const lm = this.landmarker
    if (!lm || video.readyState < 2) return null

    // MediaPipe вимагає строго зростаючих міток часу.
    if (timestampMs <= this.lastTimestamp) timestampMs = this.lastTimestamp + 1
    this.lastTimestamp = timestampMs

    const result = lm.detectForVideo(video, timestampMs)
    const points = result.faceLandmarks[0]
    if (!points || points.length <= IRIS_RIGHT) return null

    // Точки приходять з початком координат у лівому верхньому куті — перевертаємо Y.
    const toUv = (i: number): [number, number] => {
      const p = points[i]
      return [mirror ? 1 - p.x : p.x, 1 - p.y]
    }

    if (!this.points || this.points.length !== points.length * 2) {
      this.points = new Float32Array(points.length * 2)
    }
    for (let i = 0; i < points.length; i++) {
      this.points[i * 2] = mirror ? 1 - points[i].x : points[i].x
      this.points[i * 2 + 1] = 1 - points[i].y
    }

    const eyeL = toUv(IRIS_LEFT)
    const eyeR = toUv(IRIS_RIGHT)

    let dir: [number, number] = [0, 0]
    let dirStrength = 0

    // Третій стовпець матриці — вісь Z обличчя (погляд) у просторі камери.
    const matrix = result.facialTransformationMatrixes?.[0]?.data
    if (matrix && matrix.length === 16) {
      const fx = (mirror ? -1 : 1) * matrix[8]
      const fy = matrix[9]
      const len = Math.hypot(fx, fy)
      if (len > 1e-4) {
        dir = [fx / len, fy / len]
        // len ~ синус кута відвороту від камери; 0.5 вже дає добре видимий промінь.
        dirStrength = Math.min(len / 0.5, 1)
      }
    }

    return { points: this.points, eyeL, eyeR, dir, dirStrength }
  }

  dispose(): void {
    this.landmarker?.close()
    this.landmarker = null
  }
}
