import { applyProgress, loadProgress, mergeProgress, onProgressChange } from '../storage/stats.ts';
import { cloud } from './index.ts';

/**
 * Keeps settings, statistics and the personal Hall of Fame in the player's account.
 * On sign-in the browser's and the account's progress are merged; after that every
 * change is saved (a couple of seconds later, so a burst of changes is one write).
 */

const SAVE_DELAY_MS = 2000;

export function startProgressSync(onMerged: () => void): void {
  if (!cloud.enabled) return;
  let stop: (() => void) | null = null;
  let generation = 0;

  cloud.onUser((user) => {
    stop?.();
    stop = null;
    const mine = ++generation;
    if (!user) return;

    void (async () => {
      try {
        const service = await cloud.load();
        const merged = mergeProgress(loadProgress(), await service.loadRemoteProgress());
        if (mine !== generation) return;
        applyProgress(merged);
        await service.saveRemoteProgress(merged);
        onMerged();

        let timer: ReturnType<typeof setTimeout> | undefined;
        const unsubscribe = onProgressChange(() => {
          clearTimeout(timer);
          timer = setTimeout(
            () => void service.saveRemoteProgress(loadProgress()).catch(console.warn),
            SAVE_DELAY_MS,
          );
        });
        stop = () => {
          clearTimeout(timer);
          unsubscribe();
        };
      } catch (error) {
        console.warn('Progress sync failed', error);
      }
    })();
  });
}
