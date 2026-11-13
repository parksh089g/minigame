/**
 * 허브 카드의 아랫줄에 띄우는 "오늘 할 일". 두 큰 게임은 하던 것이 이어지는 게임이라, 최고 기록보다
 * 지금 들어가 볼 까닭을 보여 주는 편이 쓸모 있다: 등불지기는 멈춰 둔 판과 오늘의 판,
 * 새싹 컴퍼니는 다 찬 수익과 오늘의 목표다. 할 일이 없으면 null이고, 카드에는 원래의 기록 줄이 남는다.
 *
 * 두 게임의 저장은 허브 세이브와 따로 기기에 있어서, 허브를 그린 뒤에 읽어 와서 아랫줄을 바꾼다(loadTodos).
 * 등불지기의 파일은 고치지 않고, 그 게임이 내놓은 저장과 함수만 읽어서 쓴다.
 */
import { dateKeyOf } from '../core/daily';
import { dailyToday, dayIndexOf } from '../games/lantern-keeper/daily';
import { LANTERN_GAME_ID } from '../games/lantern-keeper/data';
import { metaStore } from '../games/lantern-keeper/meta';
import { formatClock } from '../games/lantern-keeper/rules';
import { AWAY, COMPANY_GAME_ID } from '../games/sprout-company/data';
import { hasGoalToClaim, isGoalDone } from '../games/sprout-company/goals';
import type { CompanyState } from '../games/sprout-company/rules';
import { companyStore } from '../games/sprout-company/store';

/** 게임 id마다 카드의 아랫줄에 띄울 할 일 */
export type Todos = Partial<Record<string, string>>;

/**
 * 등불지기의 할 일. 멈춰 둔 판이 있으면 그 판을 이어 하라고 하고(지난 시간과 함께),
 * 없으면 한 번이라도 해 본 사람에게만 오늘의 판을 아직 안 했다고 알린다. 처음 하는 사람에게는 "새 게임"이 낫다.
 */
export function lanternTodo(run: { t: number } | null, playedToday: boolean, playedBefore: boolean): string | null {
  if (run) return `이어하기 ${formatClock(run.t)}`;
  if (playedBefore && !playedToday) return '오늘의 판 아직';
  return null;
}

/**
 * 새싹 컴퍼니의 할 일. 닫아 둔 동안의 수익이 다 찼으면(AWAY.maxSeconds) 더 둬도 늘지 않으니 그것부터 알리고,
 * 아니면 오늘의 목표를 몇 개 채웠는지 보여 준다. 날이 바뀌었으면 새 목표가 기다린다.
 * 목표를 다 채우고 보상까지 받았으면 할 일이 없다. now는 ms, today는 YYYY-MM-DD다.
 */
export function companyTodo(state: CompanyState | null, now: number, today: string): string | null {
  if (!state) return null;
  if (now - state.savedAt >= AWAY.maxSeconds * 1000) return '수익 가득';
  const goals = state.goals;
  if (goals.day !== today) return '새 목표';
  const count = goals.list.length;
  const done = goals.list.filter((_, index) => isGoalDone(goals, index)).length;
  if (count === 0 || (done >= count && !hasGoalToClaim(goals))) return null;
  return `목표 ${done}/${count}`;
}

/**
 * 두 큰 게임의 저장을 읽어서 할 일을 모은다. 읽지 못한 게임은 빠진다.
 * playedBefore는 그 게임을 한 번이라도 마친 적이 있는지(허브 세이브의 기록)를 묻는다.
 */
export async function loadTodos(playedBefore: (id: string) => boolean, now: Date = new Date()): Promise<Todos> {
  const todos: Todos = {};
  // 같은 기기의 다른 곳(설치한 앱과 브라우저 탭 같은)에서 그사이 저장한 것이 더 새것이면 그것을 읽는다.
  const [lantern, company] = await Promise.allSettled([metaStore.refresh(), companyStore.refresh()]);
  if (lantern.status === 'fulfilled') {
    const playedToday = dailyToday(metaStore.data.daily, dayIndexOf(now)).tries > 0;
    const todo = lanternTodo(metaStore.run, playedToday, playedBefore(LANTERN_GAME_ID));
    if (todo) todos[LANTERN_GAME_ID] = todo;
  }
  if (company.status === 'fulfilled') {
    const todo = companyTodo(companyStore.data, now.getTime(), dateKeyOf(now));
    if (todo) todos[COMPANY_GAME_ID] = todo;
  }
  return todos;
}
