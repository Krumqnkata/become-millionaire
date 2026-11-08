import { formatPrize, LEVEL_COUNT, prizeForLevel } from '../game/ladder.ts';
import { ANSWER_LETTERS, FRIENDS } from '../game/lifelines.ts';
import { MODES } from '../game/modes.ts';
import { pick } from '../game/random.ts';
import type { Rng } from '../game/types.ts';

/** The game's own host – an original character, not modelled on any real presenter. */
export const HOST = {
  name: 'Ясен Светлев',
  shortName: 'Ясен',
} as const;

export type LineVars = Partial<
  Record<
    'name' | 'prize' | 'level' | 'letter' | 'answer' | 'guaranteed' | 'friend',
    string | number
  >
>;

/**
 * Everything the host can say. Each key holds variations, picked at random,
 * so two games never sound exactly the same.
 *
 * Template syntax:
 * - `{prize}`, `{letter}`… are filled in by `line()`.
 * - `{name|нашият участник}` shows the player's name, or the alternative when there is none.
 *   The recorded voice always says the alternative, since names cannot be recorded in advance.
 * - `[, {name}]` is shown on screen but left out of the recorded voice.
 */
export const LINES = {
  welcome: [
    'Добър вечер и добре дошли в „Пътят към милиона“! Аз съм {host}, а срещу мен тази вечер е {name|нашият участник}.',
    'Добър вечер, дами и господа! Светлините са запалени, публиката е тук, а на стола срещу мен е {name|нашият участник}.',
    'Добре дошли в „Пътят към милиона“! Петнайсет въпроса делят {name|нашия участник} от един милион евро.',
    'Аплодисменти, моля! Добре дошли в студиото[, {name}]!',
    'Здравейте и добре дошли! Аз съм {host}. Сърцето бие ли вече[, {name}]?',
  ],
  rules: [
    'Правилата са прости: петнайсет въпроса, четири отговора, само един е верен. Да започваме!',
    'Помни: можеш да спреш по всяко време и да вземеш парите. Да започваме!',
    'Жокерите са на твое разположение. Използвай ги мъдро. Да започваме!',
    'Сигурни суми, четири отговора и един милион на върха. Започваме!',
    'Спокойно, дишай дълбоко. Публиката е с теб. Да започваме!',
  ],
  firstQuestion: [
    'Първи въпрос, за {prize}. Да загреем!',
    'Започваме с въпрос за {prize}.',
    'Ето го и първия въпрос, за {prize}. Лесно загряване.',
    'Първата стъпка по стълбата: {prize}.',
  ],
  question: [
    'Въпрос номер {level}, за {prize}.',
    'Следващият въпрос е за {prize}.',
    'Въпрос {level}. На масата са {prize}.',
    'Продължаваме. Въпрос за {prize}.',
    'Изкачваме се. Въпрос {level}, за {prize}.',
    'Ето го въпрос номер {level}. Залогът е {prize}.',
    'Добре се справяш! Следва въпрос за {prize}.',
    'Стъпало {level} от петнайсет. {prize}.',
  ],
  safeQuestion: [
    'Внимание! Този въпрос е за сигурна сума, {prize}.',
    'Ако отговориш вярно, {prize} остават твои, каквото и да се случи после.',
    'Важен момент: въпрос за сигурната сума от {prize}.',
    'Още един верен отговор и {prize} са гарантирани.',
  ],
  bigQuestion: [
    'Вече сме на въпрос {level}. За {prize} напрежението е огромно.',
    'Въпрос за {prize}. Публиката затаи дъх.',
    'Сега играем за големи пари: {prize}.',
    'Въпрос номер {level}. {prize}. Малцина стигат дотук.',
  ],
  millionQuestion: [
    'Това е въпросът за един милион евро. Тишина в студиото, моля.',
    'Пред теб е последният въпрос[, {name}]. Един милион евро.',
    'Петнайсети въпрос. Един милион евро. Всичко се решава сега.',
  ],
  confirm: [
    '{letter}. Последен отговор?',
    'Казваш {letter}. Заключваме ли?',
    '{letter}, „{answer}“. Окончателно ли е?',
    'Хм, {letter}. Окончателно ли е?',
    '„{answer}“… Това ли е последният ти отговор?',
  ],
  lock: [
    'Заключваме {letter}.',
    'Добре. {letter} е заключен.',
    'Отговор {letter}. Да видим…',
    '{letter} е заключен. Няма връщане назад.',
  ],
  suspense: [
    'Знаеше ли го, или рискува?',
    'Момент на истината…',
    'Хм… ще те измъчвам още малко.',
    'Да видим дали…',
    'Публиката мълчи…',
    'Звучеше много уверено. Дали с право?',
    'Ако е вярно…',
    'Това е голям момент.',
  ],
  correct: [
    'Вярно! Печелиш {prize}!',
    'Абсолютно точно! {prize} са твои.',
    'Браво! „{answer}“ е верният отговор!',
    'Да! Точно така! Имаш {prize}.',
    'Правилно! Продължаваме нагоре.',
    'Отлично! {prize} в джоба.',
    'Верен отговор! Публиката ръкопляска.',
    'Точно! Нямаше и миг колебание.',
  ],
  correctBig: [
    'Вярно! {prize}! Невероятна игра!',
    'ДА! {prize}! Публиката е на крака!',
    'Феноменално! {prize}! Още малко до върха!',
    'Вярно! Вече имаш {prize}. Каква игра!',
  ],
  safe: [
    'Вярно! {prize} вече са гарантирани! Каквото и да стане, си тръгваш с тях.',
    'Браво! Стигна сигурната сума от {prize}!',
    'Сигурна сума! {prize} никой не може да ти вземе.',
    'Вярно! Заключваме {prize}. Сега може да играеш по-спокойно.',
  ],
  wrong: [
    'О, не… Съжалявам[, {name}]. Верният отговор е {letter}, „{answer}“.',
    'За съжаление не. Верният отговор е {letter}, „{answer}“.',
    'Ох… Не е това. Правилният отговор беше {letter}, „{answer}“.',
    'Сърцето ми се свива… Верният отговор е {letter}, „{answer}“.',
  ],
  wrongKeep: [
    'Но не си тръгваш с празни ръце. Печелиш {guaranteed}.',
    'Сигурната сума те спасява: тръгваш си с {guaranteed}.',
    'Все пак {guaranteed} са твои. Браво за играта!',
  ],
  wrongNothing: [
    'Този път без печалба, но беше страхотна игра.',
    'Днес без награда, но опитът е безценен.',
    'Без пари, но с много аплодисменти!',
  ],
  timeout: [
    'Времето изтече! Верният отговор беше {letter}, „{answer}“.',
    'Часовникът спря… Правилният отговор е {letter}, „{answer}“.',
    'Ох, времето свърши! Отговорът беше {letter}, „{answer}“.',
  ],
  walkAway: [
    'Решаваш да спреш. Тръгваш си с {prize}. Поздравления!',
    'Понякога най-смелото решение е да спреш. {prize} са твои!',
    'Мъдро! {prize} влизат в джоба ти.',
    'Спираш дотук. {prize}. Публиката те уважава!',
  ],
  walkAwayAsk: [
    'Само за любопитство: кой отговор щеше да дадеш?',
    'Сега, без риск: какво щеше да отговориш?',
  ],
  walkAwayRight: [
    'Щеше да познаеш! Но парите са в джоба.',
    'Ех, щеше да е вярно! Но кой можеше да знае?',
    'Вярно щеше да е! Е, следващия път.',
  ],
  walkAwayWrong: [
    'Щеше да сбъркаш! Мъдро решение да спреш.',
    'Добре, че спря. Това щеше да е грешка!',
    'Интуицията те спаси. Отговорът щеше да е грешен.',
  ],
  million: [
    'ВЯРНО! ТИ СПЕЧЕЛИ ЕДИН МИЛИОН ЕВРО[, {name}]!',
    'НЕВЕРОЯТНО! {name|Нашият участник} печели милион евро!',
    'ЕДИН МИЛИОН ЕВРО! Ти си легенда[, {name}]!',
  ],
  fifty: [
    'Компютър, моля, махни два грешни отговора.',
    '50 на 50. Да видим какво остава.',
    'Махаме два грешни отговора. Остават два.',
  ],
  audience: [
    'Публика, пред вас са клавиатурите. Гласувайте сега!',
    'Да питаме публиката. Гласуването започва!',
    'Скъпа публика, помогнете! Гласувайте!',
  ],
  audienceDone: [
    'Публиката гласува. Ето резултатите.',
    'Готово. Вижте какво мисли залата.',
    'Гласуването приключи. Публиката каза своето.',
  ],
  phonePick: ['Кого ще потърсим?', 'На кого да звъннем?', 'Кой приятел ще ти помогне?'],
  phoneCall: [
    'Здравей, {friend}! Тук е {host} от „Пътят към милиона“. {name|Нашият участник} има нужда от помощта ти. Тридесет секунди, започва… сега!',
    'Ало, {friend}? Обаждаме се от „Пътят към милиона“. {name|Нашият участник} е на горещия стол. Имате тридесет секунди!',
  ],
  phoneEnd: [
    'Благодарим ти, {friend}!',
    'Благодаря, {friend}! Чухме те.',
    'Благодарим за помощта, {friend}!',
  ],
  switch: [
    'Нов въпрос, същата трудност. Успех!',
    'Сменяме въпроса. Дано този е по-лесен!',
    'Нов шанс, нов въпрос!',
  ],
  idle: [
    'Не бързай. Помисли.',
    'Въпросът не е лесен…',
    'Публиката те подкрепя!',
    'Можеш да използваш жокер, ако се колебаеш.',
    'Спомни си първото, което ти дойде наум.',
  ],
  goodbye: [
    'Благодарим ти[, {name}]! До следващия път в „Пътят към милиона“!',
    'Беше удоволствие[, {name}]! Лека нощ от студиото на „Пътят към милиона“!',
    'Аплодисменти за {name|нашия участник}! До нови срещи!',
  ],
} satisfies Record<string, string[]>;

