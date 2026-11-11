# 포켓 아케이드

온·오프라인에서 모두 즐길 수 있는 픽셀 아트 미니게임 웹앱(PWA)입니다.
한 번 접속해 두면 그 뒤로는 인터넷 없이 실행되고, 기록은 기기 안에 저장됩니다.

![허브, 번개 탭 플레이, 결과 화면](docs/screenshots.png)

## 지금 들어 있는 것 (0단계)

- **허브**: 게임 목록, 게임별 최고 기록, 코인
- **번개 탭**: 30초 동안 나타나는 구슬을 사라지기 전에 터치하는 첫 미니게임
- **세이브**: 기기 안(IndexedDB)에 자동 저장, 파일로 내보내기·가져오기, 초기화
- **설정**: 효과음, 진동
- **오프라인**: 서비스 워커가 게임 파일을 모두 받아 두어 비행기 모드에서도 실행
- **공통 기반**: 일시정지(앱이 가려지면 자동), 결과 화면, 픽셀 UI 부품

기억 카드와 점프 러너는 허브에 "준비 중"으로 보이며 다음 단계에서 추가합니다.

## 실행

Node.js 22.12 이상이 필요합니다. CI와 배포는 `.nvmrc`에 적힌 버전을 씁니다.

```bash
npm install
npm run dev       # 개발 서버. 같은 와이파이의 휴대폰에서도 접속할 수 있습니다.
npm test          # 단위 테스트
npm run build     # 타입 검사 후 dist/ 에 빌드
npm run preview   # 빌드 결과 실행. 오프라인 동작은 여기서 확인합니다.
```

개발 서버에서는 서비스 워커가 꺼져 있습니다. 오프라인 동작을 보려면 `npm run build` 뒤에 `npm run preview`로 여세요.

## 휴대폰에서 플레이하기

[Cloudflare Workers](https://workers.cloudflare.com/)가 이 저장소를 직접 읽어서 빌드하고, 빌드 결과물(`dist/`)을 정적 파일로 배포합니다. 저장소는 비공개여도 됩니다. 배포 설정은 `wrangler.jsonc`에 있습니다.

### 처음 한 번: 저장소 연결

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 가입하거나 로그인한 뒤 **Workers & Pages**에서 **Create application**을 누릅니다.
2. GitHub 계정을 연결하고 이 저장소를 고릅니다. 저장소가 목록에 없으면 GitHub의 [설치된 앱 설정](https://github.com/settings/installations)에서 **Cloudflare Workers and Pages**의 **Configure**를 눌러 이 저장소에 접근할 권한을 줍니다.
3. **Set up your application** 화면에 아래 값을 넣고 **Deploy**를 누릅니다.

| 항목 | 값 |
| --- | --- |
| Project name | `minigame` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Project name은 `wrangler.jsonc`의 `name`과 같아야 합니다. 다르면 빌드가 실패하므로, 이름을 바꾸려면 두 곳을 함께 바꿉니다.

배포가 끝나면 `https://minigame.<계정 이름>.workers.dev` 꼴의 주소가 나옵니다. 그 뒤로는 `main`에 합쳐질 때마다 자동으로 다시 배포됩니다. 빌드에 쓰는 Node.js 버전은 `.nvmrc`를 따릅니다.

### 설치

1. 휴대폰 브라우저에서 배포된 주소를 열고 메뉴에서 **홈 화면에 추가**를 누르면 앱처럼 설치됩니다.
2. 허브 오른쪽 아래에 "오프라인 준비 완료"가 보이면 비행기 모드에서도 실행됩니다.

iOS Safari는 홈 화면에 추가하지 않고 오래 쓰지 않으면 저장 데이터를 지울 수 있습니다. 기록이 아깝다면 홈 화면에 추가하거나 설정의 "내보내기"로 백업해 두세요.

## 구조

```
src/
  main.ts              앱 시작: 글꼴·세이브를 불러오고 Phaser 게임을 만든다
  config.ts            화면 크기, 팔레트, 씬 이름
  art/                 픽셀 스프라이트(문자열 데이터)와 텍스처 생성
  core/                모든 게임이 같이 쓰는 공통 모듈
    save.ts            세이브 데이터 모양과 순수 함수
    store.ts           IndexedDB 저장소
    sfx.ts             Web Audio로 만드는 칩튠 효과음
    ui.ts              글자, 패널, 버튼, 씬 전환
    pwa.ts             서비스 워커 등록과 오프라인 상태
  scenes/              허브, 설정, 일시정지, 결과, 미니게임 공통 바탕
  games/
    registry.ts        허브에 보이는 게임 목록
    lightning-tap/     번개 탭 (rules.ts에 난이도와 점수 규칙)
scripts/gen-icons.mjs  앱 아이콘을 코드로 생성
```

이미지와 음원 파일은 없습니다. 스프라이트는 `src/art/sprites.ts`의 문자열로, 효과음은 오실레이터로 만들기 때문에 용량이 거의 들지 않고 오프라인에서도 그대로 동작합니다.

## 미니게임 추가하기

1. `src/games/<게임 이름>/`에 `MiniGameScene`을 상속한 씬을 만듭니다. `create()` 첫머리에서 `beginMiniGame()`을, 게임이 끝나면 `finishMiniGame(점수, 통계)`를 부르면 일시정지·기록 저장·결과 화면이 따라옵니다.
2. `src/config.ts`의 `SCENE`에 씬 이름을 넣고 `src/main.ts`의 씬 목록에 등록합니다.
3. `src/games/registry.ts`에 게임 정보를 추가하면 허브에 카드가 생깁니다.

규칙과 난이도는 `rules.ts`처럼 화면과 분리된 순수 함수로 두면 숫자만 바꿔 밸런스를 잡을 수 있고 테스트하기도 쉽습니다.

## 기술

| 항목 | 선택 |
| --- | --- |
| 엔진 | Phaser 4 (픽셀 아트 모드) |
| 빌드 | Vite + TypeScript |
| 오프라인 | vite-plugin-pwa (Workbox 사전 캐시) |
| 저장 | IndexedDB (idb-keyval) |
| 논리 해상도 | 가로 240px 고정, 세로는 화면 비율에 따라 400~560px |
| 배포 | Cloudflare Workers 정적 파일 (Git 연결) |

## 크레딧

- 글꼴: [갈무리(Galmuri)](https://github.com/quiple/galmuri) © Lee Minseo, SIL Open Font License 1.1 (`public/licenses/Galmuri-OFL.txt`)
- 팔레트: Sweetie 16 by GrafxKid
- 엔진: [Phaser](https://phaser.io) (MIT)
