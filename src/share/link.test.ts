import { describe, expect, it } from 'vitest';
import { GAMES } from '../games/registry';
import {
  displayHost,
  pickShareMethod,
  SHARE_PARAM,
  sharedDay,
  sharedGame,
  sharedGameId,
  shareFileName,
  shareNotice,
  shareText,
  shareTitle,
  shareUrl,
  withoutShareParam,
} from './link';

describe('공유 주소 만들기', () => {
  it('앱 주소에 게임 id를 쿼리로 붙인다', () => {
    expect(shareUrl('https://example.com/', 'path-link')).toBe('https://example.com/?game=path-link');
  });

  it('하위 경로에 올린 앱도 그 경로를 지킨다', () => {
    expect(shareUrl('https://example.com/arcade/', 'duel')).toBe('https://example.com/arcade/?game=duel');
  });

  it('지금 주소에 붙어 있던 쿼리와 해시는 버린다', () => {
    expect(shareUrl('https://example.com/?utm=1&game=old#top', 'block-fill')).toBe(
      'https://example.com/?game=block-fill',
    );
  });

  it('만든 주소에서 같은 id를 다시 꺼낼 수 있다', () => {
    for (const game of GAMES) {
      const url = new URL(shareUrl('https://example.com/', game.id));
      expect(sharedGameId(url.search), game.id).toBe(game.id);
    }
  });
});

describe('그날의 판을 가리키는 주소', () => {
  it('날을 주면 게임 id 뒤에 붙인다', () => {
    expect(shareUrl('https://example.com/?x=1#top', 'lantern-keeper', 20770)).toBe(
      'https://example.com/?game=lantern-keeper&day=20770',
    );
    // 날을 주지 않으면 예전과 같은 주소다.
    expect(shareUrl('https://example.com/', 'lantern-keeper')).toBe('https://example.com/?game=lantern-keeper');
  });

  it('만든 주소에서 같은 날을 다시 꺼낼 수 있다', () => {
    const url = new URL(shareUrl('https://example.com/', 'lantern-keeper', 20770));
    expect(sharedDay(url.search)).toBe(20770);
    expect(sharedGameId(url.search)).toBe('lantern-keeper');
  });

  it('날이 없거나 날의 모양이 아니면 null이다', () => {
    expect(sharedDay('')).toBeNull();
    expect(sharedDay('?game=lantern-keeper')).toBeNull();
    for (const bad of ['', 'abc', '-3', '1.5', '1e3', '12345678', ' 5']) {
      expect(sharedDay(`?day=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
    expect(sharedDay('?day=0')).toBe(0);
  });

  it('주소창에서 지울 때 날도 같이 지운다', () => {
    expect(withoutShareParam('/', '?game=lantern-keeper&day=20770', '')).toBe('/');
    expect(withoutShareParam('/', '?a=1&day=20770&game=duel', '#x')).toBe('/?a=1#x');
  });
});

describe('공유받은 주소 읽기', () => {
  it('쿼리에서 게임 id를 꺼낸다', () => {
    expect(sharedGameId('?game=chosung-quiz')).toBe('chosung-quiz');
    expect(sharedGameId('?a=1&game=merge-tiles&b=2')).toBe('merge-tiles');
  });

  it('표시가 없으면 null이다', () => {
    expect(sharedGameId('')).toBeNull();
    expect(sharedGameId('?other=1')).toBeNull();
  });

  it('id 모양이 아닌 값은 버린다', () => {
    for (const bad of ['', 'Path-Link', 'a b', '../x', '<script>', 'a'.repeat(41), '한글']) {
      expect(sharedGameId(`?${SHARE_PARAM}=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
  });

  it('목록에 있는 플레이할 수 있는 게임을 찾는다', () => {
    const game = sharedGame('?game=path-link', GAMES);
    expect(game?.id).toBe('path-link');
    expect(game?.sceneKey).toBe('PathLink');
  });

  it('목록의 모든 게임을 주소로 열 수 있다', () => {
    for (const game of GAMES) {
      if (game.sceneKey === null) continue;
      expect(sharedGame(`?game=${game.id}`, GAMES)?.sceneKey, game.id).toBe(game.sceneKey);
    }
  });

  it('목록에 없는 id이면 null이다', () => {
    expect(sharedGame('?game=no-such-game', GAMES)).toBeNull();
    expect(sharedGame('', GAMES)).toBeNull();
  });

  it('아직 플레이할 수 없는 게임이면 null이다', () => {
    const games = [
      { id: 'ready', sceneKey: 'Ready' },
      { id: 'soon', sceneKey: null },
    ];
    expect(sharedGame('?game=soon', games)).toBeNull();
    expect(sharedGame('?game=ready', games)?.sceneKey).toBe('Ready');
  });
});

describe('주소창에서 공유 표시 지우기', () => {
  it('공유 표시만 있으면 경로만 남는다', () => {
    expect(withoutShareParam('/', '?game=path-link', '')).toBe('/');
    expect(withoutShareParam('/arcade/', '?game=duel', '')).toBe('/arcade/');
  });

  it('다른 쿼리와 해시는 남긴다', () => {
    expect(withoutShareParam('/', '?a=1&game=duel&b=2', '#x')).toBe('/?a=1&b=2#x');
  });

  it('공유 표시가 없으면 그대로다', () => {
    expect(withoutShareParam('/', '', '')).toBe('/');
    expect(withoutShareParam('/', '?a=1', '')).toBe('/?a=1');
  });
});

describe('보내는 문구', () => {
  it('게임 이름과 점수가 들어간다', () => {
    const text = shareText('길 잇기', 320);
    expect(text).toContain('길 잇기');
    expect(text).toContain('320점');
    expect(text).toContain('포켓 아케이드');
  });

  it('제목과 파일 이름', () => {
    expect(shareTitle('초성 퀴즈')).toBe('포켓 아케이드 초성 퀴즈');
    expect(shareFileName('block-fill')).toBe('pocket-arcade-block-fill.png');
  });

  it('카드에 적는 주소는 앞뒤 군더더기를 뗀다', () => {
    expect(displayHost('https://minigame.example.dev/?game=x#y')).toBe('minigame.example.dev');
    expect(displayHost('https://example.com/arcade/')).toBe('example.com/arcade');
    expect(displayHost('http://localhost:4173/')).toBe('localhost:4173');
  });
});

describe('보내는 방법 고르기', () => {
  const all = { files: true, text: true, clipboard: true };

  it('그림을 보낼 수 있고 그림이 준비됐으면 그림으로 보낸다', () => {
    expect(pickShareMethod(all, true)).toBe('image');
  });

  it('그림이 준비되지 않았으면 글과 주소만 보낸다', () => {
    expect(pickShareMethod(all, false)).toBe('link');
  });

  it('파일 공유가 안 되는 브라우저는 글과 주소만 보낸다', () => {
    expect(pickShareMethod({ ...all, files: false }, true)).toBe('link');
  });

  it('공유 창이 없으면 주소를 복사한다', () => {
    expect(pickShareMethod({ files: false, text: false, clipboard: true }, true)).toBe('copy');
  });

  it('아무것도 안 되면 방법이 없다', () => {
    expect(pickShareMethod({ files: false, text: false, clipboard: false }, true)).toBe('none');
  });
});

describe('공유한 뒤에 띄우는 말', () => {
  it('복사했을 때와 실패했을 때만 알린다', () => {
    expect(shareNotice('copied')).toBe('링크를 복사했어요');
    expect(shareNotice('failed')).toBe('공유하지 못했어요');
    expect(shareNotice('shared')).toBeNull();
    expect(shareNotice('cancelled')).toBeNull();
  });
});
