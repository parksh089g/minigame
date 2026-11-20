/**
 * 허브 카드의 아랫줄에 띄우는 "오늘 할 일". 큰 게임은 하던 것이 이어지는 게임이라, 최고 기록보다
 * 지금 들어가 볼 까닭을 보여 주는 편이 쓸모 있다: 등불지기는 멈춰 둔 판과 오늘의 판,
 * 새싹 컴퍼니는 다 찬 수익과 오늘의 목표, 텃밭 지키기는 두고 간 판과 씨앗으로 살 수 있는 강화,
 * 행운 슬롯은 두고 간 판과 오늘의 판, 구름 탑 모험은 하던 판과 살 수 있는 강화, 그리고 모두 이번 주의 큰 게임 미션이다.
 * 할 일이 없으면 null이고, 카드에는 원래의 기록 줄이 남는다. 할 일이 있는 카드를 누르면 그 일이 있는 곳을 바로 연다(start).
 *
 * 큰 게임의 저장은 허브 세이브와 따로 기기에 있다. 처음 한 번은 허브를 그린 뒤에 읽어 와서(loadTodos) 아랫줄을 바꾸고,
 * 그 뒤로는 이 곳의 저장소가 들고 있는 것으로 바로 셈한다(todosNow). 그래서 기록 초기화나 가져오기로 저장이 바뀌면
 * 다음에 그리는 허브에 바로 맞게 나온다. 등불지기의 파일은 고치지 않고, 그 게임이 내놓은 저장과 함수만 읽어서 쓴다.
 */
import { dateKeyOf } from '../core/daily';
import { missionProgress, weeklyFor, type WeekContext, type WeeklyState } from '../core/weekly';
import { dailyToday, dayIndexOf } from '../games/lantern-keeper/daily';
import { LANTERN_GAME_ID } from '../games/lantern-keeper/data';
import type { LobbyPage } from '../games/lantern-keeper/lobby';
import { metaStore } from '../games/lantern-keeper/meta';
import { formatClock } from '../games/lantern-keeper/rules';
import { dailyToday as slotDailyToday, dayIndexOf as slotDayOf, SLOT_GAME_ID } from '../games/candy-slot/daily';
import { slotDailyStore } from '../games/candy-slot/daily-store';
import { GARDEN_GAME_ID } from '../games/garden-guard/data';
import { canBuyAny, type GardenMeta } from '../games/garden-guard/rules';
import { gardenStore } from '../games/garden-guard/store';
import { TOWER_GAME_ID } from '../games/cloud-tower/data';
import { canBuyAny as canBuyTowerUpgrade, type TowerMeta } from '../games/cloud-tower/run';
import { towerStore } from '../games/cloud-tower/store';
import { thisWeek } from '../games/registry';
import type { CompanyStart } from '../games/sprout-company/SproutCompanyScene';
import { AWAY, COMPANY_GAME_ID } from '../games/sprout-company/data';
import { hasGoalToClaim, isGoalDone } from '../games/sprout-company/goals';
import type { CompanyState } from '../games/sprout-company/rules';
import { companyStore } from '../games/sprout-company/store';

/** 카드의 아랫줄에 띄울 할 일 */
export interface Todo {
  /** 아랫줄에 쓸 말 */
  text: string;
  /** 카드를 누르면 게임 씬에 넘길 값. 그 일이 있는 곳(오늘의 판 쪽, 목표 창)을 바로 연다. 없으면 여느 때처럼 연다. */
  start?: object;
}

/** 게임 id마다 카드의 아랫줄에 띄울 할 일 */
export type Todos = Partial<Record<string, Todo>>;

/** 등불지기의 준비 화면을 오늘의 판 쪽으로 연다. */
const LANTERN_DAILY = { page: 'daily' } as const satisfies { page: LobbyPage };
/** 새싹 컴퍼니에 들어가며 오늘의 목표 창을 연다. 돌아왔을 때의 알림이 뜨면 그것을 먼저 둔다. */
const COMPANY_GOALS = { panel: 'goals' } as const satisfies CompanyStart;

/**
 * 등불지기의 할 일. 멈춰 둔 판이 있으면 그 판을 이어 하라고 하고(지난 시간과 함께),
 * 없으면 한 번이라도 해 본 사람에게만 오늘의 판을 아직 안 했다고 알린다. 처음 하는 사람에게는 "새 게임"이 낫다.
 */
