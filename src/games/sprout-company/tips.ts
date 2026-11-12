/**
 * 처음 겪는 일마다 한 번씩 뜨는 짧은 안내.
 * 어떤 때에 어떤 안내가 뜨는지만 여기에 두고, 글은 data.ts에, 화면에 띄우는 일은 씬에 있다.
 * 본 안내는 회사의 세이브에 적혀서 다시 뜨지 않는다.
 */
import { DEPARTMENT, QUEUE, TIP_IDS, TRAINING, type TipId } from './data';
import { departmentCount, equipmentBlock, hasFreeDesk, hirePool, leadBlock, moveBlock, trainBlock, type CompanyState } from './rules';

/** 안내마다 그것이 뜰 때 */
const WHEN: Readonly<Record<TipId, (state: CompanyState) => boolean>> = {
  income: (state) => state.releases >= 1,
  gear: (state) => state.releases >= 1 && state.desks.some((_, index) => equipmentBlock(state, 'computer', index) === null),
  update: (state) => state.releases >= 2 && state.project === null,
  move: (state) => moveBlock(state) === 'poor' || moveBlock(state) === null,
  hire: (state) => state.office >= 1 && hasFreeDesk(state) && hirePool(state).length > 0,
  goals: (state) => state.releases >= 3 && state.goals.list.length > 0,
  train: (state) => state.office >= TRAINING.unlockOffice && state.desks.some((_, index) => trainBlock(state, index) === null),
  lead: (state) => state.lead === 0 && leadBlock(state) === null,
  rush: (state) => state.offer !== null,
  backlog: (state) => state.backlog.length > 0,
  dept: (state) => state.office >= DEPARTMENT.unlockOffice && departmentCount(state) === 0,
  queue: (state) => state.office >= QUEUE.unlockOffice && state.project !== null && state.queue.length === 0,
};

/** 지금 띄울 안내. 이미 본 것은 건너뛰고, 띄울 것이 없으면 null */
export function nextTip(state: CompanyState): TipId | null {
  return TIP_IDS.find((id) => !state.tips.includes(id) && WHEN[id](state)) ?? null;
}

/** 안내를 본 것으로 적는다. */
export function markTip(state: CompanyState, id: TipId): void {
  if (!state.tips.includes(id)) state.tips.push(id);
}
