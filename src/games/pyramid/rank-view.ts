/**
 * 피라미드의 오늘의 랭킹 창. 게임 위에 덮이고, 오늘의 판 점수로 다른 사람과 견준다.
 * 위쪽 몇 줄과 내 순위, 닉네임을 정해 참여하는 버튼이 있다. 닉네임을 정하지 않았어도 볼 수 있다.
 * 인터넷이 없으면 안내와 "다시 불러오기"만 보이고, 오늘의 판은 그대로 할 수 있다.
 * 서버와 주고받는 길은 다른 게임의 오늘의 랭킹과 같다(online/online.ts의 syncScores, loadDayBoard).
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { store } from '../../core/store';
import { addText } from '../../core/ui';
import { failureText } from '../../online/api';
import { loadDayBoard, syncScores } from '../../online/online';
import { isJoined } from '../../online/profile';
import { rankLabel as placeLabel, type RankBoard } from '../../online/protocol';
import { askNickname } from '../../scenes/nickname';
import { PX, PX_CSS } from './art';
import { PYRAMID_GAME_ID } from './data';
import { dayLabel } from './daily';
import { RANK_TEXT } from './text';
import { addRowButton, pxBox } from './view';


/** 한 줄의 높이 */
const ROW = 18;
/** 메달 색: 금, 은, 동 */
const MEDALS = [PX.yellow, PX.silver, 0xef7d57] as const;

type State = { kind: 'loading' } | { kind: 'failed'; text: string } | { kind: 'ready'; board: RankBoard };

export interface RankView {
  destroy(): void;
}

