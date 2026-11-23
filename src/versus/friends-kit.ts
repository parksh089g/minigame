/**
 * 친구와 하기 화면의 공용 부분. 원카드, 블랙잭, 하이로우가 같이 쓴다(훌라는 먼저 만들어 자기 씬에 따로 있다).
 *
 * 맡는 것:
 * - 준비 화면에 놓는 "친구와 함께" 버튼 두 개(온라인 · 방 코드, 한 폰으로)
 * - 온라인 방 고르기(방 만들기, 코드로 들어가기, 하던 방으로 돌아가기), 친구 기다리기, 방이 닫힌 화면
 * - 한 폰으로 할 때 차례가 바뀌면 화면을 가리고 폰을 넘기게 하는 판(가릴 게 있는 게임만)
 * - 판이 끝난 뒤의 결과 판("한 판 더", "나가기")과, 친구가 나갔을 때의 알림
 * - 씬을 떠날 때 방에서 나가기
 *
 * 판 자체를 그리는 일은 게임 씬이 한다. 방이 바뀔 때마다 onRoom으로 지금 방을 넘겨준다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { promptText, showCode } from '../core/dialog';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { addTapZone, addText, drawPanel, PixelButton, whileBlocked } from '../core/ui';
import { PX, PX_CSS } from '../games/high-low/art';
import { api, failureText, type ApiFailure } from '../online/api';
import { cleanName, NAME_MAX, NAME_MIN } from '../online/protocol';
import { friendStore } from './friend-store';
import { foeSeat, LocalMatch, OnlineMatch, type Match } from './match';
import { cleanRoomCode, formatRoomCode, type RoomGame, type RoomView, type Seat } from './protocol';
import type { TurnGame } from './room';
import { savedRoom } from './saved-room';
import { shortName, withSubject } from './text';

/** 씬을 열 때 넘기는 값 가운데 친구와 하기에 쓰는 것. 게임마다의 시작 값이 이것을 덧붙여 쓴다. */
export interface FriendsStart {
  /** menu는 온라인 방을 만들거나 들어가는 화면, local은 한 폰으로 번갈아 하기 */
  friends?: 'menu' | 'local';
  /** 들어갈 온라인 방. view가 있으면 그것부터 그리고, 없으면 서버에 물어본다. */
  room?: { code: string; token: string; view?: RoomView<unknown> };
}

/** 한 폰으로 번갈아 할 때의 두 사람 이름 */
export const LOCAL_NAMES = ['1P', '2P'] as const;
const NAME_RULE = `${NAME_MIN}~${NAME_MAX}자의 한글, 영문, 숫자로 지어 주세요.`;
const MARGIN = 8;
const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 판 위에 뜨는 것들의 깊이: 결과 판, 폰 넘기기 판 */
const DEPTH = { screen: 60, end: 80, cover: 100 } as const;

/** 판이 끝났을 때 결과 판에 적는 것 */
export interface FriendsResult {
  /** 크게 적는 한 줄. 예: "이겼어요!", "1P가 이겼어요!" */
  title: string;
  /** 그 아래의 작은 줄들 */
  lines: string[];
  /** 밝게(노란 테) 보일지. 이긴 쪽이 보는 화면이거나 한 폰에서 누군가 이겼을 때 */
  bright: boolean;
  /** 진 것처럼 붉게 보일지 */
  lost?: boolean;
}

export interface FriendsOptions<V, M> {
  game: RoomGame;
  /** 친구에게 보내는 글에 쓰는 게임 이름 */
  title: string;
  // 상태(S)의 모양은 게임마다 달라서 여기서는 묻지 않는다(versus/room.ts의 AnyTurnGame과 같은 까닭).
  rules: TurnGame<any, M, V>;
  readView: (raw: unknown) => V | null;
  /** 이 방에서 보는 자리가 둘 차례인지 판에서 읽는다. */
  isMyTurn: (room: RoomView<V>) => boolean;
  /** 한 폰으로 할 때 차례가 바뀌면 화면을 가리고 폰을 넘기게 할지(상대가 몰라야 할 패가 있는 게임) */
  cover: boolean;
  /** 판이 있는 방이 바뀌었다(판이 시작됐거나, 누군가 두었거나, 끝났다). fresh는 새 판이 막 시작된 때 */
  onRoom: (room: RoomView<V>, fresh: boolean) => void;
  /** 판이 끝났을 때 결과 판에 적을 것. won은 보는 자리 쪽에서 본 승패(비기면 null) */
  result: (room: RoomView<V>) => FriendsResult & { won: boolean | null };
  /** 판을 하다가 방이 닫혔을 때. 씬은 버튼을 끈다. */
  onClosed?: () => void;
  /** 판 화면에 알림을 띄운다(서버에 닿지 못할 때) */
  say?: (text: string, warn: boolean) => void;
  /** 폰을 넘길 때 가림 판에 덧붙일 한 줄(상대가 한 일) */
  coverNote?: () => string | null;
  /** 씬을 시작 값과 함께 다시 연다. */
  restart: (data: FriendsStart) => void;
}

