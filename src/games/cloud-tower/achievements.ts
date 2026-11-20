/**
 * 업적: 탑을 오르고 도감을 채우면 구름 조각을 받는다. 다 채운 업적은 도감의 업적 쪽에서 눌러 받는다.
 * 진행은 저장한 기록(판이 끝날 때 옮긴 것)과 하던 판을 함께 본다.
 */
import { CARD_IDS, ENEMIES, TREASURE_IDS, type EnemyId } from './data';
import { codexNow, type TowerMeta } from './run';

export interface Achievement {
  id: string;
  name: string;
  /** 무엇을 하면 되는지 */
  blurb: string;
  goal: number;
  /** 받는 구름 조각 */
  reward: number;
  progress: (meta: TowerMeta) => number;
}

const ENEMY_COUNT = Object.keys(ENEMIES as Record<EnemyId, unknown>).length;

const cards = (meta: TowerMeta): number => codexNow(meta).cards.length;
const foes = (meta: TowerMeta): number => codexNow(meta).foes.length;
const treasures = (meta: TowerMeta): number => codexNow(meta).treasures.length;
const kills = (meta: TowerMeta): number => meta.kills + (meta.run?.stats.kills ?? 0);

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'boss1', name: '첫 대장', blurb: '7층의 대장을 물리쳐요', goal: 7, reward: 15, progress: (meta) => meta.best },
  { id: 'boss2', name: '바람 너머', blurb: '14층의 대장을 물리쳐요', goal: 14, reward: 30, progress: (meta) => meta.best },
  { id: 'top', name: '꼭대기', blurb: '21층 꼭대기에 올라요', goal: 1, reward: 60, progress: (meta) => meta.wins },
  { id: 'top3', name: '단골 손님', blurb: '꼭대기에 세 번 올라요', goal: 3, reward: 80, progress: (meta) => meta.wins },
  { id: 'runs10', name: '열 번의 모험', blurb: '판을 열 번 마쳐요', goal: 10, reward: 20, progress: (meta) => meta.runs },
  { id: 'kills50', name: '구름 청소부', blurb: '적을 50마리 물리쳐요', goal: 50, reward: 15, progress: kills },
  { id: 'kills200', name: '탑의 수호자', blurb: '적을 200마리 물리쳐요', goal: 200, reward: 40, progress: kills },
  { id: 'cards20', name: '카드 수집가', blurb: '카드를 20가지 만나요', goal: 20, reward: 15, progress: cards },
  { id: 'cardsAll', name: '카드 박사', blurb: '카드를 모두 만나요', goal: CARD_IDS.length, reward: 50, progress: cards },
  { id: 'foes10', name: '낯선 얼굴', blurb: '적을 10가지 만나요', goal: 10, reward: 15, progress: foes },
  { id: 'foesAll', name: '적 박사', blurb: '적을 모두 만나요', goal: ENEMY_COUNT, reward: 40, progress: foes },
  { id: 'treasures8', name: '보물 사냥꾼', blurb: '보물을 8가지 가져 봐요', goal: 8, reward: 20, progress: treasures },
  { id: 'treasuresAll', name: '보물 박사', blurb: '보물을 모두 가져 봐요', goal: TREASURE_IDS.length, reward: 50, progress: treasures },
];

export const achievementProgress = (meta: TowerMeta, achievement: Achievement): number =>
  Math.min(achievement.goal, achievement.progress(meta));

export const isClaimed = (meta: TowerMeta, achievement: Achievement): boolean => meta.claimed.includes(achievement.id);

export const canClaim = (meta: TowerMeta, achievement: Achievement): boolean =>
  !isClaimed(meta, achievement) && achievementProgress(meta, achievement) >= achievement.goal;

/** 받을 수 있는 업적의 수. 허브와 준비 화면이 알려 준다. */
export const claimableCount = (meta: TowerMeta): number => ACHIEVEMENTS.filter((achievement) => canClaim(meta, achievement)).length;

/** 업적의 보상을 받는다. 받을 수 없으면 meta를 그대로 돌려준다. */
export function claimAchievement(meta: TowerMeta, id: string): TowerMeta {
  const achievement = ACHIEVEMENTS.find((item) => item.id === id);
  if (!achievement || !canClaim(meta, achievement)) return meta;
  return { ...meta, shards: meta.shards + achievement.reward, claimed: [...meta.claimed, id] };
}
