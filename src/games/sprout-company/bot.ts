/**
 * 진행 속도를 재는 자동 플레이. 테스트에서만 쓴다.
 * 사람처럼 조금씩 늦게 누르고, 살 수 있는 것은 싼 것부터 사고, 이사할 수 있으면 이사한다.
 */
import { EQUIPMENT, EQUIPMENT_ORDER, LEAD, OFFICES, PROJECTS, type EquipmentDef, type ProjectId } from './data';
import {
  advance,
  assign,
  availableProjects,
  bestCardFor,
  buyEquipment,
  candidatesFor,
  cheer,
  equipmentBlock,
  equipmentCost,
  equipmentLevel,
  hire,
  hireBlock,
  hireCost,
  isReady,
  leadBlock,
  moveBlock,
  moveOffice,
  projectBonus,
  projectIncomeGain,
  projectReputation,
  projectWork,
  promoteLead,
  release,
  startProject,
  train,
  trainBlock,
  trainCost,
  type CompanyState,
} from './rules';

export interface BotOptions {
  /** 응원이 끝난 뒤 다시 누를 때까지 쉬는 시간(초). Infinity면 응원하지 않는다. */
  cheerGap: number;
  /** 빈 책상에 카드를 맡기거나 출시를 누르기까지 걸리는 시간(초) */
  reaction: number;
  /** 0 이상 1 미만의 수를 주는 함수. 지원자를 정할 때 쓴다. */
  random: () => number;
}

export interface BotReport {
  /** 사무실 단계 → 그 단계에 이른 때(초). 아직 못 갔으면 없다. */
  officeAt: number[];
  /** 마지막 사무실의 프로젝트를 모두 한 번씩 낸 때(초). 못 냈으면 null */
  allReleasedAt: number | null;
  releases: number;
  /** 프로젝트 하나를 시작해서 내기까지 가장 오래 걸린 시간(초) */
  slowest: number;
}

const STEP = 0.25;

function pickProject(state: CompanyState): ProjectId {
  const next = OFFICES[state.office + 1];
  const needsReputation = next !== undefined && state.reputation < next.reputation;
  let best: ProjectId = availableProjects(state)[0];
  let bestScore = -1;
  for (const id of availableProjects(state)) {
    const work = projectWork(state, id) * PROJECTS[id].cards.length;
    const leaves = projectBonus(state, id) + projectIncomeGain(state, id) * 180;
    const score = (needsReputation ? projectReputation(state, id) * 1000 + leaves * 0.01 : leaves) / work;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function spend(state: CompanyState, random: () => number): void {
  for (let guard = 0; guard < 50; guard += 1) {
    if (moveOffice(state)) continue;
    const candidate = candidatesFor(state, random)[0];
    if (candidate && hireBlock(state, candidate) === null) {
      hire(state, candidate);
      continue;
    }
    // 이사나 채용을 앞두고 있으면 그 값의 일부만 장비에 쓴다.
    let reserve = 0;
    if (moveBlock(state) === 'poor') reserve = OFFICES[state.office + 1].cost;
    else if (candidate && hireBlock(state, candidate) === 'poor') reserve = hireCost(state);
    // 장비, 팀장, 교육 가운데 가장 싼 것부터 산다.
    let pick: { cost: number; buy: () => void } | null = null;
    const offer = (cost: number, buy: () => void): void => {
      if (!pick || cost < pick.cost) pick = { cost, buy };
    };
    if (leadBlock(state) === null) offer(LEAD.levels[state.lead].cost, () => promoteLead(state));
    for (const id of EQUIPMENT_ORDER) {
      const def: EquipmentDef = EQUIPMENT[id];
      const desks = def.scope === 'desk' ? state.desks.map((_, index) => index) : [-1];
      for (const desk of desks) {
        if (equipmentBlock(state, id, desk) !== null) continue;
        offer(equipmentCost(id, equipmentLevel(state, id, desk)), () => buyEquipment(state, id, desk));
      }
    }
    state.desks.forEach((desk, index) => {
      if (trainBlock(state, index) === null) offer(trainCost(desk.level), () => train(state, index));
    });
    const chosen = pick as { cost: number; buy: () => void } | null;
    if (!chosen || (reserve > 0 && chosen.cost > reserve * 0.2)) return;
    chosen.buy();
  }
}

/** seconds초 동안 자동으로 플레이한다. */
export function runBot(state: CompanyState, seconds: number, options: BotOptions): BotReport {
  const report: BotReport = { officeAt: [0], allReleasedAt: null, releases: 0, slowest: 0 };
  let startedAt = 0;
  const idleFor = state.desks.map(() => 0);
  const restFor = state.desks.map(() => 0);
  let waiting = 0;
  const last = OFFICES.length - 1;
  for (let time = 0; time < seconds; time += STEP) {
    advance(state, STEP);
    if (!state.project) {
      waiting += STEP;
      if (waiting >= options.reaction * 2) {
        startProject(state, pickProject(state));
        startedAt = time;
        waiting = 0;
      }
    } else if (isReady(state)) {
      waiting += STEP;
      if (waiting >= options.reaction) {
        release(state);
        report.releases += 1;
        report.slowest = Math.max(report.slowest, time - startedAt);
        waiting = 0;
      }
    }
    while (idleFor.length < state.desks.length) {
      idleFor.push(0);
      restFor.push(0);
    }
    for (let index = 0; index < state.desks.length; index += 1) {
      const desk = state.desks[index];
      if (!desk.staff) continue;
      if (!desk.task) {
        idleFor[index] += STEP;
        const card = bestCardFor(state, index);
        if (card >= 0 && idleFor[index] >= options.reaction && assign(state, card, index)) idleFor[index] = 0;
      } else if (desk.cheer <= 0) {
        restFor[index] += STEP;
        if (restFor[index] >= options.cheerGap) {
          cheer(state, index);
          restFor[index] = 0;
        }
      }
    }
    spend(state, options.random);
    if (report.officeAt[state.office] === undefined) report.officeAt[state.office] = time;
    if (
      report.allReleasedAt === null &&
      state.office === last &&
      availableProjects(state).every((id) => (state.released[id] ?? 0) > 0)
    ) {
      report.allReleasedAt = time;
    }
  }
  return report;
}
