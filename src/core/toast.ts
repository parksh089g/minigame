/** 화면 아래에 잠깐 뜨는 안내 문구. 게임 캔버스 밖(DOM)에 그려서 어느 씬에서든 보인다. */

export interface ToastOptions {
  /** true면 사용자가 누를 때까지 남는다 */
  sticky?: boolean;
  onTap?: () => void;
  durationMs?: number;
}

let current: HTMLElement | null = null;
let hideTimer: number | undefined;

export function hideToast(): void {
  window.clearTimeout(hideTimer);
  current?.remove();
  current = null;
}

export function showToast(message: string, options: ToastOptions = {}): void {
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
  current = toast;

  if (!options.sticky) {
    hideTimer = window.setTimeout(hideToast, options.durationMs ?? 3500);
  }
}