/** 랭킹 창을 연다. today는 이 기기가 보는 오늘이다. 서버가 보는 오늘이 다르면 서버의 날을 적는다. */
export function openRankView(scene: Phaser.Scene, depth: number, today: number, onClose: () => void): RankView {
  const { height } = scene.scale;
  const left = 8;
  const width = GAME_WIDTH - 16;
  const top = 12;
  const panelHeight = height - 24;
  const inner = width - 20;
  const fixed: Phaser.GameObjects.GameObject[] = [];
  let body: Phaser.GameObjects.GameObject[] = [];
  let alive = true;
  let request = 0;

  const scrim = scene.add.rectangle(0, 0, GAME_WIDTH, height, PX.ink, 0.78).setOrigin(0, 0).setDepth(depth).setInteractive();
  fixed.push(scrim);
  fixed.push(pxBox(scene.add.graphics().setDepth(depth), left, top, width, panelHeight, { fill: PX.night }));
  const title = addText(scene, left + 10, top + 10, RANK_TEXT.title, { size: 14, color: PX_CSS.accent }).setDepth(depth + 1);
  const date = addText(scene, left + width - 10, top + 12, dayLabel(today), { size: 11, color: PX_CSS.sub, originX: 1 }).setDepth(depth + 1);
  const note = addText(scene, left + 10, top + 30, RANK_TEXT.note(today), { size: 9, color: PX_CSS.faint }).setDepth(depth + 1);
  fixed.push(title, date, note);

  const listTop = top + 48;
  const footHeight = 96;
  const listBottom = top + panelHeight - footHeight;
  const maxRows = Math.max(3, Math.floor((listBottom - listTop) / ROW));

  const close = (): void => {
    view.destroy();
    onClose();
  };
  fixed.push(
    ...addRowButton(scene, {
      x: left + 10,
      y: top + panelHeight - 34,
      width: inner,
      height: 24,
      title: RANK_TEXT.close,
      center: true,
      depth: depth + 1,
      onTap: close,
    }),
  );

  const clearBody = (): void => {
    for (const object of body) object.destroy();
    body = [];
  };

  const text = (x: number, y: number, content: string, color: string, size = 11, originX = 0): Phaser.GameObjects.Text => {
    const made = addText(scene, x, y, content, { size, color, originX, originY: 0.5 }).setDepth(depth + 1);
    body.push(made);
    return made;
  };

  const draw = (state: State): void => {
    clearBody();
    const centerY = (listTop + listBottom) / 2;
    if (state.kind === 'loading') text(GAME_WIDTH / 2, centerY, RANK_TEXT.loading, PX_CSS.sub, 11, 0.5);
    if (state.kind === 'failed') {
      text(GAME_WIDTH / 2, centerY - 16, state.text, PX_CSS.sub, 10, 0.5).setWordWrapWidth(inner, true).setAlign('center');
      body.push(
        ...addRowButton(scene, {
          x: left + 40,
          y: centerY + 4,
          width: width - 80,
          height: 24,
          title: RANK_TEXT.retry,
          center: true,
          depth: depth + 1,
          onTap: () => void fetch(true),
        }),
      );
    }
    if (state.kind === 'ready') {
      const { board } = state;
      if (board.day !== undefined && board.day !== today) date.setText(dayLabel(board.day));
      if (board.top.length === 0) text(GAME_WIDTH / 2, centerY, RANK_TEXT.empty, PX_CSS.sub, 10, 0.5).setAlign('center');
      board.top.slice(0, maxRows).forEach((row, index) => {
        const y = listTop + index * ROW + ROW / 2;
        if (row.mine) {
          const g = scene.add.graphics().setDepth(depth);
          g.fillStyle(PX.navy, 1).fillRect(left + 6, y - ROW / 2 + 1, width - 12, ROW - 2);
          body.push(g);
        }
        const medal = MEDALS[row.rank - 1];
        if (medal !== undefined) {
          const g = scene.add.graphics().setDepth(depth);
          g.fillStyle(medal, 1).fillRect(left + 10, y - 6, 18, 12);
          body.push(g);
        }
        text(left + 19, y, String(row.rank), medal !== undefined ? PX_CSS.dark : PX_CSS.sub, 10, 0.5);
        text(left + 36, y, row.name, row.mine ? PX_CSS.accent : PX_CSS.text);
        text(left + width - 12, y, `${row.score}점`, PX_CSS.text, 11, 1);
      });
    }
    drawFoot(state);
  };

  const drawFoot = (state: State): void => {
    const y = listBottom + 14;
    const online = store.data.online;
    const joined = isJoined(online);
    if (!joined) text(left + 10, y, RANK_TEXT.guest, PX_CSS.sub, 10).setOrigin(0, 0.5);
    else {
      const me = state.kind === 'ready' ? state.board.me : null;
      text(left + 10, y, online.name, PX_CSS.accent, 12);
      text(left + width - 12, y, me ? `${placeLabel(me.rank)} · ${me.score}점` : RANK_TEXT.none, me ? PX_CSS.text : PX_CSS.sub, 11, 1);
    }
    body.push(
      ...addRowButton(scene, {
        x: left + 10,
        y: listBottom + 32,
        width: inner,
        height: 24,
        title: joined ? RANK_TEXT.rename : RANK_TEXT.join,
        center: true,
        fill: joined ? PX.panel : PX.teal,
        depth: depth + 1,
        onTap: () => void editName(),
      }),
    );
  };

  /** 오늘의 랭킹을 불러온다. sync면 올리지 못한 내 기록부터 올린다. */
  async function fetch(sync: boolean): Promise<void> {
    const mine = (request += 1);
    draw({ kind: 'loading' });
    if (sync) await syncScores();
    if (!alive || mine !== request) return;
    const result = await loadDayBoard(PYRAMID_GAME_ID);
    if (!alive || mine !== request) return;
    draw(result.ok ? { kind: 'ready', board: result.data } : { kind: 'failed', text: failureText(result.reason) });
  }

  async function editName(): Promise<void> {
    if (!(await askNickname(scene)) || !alive) return;
    await fetch(true);
  }

  const onShutdown = (): void => {
    alive = false;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  const view: RankView = {
    destroy: () => {
      if (!alive) return;
      alive = false;
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      clearBody();
      for (const object of fixed) object.destroy();
    },
  };
  void fetch(true);
  return view;
}
