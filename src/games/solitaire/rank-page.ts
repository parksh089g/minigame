/**
 * 솔리테어 시작 화면의 오늘의 랭킹 쪽: 그날의 오늘의 판에서 낸 점수를 다른 사람과 견준다.
 * 등불지기의 오늘의 랭킹 쪽(lantern-keeper/rankpage.ts)과 같은 모양이다.
 * 닉네임을 정하지 않았어도 볼 수 있고, 여기서 닉네임을 정해 참여할 수도 있다.
 * 인터넷이 없으면 안내만 보이고, 오늘의 판은 그대로 할 수 있다.
 */
import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { clampPage, layoutPages, pageSlice, type PageLayout } from '../../core/paging';
import { store } from '../../core/store';
import { addText, drawPanel, Pager, PAGER_HEIGHT, PixelButton } from '../../core/ui';
import { failureText, type ApiFailure } from '../../online/api';
import { loadDayBoard, syncScores } from '../../online/online';
import { isJoined, isWaitingToSendDay } from '../../online/profile';
import { rankLabel, type RankBoard, type RankRow } from '../../online/protocol';
import { askNickname } from '../../scenes/nickname';
import { dayLabel, dayResetLabel } from './daily';
import { SOLITAIRE_GAME_ID } from './rules';

const MARGIN = 12;
const WIDTH = GAME_WIDTH - MARGIN * 2;
const RIGHT = GAME_WIDTH - MARGIN;
/** 목록 카드의 위쪽 끝과 안쪽 여백, 맨 위 한 줄(그날의 조건)의 높이, 랭킹 한 줄의 높이 */
const LIST = { top: 70, pad: 6, note: 15, row: 18 } as const;
/** 화면 아래의 내 기록 칸과 닉네임 버튼 */
const FOOT = { status: 34, gap: 6, button: 28, bottom: 8 } as const;
/** 1, 2, 3등의 순위 뒤에 까는 동그라미 색 */
const MEDALS = [COLOR.yellow, COLOR.silver, COLOR.orange] as const;

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'ready'; board: RankBoard };

