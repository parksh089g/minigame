import { store } from '../core/store';
import { showToast } from '../core/toast';
import { thisWeek, weeklyGames } from '../games/registry';

/**
 * 주가 바뀐 뒤 처음 앱에 들어왔을 때, 지난주에 다 채우고도 받지 않은 주간 미션의 보상을 넣어 주고 한 줄로 알린다.
 * 주가 바뀌면 지난주의 기록이 지워지므로 그 전에 불러야 한다. 허브와, 허브를 거치지 않는 첫 화면에서 부른다.
 * 플레이 중이면 안내는 판이 끝난 뒤에 뜬다.
 */
export function settleLastWeek(): void {
  const week = thisWeek(store.data.weekly);
  if (!week) return;
  announceLastWeek(store.settleLastWeek(week.weekKey, weeklyGames()));
}

/**
 * 지난주 미션 보상을 넣어 줬다고 한 줄로 알린다. 0이면 아무것도 하지 않는다.
 * 허브를 거치지 않고 판을 이어 하다 주가 바뀌면 판을 기록할 때 넣어 주므로(PlayResult.lastWeekCoins), 그때도 이것으로 알린다.
 */
export function announceLastWeek(coins: number): void {
  if (coins > 0) showToast(`지난주 미션 보상 ${coins}코인을 받았어요.`, { sticky: true });
}
