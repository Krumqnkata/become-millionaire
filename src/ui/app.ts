import { ShowAudio } from '../audio/engine.ts';
import { Narrator } from '../audio/narrator.ts';
import { VoicePack } from '../audio/voice-pack.ts';
import { Voice } from '../audio/voice.ts';
import type { Game } from '../game/engine.ts';
import { formatPrize } from '../game/ladder.ts';
import { loadQuestionBank, type QuestionBank } from '../game/questions.ts';
import type { ModeId } from '../game/types.ts';
import { HOST } from '../show/script.ts';
import { loadSettings, saveSettings, type Settings } from '../storage/stats.ts';
import { Confetti } from './components/confetti.ts';
import { logoMark } from './components/logo.ts';
import { openModal } from './components/modal.ts';
import type { AppContext, Screen, StageState } from './context.ts';
import { h } from './dom.ts';
import {
  enterFullscreen,
  fullscreenSupported,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './fullscreen.ts';
import { gameScreen } from './screens/game.ts';
import { hallOfFameScreen, rulesScreen } from './screens/info.ts';
import { menuScreen } from './screens/menu.ts';
import { resultScreen } from './screens/result.ts';

/** Owns the persistent chrome (top bar, live region, confetti, audio) and swaps screens. */
export class App {
  private readonly stageEl: HTMLElement;
  private readonly live: HTMLElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly audio: ShowAudio;
  private readonly voice: Voice;
  private readonly pack = new VoicePack();
  private readonly narrator: Narrator;
  private readonly confetti: Confetti;
  private current: Screen | null = null;
  private ctx: AppContext | null = null;

  constructor(private readonly root: HTMLElement) {
    const settings = loadSettings();
    this.audio = new ShowAudio({ muted: settings.muted, music: settings.music });
    this.audio.setVolume(settings.volume);
    this.voice = new Voice(settings.voice && !settings.muted, settings.voiceName);
    this.narrator = new Narrator(this.voice, this.audio, this.pack, settings.recordedVoice);
    void this.audio.loadRecordings(import.meta.env.BASE_URL);

    this.muteButton = h('button', {
      type: 'button',
      class: 'icon-btn',
      onClick: () => this.toggleMute(),
      title: 'Звук (M)',
    });
    this.renderMute();

    // Fullscreen: a button in the top bar (where the browser supports it) and the F key.
    const fullscreenButton = h('button', {
      type: 'button',
      class: 'icon-btn',
      hidden: !fullscreenSupported(),
      onClick: () => void toggleFullscreen(),
    });
    const renderFullscreen = () => {
      const on = isFullscreen();
      fullscreenButton.textContent = on ? '🗗' : '⛶';
      fullscreenButton.title = on ? 'Изход от цял екран (F)' : 'Цял екран (F)';
      fullscreenButton.setAttribute('aria-label', on ? 'Изход от цял екран' : 'Цял екран');
      document.documentElement.classList.toggle('is-fullscreen', on);
    };
    renderFullscreen();
    onFullscreenChange(renderFullscreen);

    const settingsButton = h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        onClick: () => this.openSettings(),
        title: 'Настройки',
        'aria-label': 'Настройки',
      },
      '⚙️',
    );

    const home = h(
      'button',
      {
        type: 'button',
        class: 'brand',
        onClick: () => this.confirmLeave(),
        'aria-label': 'Към менюто',
      },
      logoMark(30),
      h('span', { class: 'brand__name' }, 'Пътят към ', h('span', { class: 'gold' }, 'милиона')),
    );

    this.stageEl = h('main', { class: 'stage', id: 'main' });
    this.live = h('div', { class: 'sr-only', 'aria-live': 'assertive', role: 'status' });
    const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
    this.confetti = new Confetti(canvas);

    root.replaceChildren(
      h(
        'header',
        { class: 'topbar' },
        home,
        h('div', { class: 'topbar__actions' }, fullscreenButton, settingsButton, this.muteButton),
      ),
      this.stageEl,
      h(
        'footer',
        { class: 'footer' },
        'Оригинална куиз игра · Направено с ❤ и TypeScript · ',
        h(
          'a',
          {
            href: 'https://github.com/Krumqnkata/become-millionaire',
            target: '_blank',
            rel: 'noopener',
          },
          'Код в GitHub',
        ),
      ),
      this.live,
      canvas,
    );

    // Browsers only allow audio after a user gesture: unlock it on the first one.
    // The same first gesture also switches to fullscreen, so the game fills the screen
    // as soon as the player starts (browsers don't allow it before any interaction).
    let firstGesture = true;
    const unlock = (event: Event) => {
      this.audio.unlock();
      if (this.root.dataset.screen === 'menu') this.audio.setBed('menu');
      const isEscape = event instanceof KeyboardEvent && event.key === 'Escape';
      // Only once: if the player leaves fullscreen, don't pull them back in.
      if (firstGesture && loadSettings().fullscreen && !isEscape) void enterFullscreen();
      firstGesture = false;
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.code === 'KeyM') this.toggleMute();
      if (event.code === 'KeyF') void toggleFullscreen();
    });
  }

  async boot(): Promise<void> {
    this.stageEl.replaceChildren(
      h(
        'div',
        { class: 'loading' },
        h('div', { class: 'loading__coin' }, logoMark(72)),
        h('p', null, 'Подготвяме студиото…'),
      ),
    );
    try {
      const [bank] = await Promise.all([
        loadQuestionBank(`${import.meta.env.BASE_URL}questions/`),
        this.pack.load(import.meta.env.BASE_URL),
      ]);
      this.ctx = this.createContext(bank);
      this.ctx.go.menu();
    } catch (error) {
      console.error(error);
      this.stageEl.replaceChildren(
        h(
          'div',
          { class: 'card error' },
          h('h1', null, 'Нещо се обърка 😕'),
          h('p', null, 'Въпросите не успяха да се заредят. Провери връзката и опитай пак.'),
          h(
            'button',
            { type: 'button', class: 'btn btn--primary', onClick: () => void this.boot() },
            'Опитай пак',
          ),
        ),
      );
    }
  }

  private createContext(bank: QuestionBank): AppContext {
    const ctx: AppContext = {
      bank,
      audio: this.audio,
      voice: this.voice,
      narrator: this.narrator,
      confetti: this.confetti,
      announce: (message) => {
        this.live.textContent = '';
        requestAnimationFrame(() => (this.live.textContent = message));
      },
      stage: (state: StageState, tier?: number) => {
        document.body.dataset.stage = state;
        if (tier !== undefined) document.body.dataset.tier = String(tier);
      },
      go: {
        menu: () => this.show('menu', menuScreen(ctx)),
        play: (mode: ModeId, categories: string[]) =>
          this.show('game', gameScreen(ctx, mode, categories)),
        result: (game: Game) => this.show('result', resultScreen(ctx, game)),
        rules: () => this.show('rules', rulesScreen(ctx)),
        hallOfFame: () => this.show('hall-of-fame', hallOfFameScreen(ctx)),
      },
    };
    return ctx;
  }

  private show(name: string, screen: Screen): void {
    this.current?.destroy?.();
    this.narrator.stop();
    this.current = screen;
    this.root.dataset.screen = name;
    if (name !== 'game') {
      this.ctx?.stage('idle', 1);
      this.audio.setBed(name === 'result' ? 'none' : 'menu');
    }
    this.stageEl.replaceChildren(screen.el);
    window.scrollTo({ top: 0 });
    screen.focus?.focus({ preventScroll: true });
  }

  /** Leaving a running game from the logo asks first. */
  private confirmLeave(): void {
    const leave = () => this.ctx?.go.menu();
    if (this.root.dataset.screen !== 'game') return leave();
    openModal({
      title: 'Да прекратиш ли играта?',
      body: h('p', null, 'Текущата игра ще бъде загубена и няма да се запише.'),
      actions: [{ label: 'Остани' }, { label: 'Към менюто', variant: 'danger', onClick: leave }],
    });
  }

  private toggleMute(): void {
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.voice.setEnabled(!muted && loadSettings().voice);
    saveSettings({ muted });
    this.renderMute();
    if (!muted) this.audio.play('click');
  }

  private renderMute(): void {
    this.muteButton.textContent = this.audio.muted ? '🔇' : '🔊';
    this.muteButton.setAttribute('aria-label', this.audio.muted ? 'Включи звука' : 'Изключи звука');
    this.muteButton.setAttribute('aria-pressed', String(this.audio.muted));
  }

  private openSettings(): void {
    const settings = loadSettings();
    const toggle = (
      key: keyof Settings,
      label: string,
      hint: string | null,
      onChange: (on: boolean) => void,
      disabled = false,
    ) => {
      const input = h('input', {
        type: 'checkbox',
        checked: Boolean(settings[key]),
        disabled,
        onChange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          saveSettings({ [key]: on } as Partial<Settings>);
          onChange(on);
        },
      });
      return h(
        'label',
        { class: `toggle toggle--row${disabled ? ' is-disabled' : ''}` },
        input,
        h('span', { class: 'toggle__ui', 'aria-hidden': 'true' }),
        h('span', { class: 'toggle__label' }, label, hint ? h('small', null, hint) : null),
      );
    };

    const volume = h('input', {
      type: 'range',
      class: 'range',
      min: 0,
      max: 100,
      value: Math.round(this.audio.currentVolume * 100),
      'aria-label': 'Сила на звука',
      onInput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        this.audio.setVolume(v);
        saveSettings({ volume: v });
      },
      onChange: () => this.audio.play('select'),
    });

    const noVoice = !this.voice.available && !this.pack.ready;
    openModal({
      title: '⚙️ Настройки',
      body: h(
        'div',
        { class: 'settings' },
        h('label', { class: 'settings__volume' }, '🔊 Сила на звука', volume),
        toggle('music', '🎵 Музика', null, (on) => this.audio.setMusic(on)),
        this.pack.ready
          ? toggle(
              'recordedVoice',
              '🎙️ Записан глас (Azure „Борислав“)',
              'Еднакво хубав във всеки браузър. Изключи, за да чуваш гласа на браузъра.',
              (on) => (this.narrator.recorded = on),
            )
          : null,
        this.voice.available ? this.voicePicker() : null,
        toggle(
          'voice',
          '🎙️ Гласът на водещия',
          noVoice
            ? 'Браузърът ти няма български глас. Пробвай с Microsoft Edge.'
            : 'Водещият говори на глас.',
          (on) => this.voice.setEnabled(on && !this.audio.muted),
          noVoice,
        ),
        toggle(
          'readQuestions',
          '📖 Водещият чете въпросите',
          'Таймерът тръгва, след като ги прочете.',
          () => {},
          noVoice,
        ),
        toggle(
          'confirmFinalAnswer',
          '❓ „Последен отговор?“',
          'Потвърждение, преди да заключиш.',
          () => {},
        ),
        fullscreenSupported()
          ? toggle(
              'fullscreen',
              '⛶ Цял екран при влизане',
              'Играта минава на цял екран при първото кликване. Изход: Esc или F.',
              (on) => void (on ? enterFullscreen() : undefined),
            )
          : null,
      ),
      actions: [{ label: 'Готово', variant: 'primary' }],
    });
  }

  /** A dropdown of the browser's Bulgarian voices with a "listen" button. */
  private voicePicker(): HTMLElement {
    const preferred = loadSettings().voiceName;
    const select = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Глас на водещия',
        onChange: () => {
          this.voice.setPreferred(select.value);
          saveSettings({ voiceName: select.value });
          void listen();
        },
      },
      h('option', { value: '' }, `Автоматично (${this.voice.voices[0]?.label ?? '—'})`),
      this.voice.voices.map((v) =>
        h(
          'option',
          { value: v.name, selected: v.name === preferred },
          `${v.natural ? '✨ ' : ''}${v.label}`,
        ),
      ),
    );
    const listen = async () => {
      const wasEnabled = this.voice.enabled;
      this.voice.enabled = true;
      await this.voice.speak(
        `Добър вечер! Аз съм ${HOST.name}. Въпрос за ${formatPrize(1_000_000)}.`,
      );
      this.voice.enabled = wasEnabled;
    };
    const best = this.voice.voices[0];
    return h(
      'div',
      { class: 'settings__voice' },
      h('span', { class: 'settings__label' }, '🗣️ Глас'),
      h(
        'div',
        { class: 'settings__row' },
        select,
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => void listen() },
          '▶ Чуй',
        ),
      ),
      best && !best.natural
        ? h(
            'small',
            { class: 'settings__hint' },
            'За най-естествен глас отвори играта в Microsoft Edge (гласът „Borislav Natural“).',
          )
        : null,
    );
  }
}
