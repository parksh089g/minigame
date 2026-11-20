/**
 * 판을 끝까지 저절로 해 보는 단순한 봇. 테스트가 규칙이 막히지 않고 끝까지 도는지, 난이도가 어느 쪽인지 볼 때 쓴다.
 * 잘하지는 않는다: 낼 수 있는 카드를 차례로 내고(공격은 체력이 가장 적은 적에게), 보상은 첫 카드를 고른다.
 */
import { canPlay, needsTarget } from './battle';
import { CARDS } from './data';
import {
  canChoose,
  canRest,
  chooseEvent,
  chooseNode,
  choiceNeedsCard,
  finishNode,
  leaveEvent,
  rest,
  restUpgrade,
  rewardDone,
  runEndTurn,
  runPlayCard,
  takeBossTreasure,
  takeRewardCard,
  upgradable,
  type RunState,
} from './run';

/** 판이 끝날 때까지(또는 걸음을 다 쓸 때까지) 둔다. 둔 걸음 수를 돌려준다. */
export function autoplay(run: RunState, maxSteps = 20_000): number {
  let steps = 0;
  while (run.result === null && steps < maxSteps) {
    steps += 1;
    botStep(run);
  }
  return steps;
}

/** 한 걸음을 둔다. */
export function botStep(run: RunState): void {
  switch (run.stage) {
    case 'map':
      chooseNode(run, 0);
      return;
    case 'battle': {
      const battle = run.battle;
      if (!battle) return;
      // 마법 카드와 기술을 먼저, 그다음 공격을 낸다.
      const order = battle.hand
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => canPlay(battle, card))
        .sort((a, b) => rank(a.card.id) - rank(b.card.id));
      const first = order[0];
      if (!first) {
        runEndTurn(run);
        return;
      }
      let target: number | null = null;
      if (needsTarget(first.card.id, first.card.up)) {
        let lowest = Infinity;
        battle.foes.forEach((foe, index) => {
          if (!foe.dead && foe.hp < lowest) {
            lowest = foe.hp;
            target = index;
          }
        });
      }
      if (!runPlayCard(run, first.index, target)) runEndTurn(run);
      return;
    }
    case 'reward':
      if (run.reward?.bossPick) takeBossTreasure(run, 0);
      else if (run.reward?.cards) takeRewardCard(run, 0);
      if (rewardDone(run)) finishNode(run);
      return;
    case 'rest':
      if (canRest(run) && run.hp < run.maxHp * 0.6) rest(run);
      else {
        const card = upgradable(run)[0];
        if (card) restUpgrade(run, card.uid);
        else if (canRest(run)) rest(run);
        else finishNode(run);
      }
      return;
    case 'shop':
    case 'chest':
      finishNode(run);
      return;
    case 'event':
      if (run.eventResult !== null) {
        leaveEvent(run);
        return;
      }
      if (canChoose(run, 0)) chooseEvent(run, 0, choiceNeedsCard(run, 0) ? run.deck[0].uid : null);
      else chooseEvent(run, 1);
      return;
    case 'over':
      return;
  }
}

function rank(id: keyof typeof CARDS): number {
  const type = CARDS[id].type;
  return type === 'power' ? 0 : type === 'skill' ? 1 : 2;
}
