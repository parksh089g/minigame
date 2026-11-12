/**
 * 처음 겪는 일마다 한 번씩 뜨는 짧은 안내.
 * 어떤 일이 어떤 안내를 부르는지와 글만 여기에 두고, 화면에 띄우는 일은 씬이 맡는다.
 * 본 안내는 판 밖 진행(meta.ts)에 적혀서 다시 뜨지 않는다.
 */
import { STAGE_ORDER, STAGES } from './data';
import type { SimEvent } from './sim';

export const TIPS = {
  gem: '빛 조각을 모으면 레벨이 올라요',
  shooter: '멈춰 선 그림자가 쏘는 방울은 옆으로 피해요',
  burster: '부푸는 그림자는 터져요. 원 밖으로 나가요',
  post: '등불 기둥에 닿으면 빛이 그림자를 태워요',
  boss: '보스를 쓰러뜨리면 무기 강화권을 받아요',
  surge: '밀물은 사방에서 와요. 한쪽을 뚫고 나가요',
  heal: '회복 떡을 주우면 체력이 조금 차요',
  pull: '자석이 빛 조각을 모두 끌어와요',
  blast: '불꽃 단지가 화면의 그림자를 태워요',
  guard: '등갓의 빛막이 피해를 한 번 막아 줘요',
  vent: '붉어진 불구멍은 그림자도 태워요',
  elite: '금빛 뿔의 정예를 잡으면 보물 상자가 나와요',
  chest: '보물 상자는 가진 것 하나를 한 단계 올려 줘요',
} as const;

export type TipId = keyof typeof TIPS;

export const TIP_IDS = Object.keys(TIPS) as TipId[];

/**
 * 이 안내들이 생기기 전부터 하던 사람에게는 띄우지 않는 것: 그때도 있던 일에 대한 안내.
 * 그 뒤에 새로 생긴 것(쏘는 적, 터지는 적, 등불 기둥, 자석, 불꽃 단지, 등갓, 불구멍)은 한 번씩 알려 준다.
 */
export const OLD_HAND_TIPS: readonly TipId[] = ['gem', 'boss', 'surge', 'heal'];

/** 판에서 일어난 일이 부르는 안내. 안내할 것이 없는 일이면 null */
export function tipFor(event: SimEvent): TipId | null {
  switch (event.type) {
    case 'gem':
      return 'gem';
    case 'spit':
      return 'shooter';
    case 'swell':
      return 'burster';
    case 'post':
      return 'post';
    case 'boss':
      // 강화권은 중간 보스만 준다.
      return STAGE_ORDER.some((id) => STAGES[id].finalBoss === event.kind) ? null : 'boss';
    case 'surge':
      return 'surge';
    case 'heal':
      return 'heal';
    case 'pull':
      return 'pull';
    case 'blast':
      return 'blast';
    case 'block':
      return 'guard';
    case 'vent':
      return 'vent';
    case 'elite':
      return 'elite';
    case 'chest':
      return 'chest';
    default:
      return null;
  }
}

/** 저장된 값에서 아는 안내만 남긴다. */
export function normalizeTips(raw: unknown): TipId[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return TIP_IDS.filter((id) => list.includes(id));
}
