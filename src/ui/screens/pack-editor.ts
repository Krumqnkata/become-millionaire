import { cloudErrorMessage, type CloudService } from '../../cloud/index.ts';
import { ANSWER_LETTERS } from '../../game/lifelines.ts';
import {
  draftProblems,
  emptyDraft,
  emptyQuestion,
  PACK_LIMITS,
  parseQuestions,
  VISIBILITY,
  type Pack,
  type PackDraft,
  type PackQuestion,
  type Visibility,
} from '../../game/packs.ts';
import type { AnswerIndex, Difficulty } from '../../game/types.ts';
import { backTo, signInCard, withCloud } from '../components/cloud-ui.ts';
import { openModal } from '../components/modal.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, replace } from '../dom.ts';
import { icon } from '../icons.ts';

const DIFFICULTY_NAMES = ['', 'Лесен', 'Среден', 'Труден', 'Много труден', 'Експертен'];

const copyDraft = (pack: Pack | null): PackDraft =>
  pack
    ? {
        title: pack.title,
        description: pack.description,
        visibility: pack.visibility,
        questions: pack.questions.map((q) => ({
          ...q,
          answers: [...q.answers] as PackQuestion['answers'],
        })),
      }
    : emptyDraft();

/** Accepts a list of questions or a whole category file (`{ "questions": [...] }`). */
function questionsFromJson(text: string): PackQuestion[] {
  const data: unknown = JSON.parse(text);
  const list =
    typeof data === 'object' && data !== null && 'questions' in data ? data.questions : data;
  return parseQuestions(list);
}

