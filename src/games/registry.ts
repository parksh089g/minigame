/**
 * 허브에 보이는 미니게임 목록.
 * 새 게임을 추가할 때는 여기에 한 줄을 넣고, 씬을 main.ts의 씬 목록에 등록하면 된다.
 */
import { SCENE } from '../config';
import { challengeFor, dateKeyOf, type DailyChallenge } from '../core/daily';
import {
  weekContext,
  type BigMission,
  type Genre,
  type WeekContext,
  type WeeklyGame,
  type WeeklyState,
} from '../core/weekly';
import type { SpriteKey } from '../art/sprites';
import { GARDEN_GAME_ID, GARDEN_SCENE } from './garden-guard/data';
import { coinsFor as gardenCoins, recordLabel as gardenRecord } from './garden-guard/rules';
import { LANTERN_GAME_ID, LANTERN_SCENE } from './lantern-keeper/data';
import { coinsFor as lanternCoins } from './lantern-keeper/rules';
import { COMPANY_GAME_ID, COMPANY_SCENE } from './sprout-company/data';
import { ONE_CARD_GAME_ID, ONE_CARD_SCENE } from './one-card/text';
import { TOWER_GAME_ID, TOWER_SCENE } from './cloud-tower/data';
import { HULA_GAME_ID, HULA_SCENE } from './hula/data';
import { coinsFor as towerCoins, recordLabel as towerRecord } from './cloud-tower/run';

export interface MiniGameInfo {
  /** 세이브에 쓰이는 고유 id. 한 번 정하면 바꾸지 않는다. */
  id: string;
  /** 허브 카드와 결과 화면에 보이는 이름. 허브 카드가 좁으니 짧게 짓는다. 길면 카드에 맞게 글자가 줄어든다. */
  title: string;
  icon: SpriteKey;
  /** 플레이할 씬 이름. 아직 만들지 않은 게임은 null이고 허브에 "준비 중"으로 보인다. */
  sceneKey: string | null;
  /** 점수에 따라 주는 코인 수 */
  coinsFor: (score: number) => number;
  /** 오늘의 도전에 쓰는 목표 점수. 쉬운 것부터 어려운 것 순서로 세 단계. 비워 두면 오늘의 도전에 나오지 않는다. */
  dailyTargets: readonly number[];
  /**
   * 주간 미션이 게임을 묶는 갈래: 머리를 쓰는 'puzzle'과 손이 빨라야 하는 'action'.
   * 비워 두면 "퍼즐 게임 몇 판" 같은 갈래 미션에는 들지 않고 "아무 게임이나"에만 들어간다.
   */
  genre?: Genre;
  /**
   * true면 퍼즐 단계 모드(시간 제한 없이 1단계부터 차례로 깨기)에 나온다.
   * 그 게임의 씬이 MiniGameScene의 stageLevel을 보고 단계 모드로 열 줄 알아야 한다.
   */
  stageMode?: boolean;
  /** true면 허브 목록의 맨 앞에 놓는다. 대표로 내세울 게임에 쓴다. */
  featured?: boolean;
  /**
   * true면 둘이서 겨뤄 승패로 끝나는 게임이다. 점수가 없어서 허브 카드에 최고 기록 대신 "둘이서"가 보이고,
   * 온라인 랭킹과 오늘의 도전에서 빠지며, 결과도 공용 결과 화면이 아니라 그 게임의 화면에서 보여 준다.
   */
  versus?: boolean;
  /**
   * true면 판이 끝나지 않고 이어지는 성장 게임이다. 점수 대신 평판이 쌓여서 허브 카드에 최고 기록 대신 "평판"이 보이고,
   * 오늘의 도전에서 빠지고 공용 결과 화면도 쓰지 않는다. 온라인 랭킹에는 그 기록(평판)으로 오른다.
   */
  ongoing?: boolean;
  /**
   * 한 판이 길거나 이어지는 큰 게임이면, 몇 주에 한 번 나오는 주간 미션의 모양(core/weekly.ts의 BigMission).
   * 큰 게임은 "이번 주의 게임"에 나오지 않는 대신 이 미션으로 나온다.
   */
  bigMission?: BigMission;
  /** 허브 카드에서 최고 기록 자리에 쓸 말. 없으면 "최고 123"이다. 점수보다 알기 쉬운 말이 있는 게임(지킨 날 같은)이 쓴다. */
  recordLabel?: (best: number) => string;
  /**
   * 며칠에 걸쳐 꾸준히 하는 게임(키운 것이 남거나, 한 판이 길어서 차근차근 쌓아 가는 게임)이면 그 게임을 한 줄로 소개하는 말.
   * 적어 두면 허브에서 "꾸준히 하는 게임" 쪽에 놓이고, 그 카드에 이 말이 보인다. 없으면 "짧게 즐기는 게임" 쪽이다.
   * 카드 한 줄에 들어가도록 STEADY_LINE_CHARS자 안쪽으로 쓴다.
   */
  steady?: string;
}