/** today는 이 기기가 보는 오늘(daily.ts의 dayIndexOf)이다. 서버가 보는 오늘과 다르면 서버의 것을 따른다. */
export function addRankPage(scene: Phaser.Scene, today: number, height: number): void {
  const footTop = height - FOOT.bottom - FOOT.button - FOOT.gap - FOOT.status;
  const cardHeight = footTop - 8 - LIST.top;
  const listTop = LIST.top + LIST.pad + LIST.note;
  const listHeight = cardHeight - LIST.pad * 2 - LIST.note;
  drawPanel(scene.add.graphics(), MARGIN, LIST.top, WIDTH, cardHeight, {
    fill: COLOR.ink,
    border: COLOR.navy,
    shadow: null,
  });

  let view: View = { kind: 'loading' };
  let page = 0;
  let layout: PageLayout = { perPage: 1, pages: 1 };
  /** 마지막으로 내 기록을 올리려다 실패한 까닭. 올라갔거나 올릴 것이 없었으면 null. */
  let sendFailure: ApiFailure | null = null;
  /** 불러오기를 시작할 때마다 올린다. 늦게 온 답이 지금 것이 아니면 버린다. */
  let request = 0;
  // 쪽을 넘기면 같은 장면이 다시 시작된다. 그 뒤에 온 답으로 새 화면에 그리지 않게 한다.
  let alive = true;
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    alive = false;
  });

  const listObjects: Phaser.GameObjects.GameObject[] = [];
  const footObjects: Phaser.GameObjects.GameObject[] = [];
  const clear = (objects: Phaser.GameObjects.GameObject[]): void => {
    for (const object of objects) object.destroy();
    objects.length = 0;
  };

  const showPage = (next: number): void => {
    const target = clampPage(next, layout.pages);
    if (target === page) return;
    page = target;
    pager.set(layout.pages, page);
    drawList();
  };
  const pager = new Pager(scene, GAME_WIDTH / 2, listTop + listHeight - PAGER_HEIGHT, showPage);
  const retry = new PixelButton(scene, {
    x: GAME_WIDTH / 2 - 50,
    y: listTop + listHeight / 2 + 6,
    width: 100,
    height: 26,
    label: '다시 불러오기',
    onTap: () => void fetchBoard(true),
  });

  const addNote = (message: string, offsetY = 0): void => {
    listObjects.push(
      addText(scene, GAME_WIDTH / 2, listTop + listHeight / 2 + offsetY, message, {
        color: CSS.silver,
        align: 'center',
        originX: 0.5,
        originY: 0.5,
        wrapWidth: WIDTH - 32,
      }),
    );
  };

  const addRow = (row: RankRow, y: number): void => {
    const left = MARGIN + 8;
    const middle = y + LIST.row / 2;
    const decor = scene.add.graphics();
    listObjects.push(decor);
    if (row.mine) {
      decor.fillStyle(COLOR.navy, 1);
      decor.fillRoundedRect(MARGIN + 4, y + 1, WIDTH - 8, LIST.row - 2, 6);
    }
    const medal = row.rank <= MEDALS.length;
    if (medal) {
      decor.fillStyle(MEDALS[row.rank - 1], 1);
      decor.fillCircle(left + 8, middle, 7);
    }
    listObjects.push(
      addText(scene, left + 8, middle, String(row.rank), {
        size: medal ? FONT_SIZE.normal : FONT_SIZE.small,
        color: medal ? CSS.ink : CSS.silver,
        bold: medal,
        originX: 0.5,
        originY: 0.5,
      }),
      addText(scene, left + 24, middle, row.name, { color: row.mine ? CSS.yellow : CSS.white, originY: 0.5 }),
      addText(scene, RIGHT - 10, middle, String(row.score), {
        color: row.mine ? CSS.yellow : CSS.white,
        bold: true,
        originX: 1,
        originY: 0.5,
      }),
    );
  };

  function drawList(): void {
    clear(listObjects);
    retry.setVisible(false);
    // 맨 위 한 줄: 오늘 모두가 겨루는 조건과, 언제 새로 시작하는지
    const day = view.kind === 'ready' ? (view.board.day ?? today) : today;
    const note = addText(
      scene,
      GAME_WIDTH / 2,
      LIST.top + LIST.pad + (LIST.note - 2) / 2,
      `${dayLabel(day)}의 판 · ${dayResetLabel(day)}에 새로 시작`,
      { size: FONT_SIZE.small, color: CSS.cyan, originX: 0.5, originY: 0.5 },
    );
    note.setScale(Math.min(1, (WIDTH - 16) / note.width));
    listObjects.push(note);

    if (view.kind === 'loading') {
      addNote('랭킹을 불러오는 중…');
      return;
    }
    if (view.kind === 'failed') {
      addNote(failureText(view.reason), -22);
      retry.setVisible(true);
      return;
    }
    if (view.board.top.length === 0) {
      addNote('오늘은 아직 아무도 없어요.\n첫 번째로 이름을 올려 보세요!');
      return;
    }
    pageSlice(view.board.top, page, layout.perPage).forEach((row, index) => {
      addRow(row, listTop + index * LIST.row);
    });
  }

  /**
   * 오늘의 판에서 낸 내 기록을 서버에 올리지 못했으면 그 사정을 알리는 문구. 다 올라가 있으면 null.
   * 올리지 못한 기록은 세이브에 남아 있다가, 다음에 판을 마치거나 이 쪽을 열 때 다시 올라간다.
   */
  const waitingNote = (): string | null => {
    if (sendFailure === null || !isWaitingToSendDay(store.data.online, SOLITAIRE_GAME_ID, today)) return null;
    return sendFailure === 'slow' ? '기록은 잠시 뒤에 올라가요' : '기록을 아직 올리지 못했어요';
  };

  const nameButton = new PixelButton(scene, {
    x: MARGIN,
    y: footTop + FOOT.status + FOOT.gap,
    width: WIDTH,
    height: FOOT.button,
    label: '',
    onTap: () => void editName(),
  });

  function drawFoot(): void {
    clear(footObjects);
    const online = store.data.online;
    const joined = isJoined(online);
    const middle = footTop + FOOT.status / 2;
    const panel = scene.add.graphics();
    drawPanel(panel, MARGIN, footTop, WIDTH, FOOT.status, { fill: COLOR.ink, border: COLOR.navy, shadow: null });
    footObjects.push(panel);
    if (!joined) {
      footObjects.push(
        addText(scene, GAME_WIDTH / 2, middle, '닉네임을 정하면 오늘의 판 기록이\n랭킹에 올라가요.', {
          size: FONT_SIZE.small,
          color: CSS.silver,
          align: 'center',
          originX: 0.5,
          originY: 0.5,
        }),
      );
    } else {
      const me = view.kind === 'ready' ? view.board.me : null;
      const waiting = view.kind === 'ready' ? waitingNote() : null;
      // 순위는 올라가 있는 기록의 것이다. 새 기록을 올리지 못했으면 순위 대신 그 사정을 알린다.
      const rank = me && waiting === null ? `${rankLabel(me.rank)} · ${me.score}점` : null;
      const status = view.kind !== 'ready' ? '' : (rank ?? waiting ?? '오늘의 판을 마치면 올라가요');
      const name = addText(scene, MARGIN + 10, middle, online.name, { color: CSS.yellow, bold: true, originY: 0.5 });
      const note = addText(scene, RIGHT - 10, middle, status, {
        size: rank ? FONT_SIZE.normal : FONT_SIZE.small,
        color: rank ? CSS.white : CSS.silver,
        align: 'right',
        lineSpacing: 1,
        originX: 1,
        originY: 0.5,
      });
      // 닉네임이 길면 오른쪽 글의 자리가 좁다. 넘치면 작은 글씨로 줄이고 두 줄로 접는다.
      const room = RIGHT - 10 - (name.x + name.width + 6);
      if (note.width > room) note.setFontSize(FONT_SIZE.small).setWordWrapWidth(room, true);
      footObjects.push(name, note);
    }
    nameButton.setLabel(joined ? '닉네임 바꾸기' : '닉네임 정하고 참여하기').setStyle(joined ? 'neutral' : 'green');
  }

  const show = (next: View): void => {
    view = next;
    const rows = view.kind === 'ready' ? view.board.top.length : 0;
    layout = layoutPages(rows, listHeight, LIST.row, PAGER_HEIGHT);
    page = clampPage(page, layout.pages);
    pager.set(layout.pages, page);
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
    const result = await loadDayBoard(SOLITAIRE_GAME_ID);
    if (!alive || mine !== request) return;
    show(result.ok ? { kind: 'ready', board: result.data } : { kind: 'failed', reason: result.reason });
  }

  async function editName(): Promise<void> {
    if (!(await askNickname(scene)) || !alive) return;
    drawFoot();
    await fetchBoard(true);
  }

  void fetchBoard(true);
}
