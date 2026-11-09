/**
 * Finds where each phrase of a voice sprite really starts and ends, from the audio itself.
 *
 * Azure's bookmark times are only approximate – after a number they can be ~2 s early – so they
 * are used only as hints. The audio is split into speech regions at silences, and the known number
 * of phrases is fitted onto them: boundaries go into the longest pauses (every phrase is followed
 * by an explicit break), with the bookmark hints and the expected length of each phrase breaking ties.
 */

export interface Region {
  start: number;
  end: number;
}

export interface SegmentItem {
  /** Rough start time from Azure's bookmark, if any. */
  hint?: number | undefined;
  /** Rough expected length of the speech, in seconds. */
  expected: number;
}

const WINDOW = 0.01; // 10 ms
/** Pauses shorter than this are part of a word (stop consonants, short breaths). */
const MIN_SILENCE = 0.12;
const MIN_REGION = 0.05;

/** Speech regions: loud stretches of audio separated by at least MIN_SILENCE of quiet. */
export function speechRegions(samples: Float32Array, sampleRate: number): Region[] {
  const win = Math.max(1, Math.round(sampleRate * WINDOW));
  const count = Math.floor(samples.length / win);
  const rms = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let k = w * win; k < (w + 1) * win; k++) sum += samples[k]! * samples[k]!;
    rms[w] = Math.sqrt(sum / win);
  }
  const sorted = Float32Array.from(rms).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = Math.max(0.003, p95 * 0.06); // ≈ −24 dB below the loud parts

  const regions: Region[] = [];
  let open: Region | null = null;
  let quietSince = -1;
  for (let w = 0; w < count; w++) {
    const t = w * WINDOW;
    if (rms[w]! >= threshold) {
      if (!open) open = { start: t, end: t + WINDOW };
      else open.end = t + WINDOW;
      quietSince = -1;
    } else if (open) {
      if (quietSince < 0) quietSince = t;
      if (t - quietSince >= MIN_SILENCE) {
        regions.push(open);
        open = null;
        quietSince = -1;
      }
    }
  }
  if (open) regions.push(open);
  return regions.filter((r) => r.end - r.start >= MIN_REGION);
}

/** Rough speaking time for a text: letters, plus extra for digits (numbers are read as words). */
export function expectedSeconds(text: string): number {
  const digits = (text.match(/\d/g) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const pauses = (text.match(/[.!?…:;,–]/g) ?? []).length;
  return 0.065 * letters + 0.32 * digits + 0.12 * pauses + 0.15;
}

const HINT_WEIGHT = 0.03; // per second of distance from the bookmark hint
const LENGTH_WEIGHT = 0.25; // per unit of |log(actual / expected)|

/**
 * Fits `items` onto `regions`: every item gets a consecutive, non-empty run of regions.
 * Maximizes the total length of the pauses used as boundaries, lightly guided by hints and
 * expected lengths. Returns [start, end] per item, or null if there are fewer regions than items.
 */
export function segment(
  regions: readonly Region[],
  items: readonly SegmentItem[],
): [number, number][] | null {
  const n = items.length;
  const r = regions.length;
  if (n === 0 || r < n) return null;

  const lengthCost = (item: SegmentItem, from: number, to: number) => {
    const actual = regions[to]!.end - regions[from]!.start;
    return (
      LENGTH_WEIGHT * Math.abs(Math.log(Math.max(actual, 0.05) / Math.max(item.expected, 0.2)))
    );
  };
  const hintCost = (item: SegmentItem, from: number) =>
    item.hint === undefined ? 0 : HINT_WEIGHT * Math.abs(regions[from]!.start - item.hint);
  const gapBefore = (from: number) =>
    from === 0 ? 0 : regions[from]!.start - regions[from - 1]!.end;

  // best[j][e] = best score with items 0..j assigned and item j ending at region e
  const best: number[][] = Array.from({ length: n }, () => new Array<number>(r).fill(-Infinity));
  const from: number[][] = Array.from({ length: n }, () => new Array<number>(r).fill(-1));

  for (let e = 0; e <= r - n; e++) {
    best[0]![e] = -lengthCost(items[0]!, 0, e) - hintCost(items[0]!, 0);
    from[0]![e] = 0;
  }
  for (let j = 1; j < n; j++) {
    for (let e = j; e <= r - (n - j); e++) {
      for (let s = j; s <= e; s++) {
        const prev = best[j - 1]![s - 1]!;
        if (prev === -Infinity) continue;
        const score = prev + gapBefore(s) - lengthCost(items[j]!, s, e) - hintCost(items[j]!, s);
        if (score > best[j]![e]!) {
          best[j]![e] = score;
          from[j]![e] = s;
        }
      }
    }
  }

  // The last item must end at the last region.
  const spans: [number, number][] = new Array(n);
  let e = r - 1;
  if (best[n - 1]![e] === -Infinity) return null;
  for (let j = n - 1; j >= 0; j--) {
    const s = from[j]![e]!;
    spans[j] = [regions[s]!.start, regions[e]!.end];
    e = s - 1;
  }
  return spans;
}

/** Adds a little air around each span without reaching into its neighbours. */
export function pad(
  spans: [number, number][],
  duration: number,
  // Soft onsets ("А", "Х…") sit below the loudness threshold, so start a bit earlier.
  lead = 0.12,
  tail = 0.15,
): [number, number][] {
  return spans.map(([start, end], i) => {
    const prevEnd = i > 0 ? spans[i - 1]![1] : 0;
    const nextStart = i < spans.length - 1 ? spans[i + 1]![0] : duration;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return [
      round(Math.max(prevEnd + (start - prevEnd) / 2, start - lead, 0)),
      round(Math.min(end + (nextStart - end) / 2, end + tail, duration)),
    ];
  });
}
