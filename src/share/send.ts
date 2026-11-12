/**
 * 결과를 실제로 내보낸다: 휴대폰에서는 공유 창을 열고, 공유 창이 없는 브라우저에서는 문구와 주소를 복사한다.
 * 어떤 방법을 쓸지는 link.ts의 pickShareMethod가 정한다.
 */
import { pickShareMethod, type ShareAbility, type ShareOutcome } from './link';

export interface SharePayload {
  /** 공유 창의 제목 */
  title: string;
  /** 같이 보내는 한 줄 */
  text: string;
  /** 그 게임을 바로 여는 주소 */
  url: string;
  /** 점수 카드 그림. 아직 만들지 못했으면 null이고, 그때는 그림 없이 보낸다. */
  image: File | null;
}

/** navigator에서 쓰는 부분. 테스트에서는 가짜를 넣는다. */
export interface ShareHost {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/** 이 브라우저가 할 수 있는 것을 알아본다. 그림이 없으면 파일 공유는 묻지 않는다. */
export function abilityOf(host: ShareHost, image: File | null): ShareAbility {
  const text = typeof host.share === 'function';
  let files = false;
  if (text && image !== null && typeof host.canShare === 'function') {
    try {
      files = host.canShare({ files: [image] });
    } catch {
      files = false;
    }
  }
  return { files, text, clipboard: typeof host.clipboard?.writeText === 'function' };
}

/** 사용자가 공유 창을 그냥 닫았을 때 브라우저가 내는 오류인지 */
function isCancel(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function copy(host: ShareHost, message: string): Promise<ShareOutcome> {
  try {
    if (typeof host.clipboard?.writeText !== 'function') return 'failed';
    await host.clipboard.writeText(message);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * 결과를 내보낸다. 버튼을 누른 그 자리에서 불러야 한다(브라우저는 사용자가 누른 직후에만 공유 창을 허락한다).
 * 공유 창이 거절당하면 문구와 주소를 복사하는 것으로 물러난다.
 */
export async function sendShare(payload: SharePayload, host: ShareHost = navigator): Promise<ShareOutcome> {
  const method = pickShareMethod(abilityOf(host, payload.image), payload.image !== null);
  const message = `${payload.text}\n${payload.url}`;
  if (method === 'none') return 'failed';
  if (method === 'copy') return copy(host, message);

  try {
    if (method === 'image' && payload.image !== null) {
      // 그림과 함께 보낼 때는 주소를 글 안에 넣는다. 주소를 따로 주면 글을 버리는 앱이 있다.
      await host.share?.({ files: [payload.image], title: payload.title, text: message });
    } else {
      await host.share?.({ title: payload.title, text: payload.text, url: payload.url });
    }
    return 'shared';
  } catch (error) {
    if (isCancel(error)) return 'cancelled';
    return copy(host, message);
  }
}