/** 꾸준히 하는 게임의 소개(steady)에 쓰는 가장 긴 글자 수. 허브 카드의 한 줄에 줄이지 않고 들어가는 길이다. */
export const STEADY_LINE_CHARS = 16;

export const GAMES: readonly MiniGameInfo[] = [
  {
    id: 'lightning-tap',
    title: '번개 탭',
    icon: 'icon-bolt',
    sceneKey: SCENE.lightningTap,
    coinsFor: (score) => Math.floor(score / 10),
    dailyTargets: [50, 80, 110],
    genre: 'action',
  },
  {
    id: 'memory-cards',
    title: '기억 카드',
    icon: 'icon-cards',
    sceneKey: SCENE.memoryCards,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [100, 160, 220],
    genre: 'puzzle',
  },
  {
    id: 'jump-runner',
    title: '점프 러너',
    icon: 'icon-runner',
    sceneKey: SCENE.jumpRunner,
    coinsFor: (score) => Math.floor(score / 20),
    dailyTargets: [80, 140, 200],
    genre: 'action',
  },
  {
    id: 'stack-tower',
    title: '탑 쌓기',
    icon: 'icon-tower',
    sceneKey: SCENE.stackTower,
    coinsFor: (score) => Math.floor(score / 12),
    dailyTargets: [70, 110, 150],
    genre: 'action',
  },
  {
    id: 'color-sort',
    title: '색깔 물 나누기',
    icon: 'icon-flask',
    sceneKey: SCENE.colorSort,
    coinsFor: (score) => Math.floor(score / 20),
    dailyTargets: [100, 170, 250],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'gate-run',
    title: '관문 달리기',
    icon: 'icon-gate',
    sceneKey: SCENE.gateRun,
    coinsFor: (score) => Math.floor(score / 12),
    dailyTargets: [80, 150, 250],
    genre: 'action',
  },
  {
    id: 'pin-pull',
    title: '핀 뽑기',
    icon: 'icon-pin',
    sceneKey: SCENE.pinPull,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [70, 130, 220],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'parking-out',
    title: '주차장 빼기',
    icon: 'icon-car',
    sceneKey: SCENE.parkingOut,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [150, 280, 450],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'screw-sort',
    title: '나사 풀기',
    icon: 'icon-screw',
    sceneKey: SCENE.screwSort,
    coinsFor: (score) => Math.floor(score / 40),
    dailyTargets: [250, 450, 750],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'merge-tiles',
    title: '머지 타일',
    icon: 'icon-merge',
    sceneKey: SCENE.mergeTiles,
    coinsFor: (score) => Math.floor(score / 35),
    dailyTargets: [200, 380, 600],
    genre: 'puzzle',
  },
  {
    id: 'tail-chase',
    title: '꼬리 잡기',
    icon: 'icon-tail',
    sceneKey: SCENE.tailChase,
    coinsFor: (score) => Math.floor(score / 20),
    dailyTargets: [100, 200, 300],
    genre: 'action',
  },
  {
    id: 'logic-tiles',
    title: '논리 타일',
    icon: 'icon-logic',
    sceneKey: SCENE.logicTiles,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [120, 260, 420],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'nemo-logic',
    title: '네모 로직',
    icon: 'icon-nemo',
    sceneKey: SCENE.nemoLogic,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [60, 150, 260],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'number-puzzle',
    title: '숫자 퍼즐',
    icon: 'icon-number',
    sceneKey: SCENE.numberPuzzle,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [100, 220, 420],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'path-link',
    title: '길 잇기',
    icon: 'icon-path',
    sceneKey: SCENE.pathLink,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [90, 300, 500],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'block-fill',
    title: '블록 채우기',
    icon: 'icon-block',
    sceneKey: SCENE.blockFill,
    coinsFor: (score) => Math.floor(score / 50),
    dailyTargets: [300, 700, 1100],
    genre: 'puzzle',
  },
  {
    id: 'match-three',
    title: '세 개 맞추기',
    icon: 'icon-match',
    sceneKey: SCENE.matchThree,
    coinsFor: (score) => Math.floor(score / 250),
    dailyTargets: [1500, 3000, 4500],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'box-push',
    title: '상자 밀기',
    icon: 'icon-box',
    sceneKey: SCENE.boxPush,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [60, 140, 260],
    genre: 'puzzle',
    stageMode: true,
  },
  {
    id: 'chosung-quiz',
    title: '초성 퀴즈',
    icon: 'icon-chosung',
    sceneKey: SCENE.chosungQuiz,
    coinsFor: (score) => Math.floor(score / 35),
    dailyTargets: [150, 450, 750],
    genre: 'puzzle',
  },
  {
    id: 'brick-break',
    title: '벽돌 깨기',
    icon: 'icon-brick',
    sceneKey: SCENE.brickBreak,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [80, 170, 280],
    genre: 'action',
  },
  {
    id: 'candy-slot',
    title: '행운 슬롯',
    icon: 'icon-slot',
    sceneKey: SCENE.candySlot,
    // 점수는 한 판에 받은 금화의 수다. 부적이 잘 맞으면 수천까지 가서, 다른 게임보다 크게 나눈다.
    coinsFor: (score) => Math.floor(score / 50),
    dailyTargets: [100, 300, 700],
    genre: 'puzzle',
    // 한 판이 여러 라운드에 걸쳐 부적을 모아 가는 긴 판이라, 꾸준히 하는 게임 쪽에 둔다.
    steady: '부적을 모아 큰 상금을 노려요',
  },
  {
    id: ONE_CARD_GAME_ID,
    title: '원카드',
    icon: 'icon-onecard',
    sceneKey: ONE_CARD_SCENE,
    // 이기면 난이도에 따라 100~300점에 상대가 남긴 카드만큼 더한다. 지면 0점이다.
    coinsFor: (score) => Math.floor(score / 50),
    // 카드 운이 커서 점수 목표를 정하기 어려워 오늘의 도전에는 넣지 않는다.
    dailyTargets: [],
    genre: 'puzzle',
  },
  {
    id: 'duel',
    title: '둘이서 대결',
    icon: 'icon-duel',
    sceneKey: SCENE.duel,
    // 승패로 끝나는 게임이라 점수와 상관없이 한 판을 마치면 이만큼 준다.
    coinsFor: () => 3,
    dailyTargets: [],
    versus: true,
  },
  {
    id: HULA_GAME_ID,
    title: '훌라',
    icon: 'icon-hula',
    sceneKey: HULA_SCENE,
    // 점수는 이긴 판에서 컴퓨터가 낸 점수에 난이도를 곱한 것이다. 진 판은 0점이다.
    coinsFor: (score) => Math.floor(score / 10),
    // 카드 운이 커서 목표 점수를 정하기 어려워 오늘의 도전에는 넣지 않는다.
    dailyTargets: [],
    genre: 'puzzle',
  },
  {
    id: LANTERN_GAME_ID,
    title: '등불지기',
    icon: 'icon-lantern',
    sceneKey: LANTERN_SCENE,
    coinsFor: lanternCoins,
    // 한 판이 10분까지 가므로 오늘의 도전에는 넣지 않는다.
    dailyTargets: [],
    // 이 앱의 대표 게임이라 허브 목록의 맨 앞에 놓는다.
    featured: true,
    steady: '밤을 버티며 등불을 키워요',
    // 한 판이 길어서 몇 판만 묻는다.
    bigMission: {
      title: (goal) => `등불지기 ${goal}판`,
      description: '이번 주의 큰 게임이에요',
      tiers: [
        [2, 50],
        [3, 55],
        [4, 60],
      ],
    },
  },
  {
    id: GARDEN_GAME_ID,
    title: '텃밭 지키기',
    icon: 'icon-garden',
    sceneKey: GARDEN_SCENE,
    coinsFor: gardenCoins,
    // 영구 강화를 얼마나 했느냐에 따라 점수가 크게 달라서 오늘의 도전에는 넣지 않는다.
    dailyTargets: [],
    genre: 'action',
    // 점수(그 판에서 지킨 날마다 100점)보다 한 판에 지킨 날 수가 알기 쉽다.
    recordLabel: gardenRecord,
    steady: '벌레를 막고 텃밭을 가꿔요',
    // 판이 끝나도 강화가 남는 큰 게임이라 몇 주에 한 번 큰 게임 미션으로 나온다. 한 판이 등불지기보다 짧아서 판 수를 조금 더 묻는다.
    bigMission: {
      title: (goal) => `텃밭 지키기 ${goal}판`,
      description: '이번 주의 큰 게임이에요',
      tiers: [
        [3, 50],
        [4, 55],
        [5, 60],
      ],
    },
  },
  {
    id: TOWER_GAME_ID,
    title: '구름 탑 모험',
    icon: 'icon-cloudtower',
    sceneKey: TOWER_SCENE,
    // 점수는 마친 층마다 100점이다. 층마다 1코인을 준다.
    coinsFor: towerCoins,
    // 한 판이 길고 영구 강화에 따라 크게 달라져서 오늘의 도전에는 넣지 않는다.
    dailyTargets: [],
    genre: 'puzzle',
    // 점수보다 몇 층까지 올랐는지가 알기 쉽다.
    recordLabel: towerRecord,
    // 판이 끝나도 구름 조각과 강화가 남고, 한 판이 길어서 꾸준히 하는 게임 쪽에 둔다.
    steady: '카드로 싸우며 탑을 올라요',
  },
  {
    id: COMPANY_GAME_ID,
    title: '새싹 컴퍼니',
    icon: 'icon-company',
    sceneKey: COMPANY_SCENE,
    // 게임 하나를 출시할 때마다 한 판으로 치고 이만큼 준다.
    coinsFor: () => 1,
    dailyTargets: [],
    ongoing: true,
    steady: '게임 회사를 차근차근 키워요',
    // 출시 한 번이 한 판이다. 예약해 둔 게임이 닫아 둔 동안 나온 것도 센다.
    bigMission: {
      title: (goal) => `새싹 컴퍼니 ${goal}번 출시`,
      description: '업데이트도 출시로 세요',
      // 이름이 업적 화면의 한 줄에 들어가도록 목표는 한 자리 수다.
      tiers: [
        [5, 50],
        [7, 55],
        [9, 60],
      ],
    },
  },
];

