/**
 * 준비 화면의 오늘의 랭킹 쪽: 그날의 오늘의 판에서 낸 점수를 다른 사람과 견준다.
 * 들어 있는 것과 흐름은 등불지기의 오늘의 랭킹 쪽(lantern-keeper/rankpage.ts)과 같고, 모양만 이 게임의 밝은 카드다.
 * 닉네임을 정하지 않았어도 볼 수 있고, 여기서 닉네임을 정해 참여할 수도 있다.
 * 인터넷이 없으면 안내와 "다시 불러오기"만 보이고, 오늘의 판은 그대로 할 수 있다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { clampPage, layoutPages, pageSlice, type PageLayout } from '../../core/paging';
import { store } from '../../core/store';
import { addText, drawPanel, Pager, PAGER_HEIGHT, PixelButton } from '../../core/ui';
import { failureText, type ApiFailure } from '../../online/api';
import { loadDayBoard, syncScores } from '../../online/online';
import { isJoined, isWaitingToSendDay } from '../../online/profile';
import { rankLabel, type RankBoard, type RankRow } from '../../online/protocol';
import { askNickname } from '../../scenes/nickname';
import { dayLabel, RANK_TEXT, rankNote } from './daily';
import { GARDEN_GAME_ID } from './data';
import { MARGIN, WIDTH } from './shop-row';

const RIGHT = GAME_WIDTH - MARGIN;
/** 목록 카드의 위쪽 끝과 안쪽 여백, 맨 위 한 줄의 높이, 랭킹 한 줄의 높이 */
const LIST = { top: 42, pad: 6, note: 16, row: 18 } as const;
/** 화면 아래의 내 기록 칸과 닉네임 버튼 */
const FOOT = { status: 34, gap: 6, button: 30, bottom: 8 } as const;
/** 1, 2, 3등의 순위 뒤에 까는 동그라미 색: 금, 은, 동 */
const MEDALS = [THEME.gold, THEME.skySoft, THEME.butterDeep] as const;

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'ready'; board: RankBoard };

/**
 * 오늘의 랭킹 쪽을 그린다. today는 이 기기가 보는 오늘(daily.ts의 dayIndexOf)이다. 서버가 보는 오늘과 다르면 서버의 것을 따른다.
 * onBack은 왼쪽 위의 돌아가기 버튼이다.
 */
