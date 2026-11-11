/**
 * 서비스 워커 등록과 오프라인 준비 상태.
 * 서비스 워커가 게임 파일을 모두 기기에 받아 두면 그때부터 인터넷 없이 실행된다.
 */
import { registerSW } from 'virtual:pwa-register';
import { showToast } from './toast';

/** unsupported: 서비스 워커 없음, preparing: 파일을 받는 중, ready: 오프라인 실행 가능 */
export type OfflineStatus = 'unsupported' | 'preparing' | 'ready';

type Listener = (status: OfflineStatus) => void;

/** 새 버전이 있는지 다시 물어보기까지 두는 가장 짧은 간격(ms) */
const UPDATE_CHECK_GAP_MS = 10 * 60 * 1000;

const supported = (): boolean => !import.meta.env.DEV && 'serviceWorker' in navigator;

let status: OfflineStatus = 'unsupported';
const listeners = new Set<Listener>();

function setStatus(next: OfflineStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(status);
}

export function getOfflineStatus(): OfflineStatus {
  return status;
}

export function onOfflineStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** 오프라인 기능이 준비되지 않아도 게임은 그대로 할 수 있어야 하므로, 실패는 상태로만 남긴다. */
export function initPwa(): void {
  if (!supported()) return;
  try {
    register();
  } catch {
    setStatus('unsupported');
  }
}

function register(): void {
  setStatus('preparing');

  const updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() {
      setStatus('ready');
      showToast('이제 오프라인에서도 플레이할 수 있어요');
    },
    onNeedRefresh() {
      showToast('새 버전이 있어요. 눌러서 업데이트', {
        sticky: true,
        onTap: () => void updateServiceWorker(true),
      });
    },
    onRegisteredSW(_scriptUrl, registration) {
      if (registration) watchForUpdates(registration);
    },
    onRegisterError() {
      setStatus('unsupported');
    },
  });

  // 이전 방문에서 이미 설치된 경우에는 onOfflineReady가 다시 불리지 않는다.
  void navigator.serviceWorker.ready.then(() => setStatus('ready')).catch(() => undefined);
}

/**
 * 새 버전이 올라왔는지 직접 물어본다.
 * 브라우저는 페이지를 새로 열 때만 확인하는데, 홈 화면에 설치한 앱은 며칠씩 켜진 채로 있어서 그 기회가 드물다.
 * 그래서 앱을 켰을 때와 다른 앱에서 돌아왔을 때 확인한다. 새 버전이 있으면 onNeedRefresh가 불린다.
 */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let lastCheckedAt = 0;
  const check = (): void => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastCheckedAt < UPDATE_CHECK_GAP_MS) return;
    lastCheckedAt = now;
    // 인터넷이 끊겼거나 서버가 잠깐 안 되면 실패한다. 다음 기회에 다시 물어보면 된다.
    registration.update().catch(() => undefined);
  };
  check();
  document.addEventListener('visibilitychange', check);
}