/** 허브에 보여 주는 순서로 늘어놓는다: 대표 게임이 먼저 오고, 나머지는 적힌 순서 그대로다. */
export function orderForHub<T extends { featured?: boolean }>(games: readonly T[]): T[] {
  return [...games.filter((game) => game.featured), ...games.filter((game) => !game.featured)];
}

/** 허브의 게임 목록. 사람마다 달라지지 않는 기본 순서라서 랭킹 화면처럼 순서가 고정된 곳에 쓴다. */
export const HUB_GAMES: readonly MiniGameInfo[] = orderForHub(GAMES);

/**
 * 그 사람의 허브에 놓는 순서로 늘어놓는다. 자주 하는 게임이 첫 쪽에 오게 하려는 것이다.
 * 1. 대표 게임
 * 2. 즐겨찾기에 넣은 게임 (게임 목록에 적힌 순서)
 * 3. 해 본 게임 (마지막으로 한 때가 가까운 것부터)
 * 4. 아직 안 해 본 게임 (게임 목록에 적힌 순서)
 * lastPlayedAt은 게임 id를 받아 마지막으로 한 시각(ms)을 돌려주고, 한 번도 안 했으면 null을 돌려준다.
 */
export function personalHubOrder<T extends { id: string; featured?: boolean }>(
  games: readonly T[],
  favorites: readonly string[],
  lastPlayedAt: (gameId: string) => number | null,
): T[] {
  const starred = new Set(favorites);
  const featured = games.filter((game) => game.featured);
  const rest = games.filter((game) => !game.featured);
  const favorite = rest.filter((game) => starred.has(game.id));
  const others = rest.filter((game) => !starred.has(game.id));
  const played = others
    .map((game) => ({ game, at: lastPlayedAt(game.id) }))
    .filter((entry): entry is { game: T; at: number } => entry.at !== null)
    // sort는 순서가 같은 것끼리의 차례를 지키므로, 같은 시각이면 적힌 순서 그대로다.
    .sort((a, b) => b.at - a.at)
    .map((entry) => entry.game);
  const fresh = others.filter((game) => lastPlayedAt(game.id) === null);
  return [...featured, ...favorite, ...played, ...fresh];
}

