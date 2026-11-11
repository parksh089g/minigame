/**
 * 예상하지 못한 오류가 났을 때의 안내.
 * 씬 안에서 오류가 나면 화면이 멈춘 채 아무 표시도 없으므로, 새로고침할 수 있게 알려 준다.
 * 기록은 판이 끝날 때마다 바로 저장되어 있어서 새로고침해도 사라지지 않는다.
 */
import { showToast } from './toast';

export function initCrashNotice(): void {
  let shown = false;
  window.addEventListener('error', (event) => {
    // 그림이나 글꼴을 못 받은 경우에는 error 값이 없다. 코드에서 난 오류만 알린다.
    if (shown || !(event.error instanceof Error)) return;
    shown = true;
    showToast('문제가 생겼어요. 눌러서 새로고침', {
      sticky: true,
      urgent: true,
      onTap: () => window.location.reload(),
    });
  });
}
