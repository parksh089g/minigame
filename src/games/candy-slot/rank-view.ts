/**
 * 행운 슬롯의 오늘의 판 랭킹을 화면에 놓는다: 시작 화면의 작은 "랭킹" 버튼과, 화면을 덮는 랭킹 창.
 * 창은 부적 도감처럼 게임 위에 덮이고, 안에 든 것은 등불지기의 오늘의 랭킹 쪽(lantern-keeper/rankpage.ts)과 같다:
 * 위쪽 줄들, 내 순위와 점수, 닉네임을 정해 참여하는 버튼. 닉네임을 정하지 않았어도 볼 수 있다.
 * 인터넷이 없으면 안내와 "다시 불러오기"만 보이고, 오늘의 판은 그대로 할 수 있다.
 * 무엇을 적을지와 어디에 놓을지는 rank.ts가 정하고, 서버와는 online/을 거쳐 주고받는다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { clampPage, pageSlice, type PageLayout } from '../../core/paging';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import type { ApiFailure } from '../../online/api';
import { loadDayBoard, syncScores } from '../../online/online';
import { isJoined, isWaitingToSendDay } from '../../online/profile';
import type { RankRow } from '../../online/protocol';
import { askNickname } from '../../scenes/nickname';
import { LOOK } from './art';
import { SLOT_GAME_ID } from './daily';
import {
  RANK_BOX,
  RANK_TEXT,
  rankDate,
  rankLayout,
  rankListNote,
  rankMine,
  rankNote,
  rankPages,
  type RankState,
} from './rank';
import type { Box } from './rules';

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** 창에 놓는 둥근 버튼. 씬의 버튼(CandySlotScene의 SoftButton)을 그대로 쓴다. */
export interface RankButton extends Disposable {
  setVisible(visible: boolean): unknown;
  setEnabled(enabled: boolean): unknown;
}

export type RankButtonTone = 'gold' | 'mint' | 'plain';

export interface RankViewOptions {
  /** 창이 놓이는 층. 이 게임의 모든 것 위에 덮인다. */
  depth: number;
  /** 이 기기가 보는 오늘(daily.ts의 dayIndexOf). 서버가 보는 오늘과 다르면 창에는 서버의 날이 적힌다. */
  today: number;
  /** 그 자리에 이 게임의 둥근 버튼을 놓는다. */
  button(box: Box, tone: RankButtonTone, label: string, onTap: () => void): RankButton;
  /** 닫기 버튼이나 창 밖을 눌렀을 때 */
  onClose(): void;
}

/** 1, 2, 3등의 순위 뒤에 까는 동그라미: 금, 은, 동 */
const MEDALS = [LOOK.coin.face, LOOK.symbols.horseshoe.face, LOOK.machine.bulbOff] as const;
/** 창의 양옆 안쪽 여백과, 칸 안에서 글이 띄는 여백 */
const SIDE = 10;
const TEXT_PAD = 9;
/** 쪽을 넘기는 버튼과 "다시 불러오기" 버튼, 닫기 버튼의 크기 */
const PAGE_BUTTON = { width: 46, height: 24, apart: 30 } as const;
const RETRY_BUTTON = { width: 108, height: 28 } as const;
const CLOSE_WIDTH = 104;