export type LineKey = keyof typeof LINES;

/** Marks the spot where the recorded voice plays "В: Волга" from the current question. */
export const ANSWER_PART = { answer: true } as const;
export type VoicePart = string | typeof ANSWER_PART;

export interface Line {
  key: LineKey;
  /** What appears in the speech bubble and what the browser voice reads. */
  text: string;
  /** What the recorded voice says, in order: recorded phrases and the current answer. */
  voice: VoicePart[];
}

/** Picks a random variation of a line and fills in its placeholders. */
export function line(key: LineKey, vars: LineVars = {}, rng: Rng = Math.random): Line {
  const template = pick(rng, LINES[key]);
  return { key, text: renderText(template, vars), voice: renderVoice(template, vars) };
}

const PLACEHOLDER = /\{(\w+)(?:\|([^}]*))?\}/g;

function fillPlain(template: string, vars: LineVars): string {
  return template.replace(PLACEHOLDER, (match, key: string, alt?: string) => {
    if (key === 'host') return HOST.name;
    const value = vars[key as keyof LineVars];
    if (value !== undefined && value !== '') return String(value);
    return alt ?? match;
  });
}

/** Screen text: optional parts are kept only when their placeholders have values. */
export function renderText(template: string, vars: LineVars): string {
  const withOptional = template.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const needed = [...inner.matchAll(PLACEHOLDER)].map((m) => m[1] as keyof LineVars);
    return needed.every((k) => vars[k] !== undefined && vars[k] !== '') ? inner : '';
  });
  return fillPlain(withOptional, vars);
}

