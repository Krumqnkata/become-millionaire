import type { SampleHandle } from '../../audio/engine.ts';
import { Game } from '../../game/engine.ts';
import { formatPrize, LEVEL_COUNT, prizeForLevel } from '../../game/ladder.ts';
import { ANSWER_LETTERS, FRIENDS, LIFELINES, type Friend } from '../../game/lifelines.ts';
import { MODES } from '../../game/modes.ts';
import type { AnswerIndex, LifelineId, ModeId } from '../../game/types.ts';
import { line, questionIntroKey, type LineKey, type LineVars } from '../../show/script.ts';
import { loadRecentQuestionIds, loadSettings } from '../../storage/stats.ts';
import { createHost, type HostMood } from '../components/host.ts';
import { createLadder } from '../components/ladder.ts';
import { audiencePanel, callPanel, friendPicker } from '../components/lifeline-panels.ts';
import { openModal } from '../components/modal.ts';
import { createTimer, type TimerView } from '../components/timer.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, prefersReducedMotion, replace, wait } from '../dom.ts';

const KEY_TO_ANSWER: Record<string, AnswerIndex> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
  KeyA: 0,
  KeyB: 1,
  KeyC: 2,
  KeyD: 3,
};

const DIFFICULTY_LABEL = ['', 'лесен', 'среден', 'труден', 'много труден', 'експертен'];

/** Each friend sounds a little different on the phone. */
const FRIEND_PITCH = new Map(
  FRIENDS.map((f, i) => [f.name, [1.35, 1.25, 0.75, 0.9, 1.2, 1.05][i] ?? 1]),
);

/** Levels 1–5, 6–10 and 11–15 get calmer or tenser music and lights. */
const tierOf = (level: number) => (level <= 5 ? 1 : level <= 10 ? 2 : 3);

/** Extra silence before the reveal grows with the stakes. */
const suspenseFor = (level: number) => (prefersReducedMotion() ? 300 : 500 + level * 90);