/** "랭킹"이 적힌 작은 금빛 버튼을 box의 자리에 놓는다. 도감 버튼과 같은 모양이다. */
export function addRankPill(scene: Phaser.Scene, box: Box, depth: number, onTap: () => void): Disposable {
  const { x, y, width, height } = box;
  const back = scene.add.graphics().setDepth(depth);
  const label = addText(scene, Math.round(x + width / 2), Math.round(y + height / 2), RANK_TEXT.button, {
    color: LOOK.text.ink,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth + 0.5);
  const draw = (pressed: boolean): void => {
    back.clear();
    back.fillStyle(LOOK.machine.trimLip, 1);
    back.fillRoundedRect(x, y, width, height, height / 2);
    back.fillStyle(pressed ? LOOK.machine.bulbOff : LOOK.machine.trim, 1);
    back.fillRoundedRect(x + 1.5, y + 1.5, width - 3, height - 3, (height - 3) / 2);
  };
  draw(false);
  // 누르는 자리는 보이는 것보다 조금 넓다. 왼쪽은 판을 바꾸는 버튼과 붙어 있어서 넓히지 않는다.
  const zone = addTapZone(scene, x, y - 2, width + 4, height + 4, draw, () => {
    sfx.click();
    vibrate(8);
    onTap();
  }).setDepth(depth + 0.5);
  return {
    destroy: () => {
      for (const part of [back, label, zone]) part.destroy();
    },
  };
}

/**
 * 랭킹 창을 연다. 올리지 못한 내 기록이 있으면 그것부터 올리고 오늘의 랭킹을 불러온다.
 * 돌려준 것을 destroy하면 창이 닫힌다. 그 뒤에 온 서버의 답은 버린다.
 */
export function openRankView(scene: Phaser.Scene, options: RankViewOptions): Disposable {
  const { depth, today } = options;
  const { width: screenWidth, height: screenHeight } = scene.scale;
  const layout = rankLayout(screenHeight);
  const box: Box = {
    x: Math.round((GAME_WIDTH - RANK_BOX.width) / 2),
    y: layout.top,
    width: RANK_BOX.width,
    height: layout.height,
  };
  const left = box.x + SIDE;
  const right = box.x + box.width - SIDE;
  const inner = right - left;
  const centerX = GAME_WIDTH / 2;
  const small = FONT_SIZE.small;

  // 밑의 것이 눌리지 않게 화면을 덮는다. 창 밖을 누르면 닫히고, 창 안의 빈 곳은 눌러도 그대로다.
  const scrim = scene.add.rectangle(0, 0, screenWidth, screenHeight, THEME.inkDeep, 0.6).setOrigin(0, 0).setDepth(depth);
  const outside = addTapZone(scene, 0, 0, screenWidth, screenHeight, () => undefined, options.onClose).setDepth(depth);
  const panel = scene.add.graphics().setDepth(depth);
  drawPanel(panel, box.x, box.y, box.width, box.height, { radius: 14 });
  // 목록 칸과 내 기록 칸의 바탕
  panel.fillStyle(THEME.bg, 1);
  panel.fillRoundedRect(left, layout.listTop - RANK_BOX.inset, inner, layout.listHeight + RANK_BOX.inset * 2, 10);
  panel.fillRoundedRect(left, layout.statusTop, inner, RANK_BOX.status, 10);
  const inside = scene.add.zone(box.x, box.y, box.width, box.height).setOrigin(0, 0).setInteractive().setDepth(depth);
  const title = addText(scene, box.x + 14, box.y + 9, RANK_TEXT.title, { color: LOOK.text.ink }).setDepth(depth);
  const date = addText(scene, box.x + box.width - 14, box.y + 9, rankDate(today), {
    color: LOOK.text.points,
    originX: 1,
  }).setDepth(depth);
  const note = addText(scene, centerX, box.y + RANK_BOX.head + RANK_BOX.note / 2 - 2, rankNote(today), {
    size: small,
    color: LOOK.text.sub,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth);
  const views: Disposable[] = [scrim, outside, panel, inside, title, date, note];

  let state: RankState = { kind: 'loading' };
  let page = 0;
  let pages: PageLayout = { perPage: 1, pages: 1 };
  /** 마지막으로 내 기록을 올리려다 실패한 까닭. 올라갔거나 올릴 것이 없었으면 null. */
  let sendFailure: ApiFailure | null = null;
  /** 불러오기를 시작할 때마다 올린다. 늦게 온 답이 지금 것이 아니면 버린다. */
  let request = 0;
  /** 창이 닫히면 false. 그 뒤에 온 답으로 그리지 않는다. */
  let alive = true;

  const listObjects: Disposable[] = [];
  const footObjects: Disposable[] = [];
  const clear = (objects: Disposable[]): void => {
    for (const object of objects) object.destroy();
    objects.length = 0;
  };

  // 쪽을 넘기는 줄: 이전 버튼, "1/3", 다음 버튼. 한 쪽에 다 들어가면 보이지 않는다.
  const pagerTop = layout.listTop + layout.listHeight - RANK_BOX.pager + Math.floor((RANK_BOX.pager - PAGE_BUTTON.height) / 2);
  const showPage = (next: number): void => {
    const target = clampPage(next, pages.pages);
    if (target === page) return;
    page = target;
    drawList();
  };
  const pageButton = (x: number, label: string, step: number): RankButton =>
    options.button({ x, y: pagerTop, width: PAGE_BUTTON.width, height: PAGE_BUTTON.height }, 'plain', label, () =>
      showPage(page + step),
    );
  const prev = pageButton(centerX - PAGE_BUTTON.apart / 2 - PAGE_BUTTON.width, RANK_TEXT.prev, -1);
  const next = pageButton(centerX + PAGE_BUTTON.apart / 2, RANK_TEXT.next, 1);
  const pageCount = addText(scene, centerX, pagerTop + (PAGE_BUTTON.height - 3) / 2, '', {
    size: small,
    color: LOOK.text.sub,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth);
  const retry = options.button(
    {
      x: Math.round(centerX - RETRY_BUTTON.width / 2),
      y: Math.round(layout.listTop + layout.listHeight / 2 + 8),
      width: RETRY_BUTTON.width,
      height: RETRY_BUTTON.height,
    },
    'mint',
    RANK_TEXT.retry,
    () => void fetchBoard(true),
  );
  const close = options.button(
    { x: Math.round(centerX - CLOSE_WIDTH / 2), y: layout.closeTop, width: CLOSE_WIDTH, height: RANK_BOX.close },
    'gold',
    RANK_TEXT.close,
    options.onClose,
  );
  views.push(prev, next, pageCount, retry, close);

  const addRow = (row: RankRow, y: number): void => {
    const middle = y + RANK_BOX.row / 2;
    const decor = scene.add.graphics().setDepth(depth);
    if (row.mine) {
      decor.fillStyle(THEME.butterSoft, 1);
      decor.fillRoundedRect(left + 3, y + 1, inner - 6, RANK_BOX.row - 2, 7);
    }
    const medal = row.rank <= MEDALS.length;
    const rankX = left + TEXT_PAD + 7;
    if (medal) {
      decor.fillStyle(MEDALS[row.rank - 1], 1);
      decor.fillCircle(rankX, middle, 7);
    }
    const color = row.mine ? LOOK.text.points : LOOK.text.ink;
    const rank = addText(scene, rankX, middle, String(row.rank), {
      size: medal ? FONT_SIZE.normal : small,
      color: medal ? LOOK.text.ink : LOOK.text.sub,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(depth);
    const score = addText(scene, right - TEXT_PAD, middle, String(row.score), {
      color,
      originX: 1,
      originY: 0.5,
    }).setDepth(depth);
    const name = addText(scene, rankX + 14, middle, row.name, { color, originY: 0.5 }).setDepth(depth);
    // 넓은 글자로 된 닉네임도 점수와 겹치지 않게 줄인다.
    name.setScale(Math.min(1, (score.x - score.width - 6 - name.x) / name.width));
    listObjects.push(decor, rank, name, score);
  };

  function drawList(): void {
    clear(listObjects);
    // 머리글의 날짜와 그 아래 한 줄은 서버가 보는 오늘을 따른다(기기의 시계가 틀렸거나 막 날이 바뀐 때).
    const day = state.kind === 'ready' ? (state.board.day ?? today) : today;
    date.setText(rankDate(day));
    note.setScale(1).setText(rankNote(day));
    note.setScale(Math.min(1, (inner - 8) / note.width));

    const paged = state.kind === 'ready' && pages.pages > 1;
    prev.setVisible(paged);
    prev.setEnabled(page > 0);
    next.setVisible(paged);
    next.setEnabled(page < pages.pages - 1);
    // 빈 글도 글자 상자는 남으므로, 적을 것이 없으면 감춘다.
    pageCount.setText(paged ? `${page + 1}/${pages.pages}` : '').setVisible(paged);
    retry.setVisible(state.kind === 'failed');

    const message = rankListNote(state);
    if (message !== null) {
      const failed = state.kind === 'failed';
      listObjects.push(
        addText(scene, centerX, layout.listTop + layout.listHeight / 2 - (failed ? 20 : 0), message, {
          color: LOOK.text.sub,
          align: 'center',
          originX: 0.5,
          originY: 0.5,
          wrapWidth: inner - 32,
        }).setDepth(depth),
      );
      return;
    }
    if (state.kind !== 'ready') return;
    pageSlice(state.board.top, page, pages.perPage).forEach((row, index) => {
      addRow(row, layout.listTop + index * RANK_BOX.row);
    });
  }

  let nameButton: RankButton | null = null;

  function drawFoot(): void {
    clear(footObjects);
    const online = store.data.online;
    const joined = isJoined(online);
    const middle = layout.statusTop + RANK_BOX.status / 2;
    if (!joined) {
      footObjects.push(
        addText(scene, centerX, middle, RANK_TEXT.guest, {
          size: small,
          color: LOOK.text.sub,
          align: 'center',
          lineSpacing: 1,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(depth),
      );
    } else {
      // 오늘의 판에서 낸 기록을 올리지 못했으면 순위 대신 그 사정을 알린다. 올리지 못한 기록은 세이브에 남아 있다가
      // 다음에 판을 마치거나 이 창을 열 때 다시 올라간다.
      const unsent = sendFailure !== null && isWaitingToSendDay(online, SLOT_GAME_ID, today) ? sendFailure : null;
      const mine = rankMine(state, unsent);
      const name = addText(scene, left + TEXT_PAD, middle, online.name, {
        color: LOOK.text.points,
        originY: 0.5,
      }).setDepth(depth);
      footObjects.push(name);
      if (mine.text !== '') {
        const line = addText(scene, right - TEXT_PAD, middle, mine.text, {
          size: mine.strong ? FONT_SIZE.normal : small,
          color: mine.strong ? LOOK.text.ink : LOOK.text.sub,
          align: 'right',
          lineSpacing: 1,
          originX: 1,
          originY: 0.5,
        }).setDepth(depth);
        // 닉네임이 길면 오른쪽 글의 자리가 좁다. 넘치면 작은 글씨로 줄이고 두 줄로 접어서 닉네임과 겹치지 않게 한다.
        const room = right - TEXT_PAD - (name.x + name.width + 6);
        if (line.width > room) line.setFontSize(small).setWordWrapWidth(room, true);
        footObjects.push(line);
      }
    }
    // 버튼의 색이 참여했는지에 따라 달라서 새로 놓는다.
    nameButton?.destroy();
    nameButton = options.button(
      { x: left, y: layout.nameTop, width: inner, height: RANK_BOX.name },
      joined ? 'plain' : 'mint',
      joined ? RANK_TEXT.rename : RANK_TEXT.join,
      () => void editName(),
    );
  }

  const show = (next: RankState): void => {
    state = next;
    pages = rankPages(state.kind === 'ready' ? state.board.top.length : 0, layout.listHeight);
    page = clampPage(page, pages.pages);
    drawList();
    drawFoot();
  };

  /** 오늘의 랭킹을 불러온다. sync면 올리지 못한 내 기록부터 올린다. */
  async function fetchBoard(sync: boolean): Promise<void> {
    const mine = (request += 1);
    show({ kind: 'loading' });
    if (sync) {
      const outcome = await syncScores();
      sendFailure = outcome.status === 'failed' ? outcome.reason : null;
    }
    if (!alive || mine !== request) return;
    const result = await loadDayBoard(SLOT_GAME_ID);
    if (!alive || mine !== request) return;
    show(result.ok ? { kind: 'ready', board: result.data } : { kind: 'failed', reason: result.reason });
  }

  async function editName(): Promise<void> {
    if (!(await askNickname(scene)) || !alive) return;
    drawFoot();
    await fetchBoard(true);
  }

  // 창을 연 채로 씬이 닫히면 놓인 것은 씬이 치운다. 그 뒤에 온 답으로 닫힌 씬에 그리지 않게 한다.
  const onShutdown = (): void => {
    alive = false;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);

  void fetchBoard(true);

  return {
    destroy: () => {
      if (!alive) return;
      alive = false;
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      clear(listObjects);
      clear(footObjects);
      nameButton?.destroy();
      for (const view of views) view.destroy();
    },
  };
}