export function packEditorScreen(ctx: AppContext, existing: Pack | null): Screen {
  const draft = copyDraft(existing);
  let packId = existing?.id ?? null;
  let dirty = false;
  let saving = false;
  const touch = () => {
    dirty = true;
    renderStatus();
  };

  const back = backTo('Моите въпроси', () => leave(() => ctx.go.myPacks()));
  const body = h('div', { class: 'editor' });

  // ── Pack details ───────────────────────────────────────────────────────────
  const titleInput = h('input', {
    type: 'text',
    class: 'input',
    maxLength: PACK_LIMITS.title,
    placeholder: 'Например: „Нашият клас“ или „Рожденият ден на Мария“',
    value: draft.title,
    'aria-label': 'Име на пакета',
    onInput: () => ((draft.title = titleInput.value), touch()),
  });
  const descriptionInput = h('textarea', {
    class: 'input textarea',
    rows: 2,
    maxLength: PACK_LIMITS.description,
    placeholder: 'За какво са въпросите? (по желание)',
    value: draft.description,
    'aria-label': 'Описание',
    onInput: () => ((draft.description = descriptionInput.value), touch()),
  });
  const visibilityOptions = (Object.keys(VISIBILITY) as Visibility[]).map((v) =>
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'visibility',
        value: v,
        checked: draft.visibility === v,
        onChange: () => ((draft.visibility = v), touch()),
      }),
      h(
        'span',
        { class: 'choice__body' },
        h('strong', null, icon(VISIBILITY[v].icon), VISIBILITY[v].name),
        h('small', null, VISIBILITY[v].hint),
      ),
    ),
  );

  // ── Questions ──────────────────────────────────────────────────────────────
  const list = h('ol', { class: 'q-list' });
  const counter = h('p', { class: 'editor__count' });

  function renderQuestions(focusIndex?: number) {
    replace(
      list,
      draft.questions.map((q, i) => questionCard(q, i)),
    );
    renderStatus();
    if (focusIndex !== undefined)
      list.querySelectorAll<HTMLTextAreaElement>('.q-card__question')[focusIndex]?.focus();
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= draft.questions.length) return;
    const [q] = draft.questions.splice(from, 1);
    if (q) draft.questions.splice(to, 0, q);
    dirty = true;
    renderQuestions();
    list.querySelectorAll<HTMLElement>('.q-card')[to]?.scrollIntoView({ block: 'nearest' });
  }

  function questionCard(q: PackQuestion, index: number): HTMLElement {
    const name = `correct-${index}`;
    const questionInput = h('textarea', {
      class: 'input textarea q-card__question',
      rows: 2,
      maxLength: PACK_LIMITS.question,
      placeholder: 'Текстът на въпроса',
      value: q.question,
      'aria-label': `Въпрос ${index + 1}`,
      onInput: () => ((q.question = questionInput.value), touch()),
    });

    const answers = q.answers.map((answer, a) => {
      const input = h('input', {
        type: 'text',
        class: 'input',
        maxLength: PACK_LIMITS.answer,
        placeholder: a === q.correct ? 'Верният отговор' : 'Грешен отговор',
        value: answer,
        'aria-label': `Отговор ${ANSWER_LETTERS[a]} на въпрос ${index + 1}`,
        onInput: () => ((q.answers[a] = input.value), touch()),
      });
      return h(
        'div',
        { class: 'q-answer' },
        h(
          'label',
          { class: 'q-answer__pick', title: 'Маркирай като верен' },
          h('input', {
            type: 'radio',
            name,
            checked: q.correct === a,
            'aria-label': `${ANSWER_LETTERS[a]} е верният отговор`,
            onChange: () => {
              q.correct = a as AnswerIndex;
              card
                .querySelectorAll<HTMLInputElement>('.q-answer .input')
                .forEach(
                  (el, i) => (el.placeholder = i === a ? 'Верният отговор' : 'Грешен отговор'),
                );
              touch();
            },
          }),
          h('span', { class: 'q-answer__letter' }, ANSWER_LETTERS[a]),
        ),
        input,
      );
    });

    const difficulty = h(
      'select',
      {
        class: 'select select--sm',
        'aria-label': `Трудност на въпрос ${index + 1}`,
        onChange: () => ((q.difficulty = Number(difficulty.value) as Difficulty), touch()),
      },
      [1, 2, 3, 4, 5].map((d) =>
        h('option', { value: d, selected: q.difficulty === d }, `${d} · ${DIFFICULTY_NAMES[d]}`),
      ),
    );

    const explanation = h('input', {
      type: 'text',
      class: 'input',
      maxLength: PACK_LIMITS.explanation,
      placeholder: 'Обяснение след отговора (по желание)',
      value: q.explanation ?? '',
      'aria-label': `Обяснение към въпрос ${index + 1}`,
      onInput: () => ((q.explanation = explanation.value), touch()),
    });

    const tool = (label: SVGElement, title: string, onClick: () => void, disabled = false) =>
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn icon-btn--sm',
          title,
          'aria-label': title,
          disabled,
          onClick,
        },
        label,
      );

    const card = h(
      'li',
      { class: 'card q-card' },
      h(
        'div',
        { class: 'q-card__head' },
        h('span', { class: 'q-card__num' }, `Въпрос ${index + 1}`),
        difficulty,
        h(
          'span',
          { class: 'q-card__tools' },
          tool(icon('arrow-up'), 'Премести нагоре', () => move(index, index - 1), index === 0),
          tool(
            icon('arrow-down'),
            'Премести надолу',
            () => move(index, index + 1),
            index === draft.questions.length - 1,
          ),
          tool(icon('copy'), 'Дублирай', () => {
            draft.questions.splice(index + 1, 0, {
              ...q,
              answers: [...q.answers] as PackQuestion['answers'],
            });
            dirty = true;
            renderQuestions(index + 1);
          }),
          tool(icon('trash'), 'Изтрий въпроса', () => {
            draft.questions.splice(index, 1);
            if (draft.questions.length === 0) draft.questions.push(emptyQuestion());
            dirty = true;
            renderQuestions();
          }),
        ),
      ),
      questionInput,
      h('div', { class: 'q-answers' }, answers),
      explanation,
    );
    return card;
  }

  const addButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost',
      onClick: () => {
        if (draft.questions.length >= PACK_LIMITS.maxQuestions) return;
        draft.questions.push(emptyQuestion());
        dirty = true;
        renderQuestions(draft.questions.length - 1);
      },
    },
    '＋ Добави въпрос',
  );

  // ── Import / export ────────────────────────────────────────────────────────
  function importJson() {
    const area = h('textarea', {
      class: 'input textarea textarea--code',
      rows: 10,
      placeholder:
        '[{ "question": "…", "answers": ["…", "…", "…", "…"], "correct": 0, "difficulty": 2 }]',
      'aria-label': 'JSON с въпроси',
    });
    const status = h('p', { class: 'notice__error', role: 'alert' });
    const file = h('input', {
      type: 'file',
      accept: '.json,application/json',
      class: 'file-input',
      onChange: async () => {
        const f = file.files?.[0];
        if (f) area.value = await f.text();
      },
    });
    const close = openModal({
      title: 'Внеси въпроси от JSON',
      body: [
        h(
          'p',
          { class: 'hint' },
          'Постави списък с въпроси или цял файл от играта (с поле "questions"). Въпросите се добавят след твоите.',
        ),
        file,
        area,
        status,
      ],
      actions: [
        { label: 'Отказ' },
        {
          label: 'Добави',
          variant: 'primary',
          keepOpen: true,
          onClick: () => {
            let found: PackQuestion[];
            try {
              found = questionsFromJson(area.value);
            } catch {
              status.textContent = 'Това не е валиден JSON.';
              return;
            }
            if (found.length === 0) {
              status.textContent = 'Не намерих нито един валиден въпрос.';
              return;
            }
            const kept = draft.questions.filter(
              (q) => q.question.trim() !== '' || q.answers.some((a) => a.trim() !== ''),
            );
            draft.questions = [...kept, ...found].slice(0, PACK_LIMITS.maxQuestions);
            dirty = true;
            renderQuestions();
            close();
          },
        },
      ],
    });
  }

  function exportJson() {
    const data = JSON.stringify({ name: draft.title, questions: draft.questions }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = h('a', { href: url, download: `${draft.title.trim() || 'paket'}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  const problemsBox = h('div', { class: 'editor__problems', role: 'alert' });
  const saveButton = h(
    'button',
    { type: 'button', class: 'btn btn--primary', onClick: () => void save() },
    icon('save'),
    'Запази',
  );
  let service: CloudService | null = null;

  function renderStatus() {
    const n = draft.questions.length;
    counter.textContent =
      n >= PACK_LIMITS.minToPlay
        ? `${n} въпроса · готов за игра`
        : `${n} от ${PACK_LIMITS.minToPlay} въпроса, нужни за игра`;
    counter.classList.toggle('is-ready', n >= PACK_LIMITS.minToPlay);
    addButton.disabled = n >= PACK_LIMITS.maxQuestions;
  }

  async function save() {
    if (!service || saving) return;
    const problems = draftProblems(draft);
    if (problems.length > 0) {
      replace(
        problemsBox,
        h('strong', null, 'Още малко:'),
        h(
          'ul',
          null,
          problems.slice(0, 8).map((p) => h('li', null, p)),
        ),
        problems.length > 8 ? h('p', null, `…и още ${problems.length - 8}.`) : null,
      );
      problemsBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Запазваме…';
    replace(problemsBox);
    try {
      packId = await service.savePack(packId, draft);
      dirty = false;
      ctx.audio.play('select');
      ctx.go.myPacks();
    } catch (e) {
      console.error(e);
      replace(problemsBox, h('strong', null, cloudErrorMessage(e)));
    } finally {
      saving = false;
      saveButton.disabled = false;
      saveButton.replaceChildren(icon('save'), 'Запази');
    }
  }

  const leaveWarning = () =>
    dirty ? 'Имаш незапазени промени. Ако излезеш, ще се загубят.' : null;
  function leave(go: () => void) {
    const warning = leaveWarning();
    if (!warning) return go();
    openModal({
      title: 'Да изляза ли без запазване?',
      body: h('p', null, warning),
      actions: [{ label: 'Остани' }, { label: 'Излез', variant: 'danger', onClick: go }],
    });
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty) event.preventDefault();
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  const form = h(
    'div',
    { class: 'editor__form' },
    h(
      'div',
      { class: 'card editor__meta' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Име на пакета'),
        titleInput,
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Описание'),
        descriptionInput,
      ),
      h(
        'fieldset',
        { class: 'field choices' },
        h('legend', { class: 'field__label' }, 'Кой го вижда'),
        visibilityOptions,
      ),
    ),
    h(
      'div',
      { class: 'editor__bar' },
      counter,
      h(
        'span',
        { class: 'editor__io' },
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onClick: importJson },
          icon('upload'),
          'Внеси JSON',
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onClick: exportJson },
          icon('download'),
          'Изнеси',
        ),
      ),
    ),
    list,
    addButton,
    problemsBox,
    h('div', { class: 'editor__save' }, saveButton),
  );

  const stop = withCloud(ctx, body, (s, user) => {
    service = s;
    if (!user) {
      replace(body, signInCard(s, 'Влез с профила си, за да запазваш пакети.'));
      return;
    }
    if (!body.contains(form)) {
      replace(body, form);
      renderQuestions();
    }
  });

  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, existing ? 'Редактиране' : 'Нов пакет'),
    body,
  );

  return {
    el,
    focus: back,
    leaveWarning,
    destroy: () => {
      stop();
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
