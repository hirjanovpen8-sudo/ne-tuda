export type CompanionEvent =
  | { type: 'greeting' }
  | { type: 'route-start' }
  | { type: 'arrival' }
  | { type: 'reroute' }
  | { type: 'navigation'; instruction: string };

export type Boldness = 'soft' | 'witty' | 'bold';
export interface CompanionSettings {
  enabled: boolean;
  boldness: Boldness;
  allowProfanity: boolean;
  voiceEnabled: boolean;
}

export const DEFAULT_COMPANION_SETTINGS: Readonly<CompanionSettings> = Object.freeze({
  enabled: true, boldness: 'soft', allowProfanity: false, voiceEnabled: false,
});

const templates: Record<Exclude<CompanionEvent['type'], 'navigation'>, Record<Boldness, string>> = {
  greeting: { soft: 'Привет! Я Умнай, готов к прогулке.', witty: 'Привет! Умнай на связи, приключения уже заждались.', bold: 'Привет! Ну что, покажем городу, кто тут гуляет?' },
  'route-start': { soft: 'Маршрут готов. Отправляемся!', witty: 'Маршрут готов. Ноги, ваш выход!', bold: 'Поехали! Маршрут сам себя не пройдёт.' },
  arrival: { soft: 'Мы на месте!', witty: 'Прибыли! Ноги заслужили аплодисменты.', bold: 'На месте! Вот это мы дали.' },
  reroute: { soft: 'Маршрут изменился. Ищем новый путь.', witty: 'Небольшой поворот сюжета: перестраиваем маршрут.', bold: 'План поменялся. Город решил нас испытать?' },
};
const profanity: Record<Exclude<CompanionEvent['type'], 'navigation'>, string> = {
  greeting: 'Привет! Ну что, погнали, бля!',
  'route-start': 'Маршрут готов, погнали, бля, к скуке не возвращаемся!',
  arrival: 'Мы на месте, бля!',
  reroute: 'Бля, маршрут изменился. Ищем новый путь.',
};

/** Navigation instructions are returned verbatim, regardless of companion settings. */
export function getCompanionPhrase(event: CompanionEvent, settings: Partial<CompanionSettings> = {}): string | null {
  if (event.type === 'navigation') return event.instruction;
  const config = { ...DEFAULT_COMPANION_SETTINGS, ...settings };
  if (!config.enabled) return null;
  return config.boldness === 'bold' && config.allowProfanity ? profanity[event.type] : templates[event.type][config.boldness];
}

/** Optional browser speech. Returns false when unavailable, disabled, or rejected. */
export function speakCompanionPhrase(text: string, settings: Partial<CompanionSettings> = {}): boolean {
  if (!settings.voiceEnabled || !text.trim() || typeof window === 'undefined') return false;
  try {
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