export function gameScreen(ctx: AppContext, modeId: ModeId, categories: string[]): Screen {
  const mode = MODES[modeId];
  const settings = loadSettings();
  const playerName = settings.playerName.trim();
  const game = new Game({
    mode,
    pool: ctx.bank.questions,
    categories: new Set(categories),
    recent: loadRecentQuestionIds(),
    // Recorded questions are read in their recorded order.
    shuffle: !ctx.narrator.usingRecordings,
  });
  const categoryById = new Map(ctx.bank.categories.map((c) => [c.id, c]));
  const host = createHost(ctx.narrator, ctx.audio);

  let timer: TimerView | null = null;
  let closeModal: (() => void) | null = null;
  let alive = true;
  /** Answers can be picked (question fully presented, nothing else going on). */
  let ready = false;
  /** A lifeline sequence is running. */
  let busy = false;
  /** After walking away: "which answer would you have given?" */
  let guessing = false;
  /** Bumped whenever a running sequence must be abandoned. */
  let seq = 0;
  let skipRequested = false;
  let idleTimer = 0;
  /** The drum roll playing while a big answer is locked. */
  let drum: SampleHandle | null = null;

  const readAloud = () => settings.readQuestions && ctx.narrator.canSpeak;
  const tier = () => tierOf(game.level);
  const letterOf = (i: AnswerIndex) => ANSWER_LETTERS[i];

  const vars = (extra: LineVars = {}): LineVars => ({
    ...(playerName ? { name: playerName } : {}),
    prize: formatPrize(prizeForLevel(game.level)),
    level: game.level,
    ...extra,
  });
  /**
   * The host says a line. `answer` is the answer the line talks about, so the recorded
   * voice can play it from the question's recording.
   */
  const say = (
    key: LineKey,
    extra: LineVars = {},
    mood: HostMood = 'neutral',
    answer?: AnswerIndex,
  ) =>
    host.say(line(key, vars(extra)), {
      mood,
      question: game.question,
      ...(answer !== undefined ? { answer } : {}),
    });

  /** Waits, unless the player asked to skip the current sequence. */
  const pause = async (ms: number) => {
    const end = performance.now() + ms;
    while (!skipRequested && performance.now() < end)
      await wait(Math.min(50, end - performance.now()));
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  const levelLabel = h('span', { class: 'status__level' });
  const prizeLabel = h('span', { class: 'status__prize' });
  const timerSlot = h('div', { class: 'status__timer' });
  const walkButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      onClick: () => confirmWalkAway(),
      title: 'Клавиш W',
    },
    '💰 Вземи парите',
  );
  const ladderToggle = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm ladder-toggle',
      'aria-expanded': 'false',
      onClick: () => toggleLadder(),
    },
    '🪜 Стълба',
  );

  const categoryChip = h('span', { class: 'question__category' });
  const difficultyBadge = h('span', { class: 'question__difficulty' });
  const questionText = h('h2', { class: 'question__text', tabIndex: -1 });
  const questionCard = h(
    'div',
    {
      class: 'card question is-veiled',
      onClick: () => skipSequence(),
      title: 'Кликни, за да пропуснеш четенето',
    },
    h('div', { class: 'question__meta' }, categoryChip, difficultyBadge),
    questionText,
  );

  const answerButtons = ([0, 1, 2, 3] as AnswerIndex[]).map((i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'answer is-pending',
        dataset: { index: String(i) },
        disabled: true,
        onClick: () => onAnswerClick(i),
      },
      h('span', { class: 'answer__letter', 'aria-hidden': 'true' }, ANSWER_LETTERS[i]),
      h('span', { class: 'answer__text' }),
    ),
  );
  const answers = h(
    'div',
    { class: 'answers', role: 'group', 'aria-label': 'Отговори' },
    answerButtons,
  );
  const actionBar = h('div', { class: 'action-bar', 'aria-live': 'polite' });

  const lifelineButtons = new Map<LifelineId, HTMLButtonElement>();
  for (const id of mode.lifelines) {
    lifelineButtons.set(
      id,
      h(
        'button',
        {
          type: 'button',
          class: `lifeline lifeline--${id}`,
          title: `${LIFELINES[id].name}: ${LIFELINES[id].description}`,
          'aria-label': LIFELINES[id].name,
          disabled: true,
          onClick: () => void onLifeline(id),
        },
        h('span', { class: 'lifeline__icon', 'aria-hidden': 'true' }, LIFELINES[id].icon),
        h('span', { class: 'lifeline__name' }, LIFELINES[id].name),
      ),
    );
  }
  const lifelines = h('div', { class: 'lifelines', role: 'group', 'aria-label': 'Жокери' }, [
    ...lifelineButtons.values(),
  ]);
  const panels = h('div', { class: 'panels' });

  const ladder = createLadder(mode);
  const ladderBackdrop = h('div', { class: 'ladder-backdrop', onClick: () => toggleLadder(false) });

  const el = h(
    'section',
    { class: `screen game game--${mode.id}` },
    h(
      'div',
      { class: 'game__main' },
      host.el,
      h(
        'div',
        { class: 'status card' },
        h('div', { class: 'status__info' }, levelLabel, prizeLabel),
        timerSlot,
        h('div', { class: 'status__actions' }, ladderToggle, walkButton),
      ),
      questionCard,
      answers,
      actionBar,
      lifelines,
      panels,
    ),
    ladderBackdrop,
    ladder.el,
  );

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderQuestion() {
    const q = game.question;
    const category = categoryById.get(q.category);
    levelLabel.textContent = `Въпрос ${game.level} от ${LEVEL_COUNT}`;
    prizeLabel.textContent = `за ${formatPrize(prizeForLevel(game.level))}${game.isSafeHaven ? ' 🔒' : ''}`;
    categoryChip.textContent = category ? `${category.icon} ${category.name}` : '';
    difficultyBadge.textContent = `${'★'.repeat(q.difficulty)}${'☆'.repeat(5 - q.difficulty)}`;
    difficultyBadge.title = `Трудност: ${DIFFICULTY_LABEL[q.difficulty]}`;
    difficultyBadge.setAttribute('aria-label', `Трудност ${q.difficulty} от 5`);
    questionText.textContent = q.question;
    questionCard.classList.add('is-veiled');

    answerButtons.forEach((btn, i) => {
      btn.className = 'answer is-pending';
      btn.disabled = true;
      btn.removeAttribute('aria-pressed');
      const text = btn.querySelector('.answer__text');
      if (text) text.textContent = q.answers[i] ?? '';
      btn.setAttribute('aria-label', `${ANSWER_LETTERS[i]}: ${q.answers[i]}`);
    });

    replace(actionBar);
    panels.replaceChildren();
    ladder.update(game.level, game.answered);
    renderLifelines();
    walkButton.textContent =
      game.answered > 0 ? `💰 Вземи ${formatPrize(game.currentPrize)}` : '💰 Вземи парите';
  }

  function renderSelection() {
    answerButtons.forEach((btn, i) => {
      const idx = i as AnswerIndex;
      btn.classList.toggle('is-selected', game.selected === idx);
      btn.setAttribute('aria-pressed', String(game.selected === idx));
      const hidden = game.hidden.has(idx);
      btn.classList.toggle('is-hidden', hidden);
      btn.disabled = hidden || btn.classList.contains('is-pending') || busy || !(ready || guessing);
    });
  }

  function renderLifelines() {
    lifelineButtons.forEach((btn, id) => {
      btn.disabled = !ready || busy || !game.canUseLifeline(id);
      btn.classList.toggle('is-used', game.usedLifelines.has(id));
    });
    walkButton.disabled = !ready || busy;
  }

  function setReady(value: boolean) {
    ready = value;
    renderSelection();
    renderLifelines();
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function startTimer() {
    timer?.stop();
    timerSlot.replaceChildren();
    if (!mode.timer) return;
    timer = createTimer(mode.timer, {
      onSecond: (left) => {
        if (left <= 10 && left > 0) ctx.audio.play('tick');
      },
      onExpire: () => void onTimeout(),
    });
    timerSlot.append(timer.el);
    timer.start();
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (mode.timer) return; // the clock already provides the pressure
    idleTimer = window.setTimeout(() => {
      if (ready && !busy && game.selected === null) void say('idle', {}, 'happy');
    }, 25_000);
  }

  // ── The show ───────────────────────────────────────────────────────────────
  const still = (mySeq: number) => alive && mySeq === seq;

  function skipSequence() {
    skipRequested = true;
    host.skip();
    ctx.narrator.stop();
  }

  async function intro() {
    const mySeq = ++seq;
    skipRequested = false;
    ctx.stage('intro', 1);
    ctx.audio.setBed('none');
    ctx.audio.play('intro');
    renderQuestion();
    for (const prefix of ['common-', 'level-1-', 'level-2-', 'friends-'])
      ctx.narrator.prefetch(prefix);
    ctx.narrator.prefetchQuestion(game.question);
    replace(
      actionBar,
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => skipSequence() },
        '⏭ Пропусни представянето',
      ),
    );
    await pause(1200);
    for (const key of ['welcome', 'rules'] as const) {
      if (!still(mySeq) || skipRequested) break;
      await say(key, {}, 'happy');
    }
    if (still(mySeq)) await presentQuestion();
  }

  /** Host announces the level, reads the question and reveals the answers one by one. */
  async function presentQuestion() {
    const mySeq = ++seq;
    skipRequested = false;
    setReady(false);
    renderQuestion();
    ctx.narrator.prefetchQuestion(game.question);
    ctx.narrator.prefetch(`level-${game.level + 1}-`);
    timerSlot.replaceChildren();
    ctx.stage('question', tier());
    ctx.audio.play('start');
    ctx.audio.setBed(`tier${tier()}` as const);

    replace(
      actionBar,
      h('p', { class: 'hint' }, 'Кликни въпроса или натисни Space, за да пропуснеш четенето.'),
    );
    await say(
      questionIntroKey(game.level, game.isSafeHaven, LEVEL_COUNT),
      {},
      tier() === 3 ? 'tense' : 'neutral',
    );
    if (!still(mySeq)) return;

    questionCard.classList.remove('is-veiled');
    questionCard.classList.remove('is-entering');
    void questionCard.offsetWidth;
    questionCard.classList.add('is-entering');
    if (readAloud() && !skipRequested) await ctx.narrator.readQuestion(game.question);
    else await pause(500);
    if (!still(mySeq)) return;

    for (const i of [0, 1, 2, 3] as AnswerIndex[]) {
      answerButtons[i]?.classList.remove('is-pending');
      if (skipRequested) continue;
      ctx.audio.play('reveal');
      if (readAloud()) await ctx.narrator.readAnswer(game.question, i);
      else await pause(260);
      if (!still(mySeq)) return;
    }
    answerButtons.forEach((b) => b.classList.remove('is-pending'));

    replace(actionBar);
    setReady(true);
    startTimer();
    scheduleIdle();
  }

  function onAnswerClick(index: AnswerIndex) {
    if (guessing) return void onGuess(index);
    if (!ready || busy || game.phase !== 'question' || game.hidden.has(index)) return;
    clearTimeout(idleTimer);
    if (!settings.confirmFinalAnswer || game.selected === index) {
      game.select(index);
      void lockIn();
      return;
    }
    game.select(index);
    ctx.audio.play('select');
    renderSelection();
    replace(
      actionBar,
      h(
        'div',
        { class: 'confirm' },
        h(
          'span',
          { class: 'confirm__text' },
          'Последен отговор? ',
          h('strong', null, `${letterOf(index)}: ${game.question.answers[index]}`),
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => void lockIn() },
          'Да, заключи',
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => cancelSelection() },
          'Не',
        ),
      ),
    );
    void say(
      'confirm',
      { letter: letterOf(index), answer: game.question.answers[index] },
      'neutral',
      index,
    );
  }

  function cancelSelection() {
    if (!ready || game.phase !== 'question') return;
    game.selected = null;
    renderSelection();
    replace(actionBar);
  }

  async function lockIn() {
    if (!ready || busy || game.phase !== 'question' || game.selected === null) return;
    const mySeq = ++seq;
    skipRequested = false;
    timer?.stop();
    clearTimeout(idleTimer);
    game.lockIn();
    setReady(false);
    const chosenIndex = game.selected;
    const chosen = answerButtons[chosenIndex];
    chosen?.classList.add('is-locked');
    ctx.stage('lock', tier());
    ctx.audio.play('lock');
    ctx.audio.setBed('suspense');
    replace(
      actionBar,
      h(
        'p',
        { class: 'suspense' },
        'Заключено ',
        h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
      ),
    );

    await say('lock', { letter: letterOf(chosenIndex) }, 'tense');
    if (!still(mySeq)) return;
    if (game.level >= 5 && Math.random() < 0.35 + game.level * 0.03) {
      await say('suspense', {}, 'tense');
      if (!still(mySeq)) return;
    }
    // From question 10 on, a real drum roll builds up to the reveal.
    if (game.level >= 10)
      drum = ctx.audio.sample('drumroll', { loop: true, gain: 0.5, fadeIn: 0.8 });
    await wait(suspenseFor(game.level) + (drum ? 1400 : 0));
    drum?.stop(0.06);
    drum = null;
    if (!still(mySeq)) return;

    const correct = game.reveal();
    ctx.audio.setBed('none');
    chosen?.classList.remove('is-locked');
    answerButtons[game.question.correct]?.classList.add('is-correct');
    if (correct) await onCorrect(mySeq);
    else {
      chosen?.classList.add('is-wrong');
      await onGameOver('wrong', mySeq);
    }
  }

  async function onCorrect(mySeq: number) {
    const won = game.phase === 'finished';
    const reachedSafeHaven = mode.safeHavens.includes(game.level);
    ladder.update(game.level, game.answered);

    if (won) {
      ctx.stage('win', 3);
      ctx.audio.play('win');
      ctx.confetti.celebrate();
      ctx.announce('Верен отговор! Спечели един милион евро!');
      replace(
        actionBar,
        explanation(),
        h(
          'button',
          { type: 'button', class: 'btn btn--primary', onClick: () => ctx.go.result(game) },
          '🏆 Към наградата',
        ),
      );
      await say('million', {}, 'happy');
      return;
    }

    ctx.stage('correct', tier());
    ctx.audio.play(reachedSafeHaven ? 'safe' : game.level >= 10 ? 'correctBig' : 'correct');
    if (reachedSafeHaven) ctx.confetti.burst(90, 0.5, 0.4);
    ctx.announce(`Верен отговор! Печелиш ${formatPrize(game.currentPrize)}.`);

    const next = h(
      'button',
      { type: 'button', class: 'btn btn--primary', onClick: () => goNext() },
      `Следващ въпрос за ${formatPrize(prizeForLevel(game.level + 1))}`,
      h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→'),
    );
    replace(
      actionBar,
      h(
        'div',
        { class: 'result-line result-line--good' },
        h(
          'strong',
          null,
          reachedSafeHaven
            ? `🔒 Сигурна сума! ${formatPrize(game.currentPrize)} са твои.`
            : `✔ Вярно! Имаш ${formatPrize(game.currentPrize)}.`,
        ),
      ),
      explanation(),
      next,
    );
    next.focus({ preventScroll: true });
    const key: LineKey = reachedSafeHaven ? 'safe' : game.level >= 10 ? 'correctBig' : 'correct';
    if (still(mySeq))
      await say(
        key,
        { answer: game.question.answers[game.question.correct] },
        'happy',
        game.question.correct,
      );
  }

  async function onGameOver(reason: 'wrong' | 'timeout', mySeq: number) {
    setReady(false);
    ctx.stage('wrong', tier());
    ctx.audio.setBed('none');
    ctx.audio.play('wrong');
    const q = game.question;
    answerButtons[q.correct]?.classList.add('is-correct');
    const correctText = `${letterOf(q.correct)}: ${q.answers[q.correct]}`;
    const headline = reason === 'timeout' ? '⏰ Времето изтече!' : '✖ Грешен отговор.';
    ctx.announce(`${headline} Верният отговор е ${correctText}.`);

    const toResult = h(
      'button',
      { type: 'button', class: 'btn btn--primary', onClick: () => ctx.go.result(game) },
      'Виж резултата',
      h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→'),
    );
    replace(
      actionBar,
      h(
        'div',
        { class: 'result-line result-line--bad' },
        h('strong', null, headline),
        ` Верният отговор е ${correctText}.`,
      ),
      explanation(),
      toResult,
    );
    toResult.focus({ preventScroll: true });

    const extra = {
      letter: letterOf(q.correct),
      answer: q.answers[q.correct],
      guaranteed: formatPrize(game.winnings),
    };
    await say(reason === 'timeout' ? 'timeout' : 'wrong', extra, 'sad', q.correct);
    if (still(mySeq)) await say(game.winnings > 0 ? 'wrongKeep' : 'wrongNothing', extra, 'neutral');
  }

  function explanation() {
    return game.question.explanation
      ? h('p', { class: 'explanation' }, '💡 ', game.question.explanation)
      : null;
  }

  function goNext() {
    if (game.phase !== 'correct') return;
    game.next();
    void presentQuestion();
  }

  async function onTimeout() {
    if (!ready || game.phase !== 'question') return;
    const mySeq = ++seq;
    closeModal?.();
    game.timeout();
    renderSelection();
    await onGameOver('timeout', mySeq);
  }

  // ── Lifelines ──────────────────────────────────────────────────────────────
  function pauseClock() {
    busy = true;
    timer?.stop();
    clearTimeout(idleTimer);
    renderLifelines();
    renderSelection();
  }

  function resumeClock() {
    busy = false;
    renderLifelines();
    renderSelection();
    if (ready && game.phase === 'question') {
      timer?.start();
      scheduleIdle();
    }
  }

  async function onLifeline(id: LifelineId) {
    if (!ready || busy || !game.canUseLifeline(id)) return;
    if (id === 'phone') return chooseFriend();
    const mySeq = seq;
    pauseClock();
    ctx.audio.play('lifeline');

    switch (id) {
      case 'fifty': {
        await say('fifty');
        if (!still(mySeq)) return;
        game.useLifeline('fifty');
        ctx.audio.play('fifty');
        renderSelection();
        if (game.selected === null) replace(actionBar);
        ctx.announce(`Остават ${game.availableAnswers.map(letterOf).join(' и ')}.`);
        break;
      }
      case 'audience': {
        const result = game.useLifeline('audience');
        if (result.id !== 'audience') return;
        const panel = audiencePanel(game.hidden);
        panels.append(panel.el);
        void say('audience');
        ctx.audio.play('keypad');
        await panel.run(result.votes);
        if (!still(mySeq)) return;
        ctx.announce(
          `Публиката: ${result.votes.map((v, i) => `${ANSWER_LETTERS[i]} ${v}%`).join(', ')}.`,
        );
        await say('audienceDone');
        break;
      }
      case 'switch': {
        await say('switch', {}, 'happy');
        if (!still(mySeq)) return;
        game.useLifeline('switch');
        busy = false;
        await presentQuestion();
        return;
      }
    }
    if (still(mySeq)) resumeClock();
  }

  function chooseFriend() {
    pauseClock();
    void say('phonePick');
    const cancel = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onClick: () => (picker.remove(), resumeClock()),
      },
      'Отказ',
    );
    const picker = friendPicker((friend) => {
      picker.remove();
      void phoneFriend(friend);
    });
    picker.append(cancel);
    panels.append(picker);
  }

  async function phoneFriend(friend: Friend) {
    const mySeq = seq;
    const result = game.useLifeline('phone', { friend });
    if (result.id !== 'phone') return;
    renderLifelines();
    const call = callPanel(friend);
    panels.append(call.el);
    ctx.audio.play('ring');
    await wait(1400);
    if (!still(mySeq)) return;

    ctx.audio.setBed('phone');
    await say('phoneCall', { friend: friend.name }, 'happy');
    if (!still(mySeq)) return;
    const clock = call.countdown(30);
    await wait(1500 + Math.random() * 2000);
    if (!still(mySeq)) return;

    call.showAnswer(result.call.message, result.call.confidence);
    ctx.announce(`${friend.name}: ${result.call.message}`);
    await host.say(result.call.message, {
      speaker: `${friend.avatar} ${friend.name}`,
      role: friend.gender,
      pitch: FRIEND_PITCH.get(friend.name) ?? 1,
    });
    call.end();
    await clock;
    if (!still(mySeq)) return;

    ctx.audio.setBed(`tier${tier()}` as const);
    await say('phoneEnd', { friend: friend.name });
    if (still(mySeq)) resumeClock();
  }

  // ── Walking away ───────────────────────────────────────────────────────────
  function confirmWalkAway() {
    if (!ready || busy || game.phase !== 'question' || closeModal) return;
    const amount = formatPrize(game.currentPrize);
    closeModal = openModal({
      title: 'Да вземеш ли парите?',
      body: h(
        'p',
        null,
        game.answered > 0
          ? ['Тръгваш си с ', h('strong', { class: 'gold' }, amount), '. Окончателно ли е?']
          : 'Все още нямаш печалба. Ако спреш сега, си тръгваш с 0 €.',
      ),
      actions: [
        { label: 'Продължавам', variant: 'ghost' },
        { label: `Вземи ${amount}`, variant: 'primary', onClick: () => void walkAway() },
      ],
      onClose: () => (closeModal = null),
    });
  }

  async function walkAway() {
    if (game.phase !== 'question') return;
    const mySeq = ++seq;
    timer?.stop();
    clearTimeout(idleTimer);
    game.walkAway();
    setReady(false);
    ctx.stage('walk', tier());
    ctx.audio.setBed('none');
    ctx.audio.play('walk');
    replace(
      actionBar,
      h(
        'button',
        { type: 'button', class: 'btn btn--primary', onClick: () => ctx.go.result(game) },
        'Към резултата →',
      ),
    );

    await say('walkAway', { prize: formatPrize(game.winnings) }, 'happy');
    if (!still(mySeq)) return;
    guessing = true;
    renderSelection();
    replace(
      actionBar,
      h(
        'p',
        { class: 'hint' },
        'Кой отговор щеше да дадеш? Избери, за да видиш дали щеше да познаеш.',
      ),
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctx.go.result(game) },
        'Пропусни',
      ),
    );
    await say('walkAwayAsk');
  }

  async function onGuess(index: AnswerIndex) {
    if (!guessing || game.hidden.has(index)) return;
    guessing = false;
    const mySeq = ++seq;
    renderSelection();
    const correct = game.question.correct;
    answerButtons[index]?.classList.add('is-selected');
    ctx.audio.play('lock');
    await wait(900);
    if (!still(mySeq)) return;
    answerButtons[correct]?.classList.add('is-correct');
    if (index !== correct) answerButtons[index]?.classList.add('is-wrong');
    ctx.audio.play(index === correct ? 'correct' : 'wrong');
    replace(
      actionBar,
      explanation(),
      h(
        'button',
        { type: 'button', class: 'btn btn--primary', onClick: () => ctx.go.result(game) },
        'Към резултата →',
      ),
    );
    await say(
      index === correct ? 'walkAwayRight' : 'walkAwayWrong',
      {},
      index === correct ? 'sad' : 'happy',
    );
  }

  // ── Misc ───────────────────────────────────────────────────────────────────
  function toggleLadder(force?: boolean) {
    const open = force ?? !el.classList.contains('is-ladder-open');
    el.classList.toggle('is-ladder-open', open);
    ladderToggle.setAttribute('aria-expanded', String(open));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (closeModal || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;

    const answer = KEY_TO_ANSWER[event.code];
    if (answer !== undefined) {
      event.preventDefault();
      onAnswerClick(answer);
      return;
    }
    switch (event.code) {
      case 'Space':
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        skipSequence();
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (event.target instanceof HTMLButtonElement) return; // let the focused button handle it
        if (game.phase === 'question' && game.selected !== null) void lockIn();
        else if (game.phase === 'correct') goNext();
        else if (game.phase === 'finished' && !guessing) ctx.go.result(game);
        break;
      case 'Escape':
        if (el.classList.contains('is-ladder-open')) toggleLadder(false);
        else cancelSelection();
        break;
      case 'KeyW':
        confirmWalkAway();
        break;
      case 'KeyL':
        toggleLadder();
        break;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  void intro();

  return {
    el,
    focus: questionText,
    destroy() {
      alive = false;
      seq++;
      timer?.stop();
      clearTimeout(idleTimer);
      host.stop();
      drum?.stop();
      closeModal?.();
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
