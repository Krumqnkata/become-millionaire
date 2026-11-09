import { clearBankCache } from '../../cloud/bank.ts';
import { cloudErrorMessage, type CloudService, type CloudUser } from '../../cloud/index.ts';
import { ANSWER_LETTERS } from '../../game/lifelines.ts';
import { loadQuestionBank, validateQuestion } from '../../game/questions.ts';
import type { AnswerIndex, Difficulty, Question } from '../../game/types.ts';
import { backTo, errorBox, formatDate, loadingBox, withCloud } from '../components/cloud-ui.ts';
import { openModal } from '../components/modal.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, replace } from '../dom.ts';
import { icon, ICON_NAMES } from '../icons.ts';

type CategoryDoc = Awaited<ReturnType<CloudService['loadCategories']>>[number];

const DIFFICULTY_NAMES = ['', 'Лесен', 'Среден', 'Труден', 'Много труден', 'Експертен'];
const PAGE = 60;

const confirmModal = (title: string, text: string, label: string, onYes: () => void) =>
  openModal({
    title,
    body: h('p', null, text),
    actions: [{ label: 'Отказ' }, { label, variant: 'danger', onClick: onYes }],
  });

/**
 * The admin panel: the official questions (stored in Firestore) and reported packs.
 * Who is an admin is decided by the database (`admins/{uid}`), not by this screen.
 */