export function lanternTodo(run: { t: number } | null, playedToday: boolean, playedBefore: boolean): Todo | null {
  if (run) return { text: `이어하기 ${formatClock(run.t)}` };
  if (playedBefore && !playedToday) return { text: '오늘의 판 아직', start: LANTERN_DAILY };
  return null;
}

/**
 * 새싹 컴퍼니의 할 일. 닫아 둔 동안의 수익이 다 찼으면(AWAY.maxSeconds) 더 둬도 늘지 않으니 그것부터 알리고,
 * 아니면 오늘의 목표를 몇 개 채웠는지 보여 준다. 날이 바뀌었으면 새 목표가 기다린다.
 * 목표를 다 채우고 보상까지 받았으면 할 일이 없다. now는 ms, today는 YYYY-MM-DD다.
 */
export function companyTodo(state: CompanyState | null, now: number, today: string): Todo | null {
  if (!state) return null;
  if (now - state.savedAt >= AWAY.maxSeconds * 1000) return { text: '수익 가득' };
  const goals = state.goals;
  if (goals.day !== today) return { text: '새 목표', start: COMPANY_GOALS };
  const count = goals.list.length;
  const done = goals.list.filter((_, index) => isGoalDone(goals, index)).length;
  if (count === 0 || (done >= count && !hasGoalToClaim(goals))) return null;
  return { text: `목표 ${done}/${count}`, start: COMPANY_GOALS };
}

/**
 * 텃밭 지키기의 할 일. 두고 간 판이 있으면 이어 하라고 하고(이어하기 버튼은 준비 화면에 있다),
 * 없으면 해 본 사람이 가진 씨앗으로 살 수 있는 강화가 있을 때 알린다.
 * 게임 이름이 길어서 카드에 남는 폭이 좁다. 날까지 적으면("이어하기 66일째") 두 자리 날부터 큰 화면의 카드에서
 * 글자가 가장 작은 크기 밑으로 줄어서, 날은 적지 않는다(10차 검토 C3). 멈춘 날은 준비 화면의 이어하기 버튼에 적혀 있다.
 */
export function gardenTodo(meta: GardenMeta, hasRun = false): Todo | null {
  if (hasRun) return { text: '이어하기' };
  return meta.runs > 0 && canBuyAny(meta) ? { text: '강화 가능' } : null;
}

/**
 * 구름 탑 모험의 할 일. 하던 판이 있으면 몇 층에서 멈췄는지와 함께 이어 하라고 하고,
 * 없으면 한 번이라도 해 본 사람에게 구름 조각으로 살 수 있는 강화가 있다고 알린다.
 */
export function towerTodo(meta: TowerMeta): Todo | null {
  if (meta.run) return { text: `이어하기 ${Math.max(1, meta.run.floor)}층` };
  return meta.runs > 0 && canBuyTowerUpgrade(meta) ? { text: '강화 가능' } : null;
}

/** 행운 슬롯을 오늘의 판으로 연다(CandySlotScene의 SlotStart). 두고 간 판이 있으면 그 판을 이어 할지 먼저 묻는다. */
const SLOT_DAILY = { daily: true } as const;

/**
 * 행운 슬롯의 할 일. 두고 간 판이 있으면 이어 하라고 하고(이어 하기는 시작 화면에 뜬다),
 * 없으면 한 번이라도 해 본 사람에게만 오늘의 판을 아직 안 했다고 알린다. 누르면 오늘의 판으로 연다(10차 검토 S11).
 * 라운드까지 적으면("이어하기 12라운드") 큰 화면의 카드에서 글자가 가장 작은 크기 밑으로 줄어서 적지 않는다.
 */
export function slotTodo(hasRun: boolean, playedToday: boolean, playedBefore: boolean): Todo | null {
  if (hasRun) return { text: '이어하기' };
  if (playedBefore && !playedToday) return { text: '오늘의 판 아직', start: SLOT_DAILY };
  return null;
}

/**
 * 이번 주의 큰 게임 미션(네 주에 한 번 오는 "등불지기 3판", "새싹 컴퍼니 7번 출시")이 그 게임의 것이고
 * 아직 채우지 않았으면, 그 게임 카드에도 얼마나 했는지 보인다. 다른 할 일이 없을 때만 쓴다.
 */
