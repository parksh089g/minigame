/**
 * 서비스 워커 등록과 오프라인 준비 상태.
 * 서비스 워커가 게임 파일을 모두 기기에 받아 두면 그때부터 인터넷 없이 실행된다.
 */
import { registerSW } from 'virtual:pwa-register';
import { showToast } from './toast';

/** unsupported: 서비스 워커 없음, preparing: 파일을 받는 중, ready: 오프라인 실행 가능 */
export type OfflineStatus = 'unsupported' | 'preparing' | 'ready';

type Listener = (status: OfflineStatus) => void;

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
    onRegisterError() {
      setStatus('unsupported');
    },
  });

  // 이전 방문에서 이미 설치된 경우에는 onOfflineReady가 다시 불리지 않는다.
  void navigator.serviceWorker.ready.then(() => setStatus('ready')).catch(() => undefined);
}