/**
 * 한 씬에 하나씩 둔다. 씬의 create에서 만들고, 씬을 다시 열면(restart) 새로 만든다.
 */
export class FriendsKit<V, M> {
  /** 친구와 하는 판. 아직 방이 없으면 null */
  match: Match<V, M> | null = null;
  /** 폰을 넘기는 동안 판을 가리고 있는지. 자동 점검이 들여다본다. */
  covered = false;
  /** 방 고르기, 기다리기처럼 판이 아닌 화면을 보이는 중인지 */
  screenMode: 'none' | 'menu' | 'room' = 'none';
  /** 판 화면을 그리기 시작했는지 */
  inRound = false;
  private screenLayer: Phaser.GameObjects.GameObject[] = [];
  private endLayer: Phaser.GameObjects.GameObject[] = [];
  private coverLayer: Phaser.GameObjects.GameObject[] = [];
  private status: Phaser.GameObjects.Text | null = null;
  private againButton: PixelButton | null = null;
  private shownSeat: Seat | null = null;
  private settledVersion = -1;
  private closedShown = false;
  private sending = false;
  private alive = true;
  /** 지난번에 본 방의 상태. 판이 끝났다가 다시 시작되면 새 판이다. */
  private lastStatus: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: FriendsOptions<V, M>,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.close());
  }

  /** 시작 값에 친구와 하기가 있으면 그 화면을 열고 true */
  begin(data: FriendsStart): boolean {
    if (data.room) this.connectRoom(data.room.code, data.room.token, (data.room.view as RoomView<V> | undefined) ?? null);
    else if (data.friends === 'menu') this.openMenu();
    else if (data.friends === 'local') this.startLocal();
    else return false;
    return true;
  }

  get active(): boolean {
    return this.match !== null || this.screenMode !== 'none';
  }

  get kind(): 'local' | 'online' | null {
    return this.match?.kind ?? null;
  }

  get room(): RoomView<V> | null {
    return this.match?.room ?? null;
  }

  /** 상대의 이름 */
  get foeName(): string {
    const room = this.room;
    return room ? (room.names[foeSeat(room)] ?? '친구') : '친구';
  }

  /** 지금 화면을 보는 사람의 이름. 온라인이면 "나" */
  get myName(): string {
    const room = this.room;
    if (!room || this.kind !== 'local') return '나';
    return room.names[room.seat] ?? '나';
  }

  /** 자리의 이름. 온라인에서 내 자리는 "나" */
  nameOf(seat: Seat): string {
    const room = this.room;
    if (!room) return '';
    if (this.kind === 'online' && seat === room.seat) return '나';
    return room.names[seat] ?? '친구';
  }

  /** 이긴 판 수 한 줄. 한 폰이면 1P와 2P 차례 그대로, 온라인이면 나와 친구 */
  scoreLine(): string {
    const room = this.room;
    if (!room) return '';
    if (this.kind === 'local') return `${room.names[0]} ${room.wins[0]} : ${room.wins[1]} ${room.names[1] ?? ''}`;
    const foe = foeSeat(room);
    return `나 ${room.wins[room.seat]} : ${room.wins[foe]} ${shortName(room.names[foe] ?? '친구', 6)}`;
  }

  myTurn(): boolean {
    return !!this.match && !this.covered && !this.sending && this.match.myTurn();
  }

  // ───────── 준비 화면 ─────────

  /** 준비 화면에 놓는 "친구와 함께" 버튼. 누르면 한 폰으로 할지, 온라인으로 할지 고르는 화면이 열린다. */
  lobbyButton(x: number, y: number, width: number, height: number): PixelButton {
    return new PixelButton(this.scene, {
      x,
      y,
      width,
      height,
      label: '친구와 함께',
      style: 'blue',
      onTap: () => this.options.restart({ friends: 'menu' }),
    });
  }

  // ───────── 친구와 함께: 고르기 ─────────

  private openMenu(): void {
    this.screenMode = 'menu';
    const scene = this.scene;
    this.header(`${this.options.title} · 친구와 함께`, () => this.options.restart({}));

    type Row = { title: string; note: string; onTap: () => void; gold?: boolean };
    const local: Row = { title: '한 폰으로 번갈아 하기', note: '인터넷 없이 한 폰을 주고받아요', onTap: () => this.options.restart({ friends: 'local' }) };
    const online: Row[] = [];
    const saved = savedRoom.get(this.options.game);
    if (saved) {
      online.push({
        title: '하던 방으로 돌아가기',
        note: `방 코드 ${formatRoomCode(saved.code)}`,
        gold: true,
        onTap: () => this.options.restart({ room: { code: saved.code, token: saved.token } }),
      });
    }
    online.push(
      { title: '방 만들기', note: '코드를 받아 친구에게 보내요', onTap: () => this.makeRoom() },
      { title: '코드로 들어가기', note: '친구가 보낸 여섯 글자를 넣어요', onTap: () => this.joinByCode() },
    );
    const rowHeight = 46;
    const drawRow = (row: Row, top: number): void => {
      const g = this.screen(scene.add.graphics());
      const draw = (pressed: boolean): void => {
        g.clear();
        drawPanel(g, MARGIN, top + (pressed ? 1 : 0), WIDTH, rowHeight, {
          fill: pressed ? PX.navy : PX.panel,
          border: row.gold ? PX.yellow : PX.edge,
          shadow: PX.ink,
          radius: 4,
          depth: 2,
        });
      };
      draw(false);
      this.screen(addText(scene, MARGIN + 10, top + 7, row.title, { size: 14, color: row.gold ? PX_CSS.accent : PX_CSS.text }));
      this.screen(addText(scene, MARGIN + 10, top + 27, row.note, { size: 10, color: PX_CSS.sub }));
      this.screen(addTapZone(scene, MARGIN, top, WIDTH, rowHeight, draw, row.onTap) as unknown as Phaser.GameObjects.GameObject);
    };

    let y = 44;
    drawRow(local, y);
    y += rowHeight + 12;
    this.screen(addText(scene, MARGIN + 2, y, '온라인 · 각자 자기 폰으로', { size: 11, color: PX_CSS.text }));
    const record = friendStore.record(this.options.game);
    if (record.wins + record.losses > 0) {
      this.screen(addText(scene, MARGIN + WIDTH, y + 1, `${record.wins}승 ${record.losses}패`, { size: 9, color: PX_CSS.faint, originX: 1 }));
    }
    y += 18;
    for (const row of online) {
      drawRow(row, y);
      y += rowHeight + 6;
    }
    this.status = this.screen(addText(scene, GAME_WIDTH / 2, y + 2, '', { size: 10, color: PX_CSS.text, originX: 0.5, align: 'center', wrapWidth: WIDTH - 8 }));

    const notes = ['두 사람 모두 인터넷이 있어야 해요', '30분 동안 아무도 안 하면 방이 닫혀요'];
    const lineHeight = 15;
    const boxHeight = notes.length * lineHeight + 12;
    const boxTop = Math.max(y + 34, scene.scale.height - 8 - boxHeight);
    drawPanel(this.screen(scene.add.graphics()), MARGIN, boxTop, WIDTH, boxHeight, { fill: PX.ink, border: PX.edge, shadow: null, radius: 4 });
    notes.forEach((line, i) => this.screen(addText(scene, MARGIN + 8, boxTop + 7 + i * lineHeight, `· ${line}`, { size: 10, color: PX_CSS.sub })));
  }

  private menuSay(text: string, warn = false): void {
    if (this.screenMode === 'none' || !this.alive || !this.status) return;
    this.status.setText(text).setColor(warn ? PX_CSS.bad : PX_CSS.text);
  }

  private menuFail(reason: ApiFailure): void {
    this.menuSay(reason === 'offline' ? '인터넷에 닿지 못했어요.\n인터넷이 없으면 한 폰으로 해 봐요.' : failureText(reason), true);
  }

  /** 친구 화면에 보일 내 이름을 묻는다. 지난번 이름이나 랭킹 닉네임을 미리 적어 둔다. 그만두면 null */
  private async askName(): Promise<string | null> {
    const answer = await promptText({
      title: '내 이름',
      hint: '친구 화면에 보이는 이름이에요.',
      value: friendStore.name() ?? store.data.online.name ?? '',
      placeholder: '이름',
      maxLength: NAME_MAX,
      confirmLabel: '좋아요',
      check: (value) => {
        const name = cleanName(value);
        return name === null ? { error: NAME_RULE } : { value: name };
      },
    });
    if (answer.action !== 'confirm') return null;
    friendStore.setName(answer.value);
    return answer.value;
  }

  private makeRoom(): void {
    void whileBlocked(this.scene, async () => {
      if (navigator.onLine === false) return this.menuFail('offline');
      const name = await this.askName();
      if (!name || !this.alive) return;
      this.menuSay('방을 만드는 중이에요…');
      const result = await api.openRoom(this.options.game, name, this.options.readView);
      if (!this.alive) return;
      if (!result.ok) return this.menuFail(result.reason);
      const { token, room } = result.data;
      savedRoom.set(this.options.game, room.code, token);
      this.options.restart({ room: { code: room.code, token, view: room } });
    });
  }

  private joinByCode(): void {
    void whileBlocked(this.scene, async () => {
      if (navigator.onLine === false) return this.menuFail('offline');
      const asked = await promptText({
        title: '방 코드',
        hint: '친구가 보낸 여섯 글자를 넣어 주세요.',
        placeholder: 'ABC-DEF',
        maxLength: 9,
        code: true,
        confirmLabel: '다음',
        check: (value) => {
          const code = cleanRoomCode(value);
          return code === null ? { error: '여섯 글자 코드를 다시 확인해 주세요.' } : { value: code };
        },
      });
      if (asked.action !== 'confirm' || !this.alive) return;
      const name = await this.askName();
      if (!name || !this.alive) return;
      this.menuSay('방에 들어가는 중이에요…');
      const result = await api.joinRoom(asked.value, name, this.options.readView);
      if (!this.alive) return;
      if (!result.ok) {
        if (result.reason === 'notfound') this.menuSay('없는 방이거나 이미 둘이 들어간 방이에요.\n다른 게임의 방일 수도 있어요.', true);
        else this.menuFail(result.reason);
        return;
      }
      const { token, room } = result.data;
      savedRoom.set(this.options.game, room.code, token);
      this.options.restart({ room: { code: room.code, token, view: room } });
    });
  }

  // ───────── 방 잇기 ─────────

  private connectRoom(code: string, token: string, view: RoomView<V> | null): void {
    this.screenMode = 'room';
    if (view) {
      this.attachOnline(token, view);
      return;
    }
    this.header('방으로 돌아가는 중', () => this.exit());
    this.status = this.screen(
      addText(this.scene, GAME_WIDTH / 2, this.scene.scale.height / 2, '방에 다시 들어가는 중이에요…', {
        size: 11,
        color: PX_CSS.text,
        originX: 0.5,
        originY: 0.5,
        align: 'center',
        wrapWidth: WIDTH - 8,
      }),
    );
    void api.lookRoom(code, token, 0, this.options.readView).then((result) => {
      if (!this.alive) return;
      if (result.ok && result.data !== 'same') {
        this.clearScreen();
        this.attachOnline(token, result.data);
        return;
      }
      if (!result.ok && result.reason === 'notfound') savedRoom.clear();
      this.menuSay(
        !result.ok && result.reason !== 'notfound' ? failureText(result.reason) : '방이 닫혔어요.\n30분 동안 아무도 하지 않으면 방이 사라져요.',
        true,
      );
    });
  }

  private attachOnline(token: string, view: RoomView<V>): void {
    const match = new OnlineMatch<V, M>(api, token, view, this.options.readView, this.options.isMyTurn);
    this.match = match;
    match.onChange(() => this.onChange());
    // 다른 앱에 다녀오면 바로 소식을 묻는다(기다리는 동안 앱이 잠들어 묻지 못했을 수 있다).
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void match.poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener('visibilitychange', onVisible));
    this.onChange();
  }

  private startLocal(): void {
    this.screenMode = 'room';
    this.match = new LocalMatch(this.options.rules, LOCAL_NAMES);
    this.match.onChange(() => this.onChange());
    this.onChange();
  }

  /** 씬을 떠날 때. 온라인 방이면 방을 나간다. 판을 하는 중에 나가면 진 판으로 센다. */
  private close(): void {
    this.alive = false;
    const match = this.match;
    if (!match) return;
    if (match.kind === 'online') {
      if (match.room.status === 'playing') friendStore.addResult(this.options.game, false);
      if (match.room.status !== 'closed') match.leave();
      savedRoom.clear();
    }
    match.stop();
  }

  /** 방에서 나가 방 고르기(온라인) 또는 준비 화면(한 폰)으로 간다. */
  exit(): void {
    const online = this.kind === 'online' || (this.screenMode === 'room' && this.kind !== 'local');
    this.options.restart(online ? { friends: 'menu' } : {});
  }

  /** 뒤로 가기. 처리했으면 true(판을 하는 중이면 씬이 일시정지를 연다). */
  back(): boolean {
    if (this.screenMode === 'menu') {
      this.options.restart({});
      return true;
    }
    const status = this.room?.status;
    if (!this.inRound || status === 'over' || status === 'closed' || status === 'waiting') {
      if (this.active) {
        this.exit();
        return true;
      }
    }
    return false;
  }

  /** 일시정지 화면의 "처음부터 다시" 대신 적을 이름 */
  restartLabel(): string | null {
    if (this.kind === 'online') return '방에서 나가고 처음으로';
    if (this.kind === 'local') return '그만하고 처음으로';
    return null;
  }

  /** 그만하기 전에 한 번 더 물을 말 */
  quitWarning(): string | null {
    if (this.kind === 'online' && this.room?.status === 'playing') return '지금 나가면 진 판으로 치고 방이 닫혀요';
    return null;
  }

  // ───────── 수 두기 ─────────

  /** 수를 보낸다. 받아들여졌으면 true. 받지 않았으면 거절음을 내고 알린다. */
  async send(move: M): Promise<boolean> {
    const match = this.match;
    if (!match || this.sending || this.covered) return false;
    this.sending = true;
    try {
      const ok = await match.send(move);
      if (!this.alive || this.match !== match) return false;
      if (!ok) {
        sfx.deny();
        if (match.trouble) this.options.say?.(`${failureText(match.trouble)}\n다시 눌러 주세요`, true);
      }
      return ok;
    } finally {
      this.sending = false;
    }
  }

  get busy(): boolean {
    return this.sending;
  }

  // ───────── 방이 바뀌었을 때 ─────────

  private onChange(): void {
    const match = this.match;
    if (!match || !this.alive) return;
    const room = match.room;
    if (match.kind === 'online') {
      if (room.status === 'closed') savedRoom.clear();
      else savedRoom.set(this.options.game, room.code, (match as OnlineMatch<V, M>).token);
    }
    if (room.status === 'waiting') {
      this.showWaiting(room);
      return;
    }
    if (room.status === 'closed') {
      this.showClosed(room);
      return;
    }
    if (!room.game) return;
    let fresh = false;
    if (!this.inRound) {
      this.clearScreen();
      this.inRound = true;
      this.screenMode = 'none';
      fresh = true;
    }
    if (room.status === 'playing' && this.lastStatus === 'over') {
      // 한 판 더: 지난 판의 결과 판을 치운다.
      this.clearEnd();
      this.shownSeat = null;
      fresh = true;
    }
    this.lastStatus = room.status;
    this.options.onRoom(room, fresh);
    if (room.status === 'over') {
      if (this.settledVersion !== room.version) this.showResult(room);
      else this.updateAgain(room);
    } else if (this.options.cover && match.kind === 'local' && this.shownSeat !== room.seat) {
      this.shownSeat = room.seat;
      this.showCover(room);
    }
    if (match.trouble && room.status === 'playing') this.options.say?.(`${failureText(match.trouble)}\n다시 잇는 중이에요…`, true);
  }

  /** 친구를 기다리는 화면: 방 코드와 보내기 버튼 */
  private showWaiting(room: RoomView<V>): void {
    if (this.screenLayer.length > 0 && this.status) {
      const trouble = this.match?.trouble;
      this.menuSay(trouble ? `${failureText(trouble)}\n다시 잇는 중이에요…` : '친구가 들어오기를 기다리는 중…', trouble != null);
      return;
    }
    const scene = this.scene;
    const { height } = scene.scale;
    this.header('방을 만들었어요', () => this.exit());
    const top = 56;
    drawPanel(this.screen(scene.add.graphics()), MARGIN, top, WIDTH, 112, { fill: PX.panel, border: PX.yellow, shadow: PX.ink, radius: 4 });
    this.screen(addText(scene, GAME_WIDTH / 2, top + 12, `${this.options.title} 방 코드`, { size: 11, color: PX_CSS.sub, originX: 0.5 }));
    this.screen(addText(scene, GAME_WIDTH / 2, top + 30, formatRoomCode(room.code), { size: 30, color: PX_CSS.accent, originX: 0.5 }));
    this.screen(
      addText(scene, GAME_WIDTH / 2, top + 78, '친구에게 이 코드를 보내 주세요.\n친구가 들어오면 바로 시작해요.', {
        size: 10,
        color: PX_CSS.text,
        originX: 0.5,
        align: 'center',
      }),
    );
    this.button({ x: MARGIN, y: top + 124, width: WIDTH, height: 36, label: '코드 보내기', style: 'yellow', onTap: () => void this.shareCode(room.code) });
    this.button({ x: MARGIN, y: top + 168, width: WIDTH, height: 30, label: '방 닫기', onTap: () => this.exit() });
    this.status = this.screen(
      addText(scene, GAME_WIDTH / 2, Math.min(height - 40, top + 216), '친구가 들어오기를 기다리는 중…', {
        size: 11,
        color: PX_CSS.text,
        originX: 0.5,
        align: 'center',
        wrapWidth: WIDTH - 8,
      }),
    );
    const dots = this.screen(addText(scene, GAME_WIDTH / 2, Math.min(height - 22, top + 236), '●  ●  ●', { size: 10, color: PX_CSS.faint, originX: 0.5 }));
    scene.tweens.add({ targets: dots, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });
  }

  /** 방 코드를 메신저로 보낸다. 보내기를 못 하는 브라우저면 복사할 수 있게 크게 보여 준다. */
  private async shareCode(code: string): Promise<void> {
    const text = `포켓 아케이드에서 ${this.options.title} 같이 해요! 방 코드: ${formatRoomCode(code)}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text, url: `${location.origin}${location.pathname}` });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await showCode({ title: '방 코드', code: formatRoomCode(code), hint: '복사해서 친구에게 보내 주세요.' });
  }

  /** 방이 닫혔을 때: 친구가 나갔거나, 오래 두지 않아 방이 사라졌다. */
  private showClosed(room: RoomView<V>): void {
    if (this.closedShown) return;
    this.closedShown = true;
    const wasPlaying = this.inRound && this.lastStatus === 'playing';
    this.match?.stop();
    const foeLeft = room.left !== null && room.left !== room.seat;
    if (wasPlaying && foeLeft && this.kind === 'online') friendStore.addResult(this.options.game, true);
    const title = foeLeft ? `${withSubject(this.foeName)} 나갔어요` : '방이 닫혔어요';
    const note = foeLeft ? (wasPlaying ? '하던 판은 내가 이긴 것으로 쳐요' : '다시 하려면 방을 새로 만들어요') : '30분 동안 아무도 하지 않으면 방이 사라져요';
    const scene = this.scene;

    if (!this.inRound) {
      this.clearScreen();
      this.header('방이 닫혔어요', () => this.exit());
      this.status = this.screen(
        addText(scene, GAME_WIDTH / 2, scene.scale.height / 2 - 20, `${title}\n${note}`, {
          size: 11,
          color: PX_CSS.text,
          originX: 0.5,
          originY: 0.5,
          align: 'center',
          wrapWidth: WIDTH - 8,
        }),
      );
      this.button({ x: MARGIN, y: scene.scale.height / 2 + 20, width: WIDTH, height: 34, label: '나가기', onTap: () => this.exit() });
      return;
    }
    this.hideCover();
    this.clearEnd();
    this.options.onClosed?.();
    const boxHeight = 96;
    const boxTop = Math.round(scene.scale.height / 2 - boxHeight / 2);
    this.endBox(boxTop, boxHeight, false);
    this.end(addText(scene, GAME_WIDTH / 2, boxTop + 12, title, { size: 15, color: PX_CSS.text, originX: 0.5 }).setDepth(DEPTH.end + 1));
    this.end(addText(scene, GAME_WIDTH / 2, boxTop + 34, note, { size: 10, color: PX_CSS.sub, originX: 0.5 }).setDepth(DEPTH.end + 1));
    this.endButton({ x: MARGIN + 20, y: boxTop + boxHeight - 44, width: WIDTH - 40, height: 32, label: '나가기', onTap: () => this.exit() });
    if (foeLeft) sfx.deny();
  }

  /** 판이 끝났다: 결과 판에 "한 판 더"와 "나가기"를 둔다. */
  private showResult(room: RoomView<V>): void {
    this.settledVersion = room.version;
    this.hideCover();
    this.clearEnd();
    const result = this.options.result(room);
    if (this.kind === 'online') friendStore.addResult(this.options.game, result.won);
    const scene = this.scene;
    const lineHeight = 15;
    // 제목, 작은 줄들, 이긴 판 수, 버튼 차례로 쌓는다.
    const scoreY = 34 + result.lines.length * lineHeight + 2;
    const boxHeight = scoreY + 14 + 8 + 34 + 10;
    const boxTop = Math.round(scene.scale.height / 2 - boxHeight / 2);
    this.endBox(boxTop, boxHeight, result.bright);
    this.end(
      addText(scene, GAME_WIDTH / 2, boxTop + 10, result.title, {
        size: 16,
        color: result.bright ? PX_CSS.accent : result.lost ? PX_CSS.bad : PX_CSS.text,
        originX: 0.5,
      }).setDepth(DEPTH.end + 1),
    );
    result.lines.forEach((line, index) =>
      this.end(addText(scene, GAME_WIDTH / 2, boxTop + 34 + index * lineHeight, line, { size: 10, color: index === 0 ? PX_CSS.text : PX_CSS.sub, originX: 0.5 }).setDepth(DEPTH.end + 1)),
    );
    this.end(addText(scene, GAME_WIDTH / 2, boxTop + scoreY, this.scoreLine(), { size: 9, color: PX_CSS.faint, originX: 0.5 }).setDepth(DEPTH.end + 1));
    const half = Math.floor((WIDTH - 40 - 6) / 2);
    this.againButton = this.endButton({ x: MARGIN + 20, y: boxTop + boxHeight - 44, width: half, height: 34, label: '한 판 더', style: 'green', onTap: () => this.askAgain() });
    this.endButton({ x: MARGIN + WIDTH - 20 - half, y: boxTop + boxHeight - 44, width: half, height: 34, label: '나가기', onTap: () => this.exit() });
    if (result.bright) {
      sfx.gold();
      vibrate([20, 40, 20]);
    } else {
      sfx.finish();
    }
    this.updateAgain(room);
  }

  /** "한 판 더"를 누른 사람을 알린다. 온라인에서는 둘 다 눌러야 시작한다. */
  private updateAgain(room: RoomView<V>): void {
    if (this.kind !== 'online' || room.status !== 'over') return;
    const mine = room.again[room.seat];
    const theirs = room.again[foeSeat(room)];
    if (mine) {
      this.againButton?.setEnabled(false).setLabel('기다리는 중');
      this.options.say?.(`${withSubject(this.foeName)} 한 판 더를 누르면 시작해요`, false);
    } else if (theirs) {
      this.options.say?.(`${withSubject(this.foeName)} 한 판 더 하고 싶어 해요!`, false);
    }
  }

  private askAgain(): void {
    const match = this.match;
    if (!match) return;
    this.againButton?.setEnabled(false);
    void match.again().then(() => {
      if (!this.alive || this.match !== match) return;
      if (match.trouble) {
        this.againButton?.setEnabled(true);
        this.options.say?.(failureText(match.trouble), true);
      }
    });
  }

  // ───────── 폰 넘기기 ─────────

  /** 한 폰으로 할 때 차례가 바뀌면 판을 가리고, 다음 사람에게 폰을 넘기게 한다. */
  private showCover(room: RoomView<V>): void {
    this.hideCover();
    this.covered = true;
    const scene = this.scene;
    const { height } = scene.scale;
    const name = room.names[room.seat] ?? '';
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.coverLayer.push(object);
      return object;
    };
    const g = keep(scene.add.graphics().setDepth(DEPTH.cover));
    g.fillStyle(PX.ink, 1);
    g.fillRect(0, 0, GAME_WIDTH, height);
    const mid = Math.round(height / 2);
    // 엎어 둔 카드 두 장
    const cards = keep(scene.add.graphics().setDepth(DEPTH.cover + 1));
    for (const [dx, tilt] of [[-12, -0.14], [12, 0.14]] as const) {
      const cx = GAME_WIDTH / 2 + dx;
      const cy = mid - 72;
      const w = 34;
      const h = 48;
      const corners = [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].map(([x, y]) => new Phaser.Math.Vector2(cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)));
      cards.fillStyle(PX.white, 1).fillPoints(corners, true);
      const inner = corners.map((point) => new Phaser.Math.Vector2(cx + (point.x - cx) * 0.8, cy + (point.y - cy) * 0.85));
      cards.fillStyle(PX.blue, 1).fillPoints(inner, true);
    }
    keep(addText(scene, GAME_WIDTH / 2, mid - 26, `${name} 차례예요`, { size: 20, color: PX_CSS.accent, originX: 0.5 }).setDepth(DEPTH.cover + 1));
    keep(addText(scene, GAME_WIDTH / 2, mid + 4, `폰을 ${name}에게 넘겨 주세요`, { size: 12, color: PX_CSS.text, originX: 0.5 }).setDepth(DEPTH.cover + 1));
    const note = this.options.coverNote?.();
    if (note) {
      keep(addText(scene, GAME_WIDTH / 2, mid + 28, note, { size: 10, color: PX_CSS.sub, originX: 0.5, align: 'center', wrapWidth: WIDTH - 16 }).setDepth(DEPTH.cover + 1));
    }
    keep(addText(scene, GAME_WIDTH / 2, height - 40, '화면을 누르면 시작해요', { size: 11, color: PX_CSS.good, originX: 0.5 }).setDepth(DEPTH.cover + 1));
    const zone = keep(scene.add.zone(0, 0, GAME_WIDTH, height).setOrigin(0, 0).setDepth(DEPTH.cover + 2).setInteractive({ useHandCursor: true }));
    zone.once(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      sfx.click();
      this.hideCover();
      const room = this.room;
      if (room) this.options.onRoom(room, false);
    });
  }

  private hideCover(): void {
    for (const object of this.coverLayer) object.destroy();
    this.coverLayer = [];
    this.covered = false;
  }

  // ───────── 그리기 도움 ─────────

  private screen<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.screenLayer.push(object);
    if ('setDepth' in object && typeof object.setDepth === 'function') (object as unknown as Phaser.GameObjects.Components.Depth).setDepth(DEPTH.screen);
    return object;
  }

  private clearScreen(): void {
    for (const object of this.screenLayer) object.destroy();
    this.screenLayer = [];
    this.status = null;
  }

  private end<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.endLayer.push(object);
    return object;
  }

  private clearEnd(): void {
    for (const object of this.endLayer) object.destroy();
    this.endLayer = [];
    this.againButton = null;
  }

  private endBox(top: number, height: number, bright: boolean): void {
    const scene = this.scene;
    const shade = this.end(scene.add.rectangle(0, 0, GAME_WIDTH, scene.scale.height, PX.ink, 0.45).setOrigin(0, 0).setDepth(DEPTH.end - 1).setInteractive());
    void shade;
    drawPanel(this.end(scene.add.graphics().setDepth(DEPTH.end)), MARGIN + 10, top, WIDTH - 20, height, {
      fill: PX.panel,
      border: bright ? PX.yellow : PX.edge,
      shadow: PX.ink,
      radius: 4,
      depth: 3,
    });
  }

  /** 판이 아닌 화면의 바탕과 머리: 어두운 바탕, 뒤로 버튼, 제목 */
  private header(title: string, onBack: () => void): void {
    const scene = this.scene;
    const bg = this.screen(scene.add.graphics());
    bg.fillStyle(0x1a1c2c, 1).fillRect(0, 0, GAME_WIDTH, scene.scale.height);
    this.button({ x: MARGIN, y: 8, width: 26, height: 26, icon: 'icon-back', onTap: onBack });
    this.screen(addText(scene, 42, 21, title, { size: 15, color: PX_CSS.accent, originY: 0.5 }));
  }

  /** 판이 아닌 화면에 버튼을 놓는다. 화면을 지우면 같이 지워진다. */
  private button(config: ConstructorParameters<typeof PixelButton>[1]): PixelButton {
    const button = new PixelButton(this.scene, config);
    button.setDepth(DEPTH.screen + 1);
    this.screenLayer.push({ destroy: () => button.destroy() } as unknown as Phaser.GameObjects.GameObject);
    return button;
  }

  private endButton(config: ConstructorParameters<typeof PixelButton>[1]): PixelButton {
    const button = new PixelButton(this.scene, config);
    button.setDepth(DEPTH.end + 2);
    this.endLayer.push({ destroy: () => button.destroy() } as unknown as Phaser.GameObjects.GameObject);
    return button;
  }
}
