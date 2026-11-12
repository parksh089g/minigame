/**
 * 홈 화면에 추가하는 방법을 기기와 브라우저에 맞게 고른다.
 * 여기에는 화면에 의존하지 않는 판단과 글만 있다. 창을 띄우는 일은 install-guide.ts가 한다.
 *
 * 한글은 글꼴에 들어 있는 완성형 2,350자만 쓴다(허브의 도움말은 캔버스에 그린다). install.test.ts가 확인한다.
 */

export type InstallPlatform =
  /** 아이폰과 아이패드의 사파리 */
  | 'ios-safari'
  /** 아이폰과 아이패드의 다른 브라우저(크롬, 엣지 등) */
  | 'ios-browser'
  | 'android-chrome'
  /** 삼성 인터넷 */
  | 'android-samsung'
  /** 안드로이드의 그 밖의 브라우저 */
  | 'android-browser'
  /** 카카오톡 안에서 열린 화면. 밖의 브라우저로 여는 주소가 따로 있다. */
  | 'in-app-kakao'
  /** 다른 앱(네이버, 인스타그램 등) 안에서 열린 화면. 여기서는 홈 화면에 추가할 수 없다. */
  | 'in-app'
  | 'desktop';

export interface DeviceHints {
  userAgent: string;
  /** 아이패드는 맥인 척하는 일이 있어서, 손가락을 몇 개까지 받는지로 가려낸다. */
  maxTouchPoints?: number;
}

/** 다른 앱이 제 안에서 화면을 열 때 붙이는 이름들 */
const IN_APP = /NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|DaumApps|BAND\/|; wv\)/i;
/** 아이폰에서 사파리가 아닌 브라우저가 붙이는 이름들 */
const IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Whale|DuckDuckGo/i;
/** 안드로이드에서 크롬을 바탕으로 만든 다른 브라우저들. 이들도 "Chrome"을 달고 있다. */
const ANDROID_NOT_CHROME = /EdgA|OPR\/|Whale|Firefox|DuckDuckGo|UCBrowser|MiuiBrowser/i;

export function installPlatform(hints: DeviceHints): InstallPlatform {
  const ua = hints.userAgent;
  if (/KAKAOTALK/i.test(ua)) return 'in-app-kakao';
  if (IN_APP.test(ua)) return 'in-app';

  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (hints.maxTouchPoints ?? 0) > 1);
  if (ios) {
    if (IOS_BROWSER.test(ua)) return 'ios-browser';
    // 다른 앱 안의 화면은 "Safari"를 달지 않는다.
    return /Safari\//.test(ua) ? 'ios-safari' : 'in-app';
  }
  if (/Android/i.test(ua)) {
    if (/SamsungBrowser/i.test(ua)) return 'android-samsung';
    if (/Chrome\//.test(ua) && !ANDROID_NOT_CHROME.test(ua)) return 'android-chrome';
    return 'android-browser';
  }
  return 'desktop';
}

/** 다른 앱 안이라서 먼저 밖의 브라우저로 나가야 하는지 */
export function isInApp(platform: InstallPlatform): boolean {
  return platform === 'in-app' || platform === 'in-app-kakao';
}

export interface InstallGuide {
  /** 순서 위에 보이는 한두 마디 */
  intro: string;
  /** 차례대로 할 일 */
  steps: readonly string[];
}

export const INSTALL_TITLE = '홈 화면에 추가하기';

const BENEFIT = '홈 화면에 아이콘이 생기고, 주소창 없이 앱처럼 열려요.';
const LEAVE_APP = "열린 브라우저에서 설정의 '설치'를 다시 눌러요";

const GUIDES: Readonly<Record<InstallPlatform, InstallGuide>> = {
  'ios-safari': {
    intro: BENEFIT,
    steps: [
      '공유 버튼(네모에서 화살표가 올라가는 모양)을 눌러요. 안 보이면 주소창 옆의 점 세 개를 먼저 눌러요',
      "목록을 올려서 '홈 화면에 추가'를 눌러요",
      "오른쪽 위의 '추가'를 눌러요",
    ],
  },
  'ios-browser': {
    intro: BENEFIT,
    steps: [
      '주소창 옆의 공유 버튼을 눌러요',
      "목록에서 '홈 화면에 추가'를 눌러요",
      '목록에 없으면 사파리에서 이 주소를 열어 주세요',
    ],
  },
  'android-chrome': {
    intro: BENEFIT,
    steps: [
      '오른쪽 위의 더보기(점 세 개)를 눌러요',
      "'홈 화면에 추가'나 '앱 설치'를 눌러요",
      "'설치'를 눌러요",
    ],
  },
  'android-samsung': {
    intro: BENEFIT,
    steps: [
      '오른쪽 아래의 메뉴(줄 세 개)를 눌러요',
      "'현재 페이지 추가'를 누르고 '홈 화면'을 골라요",
      "'추가'를 눌러요",
    ],
  },
  'android-browser': {
    intro: BENEFIT,
    steps: ['브라우저의 메뉴(점 세 개나 줄 세 개)를 눌러요', "'홈 화면에 추가'나 '앱 설치'를 눌러요"],
  },
  'in-app-kakao': {
    intro: '카카오톡 안에서는 홈 화면에 추가할 수 없어요. 먼저 다른 브라우저로 열어 주세요.',
    steps: [
      "아래의 '다른 브라우저로 열기'를 눌러요",
      "안 열리면 화면의 메뉴(점 세 개나 공유 버튼)에서 '다른 브라우저로 열기'를 눌러요",
      LEAVE_APP,
    ],
  },
  'in-app': {
    intro: '지금은 다른 앱 안에서 열려 있어서 홈 화면에 추가할 수 없어요. 먼저 브라우저로 열어 주세요.',
    steps: [
      '화면의 메뉴(점 세 개나 공유 버튼)를 눌러요',
      "'다른 브라우저로 열기'나 'Safari로 열기'를 눌러요. 없으면 주소를 복사해서 브라우저에 붙여 넣어요",
      LEAVE_APP,
    ],
  },
  desktop: {
    intro: '컴퓨터에서도 앱처럼 따로 띄울 수 있어요.',
    steps: ['주소창 오른쪽의 설치 버튼을 눌러요', "안 보이면 브라우저 메뉴에서 '앱 설치'를 찾아요"],
  },
};

export function installGuide(platform: InstallPlatform): InstallGuide {
  return GUIDES[platform];
}

/** 허브 아래쪽 도움말에 쓰는 한마디. 누르면 방법이 나온다. */
export function installTip(platform: InstallPlatform): string {
  if (isInApp(platform)) return '이 화면에서는 홈 화면에 추가할 수 없어요. 여기를 누르면 방법이 나와요.';
  if (platform === 'desktop') return '컴퓨터에서도 앱처럼 따로 띄울 수 있어요. 여기를 누르면 방법이 나와요.';
  return '홈 화면에 추가하면 앱처럼 쓸 수 있어요. 여기를 누르면 방법이 나와요.';
}

/** 이 앱의 주소. pageUrl은 지금 열려 있는 주소이고, 공유 링크에 붙어 온 쿼리와 해시는 뗀다. */
export function appAddress(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** 카카오톡 안에서 이 주소를 밖의 브라우저로 여는 주소 */
export function kakaoExternalUrl(pageUrl: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(pageUrl)}`;
}
