/**
 * 허브에 보이는 미니게임 목록.
 * 새 게임을 추가할 때는 여기에 한 줄을 넣고, 씬을 main.ts의 씬 목록에 등록하면 된다.
 */
import { SCENE } from '../config';
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
}

export const GAMES: readonly MiniGameInfo[] = [
  {
    id: 'lightning-tap',
    title: '번개 탭',
    tagline: '빛나는 구슬을 빠르게!',
    icon: 'icon-bolt',
    sceneKey: SCENE.lightningTap,
    coinsFor: (score) => Math.floor(score / 10),
  },
  {
    id: 'memory-cards',
    title: '기억 카드',
    tagline: '같은 그림 짝 맞추기',
    icon: 'icon-cards',
    sceneKey: SCENE.memoryCards,
    coinsFor: (score) => Math.floor(score / 15),
  },
  {
    id: 'jump-runner',
    title: '점프 러너',
    tagline: '한 번 탭으로 점프!',
    icon: 'icon-runner',
    sceneKey: SCENE.jumpRunner,
    coinsFor: (score) => Math.floor(score / 20),
  },
];

export function getGame(id: string): MiniGameInfo | undefined {
  return GAMES.find((game) => game.id === id);
}
