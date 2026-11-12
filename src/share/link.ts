/**
 * 결과 공유의 규칙: 게임을 바로 여는 주소, 같이 보내는 문구, 보낼 방법 고르기.
 * 화면도 브라우저도 모르는 순수한 함수만 둔다. 그림은 card.ts가, 실제로 보내는 일은 send.ts가 맡는다.
 */

/** 공유 주소에서 게임을 가리키는 쿼리 이름. 한 번 보낸 주소는 계속 돌아다니므로 바꾸지 않는다. */
export const SHARE_PARAM = 'game';

/** 게임 id로 쓸 수 있는 글자. 주소에 아무 글자나 실려 와도 이 모양이 아니면 버린다. */
const GAME_ID = /^[a-z0-9-]{1,40}$/;

/**
 * 그 게임을 바로 여는 주소. pageUrl은 지금 앱이 열려 있는 주소이고, 거기 붙어 있던 쿼리와 해시는 버린다.
 * 예: https://example.com/arcade/?x=1#top 과 path-link 로 https://example.com/arcade/?game=path-link
 */
export function shareUrl(pageUrl: string, gameId: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set(SHARE_PARAM, gameId);
  return url.toString();
}

/** 주소의 쿼리(location.search)에서 공유받은 게임 id를 꺼낸다. 없거나 id 모양이 아니면 null이다. */
export function sharedGameId(search: string): string | null {
  const raw = new URLSearchParams(search).get(SHARE_PARAM);
  return raw !== null && GAME_ID.test(raw) ? raw : null;
}

/** 공유 주소로 열 수 있는 게임이 갖춰야 하는 것 */
interface Playable {
  id: string;
  sceneKey: string | null;
}

/**
 * 공유받은 주소가 가리키는 게임을 찾는다. 목록에 없거나 아직 플레이할 수 없는 게임이면 null이고,
 * 그때는 평소처럼 허브에서 시작하면 된다.
 */
export function sharedGame<T extends Playable>(
  search: string,
  games: readonly T[],
): (T & { sceneKey: string }) | null {
  const id = sharedGameId(search);
  if (id === null) return null;
  const game = games.find((candidate) => candidate.id === id);
  return game && game.sceneKey !== null ? (game as T & { sceneKey: string }) : null;
}

/**
 * 쿼리에서 공유 표시만 지운 주소(경로 + 남은 쿼리 + 해시). 게임을 연 뒤 주소창을 이것으로 바꿔 두면
 * 새로고침하거나 홈 화면에 추가했을 때 그 게임이 아니라 허브에서 시작한다.
 */
export function withoutShareParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHARE_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

/** 그림과 함께 보내는 한 줄. 게임 이름 뒤에 조사를 붙이지 않아서 받침에 따라 어색해지지 않는다. */
export function shareText(title: string, score: number): string {
  return `포켓 아케이드 [${title}] ${score}점! 이 기록, 넘을 수 있을까요?`;
}

/** 공유 창의 제목 */
export function shareTitle(title: string): string {
  return `포켓 아케이드 ${title}`;
}

/** 보내는 그림 파일의 이름 */
export function shareFileName(gameId: string): string {
  return `pocket-arcade-${gameId}.png`;
}

/** 주소를 카드에 적을 때의 모양: 앞의 https:// 와 끝의 빗금, 쿼리를 뗀다. */
export function displayHost(pageUrl: string): string {
  const url = new URL(pageUrl);
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.host}${path}`;
}

/** 이 브라우저가 할 수 있는 것 */
export interface ShareAbility {
  /** 그림 파일을 공유 창으로 보낼 수 있다 */
  files: boolean;
  /** 글과 주소를 공유 창으로 보낼 수 있다 */
  text: boolean;
  /** 클립보드에 글을 넣을 수 있다 */
  clipboard: boolean;
}

/** 보내는 방법. 'image'는 그림과 문구, 'link'는 문구와 주소만, 'copy'는 주소를 복사, 'none'은 방법이 없음 */
export type ShareMethod = 'image' | 'link' | 'copy' | 'none';

/**
 * 할 수 있는 것 가운데 가장 좋은 방법을 고른다. 그림이 준비되지 않았으면(hasImage가 false) 그림 없이 보낸다.
 * 공유 창이 없는 브라우저(대개 컴퓨터)에서는 주소를 복사해 준다.
 */
export function pickShareMethod(ability: ShareAbility, hasImage: boolean): ShareMethod {
  if (hasImage && ability.files) return 'image';
  if (ability.text) return 'link';
  if (ability.clipboard) return 'copy';
  return 'none';
}

/** 공유를 해 본 결과 */
export type ShareOutcome =
  /** 공유 창으로 넘겼다(그 뒤에 실제로 보냈는지는 알 수 없다) */
  | 'shared'
  /** 주소를 클립보드에 복사했다 */
  | 'copied'
  /** 사용자가 공유 창을 닫았다 */
  | 'cancelled'
  /** 방법이 없거나 브라우저가 거절했다 */
  | 'failed';

/** 결과에 따라 화면에 잠깐 띄울 말. 띄울 것이 없으면 null이다. */
export function shareNotice(outcome: ShareOutcome): string | null {
  if (outcome === 'copied') return '링크를 복사했어요';
  if (outcome === 'failed') return '공유하지 못했어요';
  return null;
}
