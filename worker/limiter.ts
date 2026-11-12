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

/** 주소를 알 수 없는 요청은 모두 이 이름으로 함께 센다. */
const UNKNOWN_PLACE = 'unknown';

/** 16진수 네 자리까지로 된 IPv6 주소의 한 마디인지 */
const isHexGroup = (group: string): boolean => /^[0-9a-f]{1,4}$/.test(group);

/**
 * 요청을 셀 때 "같은 곳"으로 묶는 이름을 주소에서 만든다.
 * IPv4 주소는 그대로 쓴다. IPv6 주소는 앞 64비트만 쓴다. IPv6에서는 집 한 곳이나 휴대폰 한 대가
 * 뒤 64비트를 마음대로 바꿔 쓸 수 있어서, 주소 전체로 세면 주소를 바꿔 가며 한도를 피할 수 있다.
 * IPv4 주소를 품은 모양(::ffff:1.2.3.4)이나 읽을 수 없는 주소는 묶지 않고 받은 글자 그대로 쓴다.
 */
export function placeOf(address: string | null): string {
  const text = (address ?? '').trim().toLowerCase();
  if (text === '') return UNKNOWN_PLACE;
  if (!text.includes(':') || text.includes('.')) return text;

  const halves = text.split('::');
  if (halves.length > 2) return text;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length < 2 || halves[1] === '' ? [] : halves[1].split(':');
  // "::"은 0으로 된 마디가 한 개 이상 줄어든 자리다.
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (head.length + gap + tail.length !== 8 || (halves.length === 2 && gap < 1)) return text;

  const front = [...head, ...new Array<string>(gap).fill('0'), ...tail].slice(0, 4);
  if (![...head, ...tail].every(isHexGroup)) return text;
  return `${front.map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
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