/** Kept for compatibility with older callers and tests. */
export const fill = renderText;

const ANSWER_SPOT = /\{letter\}(?:[,:]\s*|\s+)„?\{answer\}“?|„?\{answer\}“?/;

/** Recorded-voice parts: no names, and the answer as its own part. */
export function renderVoice(template: string, vars: LineVars): VoicePart[] {
  const anonymous = template
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{name\|([^}]*)\}/g, '$1')
    .replace(/\{name\}/g, '');
  const pieces = anonymous.split(ANSWER_SPOT);
  const parts: VoicePart[] = [];
  pieces.forEach((piece, i) => {
    if (i > 0) parts.push(ANSWER_PART);
    const text = fillPlain(piece, vars)
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (/[\p{L}\d]/u.test(text)) parts.push(text);
  });
  return parts;
}

/** The right intro for a level: first question, safe haven, the million or a regular one. */
export function questionIntroKey(level: number, isSafeHaven: boolean, total: number): LineKey {
  if (level === total) return 'millionQuestion';
  if (level === 1) return 'firstQuestion';
  if (isSafeHaven) return 'safeQuestion';
  if (level >= 11) return 'bigQuestion';
  return 'question';
}

// ─── Everything the recorded voice may need ──────────────────────────────────

export type Mood = 'neutral' | 'warm' | 'tense' | 'excited' | 'sad';

