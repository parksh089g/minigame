import { describe, expect, it } from 'vitest';
import { MAX_GAME_HEIGHT, MIN_GAME_HEIGHT } from '../config';
import { GAMES, gamesInGroup, stageGames } from '../games/registry';
import { HUB_TABS, listBottom, QUICK_CARD, QUICK_COLUMNS, quickList, STEADY_CARD, steadyList } from './hub-layout';

/** 허브에서 탭 줄의 위쪽 끝부터 목록이 쓸 수 있는 아래쪽 끝까지(HubScene의 TABS_TOP 126, FOOTER_HEIGHT 26) */
const roomAt = (height: number): number => height - 26 - 126;
/** 쪽 넘김 줄의 높이(core/ui.ts의 PAGER_HEIGHT) */
const PAGER = 30;
/** 가장 짧은 화면, 점검하는 두 휴대폰 화면(320×568과 390×844), 가장 긴 화면의 논리 높이 */
const HEIGHTS = [MIN_GAME_HEIGHT, 426, 519, MAX_GAME_HEIGHT];

const STEADY = gamesInGroup(GAMES, 'steady').length;
/** 짧게 즐기는 게임의 카드 수: 게임들과 퍼즐 단계 모드의 카드 */
const QUICK = gamesInGroup(GAMES, 'quick').length + (stageGames().length > 0 ? 1 : 0);

describe('허브의 목록 놓기', () => {
  it('어느 화면에서든 두 갈래의 목록이 쓸 수 있는 자리 안에 놓인다', () => {
    for (let height = MIN_GAME_HEIGHT; height <= MAX_GAME_HEIGHT; height += 1) {
      const room = roomAt(height);
      for (const list of [steadyList(STEADY, room, PAGER), quickList(QUICK, room, PAGER)]) {
        expect(listBottom(list, PAGER), `높이 ${height}`).toBeLessThanOrEqual(room);
        expect(list.top, `높이 ${height}`).toBeGreaterThanOrEqual(HUB_TABS.height + HUB_TABS.depth);
        expect(list.rows).toBeGreaterThanOrEqual(1);
        expect(list.pages).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('꾸준히 하는 게임은 가장 짧은 화면에서도 한 쪽에 다 보인다', () => {
    for (const height of HEIGHTS) {
      const list = steadyList(STEADY, roomAt(height), PAGER);
      expect(list.pages, `높이 ${height}`).toBe(1);
      expect(list.rows, `높이 ${height}`).toBe(STEADY);
      expect(list.card.height).toBeGreaterThanOrEqual(STEADY_CARD.least);
      expect(list.card.height).toBeLessThanOrEqual(STEADY_CARD.tall);
    }
  });

  it('꾸준히 하는 게임의 카드는 자리가 남는 만큼 커지고, 정한 높이보다 더 커지지는 않는다', () => {
    expect(steadyList(4, 218, PAGER).card.height).toBe(STEADY_CARD.least);
    expect(steadyList(4, 274, PAGER).card.height).toBe(55);
    expect(steadyList(4, 2000, PAGER).card.height).toBe(STEADY_CARD.tall);
    expect(steadyList(1, 2000, PAGER)).toMatchObject({ rows: 1, pages: 1 });
  });

  it('꾸준히 하는 게임이 가장 낮은 카드로도 다 들어가지 않으면 쪽으로 나눈다', () => {
    const list = steadyList(9, roomAt(MIN_GAME_HEIGHT), PAGER);
    expect(list.card.height).toBe(STEADY_CARD.least);
    expect(list.pages).toBeGreaterThan(1);
    expect(list.rows * list.pages).toBeGreaterThanOrEqual(9);
    expect(listBottom(list, PAGER)).toBeLessThanOrEqual(roomAt(MIN_GAME_HEIGHT));
  });

  it('짧게 즐기는 게임은 한 줄에 세 개씩 놓고, 모든 카드가 어느 쪽엔가 들어간다', () => {
    for (const height of HEIGHTS) {
      const list = quickList(QUICK, roomAt(height), PAGER);
      expect(list.rows * QUICK_COLUMNS * list.pages, `높이 ${height}`).toBeGreaterThanOrEqual(QUICK);
      // 마지막 쪽이 비지 않는다.
      expect(list.rows * QUICK_COLUMNS * (list.pages - 1), `높이 ${height}`).toBeLessThan(QUICK);
    }
  });

  it('점검하는 두 휴대폰 화면에서는 여느 크기의 카드를 세 줄과 네 줄씩 놓는다', () => {
    expect(quickList(21, roomAt(426), PAGER)).toMatchObject({ card: QUICK_CARD.roomy, rows: 3, pages: 3, compact: false });
    expect(quickList(21, roomAt(519), PAGER)).toMatchObject({ card: QUICK_CARD.roomy, rows: 4, pages: 2, compact: false });
  });

  it('카드를 낮추면 쪽 수가 줄어드는 화면에서만 낮춘 카드를 쓴다', () => {
    // 가장 짧은 화면: 여느 카드로는 두 줄(네 쪽)인데, 낮추면 세 줄(세 쪽)이 들어간다.
    expect(quickList(21, roomAt(MIN_GAME_HEIGHT), PAGER)).toMatchObject({
      card: QUICK_CARD.compact,
      rows: 3,
      pages: 3,
      compact: true,
    });
    // 낮춰도 쪽 수가 같으면 여느 카드를 쓴다.
    expect(quickList(21, roomAt(MAX_GAME_HEIGHT), PAGER).compact).toBe(false);
    // 한 쪽에 다 들어가면 쪽 넘김 줄 없이 여느 카드로 놓는다.
    expect(quickList(6, roomAt(MIN_GAME_HEIGHT), PAGER)).toMatchObject({ rows: 2, pages: 1, compact: false });
    expect(quickList(0, roomAt(MIN_GAME_HEIGHT), PAGER).pages).toBe(1);
  });

  it('목록의 아래쪽 끝은 쪽이 여럿일 때만 쪽 넘김 줄까지 친다', () => {
    const one = quickList(6, roomAt(519), PAGER);
    expect(listBottom(one, PAGER)).toBe(one.top + one.rows * (one.card.height + one.card.gap));
    const many = quickList(21, roomAt(519), PAGER);
    expect(listBottom(many, PAGER)).toBe(many.top + many.rows * (many.card.height + many.card.gap) + PAGER);
  });
});
