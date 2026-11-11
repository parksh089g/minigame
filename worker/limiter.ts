/**
 * 같은 곳에서 너무 자주 오는 요청을 걸러 낸다.
 * 세는 값은 메모리에만 두고 어디에도 저장하지 않는다. 서버가 쉬었다 깨어나면 처음부터 다시 센다.
 */

interface Window {
  /** 이 구간이 시작된 시각(ms) */
  start: number;
  count: number;
}

/** 이보다 많이 쌓이면 지난 구간의 기록을 치운다. */
const SWEEP_AT = 2000;

export class Limiter {
  private readonly windows = new Map<string, Window>();

  /**
   * key가 windowMs 동안 limit번까지만 지나가게 한다. 지나가도 되면 true.
   * 정해진 구간마다 새로 세는 단순한 방식이라, 구간이 바뀌는 순간에는 잠깐 두 배까지 지나갈 수 있다.
   */
  allow(key: string, limit: number, windowMs: number, now: number): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.start >= windowMs) {
      if (this.windows.size >= SWEEP_AT) this.sweep(now, windowMs);
      this.windows.set(key, { start: now, count: 1 });
      return limit >= 1;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  get size(): number {
    return this.windows.size;
  }

  /** 가장 긴 구간(maxWindowMs)보다 오래된 기록을 치운다. 그래도 넘치면 모두 비운다. */
  private sweep(now: number, windowMs: number): void {
    const maxWindowMs = Math.max(windowMs, LONGEST_WINDOW_MS);
    for (const [key, window] of this.windows) {
      if (now - window.start >= maxWindowMs) this.windows.delete(key);
    }
    if (this.windows.size >= SWEEP_AT) this.windows.clear();
  }
}

/** 아래 규칙 가운데 가장 긴 구간. 이보다 오래된 기록은 어느 규칙에도 쓰이지 않는다. */
const LONGEST_WINDOW_MS = 60 * 60 * 1000;

/** 요청 종류마다의 한도: [횟수, 구간(ms)] */
export const LIMITS = {
  /** 랭킹 보기 */
  read: [60, 60 * 1000],
  /** 점수 올리기 */
  submit: [20, 60 * 1000],
  /** 랭킹에 처음 오르는 기기. 한 곳에서 이름을 마구 만들어 올리는 것을 막는다. */
  newcomer: [10, LONGEST_WINDOW_MS],
  /** 옮기기 코드 만들기 */
  stash: [6, 10 * 60 * 1000],
  /** 옮기기 코드 넣기. 코드를 마구 넣어 맞히는 것을 막는다. */
  take: [12, 10 * 60 * 1000],
} as const satisfies Record<string, readonly [number, number]>;

export type LimitKind = keyof typeof LIMITS;