export function weeklyTodo(gameId: string, week: WeekContext | null, weekly: WeeklyState): Todo | null {
  const mission = week?.missions.find((item) => item.kind === 'big' && item.counts?.includes(gameId));
  const state = week && mission ? weeklyFor(weekly, week.weekKey) : null;
  if (!mission || !state) return null;
  const { current, goal, complete } = missionProgress(mission, state);
  if (complete) return null;
  // 회사는 출시 한 번을 한 판으로 센다.
  return { text: gameId === COMPANY_GAME_ID ? `주간 출시 ${current}/${goal}` : `주간 ${current}/${goal}판` };
}

/** 할 일을 셈하는 데 쓰는 허브 세이브의 것 */
export interface HubRecords {
  /** 그 게임을 한 번이라도 마친 적이 있는지 */
  playedBefore(id: string): boolean;
  /** 주간 미션의 기록. 읽을 때마다 지금의 것을 준다. */
  weekly(): WeeklyState;
  /** 행운 슬롯에 두고 간 판(허브 세이브의 slot.run)이 있는지 */
  slotRun(): boolean;
}

/** 두 게임의 저장을 한 번이라도 읽었는지. 읽기 전에는 저장소가 빈 값을 들고 있어서 할 일을 셈하지 않는다. */
let lanternRead = false;
let companyRead = false;
let gardenRead = false;
let towerRead = false;
let slotDailyRead = false;

/** 지금 이 곳의 저장소가 들고 있는 것으로 할 일을 바로 셈한다. 읽은 적이 없는 게임은 빠진다. */
export function todosNow(records: HubRecords, now: Date = new Date()): Todos {
  const todos: Todos = {};
  const weekly = records.weekly();
  const week = thisWeek(weekly, now);
  const pick = (gameId: string, todo: Todo | null): void => {
    const chosen = todo ?? weeklyTodo(gameId, week, weekly);
    if (chosen) todos[gameId] = chosen;
  };
  if (lanternRead) {
    const playedToday = dailyToday(metaStore.data.daily, dayIndexOf(now)).tries > 0;
    pick(LANTERN_GAME_ID, lanternTodo(metaStore.run, playedToday, records.playedBefore(LANTERN_GAME_ID)));
  }
  if (companyRead) pick(COMPANY_GAME_ID, companyTodo(companyStore.data, now.getTime(), dateKeyOf(now)));
  // 두고 간 판은 허브 세이브에 있어서 늘 읽혀 있다. 오늘의 판을 했는지는 따로 둔 기록을 읽은 뒤에만 따진다.
  const slotRun = records.slotRun();
  if (slotRun || slotDailyRead) {
    const playedToday = slotDailyToday(slotDailyStore.data, slotDayOf(now)).tries > 0;
    pick(SLOT_GAME_ID, slotTodo(slotRun, playedToday, records.playedBefore(SLOT_GAME_ID)));
  }
  if (gardenRead) {
    pick(GARDEN_GAME_ID, gardenTodo(gardenStore.data, gardenStore.run !== null));
  }
  if (towerRead) pick(TOWER_GAME_ID, towerTodo(towerStore.data));
  return todos;
}

/**
 * 큰 게임의 저장을 기기에서 다시 읽고 할 일을 셈한다. 같은 기기의 다른 곳(설치한 앱과 브라우저 탭 같은)에서
 * 그사이 저장한 것이 더 새것이면 그것을 읽는다. 읽지 못한 게임은 빠진다.
 */
export async function loadTodos(records: HubRecords, now: Date = new Date()): Promise<Todos> {
  const [lantern, company, garden, slotDaily, tower] = await Promise.allSettled([
    metaStore.refresh(),
    companyStore.refresh(),
    gardenStore.refresh(),
    slotDailyStore.refresh(),
    towerStore.refresh(),
  ]);
  if (lantern.status === 'fulfilled') lanternRead = true;
  if (company.status === 'fulfilled') companyRead = true;
  if (garden.status === 'fulfilled') gardenRead = true;
  if (slotDaily.status === 'fulfilled') slotDailyRead = true;
  if (tower.status === 'fulfilled') towerRead = true;
  return todosNow(records, now);
}

/** 같은 기기의 다른 곳에서 두 게임의 저장이 바뀌면 부른다. 구독을 끊는 함수를 돌려준다. */
export function watchTodos(listener: () => void): () => void {
  const offLantern = metaStore.onChange(() => listener());
  const offCompany = companyStore.onChange(() => listener());
  return () => {
    offLantern();
    offCompany();
  };
}