export function adminScreen(ctx: AppContext): Screen {
  const back = backTo('Моите въпроси', () => ctx.go.myPacks());
  const body = h('div', { class: 'admin' });

  const stop = withCloud(ctx, body, (service, user) => {
    if (!user) return replace(body, errorBox('Влез с профила си.'));
    replace(body, loadingBox());
    void service.isAdmin().then((admin) => (admin ? renderPanel(service) : renderNotAdmin(user)));
  });

  function renderNotAdmin(user: CloudUser) {
    replace(
      body,
      h(
        'div',
        { class: 'card notice' },
        h('p', null, 'Нямаш администраторски права.'),
        h(
          'p',
          { class: 'hint' },
          'Във Firebase → Firestore създай колекция „admins“ с документ, чието ID е твоето:',
        ),
        h('code', { class: 'uid' }, user.uid),
      ),
    );
  }

  function renderPanel(service: CloudService) {
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const pane = h('div', { class: 'admin__pane' });
    const tab = (label: string, iconName: string, render: () => void) => {
      const button = h(
        'button',
        {
          type: 'button',
          class: 'tab',
          role: 'tab',
          onClick: () => {
            tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
            button.setAttribute('aria-selected', 'true');
            render();
          },
        },
        icon(iconName),
        label,
      );
      return button;
    };
    const questionsTab = tab('Въпроси', 'book-open', () => void renderQuestions(service, pane));
    tabs.append(
      questionsTab,
      tab('Доклади', 'flag', () => void renderReports(service, pane)),
    );
    replace(body, tabs, pane);
    questionsTab.click();
  }

  // ── Official questions ─────────────────────────────────────────────────────

  async function renderQuestions(service: CloudService, pane: HTMLElement) {
    replace(pane, loadingBox('Зареждаме въпросите…'));
    let categories: CategoryDoc[];
    try {
      categories = await service.loadCategories();
    } catch (e) {
      return replace(pane, errorBox(cloudErrorMessage(e)));
    }
    if (categories.length === 0) return renderSeed(service, pane);

    let current = categories[0]!;
    let search = '';
    let shown = PAGE;

    const save = async (category: CategoryDoc, removed: string[] = []) => {
      await service.saveCategories(removed.length ? [] : [category], removed);
      clearBankCache();
      ctx.announce('Запазено');
    };

    const chips = h('div', { class: 'chips' });
    const list = h('div', { class: 'admin-list' });
    const searchInput = h('input', {
      type: 'search',
      class: 'input',
      placeholder: 'Търси във всички въпроси…',
      'aria-label': 'Търсене',
      onInput: () => {
        search = searchInput.value.trim().toLocaleLowerCase('bg');
        shown = PAGE;
        renderList();
      },
    });

    function renderChips() {
      replace(
        chips,
        categories.map((c) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              'aria-pressed': String(c === current && !search),
              onClick: () => {
                current = c;
                searchInput.value = search = '';
                shown = PAGE;
                renderChips();
                renderList();
              },
            },
            icon(c.icon),
            ` ${c.name} `,
            h('small', null, c.questions.length),
          ),
        ),
        h(
          'button',
          { type: 'button', class: 'chip chip--add', onClick: () => editCategory(null) },
          icon('plus'),
          'Категория',
        ),
      );
    }

    function renderList() {
      const matches: [CategoryDoc, Question][] = search
        ? categories.flatMap((c) =>
            c.questions
              .filter((q) =>
                [q.question, ...q.answers].some((t) => t.toLocaleLowerCase('bg').includes(search)),
              )
              .map((q): [CategoryDoc, Question] => [c, q]),
          )
        : current.questions.map((q): [CategoryDoc, Question] => [current, q]);

      replace(
        list,
        search
          ? null
          : h(
              'div',
              { class: 'admin-list__head' },
              h('strong', null, icon(current.icon), current.name),
              h(
                'span',
                { class: 'admin-list__tools' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    onClick: () => editCategory(current),
                  },
                  icon('pencil'),
                  'Категорията',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--primary btn--sm',
                    onClick: () => {
                      const q: Question = {
                        id: `${current.id}-${Date.now().toString(36)}`,
                        difficulty: 3,
                        question: '',
                        answers: ['', '', '', ''],
                        correct: 0,
                      };
                      list.querySelector('.admin-q-form')?.remove();
                      list
                        .querySelector('.admin-list__head')
                        ?.after(questionForm(current, q, true));
                    },
                  },
                  icon('plus'),
                  'Нов въпрос',
                ),
              ),
            ),
        matches.length === 0 ? h('p', { class: 'empty' }, 'Няма въпроси.') : null,
        matches.slice(0, shown).map(([c, q]) => questionRow(c, q)),
        matches.length > shown
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--sm admin-list__more',
                onClick: () => ((shown += PAGE), renderList()),
              },
              `Покажи още (${matches.length - shown})`,
            )
          : null,
      );
    }

    function questionRow(category: CategoryDoc, q: Question): HTMLElement {
      const row = h(
        'button',
        {
          type: 'button',
          class: 'admin-q',
          onClick: () => {
            list.querySelector('.admin-q-form')?.remove();
            row.after(questionForm(category, q, false));
          },
        },
        h(
          'span',
          { class: 'question__difficulty', 'aria-label': `Трудност ${q.difficulty}` },
          [1, 2, 3, 4, 5].map((d) => h('i', { class: d <= q.difficulty ? 'pip is-on' : 'pip' })),
        ),
        h('span', { class: 'admin-q__text' }, q.question),
        h('span', { class: 'admin-q__answer' }, icon('check'), q.answers[q.correct]),
        search ? h('span', { class: 'badge' }, category.name) : null,
      );
      return row;
    }

    function questionForm(category: CategoryDoc, original: Question, isNew: boolean): HTMLElement {
      const q: Question = { ...original, answers: [...original.answers] as Question['answers'] };
      const status = h('p', { class: 'notice__error', role: 'alert' });
      const text = h('textarea', {
        class: 'input textarea',
        rows: 2,
        value: q.question,
        'aria-label': 'Въпрос',
      });
      const answers = q.answers.map((a, i) =>
        h('input', {
          type: 'text',
          class: 'input',
          value: a,
          'aria-label': `Отговор ${ANSWER_LETTERS[i]}`,
        }),
      );
      const correct = q.answers.map((_, i) =>
        h('input', {
          type: 'radio',
          name: `admin-correct-${q.id}`,
          checked: q.correct === i,
          'aria-label': `${ANSWER_LETTERS[i]} е верният`,
        }),
      );
      const difficulty = h(
        'select',
        { class: 'select select--sm', 'aria-label': 'Трудност' },
        [1, 2, 3, 4, 5].map((d) =>
          h('option', { value: d, selected: q.difficulty === d }, `${d} · ${DIFFICULTY_NAMES[d]}`),
        ),
      );
      const explanation = h('input', {
        type: 'text',
        class: 'input',
        value: q.explanation ?? '',
        placeholder: 'Обяснение (по желание)',
        'aria-label': 'Обяснение',
      });

      const form = h(
        'div',
        { class: 'card q-card admin-q-form' },
        h(
          'div',
          { class: 'q-card__head' },
          h('span', { class: 'q-card__num' }, isNew ? 'Нов въпрос' : q.id),
          difficulty,
        ),
        text,
        h(
          'div',
          { class: 'q-answers' },
          answers.map((input, i) =>
            h(
              'div',
              { class: 'q-answer' },
              h(
                'label',
                { class: 'q-answer__pick' },
                correct[i],
                h('span', { class: 'q-answer__letter' }, ANSWER_LETTERS[i]),
              ),
              input,
            ),
          ),
        ),
        explanation,
        status,
        h(
          'div',
          { class: 'admin-q-form__actions' },
          isNew
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost btn--sm',
                  onClick: () =>
                    confirmModal(
                      'Да изтрия ли въпроса?',
                      `„${q.question}“ ще изчезне от играта.`,
                      'Изтрий',
                      () => {
                        const index = category.questions.findIndex((x) => x.id === q.id);
                        if (index < 0) return;
                        const [removed] = category.questions.splice(index, 1);
                        save(category)
                          .then(() => (renderChips(), renderList()))
                          .catch((e) => {
                            if (removed) category.questions.splice(index, 0, removed);
                            status.textContent = cloudErrorMessage(e);
                          });
                      },
                    ),
                },
                icon('trash'),
                'Изтрий',
              ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => form.remove() },
            'Отказ',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--primary btn--sm',
              onClick: () => {
                const edited = {
                  id: q.id,
                  difficulty: Number(difficulty.value) as Difficulty,
                  question: text.value,
                  answers: answers.map((a) => a.value),
                  correct: Math.max(
                    0,
                    correct.findIndex((r) => r.checked),
                  ) as AnswerIndex,
                  ...(explanation.value.trim() ? { explanation: explanation.value } : {}),
                };
                const { value, errors } = validateQuestion(edited, 'Въпросът');
                if (!value) return (status.textContent = errors.join(' · '));
                const index = category.questions.findIndex((x) => x.id === q.id);
                const before = [...category.questions];
                if (index < 0) category.questions.unshift(value);
                else category.questions[index] = value;
                save(category)
                  .then(() => (renderChips(), renderList()))
                  .catch((e) => {
                    category.questions = before;
                    status.textContent = cloudErrorMessage(e);
                  });
              },
            },
            icon('save'),
            'Запази',
          ),
        ),
      );
      setTimeout(() => text.focus(), 0);
      return form;
    }

    function editCategory(category: CategoryDoc | null) {
      const name = h('input', {
        type: 'text',
        class: 'input',
        value: category?.name ?? '',
        maxLength: 60,
        'aria-label': 'Име',
      });
      const id = h('input', {
        type: 'text',
        class: 'input',
        value: category?.id ?? '',
        disabled: Boolean(category),
        placeholder: 'id на латиница, напр. music',
        'aria-label': 'id',
      });
      const iconSelect = h(
        'select',
        { class: 'select', 'aria-label': 'Икона' },
        ICON_NAMES.map((n) =>
          h('option', { value: n, selected: (category?.icon ?? 'lightbulb') === n }, n),
        ),
      );
      const preview = h('span', { class: 'admin-icon-preview' }, icon(iconSelect.value));
      iconSelect.addEventListener('change', () => preview.replaceChildren(icon(iconSelect.value)));
      const status = h('p', { class: 'notice__error', role: 'alert' });

      const close = openModal({
        title: category ? 'Категория' : 'Нова категория',
        body: h(
          'div',
          { class: 'settings' },
          h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Име'), name),
          h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'id'), id),
          h(
            'label',
            { class: 'field' },
            h('span', { class: 'field__label' }, 'Икона'),
            h('span', { class: 'settings__row' }, preview, iconSelect),
          ),
          status,
        ),
        actions: [
          ...(category
            ? [
                {
                  label: 'Изтрий категорията',
                  variant: 'danger' as const,
                  keepOpen: true,
                  onClick: () => {
                    if (category.questions.length > 0) {
                      status.textContent = 'Първо премести или изтрий въпросите в нея.';
                      return;
                    }
                    save(category, [category.id])
                      .then(() => {
                        close();
                        void renderQuestions(service, pane);
                      })
                      .catch((e) => (status.textContent = cloudErrorMessage(e)));
                  },
                },
              ]
            : []),
          { label: 'Отказ' },
          {
            label: 'Запази',
            variant: 'primary',
            keepOpen: true,
            onClick: () => {
              const newId = id.value.trim();
              if (!name.value.trim()) return void (status.textContent = 'Липсва име.');
              if (!category && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(newId))
                return void (status.textContent =
                  'id трябва да е с малки латински букви и тирета.');
              if (!category && categories.some((c) => c.id === newId))
                return void (status.textContent = 'Такава категория вече има.');
              const target: CategoryDoc = category ?? {
                id: newId,
                name: '',
                icon: '',
                order: Math.max(0, ...categories.map((c) => c.order)) + 1,
                questions: [],
              };
              target.name = name.value.trim();
              target.icon = iconSelect.value;
              save(target)
                .then(() => {
                  if (!category) {
                    categories.push(target);
                    current = target;
                  }
                  close();
                  renderChips();
                  renderList();
                })
                .catch((e) => (status.textContent = cloudErrorMessage(e)));
            },
          },
        ],
      });
    }

    replace(
      pane,
      h(
        'p',
        { class: 'hint' },
        'Промените са веднага в базата. Играчите ги виждат при следващото отваряне на играта. Записаният глас за нов или променен въпрос се прави с npm run voice.',
      ),
      searchInput,
      chips,
      list,
    );
    renderChips();
    renderList();
  }

  /** First run: copy the questions shipped with the site into the database. */
  function renderSeed(service: CloudService, pane: HTMLElement) {
    const status = h('p', { class: 'notice__error', role: 'alert' });
    const button = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onClick: async () => {
          button.disabled = true;
          status.textContent = '';
          try {
            const bank = await loadQuestionBank(`${import.meta.env.BASE_URL}questions/`);
            const docs: CategoryDoc[] = bank.categories.map((c, order) => ({
              id: c.id,
              name: c.name,
              icon: c.icon,
              order,
              questions: bank.questions
                .filter((q) => q.category === c.id)
                .map(({ category: _c, ...q }) => q),
            }));
            await service.saveCategories(docs);
            clearBankCache();
            void renderQuestions(service, pane);
          } catch (e) {
            console.error(e);
            status.textContent = cloudErrorMessage(e);
            button.disabled = false;
          }
        },
      },
      icon('upload'),
      `Качи ${ctx.bank.questions.length} въпроса в базата`,
    );
    replace(
      pane,
      h(
        'div',
        { class: 'card notice' },
        h('p', null, 'Официалните въпроси още не са в базата. Играта ползва вградените в сайта.'),
        button,
        status,
      ),
    );
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  async function renderReports(service: CloudService, pane: HTMLElement) {
    replace(pane, loadingBox('Зареждаме докладите…'));
    try {
      const reports = await service.listReports();
      if (reports.length === 0)
        return replace(pane, h('div', { class: 'card empty' }, 'Няма докладвани пакети.'));
      const titles = new Map<string, string | null>();
      await Promise.all(
        [...new Set(reports.map((r) => r.packId))].map((id) =>
          service
            .getPack(id)
            .then((p) => titles.set(id, p.title))
            .catch(() => titles.set(id, null)),
        ),
      );
      replace(
        pane,
        h(
          'div',
          { class: 'pack-list' },
          reports.map((r) => {
            const title = titles.get(r.packId);
            const row: HTMLElement = h(
              'article',
              { class: 'card pack-row' },
              h(
                'div',
                { class: 'pack-row__main' },
                h('h3', { class: 'pack-row__title' }, title ?? 'Пакетът вече е изтрит'),
                h('p', { class: 'pack-row__meta' }, `${formatDate(r.createdAt)} · ${r.reason}`),
              ),
              h(
                'div',
                { class: 'pack-row__actions' },
                title
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--ghost btn--sm',
                        onClick: () => ctx.go.pack(r.packId),
                      },
                      icon('play'),
                      'Отвори',
                    )
                  : null,
                title
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'btn btn--danger btn--sm',
                        onClick: () =>
                          confirmModal(
                            'Да изтрия ли пакета?',
                            `„${title}“ ще бъде изтрит за всички.`,
                            'Изтрий',
                            () =>
                              void service
                                .deletePack(r.packId)
                                .then(() => service.dismissReport(r.id))
                                .then(() => row.remove())
                                .catch((e) => alert(cloudErrorMessage(e))),
                          ),
                      },
                      icon('trash'),
                      'Изтрий пакета',
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    onClick: () => void service.dismissReport(r.id).then(() => row.remove()),
                  },
                  icon('check'),
                  'Наред е',
                ),
              ),
            );
            return row;
          }),
        ),
      );
    } catch (e) {
      replace(pane, errorBox(cloudErrorMessage(e)));
    }
  }

  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, icon('shield'), 'Администрация'),
    body,
  );
  return { el, focus: back, destroy: stop };
}
