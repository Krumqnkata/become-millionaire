import { describe, expect, it } from 'vitest';
import { bankFromDocuments, decodeValue } from '../src/cloud/bank.ts';

const str = (v: string) => ({ stringValue: v });
const question = (id: string) => ({
  mapValue: {
    fields: {
      id: str(id),
      difficulty: { integerValue: '2' },
      question: str('Кой?'),
      answers: { arrayValue: { values: [str('А'), str('Б'), str('В'), str('Г')] } },
      correct: { integerValue: '1' },
    },
  },
});

describe('Firestore REST decoding', () => {
  it('turns typed values into plain JSON', () => {
    expect(decodeValue({ integerValue: '7' })).toBe(7);
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
    expect(decodeValue({ mapValue: { fields: { a: { booleanValue: true } } } })).toEqual({
      a: true,
    });
  });

  it('builds a bank in category order and skips empty or broken categories', () => {
    const bank = bankFromDocuments([
      {
        name: 'x/categories/b',
        fields: {
          name: str('Б'),
          icon: str('atom'),
          order: { integerValue: '2' },
          questions: { arrayValue: { values: [question('b-1')] } },
        },
      },
      {
        name: 'x/categories/a',
        fields: {
          name: str('А'),
          icon: str('landmark'),
          order: { integerValue: '1' },
          questions: { arrayValue: { values: [question('a-1'), { stringValue: 'боклук' }] } },
        },
      },
      {
        name: 'x/categories/empty',
        fields: {
          name: str('Празна'),
          order: { integerValue: '0' },
          questions: { arrayValue: {} },
        },
      },
    ]);
    expect(bank?.categories.map((c) => c.id)).toEqual(['a', 'b']);
    expect(bank?.questions.map((q) => `${q.category}:${q.id}`).sort()).toEqual(['a:a-1', 'b:b-1']);
  });

  it('returns null when there are no questions at all', () => {
    expect(bankFromDocuments([])).toBeNull();
  });
});