/**
 * 허브가 게임을 나눠 보여 주는 두 갈래: 며칠에 걸쳐 꾸준히 하는 게임('steady')과 한 판을 짧게 즐기는 게임('quick').
 * 적힌 순서가 허브의 탭 순서다.
 */
export const HUB_GROUPS = ['steady', 'quick'] as const;
export type HubGroup = (typeof HUB_GROUPS)[number];

/** 허브의 탭에 적는 갈래의 이름 */
export const HUB_GROUP_LABEL: Readonly<Record<HubGroup, string>> = {
  steady: '꾸준히 하는 게임',
  quick: '짧게 즐기는 게임',
};

/** 그 게임이 허브의 어느 갈래에 놓이는지. 소개(steady)를 적어 둔 게임이 꾸준히 하는 게임이다. */
export function hubGroupOf(game: { steady?: string }): HubGroup {
  return game.steady === undefined ? 'quick' : 'steady';
}

/** 그 갈래의 게임들. 적힌 순서 그대로다. */
export function gamesInGroup<T extends { steady?: string }>(games: readonly T[], group: HubGroup): T[] {
  return games.filter((game) => hubGroupOf(game) === group);
}

/**
 * 허브를 처음 열 때 보여 줄 갈래: 가장 최근에 한 게임이 있는 쪽이다. 하던 게임을 바로 이어 하게 하려는 것이다.
 * 해 본 게임이 하나도 없으면 대표 게임이 있는 꾸준히 하는 게임 쪽을 연다.
 */
