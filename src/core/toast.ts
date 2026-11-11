/** 화면 아래에 잠깐 뜨는 안내 문구. 게임 캔버스 밖(DOM)에 그려서 어느 씬에서든 보인다. */

export interface ToastOptions {
  /** true면 사용자가 누를 때까지 남는다 */
  sticky?: boolean;
  onTap?: () => void;
  durationMs?: number;
  /** true면 플레이 중에도 바로 띄운다. 게임이 멈췄을 때처럼 미룰 수 없는 안내에만 쓴다. */
  urgent?: boolean;
}

interface ToastSpec {
  message: string;
  options: ToastOptions;
}

/** 플레이가 끝난 뒤 미뤄 둔 문구를 다시 띄우기까지의 여유(ms). "다시 하기"로 바로 이어질 때 깜빡이지 않게 한다. */
const RELEASE_DELAY_MS = 400;

let current: { element: HTMLElement; spec: ToastSpec } | null = null;
let hideTimer: number | undefined;
/** 플레이 중이라 띄우지 않고 미뤄 둔 문구. 누를 때까지 남는 문구만 미뤄 둔다. */
let waiting: ToastSpec | null = null;
let held = false;
let releaseTimer: number | undefined;

export function hideToast(): void {
  window.clearTimeout(hideTimer);
  current?.element.remove();
  current = null;
}

/**
 * 문구가 판단을 방해할 수 있는 동안(미니게임 플레이 중) 문구를 띄우지 않게 한다.
 * 문구는 화면 아래쪽을 덮고 그 자리의 터치를 가져가므로, 플레이 중에는 구슬이나 버튼을 가릴 수 있다.
 * 누를 때까지 남는 문구는 미뤄 두었다가 풀릴 때 다시 띄우고, 잠깐 뜨는 문구는 그냥 버린다.
 */
export function holdToasts(hold: boolean): void {
  window.clearTimeout(releaseTimer);
  if (hold) {
    held = true;
    if (current && !current.spec.options.urgent) {
      if (current.spec.options.sticky) waiting = current.spec;
      hideToast();
    }
    return;
  }
  releaseTimer = window.setTimeout(() => {
    held = false;
    const spec = waiting;
    waiting = null;
    if (spec && !current) showToast(spec.message, spec.options);
  }, RELEASE_DELAY_MS);
}

export function showToast(message: string, options: ToastOptions = {}): void {
  if (held && !options.urgent) {
    if (options.sticky) waiting = { message, options };
    return;
  }
  // 급한 안내가 떠 있으면 다른 문구가 그것을 밀어내지 못한다.
  if (current?.spec.options.urgent && !options.urgent) return;
  hideToast();

  const toast = document.createElement('button');
  toast.type = 'button';
  toast.className = 'toast';
  toast.textContent = message;
  toast.addEventListener('click', () => {
    hideToast();
    options.onTap?.();
  });

  document.body.appendChild(toast);
  current = { element: toast, spec: { message, options } };

  if (!options.sticky) {
    hideTimer = window.setTimeout(hideToast, options.durationMs ?? 3500);
  }
}
