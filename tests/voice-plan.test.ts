import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  buildSsml,
  friendPhrases,
  planStats,
  questionSprite,
  resolveSpans,
} from '../scripts/voice-plan.ts';
import { clipKey, questionHash } from '../src/audio/voice-pack.ts';
import { formatPrize, prizeForLevel } from '../src/game/ladder.ts';
import { ANSWER_LETTERS, FRIENDS, phoneFriend } from '../src/game/lifelines.ts';
import { loadQuestionBank } from '../src/game/questions.ts';
import { createRng } from '../src/game/random.ts';
import type { AnswerIndex, CategorizedQuestion } from '../src/game/types.ts';
import {
  allVoicePhrases,
  LINES,
  renderText,
  renderVoice,
  type LineKey,
} from '../src/show/script.ts';

const sample: CategorizedQuestion = {
  id: 'geo-008',
  category: 'geography',
  difficulty: 2,
  question: 'Коя е най-дългата река в Европа?',
  answers: ['Дунав', 'Рейн', 'Волга', 'Днепър'],
  correct: 2,
};

describe('host lines', () => {
  it('show the name on screen but never in the recorded voice', () => {
    const template = 'О, не… Съжалявам[, {name}]. Верният отговор е {letter}, „{answer}“.';
    expect(renderText(template, { name: 'Мария', letter: 'В', answer: 'Волга' })).toBe(
      'О, не… Съжалявам, Мария. Верният отговор е В, „Волга“.',
    );
    expect(renderText(template, { letter: 'В', answer: 'Волга' })).toBe(
      'О, не… Съжалявам. Верният отговор е В, „Волга“.',
    );
    expect(renderVoice(template, { name: 'Мария', letter: 'В', answer: 'Волга' })).toEqual([
      'О, не… Съжалявам. Верният отговор е',
      { answer: true },
    ]);
  });

  it('drop punctuation left over around the answer', () => {
    expect(
      renderVoice('{letter}, „{answer}“. Окончателно ли е?', { letter: 'Б', answer: 'Рейн' }),
    ).toEqual([{ answer: true }, 'Окончателно ли е?']);
  });

  it('use the alternative wording when there is no name', () => {
    const template = 'Аплодисменти за {name|нашия участник}!';
    expect(renderText(template, { name: 'Иво' })).toBe('Аплодисменти за Иво!');
    expect(renderText(template, {})).toBe('Аплодисменти за нашия участник!');
    expect(renderVoice(template, { name: 'Иво' })).toEqual(['Аплодисменти за нашия участник!']);
  });

  it('every phrase a real game can ask for has been planned for recording', () => {
    const planned = new Set(allVoicePhrases().map((p) => p.text));
    const rng = createRng(5);
    const missing: string[] = [];
    for (const key of Object.keys(LINES) as LineKey[]) {
      for (const template of LINES[key]) {
        for (let level = 1; level <= 15; level++) {
          const vars = {
            name: 'Мария',
            level,
            prize: formatPrize(prizeForLevel(key === 'walkAway' ? level - 1 : level)),
            letter: ANSWER_LETTERS[Math.floor(rng() * 4)]!,
            answer: 'Волга',
            guaranteed: formatPrize(prizeForLevel(level < 10 ? 5 : 10)),
            friend: FRIENDS[level % FRIENDS.length]!.name,
          };
          for (const part of renderVoice(template, vars))
            if (typeof part === 'string' && !planned.has(part)) missing.push(part);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every friend message has been planned, in the right voice', () => {
    const planned = new Set(friendPhrases().map((f) => clipKey(f.text, f.role)));
    for (const friend of FRIENDS) {
      for (let seed = 0; seed < 60; seed++) {
        const call = phoneFriend(
          0,
          ((seed % 5) + 1) as 1,
          'history',
          [0, 1, 2, 3],
          createRng(seed),
          friend,
        );
        expect(planned.has(clipKey(call.message, friend.gender))).toBe(true);
      }
    }
  });
});

describe('SSML', () => {
  it('bookmarks the question and each answer', () => {
    const ssml = buildSsml(questionSprite(sample));
    expect(ssml).toContain('<voice name="bg-BG-BorislavNeural">');
    for (const mark of ['q', 'a0', 'a1', 'a2', 'a3']) {
      expect(ssml).toContain(`<bookmark mark="${mark}|s"/>`);
      expect(ssml).toContain(`<bookmark mark="${mark}|e"/>`);
    }
    expect(ssml).toContain('В: Волга');
  });

  it('ends with a closing word, so Azure reports the last bookmark', () => {
    const ssml = buildSsml(questionSprite(sample));
    expect(ssml).toMatch(
      /<bookmark mark="a3\|e"\/><\/prosody><break time="\d+ms"\/><bookmark mark="__tail"\/>Край\.<\/voice><\/speak>$/,
    );
  });

  it('places items even when Azure drops a bookmark', () => {
    const sprite = questionSprite(sample);
    const marks = new Map<string, number>([
      ['q|s', 0.1],
      ['q|e', 2.0],
      ['a0|s', 2.8],
      ['a0|e', 3.4],
      ['a1|s', 3.9], // a1|e missing → next start
      ['a2|s', 5.0],
      ['a2|e', 5.6],
      ['a3|s', 6.1], // a3|e missing (the last one) → end of file
    ]);
    const spans = resolveSpans(sprite, marks, 8);
    expect(spans.get('a1')).toEqual([3.87, 4.97]);
    expect(spans.get('a3')).toEqual([6.07, 6.92]); // no tail mark → end of file − 1.2 s
    // With the closing word's bookmark at 7.3 s and a 450 ms pause before it, speech ended ≈ 6.85 s.
    expect(resolveSpans(sprite, new Map([...marks, ['__tail', 7.3]]), 8).get('a3')).toEqual([
      6.07, 6.97,
    ]);
    expect(() => resolveSpans(sprite, new Map(), 8)).toThrow(/missing bookmark/);
  });

  it('escapes XML and normalizes text for speech', () => {
    const ssml = buildSsml({
      id: 't',
      file: 't.mp3',
      items: [
        { mark: 'x', text: 'A & B < C, „1 000 000 €“', role: 'host', style: 'neutral', pause: 300 },
      ],
    });
    expect(ssml).toContain('A &amp; B &lt; C, 1000000 евро');
    expect(ssml).not.toContain('„');
  });

  it('switches to the female voice only for female friends', () => {
    const ssml = buildSsml({
      id: 'f',
      file: 'f.mp3',
      items: [
        { mark: 'a', text: 'Здравей', role: 'host', style: 'neutral', pause: 300 },
        { mark: 'b', text: 'Здрасти', role: 'female', style: 'friend', pause: 300 },
      ],
    });
    expect(ssml).toMatch(/BorislavNeural.*KalinaNeural/);
  });
});

describe('the whole plan', () => {
  it('fits the free Azure tier and keeps every request small', async () => {
    const root = resolve(import.meta.dirname, '../public/questions');
    const bank = await loadQuestionBank('/', async (url) =>
      JSON.parse(readFileSync(resolve(root, url.slice(1)), 'utf8')),
    );
    const plan = buildPlan(bank.questions);
    const stats = planStats(plan);

    expect(stats.questions).toBe(bank.questions.length);
    expect(stats.characters).toBeLessThan(500_000); // the free monthly allowance
    for (const sprite of plan) {
      expect(buildSsml(sprite).length).toBeLessThan(60_000);
      expect(sprite.items.length).toBeLessThanOrEqual(12);
    }
    expect(new Set(plan.map((s) => s.id)).size).toBe(plan.length);
  });

  it('question sprites carry the hash used to detect edits', () => {
    const sprite = questionSprite(sample);
    expect(sprite.question?.hash).toBe(questionHash(sample));
    const edited = {
      ...sample,
      answers: ['Дунав', 'Рейн', 'Волга', 'Днестър'] as CategorizedQuestion['answers'],
    };
    expect(questionHash(edited)).not.toBe(questionHash(sample));
  });

  it('answer marks map to the JSON order', () => {
    const sprite = questionSprite(sample);
    const index = sample.correct as AnswerIndex;
    expect(sprite.items[index + 1]!.text).toBe('В: Волга');
  });
});
