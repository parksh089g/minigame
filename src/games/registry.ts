/**
 * 허브에 보이는 미니게임 목록.
 * 새 게임을 추가할 때는 여기에 한 줄을 넣고, 씬을 main.ts의 씬 목록에 등록하면 된다.
 */
import { SCENE } from '../config';
import { challengeFor, dateKeyOf, type DailyChallenge } from '../core/daily';
import type { SpriteKey } from '../art/sprites';

export interface MiniGameInfo {
  /** 세이브에 쓰이는 고유 id. 한 번 정하면 바꾸지 않는다. */
  id: string;
  title: string;
  /** 허브 카드에 보이는 한 줄 설명. 한글 11자 안팎이 카드 폭에 맞는다. */
  tagline: string;
  icon: SpriteKey;
  /** 플레이할 씬 이름. 아직 만들지 않은 게임은 null이고 허브에 "준비 중"으로 보인다. */
  sceneKey: string | null;
  /** 점수에 따라 주는 코인 수 */
  coinsFor: (score: number) => number;
  /** 오늘의 도전에 쓰는 목표 점수. 쉬운 것부터 어려운 것 순서로 세 단계. */
  dailyTargets: readonly number[];
  /** true면 허브 목록의 맨 앞에 놓는다. 대표로 내세울 게임에 쓴다. */
  featured?: boolean;
}

export const GAMES: readonly MiniGameInfo[] = [
  {
    id: 'lightning-tap',
    title: '번개 탭',
    tagline: '빛나는 구슬을 빠르게!',
    icon: 'icon-bolt',
    sceneKey: SCENE.lightningTap,
    coinsFor: (score) => Math.floor(score / 10),
    dailyTargets: [50, 80, 110],
  },
  {
    id: 'memory-cards',
    title: '기억 카드',
    tagline: '같은 그림 짝 맞추기',
    icon: 'icon-cards',
    sceneKey: SCENE.memoryCards,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [100, 160, 220],
  },
  {
    id: 'jump-runner',
    title: '점프 러너',
    tagline: '한 번 탭으로 점프!',
    icon: 'icon-runner',
    sceneKey: SCENE.jumpRunner,
    coinsFor: (score) => Math.floor(score / 20),
    dailyTargets: [80, 140, 200],
  },
  {
    id: 'stack-tower',
    title: '탑 쌓기',
    tagline: '타이밍 맞춰 차곡차곡',
    icon: 'icon-tower',
    sceneKey: SCENE.stackTower,
    coinsFor: (score) => Math.floor(score / 12),
    dailyTargets: [70, 110, 150],
  },
  {
    id: 'color-sort',
    title: '색깔 물 나누기',
    tagline: '같은 색끼리 병에 모으기',
    icon: 'icon-flask',
    sceneKey: SCENE.colorSort,
    coinsFor: (score) => Math.floor(score / 20),
    dailyTargets: [100, 170, 250],
  },
  {
    id: 'gate-run',
    title: '관문 달리기',
    tagline: '관문 골라 무리 불리기',
    icon: 'icon-gate',
    sceneKey: SCENE.gateRun,
    coinsFor: (score) => Math.floor(score / 12),
    dailyTargets: [80, 150, 250],
  },
  {
    id: 'pin-pull',
    title: '핀 뽑기',
    tagline: '순서대로 뽑아 보물 얻기',
    icon: 'icon-pin',
    sceneKey: SCENE.pinPull,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [70, 130, 220],
  },
  {
    id: 'parking-out',
    title: '주차장 빼기',
    tagline: '막힌 차를 차례로 빼기',
    icon: 'icon-car',
    sceneKey: SCENE.parkingOut,
    coinsFor: (score) => Math.floor(score / 25),
    dailyTargets: [150, 280, 450],
  },
  {
    id: 'screw-sort',
    title: '나사 풀기',
    tagline: '같은 색 나사 세 개씩',
    icon: 'icon-screw',
    sceneKey: SCENE.screwSort,
    coinsFor: (score) => Math.floor(score / 40),
    dailyTargets: [250, 450, 750],
  },
  {
    id: 'merge-tiles',
    title: '머지 타일',
    tagline: '같은 숫자를 밀어 합치기',
    icon: 'icon-merge',
    sceneKey: SCENE.mergeTiles,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [60, 100, 150],
  },
  {
    id: 'tail-chase',
    title: '꼬리 잡기',
    tagline: '먹을수록 길어지는 꼬리',
    icon: 'icon-tail',
    sceneKey: SCENE.tailChase,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [60, 100, 150],
  },
  {
    id: 'logic-tiles',
    title: '논리 타일',
    tagline: '숫자 힌트로 함정 찾기',
    icon: 'icon-logic',
    sceneKey: SCENE.logicTiles,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [60, 100, 150],
  },
  {
    id: 'number-puzzle',
    title: '숫자 퍼즐',
    tagline: '빈칸에 맞는 숫자 채우기',
    icon: 'icon-number',
    sceneKey: SCENE.numberPuzzle,
    coinsFor: (score) => Math.floor(score / 15),
    dailyTargets: [60, 100, 150],
  },
];

/** 허브에 보여 주는 순서로 늘어놓는다: 대표 게임이 먼저 오고, 나머지는 적힌 순서 그대로다. */
export function orderForHub<T extends { featured?: boolean }>(games: readonly T[]): T[] {
  return [...games.filter((game) => game.featured), ...games.filter((game) => !game.featured)];
}

/** 허브의 게임 목록 */
export const HUB_GAMES: readonly MiniGameInfo[] = orderForHub(GAMES);

export function getGame(id: string): MiniGameInfo | undefined {
  return GAMES.find((game) => game.id === id);
}

/** 오늘(기기의 현지 날짜)의 도전. 플레이할 수 있는 게임 가운데에서 날짜로 정해진다. */
export function todaysChallenge(now: Date = new Date()): DailyChallenge | null {
  const games = GAMES.filter((game) => game.sceneKey !== null).map((game) => ({
    id: game.id,
    targets: game.dailyTargets,
  }));
  return challengeFor(dateKeyOf(now), games);
}
