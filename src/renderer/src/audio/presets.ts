/** Налаштування обробки голосу, які розуміє воркліт memecam-voice. */
export interface VoiceParams {
  semitones: number
  ringHz: number
  ringMix: number
  echoMs: number
  echoFeedback: number
  echoMix: number
  wet: number
  outputGain: number
}

export interface VoicePreset {
  id: string
  name: string
  icon: string
  /** Одне речення для підказки під кнопкою. */
  hint: string
  params: VoiceParams
}

const base: VoiceParams = {
  semitones: 0,
  ringHz: 0,
  ringMix: 0,
  echoMs: 180,
  echoFeedback: 0,
  echoMix: 0,
  wet: 1,
  outputGain: 1
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'off',
    name: 'Без ефекту',
    icon: '🎙',
    hint: 'Чистий мікрофон',
    params: { ...base, wet: 0 }
  },
  {
    id: 'slowed',
    name: 'Сповільнений',
    icon: '🐌',
    hint: 'Той самий низький тягучий голос, що в мемах',
    params: { ...base, semitones: -5, echoMs: 90, echoFeedback: 0.18, echoMix: 0.16 }
  },
  {
    id: 'demon',
    name: 'Демон',
    icon: '😈',
    hint: 'Октава вниз і трохи печери',
    params: {
      ...base,
      semitones: -12,
      echoMs: 140,
      echoFeedback: 0.3,
      echoMix: 0.24,
      outputGain: 1.2
    }
  },
  {
    id: 'chipmunk',
    name: 'Бурундук',
    icon: '🐿',
    hint: 'Високо і швидко',
    params: { ...base, semitones: 7 }
  },
  {
    id: 'robot',
    name: 'Робот',
    icon: '🤖',
    hint: 'Механічний призвук поверх голосу',
    params: { ...base, semitones: -2, ringHz: 62, ringMix: 0.75 }
  },
  {
    id: 'cave',
    name: 'Печера',
    icon: '🕳',
    hint: 'Довге відлуння',
    params: { ...base, semitones: -3, echoMs: 380, echoFeedback: 0.62, echoMix: 0.45 }
  },
  {
    id: 'radio',
    name: 'Рація',
    icon: '📻',
    hint: 'Різкий металевий тембр',
    params: { ...base, ringHz: 340, ringMix: 0.35, echoMs: 40, echoFeedback: 0.1, echoMix: 0.12 }
  }
]

export const findVoicePreset = (id: string): VoicePreset =>
  VOICE_PRESETS.find((p) => p.id === id) ?? VOICE_PRESETS[0]
