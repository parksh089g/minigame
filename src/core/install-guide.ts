/**
 * 홈 화면에 추가하는 방법을 창으로 보여 준다. 기기에 맞는 글은 install.ts가 고른다.
 * 크롬처럼 브라우저가 설치 창을 띄울 수 있다고 알려 주는 곳에서는, 안내 대신 바로 설치하는 버튼도 둔다.
 */
import { showGuide } from './dialog';
import {
  appAddress,
  INSTALL_TITLE,
  installGuide,
  installPlatform,
  isInApp,
  kakaoExternalUrl,
  type InstallPlatform,
} from './install';
import { showToast } from './toast';

/** 브라우저가 "이 앱을 설치할 수 있다"고 알릴 때 주는 것. 표준 타입에는 아직 없다. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

/** 브라우저가 맡겨 둔 설치 창. 한 번 띄우면 다시 쓸 수 없다. */
let pending: InstallPromptEvent | null = null;

/**
 * 브라우저의 설치 알림을 받아 둔다. 알림은 페이지를 연 직후에 한 번 오므로 앱을 켤 때 바로 불러 둔다.
 * 브라우저가 스스로 띄우는 안내는 막지 않는다.
 */
export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    pending = event as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    pending = null;
    showToast('홈 화면에 추가했어요. 이제 아이콘으로 열 수 있어요.');
  });
}

/** 지금 이 기기와 브라우저 */
export function currentPlatform(): InstallPlatform {
  return installPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
}

/** 방법을 보여 주고, 닫을 때까지 기다린다. 부르는 쪽은 그동안 씬의 입력을 꺼 둔다(whileBlocked). */
export async function showInstallGuide(): Promise<void> {
  const platform = currentPlatform();
  const guide = installGuide(platform);
  const inApp = isInApp(platform);
  const prompt = inApp ? null : pending;
  const address = appAddress(window.location.href);

  const answer = await showGuide({
    title: INSTALL_TITLE,
    hint: guide.intro,
    steps: guide.steps,
    action: prompt ? '바로 설치' : platform === 'in-app-kakao' ? '다른 브라우저로 열기' : undefined,
    copy: inApp ? { label: '주소 복사', text: address } : undefined,
  });
  if (answer !== 'action') return;

  if (prompt) {
    pending = null;
    // 설치를 마치면 appinstalled가 알려 준다. 사용자가 그만두거나 브라우저가 거절해도 할 일은 없다.
    await prompt.prompt().catch(() => undefined);
  } else if (platform === 'in-app-kakao') {
    window.location.href = kakaoExternalUrl(address);
  }
}
