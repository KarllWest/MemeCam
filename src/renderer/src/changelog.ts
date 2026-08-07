/**
 * Історія змін, яку показує вікно «Що нового».
 *
 * Найновіша версія — перша. Дати абсолютні, щоб не плутатись через півроку.
 * Версія тут має збігатися з полем version у package.json.
 */

export type ChangeKind = 'added' | 'fixed' | 'changed' | 'removed'

export interface Release {
  version: string
  date: string
  /** Одне речення про суть релізу, показується під номером версії. */
  summary?: string
  changes: { kind: ChangeKind; text: string }[]
}

export const CHANGE_LABELS: Record<ChangeKind, { label: string; icon: string }> = {
  added: { label: 'Додано', icon: '✨' },
  fixed: { label: 'Виправлено', icon: '🔧' },
  changed: { label: 'Змінено', icon: '🔄' },
  removed: { label: 'Видалено', icon: '🗑' }
}

export const RELEASES: Release[] = [
  {
    version: '0.2.0',
    date: '2026-08-06',
    summary: 'Камера тепер 60 кадрів за секунду, новий інтерфейс і оновлення.',
    changes: [
      { kind: 'changed', text: 'Віртуальна камера віддає 60 кадрів/с замість 30' },
      { kind: 'added', text: 'Режим 30 кадрів/с лишився як другий варіант для слабших ПК' },
      { kind: 'changed', text: 'Повністю перероблений інтерфейс: маски винесені на кадр' },
      { kind: 'added', text: 'Вікно «Що нового» з історією змін і перевіркою оновлень' },
      {
        kind: 'changed',
        text: 'Пошук обличчя виконується 30 разів на секунду замість 60 — удвічі менше навантаження без втрати плавності'
      },
      { kind: 'changed', text: 'Рендер обмежений частотою камери, а не монітора' },
      { kind: 'added', text: 'Своя іконка застосунку' }
    ]
  },
  {
    version: '0.1.0',
    date: '2026-08-06',
    summary: 'Перша версія.',
    changes: [
      { kind: 'added', text: 'Лінза «лазерні очі» з відстеженням обличчя' },
      { kind: 'added', text: 'Низовий дим і блискавки згори' },
      { kind: 'added', text: '11 масок з перемиканням стрілками' },
      { kind: 'added', text: 'Знімки фото в теку Зображення/MemeCam' },
      { kind: 'added', text: 'Свій драйвер камери: окремий пристрій «Meme Cam» у Discord' },
      { kind: 'added', text: 'Запасний режим через віртуальну камеру OBS' },
      {
        kind: 'fixed',
        text: 'Трансляція більше не гальмує, коли вікно згорнуте або відкритий Discord'
      },
      {
        kind: 'fixed',
        text: 'Портативна версія більше не реєструє камеру з тимчасової теки, яка зникає після закриття'
      }
    ]
  }
]
