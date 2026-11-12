import { describe, expect, it } from 'vitest';
import {
  appAddress,
  INSTALL_TITLE,
  installGuide,
  installPlatform,
  installTip,
  isInApp,
  kakaoExternalUrl,
  type InstallPlatform,
} from './install';

/**
 * 주아 글꼴에 들어 있는 한글: KS X 1001의 완성형 2,350자.
 * EUC-KR에서 첫 바이트 0xB0~0xC8, 둘째 바이트 0xA1~0xFE인 글자가 바로 그것이다.
 */
function fontSyllables(): Set<string> {
  const decoder = new TextDecoder('euc-kr');
  const syllables = new Set<string>();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) {
      syllables.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  }
  return syllables;
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const GALAXY = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko)';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const PLATFORMS: InstallPlatform[] = [
  'ios-safari',
  'ios-browser',
  'android-chrome',
  'android-samsung',
  'android-browser',
  'in-app-kakao',
  'in-app',
  'desktop',
];

describe('기기와 브라우저 알아보기', () => {
  const of = (userAgent: string, maxTouchPoints = 5): InstallPlatform =>
    installPlatform({ userAgent, maxTouchPoints });

  it('아이폰의 사파리와 다른 브라우저를 가린다', () => {
    expect(of(`${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1`)).toBe('ios-safari');
    expect(of(`${IPHONE} CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1`)).toBe('ios-browser');
    expect(of(`${IPHONE} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`)).toBe('ios-browser');
    expect(of(`${IPHONE} Version/17.5 EdgiOS/126.0.2592.56 Mobile/15E148 Safari/605.1.15`)).toBe('ios-browser');
  });

  it('맥인 척하는 아이패드는 손가락을 받는지로 가린다', () => {
    expect(of(MAC_SAFARI, 5)).toBe('ios-safari');
    expect(of(MAC_SAFARI, 0)).toBe('desktop');
    expect(installPlatform({ userAgent: MAC_SAFARI })).toBe('desktop');
  });

  it('안드로이드의 크롬, 삼성 인터넷, 그 밖의 브라우저를 가린다', () => {
    expect(of(`${GALAXY} Chrome/126.0.0.0 Mobile Safari/537.36`)).toBe('android-chrome');
    expect(of(`${GALAXY} SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36`)).toBe('android-samsung');
    expect(of(`${GALAXY} Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0`)).toBe('android-browser');
    expect(of(`${GALAXY} Chrome/124.0.0.0 Whale/1.0.0.0 Mobile Safari/537.36`)).toBe('android-browser');
    expect(of('Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0')).toBe('android-browser');
  });

  it('카카오톡 안에서 열린 화면을 알아본다', () => {
    expect(of(`${IPHONE} Mobile/15E148 KAKAOTALK 11.0.0`)).toBe('in-app-kakao');
    expect(
      of(
        'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36 KAKAOTALK/11.0.0 (INAPP)',
      ),
    ).toBe('in-app-kakao');
  });

  it('다른 앱 안에서 열린 화면을 알아본다', () => {
    expect(of(`${GALAXY} Chrome/126.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.6.3)`)).toBe('in-app');
    expect(of(`${IPHONE} Mobile/15E148 Instagram 337.0.0.27.92 (iPhone14,5; iOS 17_5; ko_KR)`)).toBe('in-app');
    expect(of(`${IPHONE} Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.31.107;FBBV/611482356]`)).toBe('in-app');
    expect(of(`${IPHONE} Mobile/15E148 Safari/604.1 Line/14.9.0`)).toBe('in-app');
    // 이름을 밝히지 않은 앱도 안드로이드는 "wv"로, 아이폰은 "Safari"가 없는 것으로 알아본다.
    expect(
      of(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('in-app');
    expect(of(`${IPHONE} Mobile/15E148`)).toBe('in-app');
  });

  it('컴퓨터는 따로 본다', () => {
    expect(
      of(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        0,
      ),
    ).toBe('desktop');
    expect(of('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 0)).toBe('desktop');
    expect(of('', 0)).toBe('desktop');
  });

  it('앱 안의 화면만 밖으로 나가야 한다고 본다', () => {
    for (const platform of PLATFORMS) {
      expect(isInApp(platform), platform).toBe(platform === 'in-app' || platform === 'in-app-kakao');
    }
  });
});

describe('홈 화면에 추가하는 방법', () => {
  it('기기마다 두세 단계로 적혀 있다', () => {
    for (const platform of PLATFORMS) {
      const guide = installGuide(platform);
      expect(guide.intro.length, platform).toBeGreaterThan(0);
      expect(guide.steps.length, platform).toBeGreaterThanOrEqual(2);
      expect(guide.steps.length, platform).toBeLessThanOrEqual(3);
      for (const step of guide.steps) {
        expect(step.trim(), `${platform}: ${step}`).toBe(step);
        // 번호를 붙여 보여 주므로 마침표로 끝내지 않는다.
        expect(step.endsWith('.'), `${platform}: ${step}`).toBe(false);
      }
    }
  });

  it('앱 안의 화면에서는 먼저 브라우저로 나가라고 알린다', () => {
    expect(installGuide('in-app-kakao').intro).toContain('카카오톡');
    expect(installGuide('in-app-kakao').steps[0]).toContain('다른 브라우저로 열기');
    expect(installGuide('in-app').steps.join(' ')).toContain('복사');
    expect(installTip('in-app')).not.toBe(installTip('android-chrome'));
    expect(installTip('in-app-kakao')).toBe(installTip('in-app'));
  });

  it('허브의 도움말은 두 줄 안에 들어가는 길이다', () => {
    for (const platform of PLATFORMS) {
      expect(installTip(platform).length, platform).toBeLessThanOrEqual(42);
    }
  });

  it('글꼴에 들어 있는 한글만 쓴다', () => {
    const known = fontSyllables();
    expect(known.size).toBe(2350);
    const lines = [INSTALL_TITLE];
    for (const platform of PLATFORMS) {
      const guide = installGuide(platform);
      lines.push(guide.intro, ...guide.steps, installTip(platform));
    }
    for (const line of lines) {
      for (const letter of line.match(/[ㄱ-ㆎ가-힣]/g) ?? []) {
        expect(known.has(letter), `"${letter}" in "${line}"`).toBe(true);
      }
    }
  });
});

describe('주소', () => {
  it('공유 링크에 붙어 온 쿼리와 해시를 뗀다', () => {
    expect(appAddress('https://example.com/?game=path-link#top')).toBe('https://example.com/');
    expect(appAddress('https://example.com/arcade/?game=duel')).toBe('https://example.com/arcade/');
    expect(appAddress('https://example.com/')).toBe('https://example.com/');
  });

  it('카카오톡 밖의 브라우저로 여는 주소에 앱의 주소를 그대로 싣는다', () => {
    const url = kakaoExternalUrl('https://example.com/arcade/');
    expect(url.startsWith('kakaotalk://web/openExternal?url=')).toBe(true);
    expect(decodeURIComponent(url.split('url=')[1] ?? '')).toBe('https://example.com/arcade/');
    expect(url).not.toContain('://example');
  });
});
