import { describe, expect, it, vi } from 'vitest';
import { abilityOf, sendShare, type ShareHost, type SharePayload } from './send';

const image = new File(['x'], 'pocket-arcade-path-link.png', { type: 'image/png' });
const payload: SharePayload = {
  title: '포켓 아케이드 길 잇기',
  text: '포켓 아케이드 [길 잇기] 320점! 이 기록, 넘을 수 있을까요?',
  url: 'https://example.com/?game=path-link',
  image,
};
const message = `${payload.text}\n${payload.url}`;

function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('브라우저가 할 수 있는 것', () => {
  it('공유 창과 파일 공유, 클립보드를 따로 알아본다', () => {
    const host: ShareHost = {
      share: async () => {},
      canShare: () => true,
      clipboard: { writeText: async () => {} },
    };
    expect(abilityOf(host, image)).toEqual({ files: true, text: true, clipboard: true });
    expect(abilityOf({}, image)).toEqual({ files: false, text: false, clipboard: false });
  });

  it('그림이 없으면 파일 공유는 묻지 않는다', () => {
    const canShare = vi.fn(() => true);
    expect(abilityOf({ share: async () => {}, canShare }, null).files).toBe(false);
    expect(canShare).not.toHaveBeenCalled();
  });

  it('파일 공유를 묻다가 오류가 나면 안 되는 것으로 본다', () => {
    const host: ShareHost = {
      share: async () => {},
      canShare: () => {
        throw new TypeError('files');
      },
    };
    expect(abilityOf(host, image).files).toBe(false);
  });
});

describe('결과 내보내기', () => {
  it('파일을 보낼 수 있으면 그림과 함께, 주소는 글 안에 넣어 보낸다', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    const outcome = await sendShare(payload, { share, canShare: () => true });
    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const sent = share.mock.calls[0][0];
    expect(sent.files).toEqual([image]);
    expect(sent.text).toBe(message);
    expect(sent.url).toBeUndefined();
    expect(sent.title).toBe(payload.title);
  });

  it('파일을 보낼 수 없으면 글과 주소만 보낸다', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    const outcome = await sendShare(payload, { share, canShare: () => false });
    expect(outcome).toBe('shared');
    expect(share.mock.calls[0][0]).toEqual({ title: payload.title, text: payload.text, url: payload.url });
  });

  it('그림이 아직 없으면 글과 주소만 보낸다', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    const outcome = await sendShare({ ...payload, image: null }, { share, canShare: () => true });
    expect(outcome).toBe('shared');
    expect(share.mock.calls[0][0].files).toBeUndefined();
    expect(share.mock.calls[0][0].url).toBe(payload.url);
  });

  it('공유 창이 없으면 문구와 주소를 복사한다', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const outcome = await sendShare(payload, { clipboard: { writeText } });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(message);
  });

  it('사용자가 공유 창을 닫으면 아무것도 하지 않는다', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const host: ShareHost = {
      share: async () => {
        throw named('AbortError');
      },
      canShare: () => true,
      clipboard: { writeText },
    };
    expect(await sendShare(payload, host)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('공유 창이 거절당하면 복사로 물러난다', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const host: ShareHost = {
      share: async () => {
        throw named('NotAllowedError');
      },
      canShare: () => true,
      clipboard: { writeText },
    };
    expect(await sendShare(payload, host)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(message);
  });

  it('공유도 복사도 안 되면 실패다', async () => {
    expect(await sendShare(payload, {})).toBe('failed');
    const host: ShareHost = {
      share: async () => {
        throw named('NotAllowedError');
      },
      clipboard: {
        writeText: async () => {
          throw named('NotAllowedError');
        },
      },
    };
    expect(await sendShare(payload, host)).toBe('failed');
  });
});