export const LINE_MOOD: Record<LineKey, Mood> = {
  welcome: 'warm',
  rules: 'warm',
  firstQuestion: 'warm',
  question: 'neutral',
  safeQuestion: 'neutral',
  bigQuestion: 'tense',
  millionQuestion: 'tense',
  confirm: 'neutral',
  lock: 'tense',
  suspense: 'tense',
  correct: 'excited',
  correctBig: 'excited',
  safe: 'excited',
  wrong: 'sad',
  wrongKeep: 'warm',
  wrongNothing: 'warm',
  timeout: 'sad',
  walkAway: 'warm',
  walkAwayAsk: 'neutral',
  walkAwayRight: 'neutral',
  walkAwayWrong: 'warm',
  million: 'excited',
  fifty: 'neutral',
  audience: 'warm',
  audienceDone: 'neutral',
  phonePick: 'neutral',
  phoneCall: 'warm',
  phoneEnd: 'warm',
  switch: 'warm',
  idle: 'warm',
  goodbye: 'warm',
};

export interface VoicePhrase {
  text: string;
  key: LineKey;
  mood: Mood;
  /** "common" or "level-N": phrases are recorded and loaded in groups. */
  section: string;
}

function* combinations(template: string): Generator<{ vars: LineVars; section: string }> {
  const uses = (name: string) => template.includes(`{${name}`);
  const levels = uses('level')
    ? Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1)
    : uses('prize')
      ? Array.from({ length: LEVEL_COUNT + 1 }, (_, i) => i) // 0 € … 1 000 000 € (walk away at any point)
      : [null];
  const guaranteed = uses('guaranteed')
    ? [...new Set(Object.values(MODES).flatMap((m) => m.safeHavens))].map((l) =>
        formatPrize(prizeForLevel(l)),
      )
    : [undefined];
  const letters =
    uses('letter') && !template.includes('{answer}') ? [...ANSWER_LETTERS] : [undefined];
  const friends = uses('friend') ? FRIENDS.map((f) => f.name) : [undefined];

  for (const level of levels)
    for (const g of guaranteed)
      for (const letter of letters)
        for (const friend of friends) {
          const vars: LineVars = {};
          if (level !== null) {
            vars.prize = formatPrize(prizeForLevel(level));
            if (uses('level')) vars.level = level;
          }
          if (g !== undefined) vars.guaranteed = g;
          if (letter !== undefined) vars.letter = letter;
          if (friend !== undefined) vars.friend = friend;
          yield { vars, section: level === null ? 'common' : `level-${Math.max(1, level)}` };
        }
}

/** Every phrase the host can say with a recorded voice, ready to be synthesized. */
export function allVoicePhrases(): VoicePhrase[] {
  const seen = new Set<string>();
  const phrases: VoicePhrase[] = [];
  for (const key of Object.keys(LINES) as LineKey[]) {
    for (const template of LINES[key]) {
      for (const { vars, section } of combinations(template)) {
        for (const part of renderVoice(template, vars)) {
          if (typeof part !== 'string' || seen.has(part)) continue;
          seen.add(part);
          phrases.push({ text: part, key, mood: LINE_MOOD[key], section });
        }
      }
    }
  }
  return phrases;
}
