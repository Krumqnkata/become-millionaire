/**
 * Turns on-screen text into something a speech engine reads naturally:
 * "1 000 000 €" → "1000000 евро", "IX век" → "девети век", "343 m/s" → "343 метра в секунда".
 * Without this, engines spell out digit groups one by one and skip symbols.
 */

const ORDINALS = [
  '',
  'първи',
  'втори',
  'трети',
  'четвърти',
  'пети',
  'шести',
  'седми',
  'осми',
  'девети',
  'десети',
  'единадесети',
  'дванадесети',
  'тринадесети',
  'четиринадесети',
  'петнадесети',
  'шестнадесети',
  'седемнадесети',
  'осемнадесети',
  'деветнадесети',
  'двадесети',
  'двадесет и първи',
];

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

export function romanToNumber(roman: string): number | null {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const value = ROMAN[roman[i]!];
    const next = ROMAN[roman[i + 1] ?? ''] ?? 0;
    if (value === undefined) return null;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : null;
}

/** "първи" → "Първа" for queens, "Първи" for kings. */
function regnal(n: number, feminine: boolean): string | null {
  const word = ORDINALS[n];
  if (!word || n > 20) return null;
  const inflected = feminine ? word.replace(/и$/, 'а') : word;
  return inflected[0]!.toUpperCase() + inflected.slice(1);
}

const FEMININE_NAMES = new Set(['Елизабет']);

const UNITS: Array<[RegExp, string]> = [
  [/(\d)\s?°C/g, '$1 градуса'],
  [/(\d)\s?%/g, '$1 процента'],
  [/(\d)\s?m\/s²/g, '$1 метра в секунда на квадрат'],
  [/(\d)\s?km\/s/g, '$1 километра в секунда'],
  [/(\d)\s?km\/h/g, '$1 километра в час'],
  [/(\d)\s?m\/s/g, '$1 метра в секунда'],
  [/(\d)\s?km(?![\p{L}])/gu, '$1 километра'],
  [/(\d)\s?kg(?![\p{L}])/gu, '$1 килограма'],
  [/(\d)\s?m(?![\p{L}/])/gu, '$1 метра'],
];

export function toSpeech(text: string): string {
  let out = text;

  // Emoji and decorative symbols are not meant to be read.
  out = out.replace(/[\p{Extended_Pictographic}️★☆]/gu, '');

  // "1 000 000" (with normal, no-break or narrow no-break spaces) → "1000000"
  while (/(\d)[ \u00A0\u202F](\d{3})(?!\d)/.test(out)) {
    out = out.replace(/(\d)[ \u00A0\u202F](\d{3})(?!\d)/g, '$1$2');
  }

  out = out.replace(/(\d)\s?€/g, '$1 евро').replace(/€/g, 'евро');
  out = out.replace(/\b50:50\b/g, 'петдесет на петдесет');
  for (const [pattern, replacement] of UNITS) out = out.replace(pattern, replacement);

  // Centuries: "IX век" → "девети век"
  out = out.replace(
    /\b([IVXLC]+)(\s+)(век|в\.)/g,
    (match, roman: string, space: string, word: string) => {
      const n = romanToNumber(roman);
      return n && ORDINALS[n] ? `${ORDINALS[n]}${space}${word === 'в.' ? 'век' : word}` : match;
    },
  );

  // Rulers: "Николай II" → "Николай Втори", "Елизабет I" → "Елизабет Първа"
  out = out.replace(
    /([А-Я][а-яъ]+)\s+([IVX]{1,4})(?![\p{L}\d])/gu,
    (match, name: string, roman: string) => {
      const n = romanToNumber(roman);
      const feminine = FEMININE_NAMES.has(name) || /[ая]$/.test(name);
      const word = n ? regnal(n, feminine) : null;
      return word ? `${name} ${word}` : match;
    },
  );

  // Quotes are visual only; ellipses become a short pause.
  out = out.replace(/[„“”"«»]/g, '').replace(/…/g, '...');

  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Splits long text into sentences. Some engines (notably Chrome) cut off utterances
 * after ~15 seconds, and shorter chunks also get more natural pauses.
 */
export function splitForSpeech(text: string, maxLength = 160): string[] {
  if (text.length <= maxLength) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + ' ' + sentence).length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
