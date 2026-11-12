/**
 * 처음 하는 사람을 위한 길잡이. 첫 게임을 내고, 장비를 사고, 이사해서 새 친구를 뽑을 때까지
 * 지금 무엇을 누르면 되는지를 한 걸음씩 짚어 준다.
 * 어느 걸음인지는 회사의 세이브(state.guide)에 적히고, 걸음은 앞으로만 간다.
 * 여기에는 무엇을 언제 짚을지만 있고, 화면에 그리는 일은 씬에 있다.
 */
import { EQUIPMENT_ORDER, GUIDE_STEPS, OFFICES, type GuideStep, type TipId } from './data';
import { equipmentBlock, hasFreeDesk, isReady, moveBlock, skill, staffCount, type CompanyState } from './rules';
import { markTip } from './tips';

/** 길잡이가 짚는 곳: 게임 고르기 버튼, 출시하기 버튼, 책상 하나, 아래쪽 버튼 하나 */
export type GuideTarget =
  | { kind: 'pick' }
  | { kind: 'release' }
  | { kind: 'desk'; index: number }
  | { kind: 'button'; panel: 'gear' | 'office' };

export interface GuideView {
  step: GuideStep;
  title: string;
  detail: string;
  target: GuideTarget;
}

/** 그 걸음을 마치면 본 것으로 치는 처음 안내. 길잡이가 같은 말을 이미 했기 때문이다. */
export const GUIDE_TIPS: Readonly<Partial<Record<GuideStep, readonly TipId[]>>> = {
  gear: ['income', 'gear'],
  grow: ['update'],
  move: ['move'],
  hire: ['hire'],
};

/** 길잡이를 마쳤을 때 띄우는 말 */
export const GUIDE_DONE = '길잡이는 여기까지예요. 마음껏 키워 봐요';

/** 지금 걸음. 길잡이를 마쳤거나 그만 보기로 했으면 null */
export function guideStep(state: CompanyState): GuideStep | null {
  return GUIDE_STEPS[state.guide] ?? null;
}

const working = (state: CompanyState): number => state.desks.findIndex((desk) => desk.staff !== null && desk.task !== null);

function hasGear(state: CompanyState): boolean {
  const any = (levels: Record<string, number | undefined>): boolean => Object.values(levels).some((level) => (level ?? 0) > 0);
  return any(state.gear) || state.desks.some((desk) => any(desk.gear));
}

function canBuyGear(state: CompanyState): boolean {
  return EQUIPMENT_ORDER.some(
    (id) => equipmentBlock(state, id) === null || state.desks.some((_, index) => equipmentBlock(state, id, index) === null),
  );
}

/** 그 걸음에서 하라는 일을 이미 했는가 */
function isDone(state: CompanyState, step: GuideStep): boolean {
  const released = state.releases > 0;
  const moved = state.office > 0;
  if (step === 'pick') return state.project !== null || released;
  if (step === 'assign') return working(state) >= 0 || (state.project?.done ?? 0) > 0 || released;
  if (step === 'cheer') return state.desks.some((desk) => desk.cheer > 0) || isReady(state) || released;
  if (step === 'finish') return isReady(state) || released;
  if (step === 'release') return released;
  if (step === 'gear') return hasGear(state) || moved;
  if (step === 'grow') return state.reputation >= OFFICES[1].reputation || moved;
  if (step === 'move') return moved;
  return moved && (staffCount(state) > 2 || !hasFreeDesk(state));
}

/**
 * 이미 한 걸음을 넘긴다. 넘긴 걸음을 차례로 돌려주고, 그 걸음이 대신한 처음 안내는 본 것으로 적는다.
 * 마지막 걸음까지 넘기면 길잡이가 끝난다.
 */
export function advanceGuide(state: CompanyState): GuideStep[] {
  const passed: GuideStep[] = [];
  for (let step = guideStep(state); step !== null && isDone(state, step); step = guideStep(state)) {
    for (const tip of GUIDE_TIPS[step] ?? []) markTip(state, tip);
    passed.push(step);
    state.guide += 1;
  }
  return passed;
}

/** 길잡이를 그만 본다. 처음 안내는 그대로 남아서 제때에 뜬다. */
export function skipGuide(state: CompanyState): void {
  state.guide = GUIDE_STEPS.length;
}

/** 카드를 맡길 쉬는 친구의 책상. selected번 카드를 잘하는 친구가 먼저다. 없으면 -1 */
function idleDesk(state: CompanyState, selected: number): number {
  const card = state.inbox[Math.min(selected, state.inbox.length - 1)];
  if (!card) return -1;
  let best = -1;
  let bestSkill = 0;
  state.desks.forEach((desk, index) => {
    if (!desk.staff || desk.task || desk.resting) return;
    const fit = skill(state, index, card.kind);
    if (fit > bestSkill) {
      best = index;
      bestSkill = fit;
    }
  });
  return best;
}

/**
 * 지금 화면에 띄울 길잡이. selected는 일감함에서 골라 둔 카드의 번호다.
 * 짚을 곳이 없는 때(카드를 다 맡기고 기다리는 동안 등)에는 null이라서 아무것도 띄우지 않는다.
 */
export function guideView(state: CompanyState, selected = 0): GuideView | null {
  const step = guideStep(state);
  if (!step) return null;
  const view = (title: string, detail: string, target: GuideTarget): GuideView => ({ step, title, detail, target });
  const pick: GuideTarget = { kind: 'pick' };
  const desk = (index: number): GuideTarget => ({ kind: 'desk', index });
  const idle = idleDesk(state, selected);
  const busy = working(state);

  if (step === 'pick') return view('첫 게임을 만들어 봐요', '게임 고르기를 눌러요', pick);
  if (step === 'assign' || (step === 'cheer' && busy < 0)) {
    return idle < 0 ? null : view('카드는 해야 할 일이에요', '쉬는 친구를 눌러 카드를 맡겨요', desk(idle));
  }
  if (step === 'cheer') return view('일하는 친구를 눌러 봐요', '응원하면 잠깐 두 배로 빨라져요', desk(busy));
  if (step === 'finish') {
    if (idle >= 0) return view('남은 카드도 맡겨요', '같은 그림을 단 친구는 두 배 빨라요', desk(idle));
    return busy < 0 ? null : view('곧 다 만들어요', '응원하면 더 빨리 끝나요', desk(busy));
  }
  if (step === 'release') return view('다 만들었어요!', '출시하기를 눌러 게임을 내요', { kind: 'release' });
  if (step === 'gear') {
    if (canBuyGear(state)) return view('낸 게임이 잎사귀를 벌어요', '장비에서 컴퓨터를 올려 봐요', { kind: 'button', panel: 'gear' });
    return state.project ? null : view('낸 게임이 잎사귀를 벌어요', '다음 게임을 골라 계속 만들어요', pick);
  }
  if (step === 'grow') {
    if (state.project) return null;
    return view('게임을 더 내서 평판을 모아요', `평판을 ${OFFICES[1].reputation}까지 모으면 이사해요`, pick);
  }
  if (step === 'move') {
    if (moveBlock(state) === null) return view('평판이 찼어요!', '사무실에서 더 큰 곳으로 이사해요', { kind: 'button', panel: 'office' });
    return state.project ? null : view('이사할 잎사귀를 모아요', `잎사귀 ${OFFICES[1].cost}개로 이사할 수 있어요`, pick);
  }
  const empty = state.desks.findIndex((slot) => slot.staff === null);
  return empty < 0 ? null : view('새 자리가 생겼어요', '빈 자리를 눌러 친구를 뽑아요', desk(empty));
}