export function startingHubGroup(
  games: readonly { id: string; steady?: string }[],
  lastPlayedAt: (gameId: string) => number | null,
): HubGroup {
  const latest = lastPlayedGame(
    games.map((game) => game.id),
    lastPlayedAt,
  );
  const game = games.find((item) => item.id === latest);
  return game ? hubGroupOf(game) : HUB_GROUPS[0];
}

/**
 * ids 가운데 가장 최근에 한 게임의 id. 해 본 게임이 하나도 없으면 null.
 * 같은 때에 한 것이 여럿이면 ids에 먼저 적힌 것을 고른다.
 */
export function lastPlayedGame(
  ids: readonly string[],
  lastPlayedAt: (gameId: string) => number | null,
): string | null {
  let latest: { id: string; at: number } | null = null;
  for (const id of ids) {
    const at = lastPlayedAt(id);
    if (at !== null && (latest === null || at > latest.at)) latest = { id, at };
  }
  return latest?.id ?? null;
}

export function getGame(id: string): MiniGameInfo | undefined {
  return GAMES.find((game) => game.id === id);
}

/** 퍼즐 단계 모드에 나오는 게임들. 적힌 순서대로 단계 화면의 탭이 된다. */
export function stageGames(games: readonly MiniGameInfo[] = GAMES): MiniGameInfo[] {
  return games.filter((game) => game.stageMode === true && game.sceneKey !== null);
}

/**
 * 주간 미션이 보는 게임 목록. 플레이할 수 있는 게임만 들어가고, 오늘의 도전에 나오는 게임
 * (한 판이 짧고 혼자 하는 게임)만 "이 게임 몇 판" 미션으로 낸다. 큰 게임은 큰 게임 미션으로 가끔 낸다.
 */
export function weeklyGames(games: readonly MiniGameInfo[] = GAMES): WeeklyGame[] {
  return games
    .filter((game) => game.sceneKey !== null)
    .map((game) => ({
      id: game.id,
      title: game.title,
      genre: game.genre ?? null,
      quick: game.dailyTargets.length > 0,
      ...(game.bigMission ? { big: game.bigMission } : {}),
    }));
}

/**
 * 이번 주(기기의 현지 날짜)의 미션. 세이브의 주간 기록을 함께 넘겨야 하는 것은,
 * 기기 시계가 뒤로 돌아가 있을 때 기록이 있는 주를 그대로 따르기 위해서다.
 */
export function thisWeek(weekly: WeeklyState, now: Date = new Date()): WeekContext | null {
  return weekContext(weekly, dateKeyOf(now), weeklyGames());
}

/** 오늘(기기의 현지 날짜)의 도전. 플레이할 수 있는 게임 가운데에서 날짜로 정해진다. */
export function todaysChallenge(now: Date = new Date()): DailyChallenge | null {
  const games = GAMES.filter((game) => game.sceneKey !== null).map((game) => ({
    id: game.id,
    targets: game.dailyTargets,
  }));
  return challengeFor(dateKeyOf(now), games);
}