export function buildRankPage(scene: Phaser.Scene, today: number, onBack: () => void): void {
  const { height } = scene.scale;
  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: onBack,
  });
  addText(scene, 42, 21, RANK_TEXT.title, { size: 16, originY: 0.5 });
  const date = addText(scene, RIGHT, 21, dayLabel(today), {
    size: FONT_SIZE.small,
    color: THEME_CSS.sub,
    originX: 1,
    originY: 0.5,
  });

  const footTop = height - FOOT.bottom - FOOT.button - FOOT.gap - FOOT.status;
  const cardHeight = footTop - 8 - LIST.top;
  const listTop = LIST.top + LIST.pad + LIST.note;
  const listHeight = cardHeight - LIST.pad * 2 - LIST.note;
  drawPanel(scene.add.graphics(), MARGIN, LIST.top, WIDTH, cardHeight, { depth: 2, radius: 10 });

  let view: View = { kind: 'loading' };
  let page = 0;
  let layout: PageLayout = { perPage: 1, pages: 1 };
  /** 마지막으로 내 기록을 올리려다 실패한 까닭. 올라갔거나 올릴 것이 없었으면 null. */
  let sendFailure: ApiFailure | null = null;
  /** 불러오기를 시작할 때마다 올린다. 늦게 온 답이 지금 것이 아니면 버린다. */
  let request = 0;
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
    x: GAME_WIDTH / 2 - 54,
    y: listTop + listHeight / 2 + 6,
    width: 108,
    height: 28,
    label: RANK_TEXT.retry,
    onTap: () => void fetchBoard(true),
  });

  const addNote = (message: string, offsetY = 0): void => {
    listObjects.push(
      addText(scene, GAME_WIDTH / 2, listTop + listHeight / 2 + offsetY, message, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        align: 'center',
        originX: 0.5,
        originY: 0.5,
        wrapWidth: WIDTH - 32,
        lineSpacing: 2,
      }),
    );
  };

  const addRow = (row: RankRow, y: number): void => {
    const left = MARGIN + 8;
    const middle = y + LIST.row / 2;
    const decor = scene.add.graphics();
    listObjects.push(decor);
    if (row.mine) {
      decor.fillStyle(THEME.mintSoft, 1);
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
        color: medal ? THEME_CSS.inkDeep : THEME_CSS.sub,
        originX: 0.5,
        originY: 0.5,
      }),
      addText(scene, left + 24, middle, row.name, { color: row.mine ? THEME_CSS.good : THEME_CSS.ink, originY: 0.5 }),
      addText(scene, RIGHT - 10, middle, String(row.score), {
        color: row.mine ? THEME_CSS.good : THEME_CSS.accent,
        originX: 1,
        originY: 0.5,
      }),
    );
  };

  function drawList(): void {
    clear(listObjects);
    retry.setVisible(false);
    // 맨 위 한 줄: 무엇으로 겨루는지와 언제 새로 시작하는지. 날은 서버가 보는 오늘을 따른다.
    const day = view.kind === 'ready' ? (view.board.day ?? today) : today;
    date.setText(dayLabel(day));
    const note = addText(scene, GAME_WIDTH / 2, LIST.top + LIST.pad + (LIST.note - 2) / 2, rankNote(day), {
      size: FONT_SIZE.small,
      color: THEME_CSS.good,
      originX: 0.5,
      originY: 0.5,
    });
    note.setScale(Math.min(1, (WIDTH - 16) / note.width));
    listObjects.push(note);

    if (view.kind === 'loading') {
      addNote(RANK_TEXT.loading);
      return;
    }
    if (view.kind === 'failed') {
      addNote(failureText(view.reason), -22);
      retry.setVisible(true);
      return;
    }
    if (view.board.top.length === 0) {
      addNote(RANK_TEXT.empty);
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
    if (sendFailure === null || !isWaitingToSendDay(store.data.online, GARDEN_GAME_ID, today)) return null;
    return sendFailure === 'slow' ? RANK_TEXT.slow : RANK_TEXT.unsent;
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
    drawPanel(panel, MARGIN, footTop, WIDTH, FOOT.status, { fill: THEME.butterSoft, shadow: null, radius: 9 });
    footObjects.push(panel);
    if (!joined) {
      footObjects.push(
        addText(scene, GAME_WIDTH / 2, middle, RANK_TEXT.guest, {
          size: FONT_SIZE.small,
          color: THEME_CSS.ink,
          align: 'center',
          originX: 0.5,
          originY: 0.5,
          lineSpacing: 1,
        }),
      );
    } else {
      const me = view.kind === 'ready' ? view.board.me : null;
      const waiting = view.kind === 'ready' ? waitingNote() : null;
      // 순위는 올라가 있는 기록의 것이다. 새 기록을 올리지 못했으면 순위 대신 그 사정을 알린다.
      const rank = me && waiting === null ? `${rankLabel(me.rank)} · ${me.score}점` : null;
      const status = view.kind !== 'ready' ? '' : (rank ?? waiting ?? RANK_TEXT.none);
      const name = addText(scene, MARGIN + 10, middle, online.name, { color: THEME_CSS.good, originY: 0.5 });
      const note = addText(scene, RIGHT - 10, middle, status, {
        size: rank ? FONT_SIZE.normal : FONT_SIZE.small,
        color: rank ? THEME_CSS.accent : THEME_CSS.sub,
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
    nameButton.setLabel(joined ? RANK_TEXT.rename : RANK_TEXT.join).setStyle(joined ? 'neutral' : 'green');
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
    const result = await loadDayBoard(GARDEN_GAME_ID);
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
