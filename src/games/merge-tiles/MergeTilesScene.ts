import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { swipeDirection, type SwipeDirection } from '../../core/swipe';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  maxLevel,
  playTurn,
  SIZE,
  START_SECONDS,
  startBoard,
  tileValue,
  type Merge,
  type Spawn,
  type Turn,
} from './rules';

// ───────── 자리 ─────────

/** 판 한 변의 길이와 타일 사이의 틈. 타일 한 변은 (BOARD - GAP × 5) / 4 = 46.5다. */
const BOARD = 216;
const GAP = 6;
const TILE = (BOARD - GAP * (SIZE + 1)) / SIZE;
const BOARD_LEFT = (GAME_WIDTH - BOARD) / 2;
/** 판 위에 안내 두 줄이 들어갈 자리. 화면이 짧아도 이만큼은 비워 둔다. */
const HINT_ROOM = 52;
/** 판 아래에 한 줄 설명이 들어갈 자리 */
const NOTE_ROOM = 26;
const TILE_RADIUS = 9;
/** 타일 아래로 도톰하게 내려오는 옆면의 두께 */
const TILE_LIP = 3;

// ───────── 움직임 ─────────

/** 타일이 미끄러지는 시간(ms). 빠르게 이어 밀 수 있도록 짧게 둔다. */
const SLIDE_MS = 90;
const POP_MS = 130;
/** 이만큼 움직이면 밀었다고 본다. 타일이 커서 기본값보다 조금 길게 잡았다. */
const SWIPE_DISTANCE = 18;
/** 아무것도 밀지 않아도 이 시간이 지나면 시계가 가기 시작한다. */
const AUTO_START_SECONDS = 4;
/** 이 숫자 이상의 타일을 만들면 점수를 타일 위에 띄운다. 작은 합치기까지 띄우면 어수선하다. */
const FLOAT_FROM_LEVEL = 4;

/** 윗면 색보다 조금 어두운 옆면 색. 짝이 되는 짙은 색이 테마에 없는 타일에 쓴다. */
function shade(color: number): number {
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * 0.86) << shift;
  return channel(16) | channel(8) | channel(0);
}

/**
 * 이 씬이 쓰는 색. 모양을 바꿀 때는 여기와 TileView.draw만 손보면 된다.
 * 자주 함께 놓이는 작은 타일들(2부터 64까지)은 한눈에 가려지도록 색상이 모두 다르고,
 * 그 위로는 같은 색상을 한 번 더 짙게 돈다.
 */
const LOOK = {
  board: { face: THEME.lilac, lip: THEME.lilacDeep, slot: THEME.lilacSoft },
  /** 단계 1(숫자 2)부터 차례로. 마지막 색은 그보다 큰 타일이 모두 쓴다. */
  tiles: [
    { face: THEME.card, lip: THEME.shadow },
    { face: THEME.butter, lip: THEME.butterDeep },
    { face: THEME.mint, lip: THEME.mintDeep },
    { face: THEME.sky, lip: THEME.skyDeep },
    { face: THEME.pink, lip: THEME.pinkDeep },
    { face: THEME.coral, lip: THEME.coralDeep },
    { face: THEME.gold, lip: shade(THEME.gold) },
    { face: THEME.mintDeep, lip: shade(THEME.mintDeep) },
    { face: THEME.skyDeep, lip: shade(THEME.skyDeep) },
    { face: THEME.pinkDeep, lip: shade(THEME.pinkDeep) },
    { face: THEME.coralDeep, lip: shade(THEME.coralDeep) },
  ],
  shine: THEME.white,
  text: {
    tile: THEME_CSS.inkDeep,
    hint: THEME_CSS.ink,
    hintSub: THEME_CSS.sub,
    note: THEME_CSS.sub,
    outline: THEME_CSS.white,
    points: THEME_CSS.accent,
    bonus: THEME_CSS.good,
    start: THEME_CSS.good,
    over: THEME_CSS.bad,
  },
} as const;

const DEPTH = { board: 1, tile: 5, effect: 20, hud: 30, hint: 32, banner: 40 } as const;

const KEY_DIRECTIONS: Readonly<Record<string, SwipeDirection>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
};

/** 타일 하나의 그림. 합쳐져 사라진 타일은 숨겨 두었다가 새 타일에 다시 쓴다. */
class TileView {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private level = 0;

  constructor(scene: Phaser.Scene) {
    this.body = scene.add.graphics();
    this.label = addText(scene, 0, -TILE_LIP / 2, '', {
      size: FONT_SIZE.large,
      color: LOOK.text.tile,
      originX: 0.5,
      originY: 0.5,
    });
    this.container = scene.add.container(0, 0, [this.body, this.label]).setDepth(DEPTH.tile);
  }

  setLevel(level: number): void {
    if (level === this.level) return;
    this.level = level;
    this.draw();
    this.label.setText(String(tileValue(level)));
    // 네 자리 숫자도 타일 안에 들어가도록 줄인다.
    this.label.setScale(Math.min(1, (TILE - 8) / this.label.width));
  }

  private draw(): void {
    const look = LOOK.tiles[Math.min(this.level, LOOK.tiles.length) - 1];
    const half = TILE / 2;
    this.body.clear();
    this.body.fillStyle(look.lip, 1);
    this.body.fillRoundedRect(-half, -half, TILE, TILE, TILE_RADIUS);
    this.body.fillStyle(look.face, 1);
    this.body.fillRoundedRect(-half, -half, TILE, TILE - TILE_LIP, TILE_RADIUS);
    this.body.fillStyle(LOOK.shine, 0.55);
    this.body.fillRoundedRect(-half + 6, -half + 4, 12, 3, 1.5);
  }
}

/** 미끄러지는 동안 미뤄 둔 마무리: 사라질 타일, 합쳐질 칸, 새로 나올 타일 */
interface Pending {
  gone: TileView[];
  merges: Merge[];
  spawn: Spawn | null;
  /** 남은 미끄러지는 시간(ms) */
  remaining: number;
}

/** 손가락 하나가 누른 자리. 한 번 누른 동안에는 한 번만 민다. */
interface Touch {
  id: number;
  x: number;
  y: number;
  used: boolean;
}

/**
 * 머지 타일: 화면을 밀어 타일을 한쪽으로 모으고, 같은 숫자끼리 합쳐 큰 숫자를 만든다.
 * 제한 시간 안에 점수를 겨루고, 큰 타일을 처음 만들 때마다 시간이 늘어난다.
 * 규칙은 rules.ts에 있고, 이 씬은 입력과 그리기만 맡는다.
 */
export class MergeTilesScene extends MiniGameScene {
  protected readonly gameId = 'merge-tiles';

  private hud!: GameHud;
  private board: number[] = [];
  /** 칸 번호 → 그 칸에 놓인 타일 그림 */
  private views = new Map<number, TileView>();
  private pool: TileView[] = [];
  private pending: Pending | null = null;
  private touch: Touch | null = null;
  private hints: Phaser.GameObjects.Text[] = [];
  private boardTop = 0;
  private bounds!: Phaser.Geom.Rectangle;

  private score = 0;
  private best = 0;
  private slides = 0;
  private merges = 0;
  private timeLeft = START_SECONDS;
  /** 시계가 가기 시작했는지. 처음 밀 때, 또는 조금 기다리면 시작한다. */
  private started = false;
  private waited = 0;
  /** 마지막으로 째깍 소리를 낸 초 */
  private lastTick = 0;

  constructor() {
    super(SCENE.mergeTiles);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const height = this.scale.height;
    const room = height - HUD_HEIGHT - BOARD - HINT_ROOM - NOTE_ROOM;
    this.boardTop = HUD_HEIGHT + HINT_ROOM + Math.max(0, room / 2);
    this.bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, height - HUD_HEIGHT);

    addBackdrop(this);
    this.drawBoard();
    addText(this, GAME_WIDTH / 2, this.boardTop + BOARD + 10, '큰 타일을 처음 만들면 시간이 늘어요', {
      size: FONT_SIZE.small,
      color: LOOK.text.note,
      originX: 0.5,
    }).setDepth(DEPTH.board);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(this.timeLeft, START_SECONDS);

    this.board = startBoard(Math.random);
    this.board.forEach((level, cell) => {
      if (level > 0) this.placeTile(cell, level, true);
    });
    this.best = maxLevel(this.board);
    this.hud.setSide(`최고 ${tileValue(this.best)}`);

    this.bindInput();
    this.showHints();
    showBanner(this, this.boardTop + BOARD / 2, '시작!', LOOK.text.start, 600, DEPTH.banner);
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    const elapsedMs = Math.min(deltaMs, 100);
    if (this.pending) {
      this.pending.remaining -= elapsedMs;
      if (this.pending.remaining <= 0) this.settle(true);
    }
    if (!this.playing) return;

    const dt = elapsedMs / 1000;
    if (!this.started) {
      this.waited += dt;
      if (this.waited >= AUTO_START_SECONDS) this.startClock();
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.hud.setTime(this.timeLeft, START_SECONDS);
    this.tickLastSeconds();
    if (this.timeLeft <= 0) this.endRun('시간 끝!');
  }

  private resetState(): void {
    this.board = [];
    this.views = new Map();
    this.pool = [];
    this.pending = null;
    this.touch = null;
    this.hints = [];
    this.score = 0;
    this.best = 0;
    this.slides = 0;
    this.merges = 0;
    this.timeLeft = START_SECONDS;
    this.started = false;
    this.waited = 0;
    this.lastTick = 0;
  }

  // ───────── 그리기 ─────────

  private drawBoard(): void {
    const graphics = this.add.graphics().setDepth(DEPTH.board);
    drawPanel(graphics, BOARD_LEFT, this.boardTop, BOARD, BOARD, {
      fill: LOOK.board.face,
      shadow: LOOK.board.lip,
      radius: 14,
    });
    graphics.fillStyle(LOOK.board.slot, 0.7);
    for (let cell = 0; cell < SIZE * SIZE; cell += 1) {
      const { x, y } = this.centerOf(cell);
      graphics.fillRoundedRect(x - TILE / 2, y - TILE / 2, TILE, TILE, TILE_RADIUS);
    }
  }

  /** 칸의 한가운데 */
  private centerOf(cell: number): { x: number; y: number } {
    const col = cell % SIZE;
    const row = Math.floor(cell / SIZE);
    return {
      x: BOARD_LEFT + GAP + col * (TILE + GAP) + TILE / 2,
      y: this.boardTop + GAP + row * (TILE + GAP) + TILE / 2,
    };
  }

  /** 칸에 타일을 놓는다. grow를 주면 작게 시작해서 톡 튀어나온다. */
  private placeTile(cell: number, level: number, grow: boolean): TileView {
    const view = this.pool.pop() ?? new TileView(this);
    const { x, y } = this.centerOf(cell);
    view.setLevel(level);
    view.container.setPosition(x, y).setScale(1).setVisible(true);
    this.views.set(cell, view);
    if (grow) {
      this.tweens.add({
        targets: view.container,
        scale: { from: 0.3, to: 1 },
        duration: POP_MS,
        ease: 'Back.Out',
      });
    }
    return view;
  }

  private showHints(): void {
    const top = this.boardTop - HINT_ROOM + 12;
    this.hints = [
      addText(this, GAME_WIDTH / 2, top, '화면을 밀어 타일을 움직여요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 17, '같은 숫자끼리 만나면 합쳐져요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const hint of this.hints) hint.setDepth(DEPTH.hint);
  }

  private hideHints(): void {
    if (this.hints.length === 0) return;
    this.tweens.add({ targets: this.hints, alpha: 0, duration: 400 });
    this.hints = [];
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.worldY < HUD_HEIGHT) return;
      this.touch = { id: pointer.id, x: pointer.worldX, y: pointer.worldY, used: false };
    };
    // 손가락을 떼기를 기다리지 않고, 충분히 움직인 순간에 바로 민다.
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      const touch = this.touch;
      if (!touch || touch.used || touch.id !== pointer.id || !pointer.isDown) return;
      const direction = swipeDirection(
        pointer.worldX - touch.x,
        pointer.worldY - touch.y,
        SWIPE_DISTANCE,
      );
      if (!direction) return;
      touch.used = true;
      this.push(direction);
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (this.touch?.id === pointer.id) this.touch = null;
    };
    const onKey = (event: KeyboardEvent): void => {
      const direction = KEY_DIRECTIONS[event.code];
      if (direction) this.push(direction);
    };
    // 일시정지에서 돌아오면 누르고 있던 손가락은 잊는다.
    const onResume = (): void => {
      this.touch = null;
    };

    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.keyboard?.on('keydown', onKey);
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.keyboard?.off('keydown', onKey);
      this.events.off(Phaser.Scenes.Events.RESUME, onResume);
    });
  }

  // ───────── 한 수 ─────────

  private push(direction: SwipeDirection): void {
    if (!this.playing) return;
    // 앞선 움직임이 아직 끝나지 않았으면 바로 마무리하고 이어서 민다.
    this.settle(false);
    const turn = playTurn(this.board, direction, Math.random);
    if (!turn.slide.moved) {
      // 그쪽으로는 움직일 타일이 없다. 자주 있는 일이라 소리는 작게 낸다.
      sfx.land();
      return;
    }

    this.startClock();
    this.board = turn.board;
    this.slides += 1;
    this.merges += turn.slide.merges.length;
    this.animate(turn);
    this.reward(turn);
    if (!turn.alive) this.endRun('꽉 찼어요!');
  }

  private startClock(): void {
    if (this.started) return;
    this.started = true;
    this.hideHints();
  }

  /** 타일들을 새 자리로 미끄러뜨린다. 합치기와 새 타일은 다 미끄러진 뒤에 보여 준다. */
  private animate(turn: Turn): void {
    const next = new Map<number, TileView>();
    const gone: TileView[] = [];
    for (const move of turn.slide.moves) {
      const view = this.views.get(move.from);
      if (!view) continue;
      if (move.absorbed) gone.push(view);
      else next.set(move.to, view);
      if (move.from === move.to) continue;
      const { x, y } = this.centerOf(move.to);
      this.tweens.add({ targets: view.container, x, y, duration: SLIDE_MS, ease: 'Quad.Out' });
    }
    this.views = next;
    this.pending = { gone, merges: turn.slide.merges, spawn: turn.spawn, remaining: SLIDE_MS };
  }

  /**
   * 미끄러지던 타일들을 제자리에 놓고, 합쳐진 타일과 새 타일을 보여 준다.
   * effects가 false면 톡 튀는 효과 없이 바로 끝낸다(다음 밀기가 이미 들어온 경우).
   */
  private settle(effects: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;

    for (const view of pending.gone) {
      this.tweens.killTweensOf(view.container);
      view.container.setVisible(false);
      this.pool.push(view);
    }
    for (const [cell, view] of this.views) {
      const { x, y } = this.centerOf(cell);
      this.tweens.killTweensOf(view.container);
      view.container.setPosition(x, y).setScale(1);
    }
    for (const merge of pending.merges) {
      const view = this.views.get(merge.cell);
      if (!view) continue;
      view.setLevel(merge.level);
      if (!effects) continue;
      this.tweens.add({
        targets: view.container,
        scale: { from: 1.18, to: 1 },
        duration: POP_MS,
        ease: 'Quad.Out',
      });
    }
    if (pending.spawn) this.placeTile(pending.spawn.cell, pending.spawn.level, effects);
  }

  /** 점수, 기록 타일, 늘어난 시간을 반영하고 소리와 글자로 알려 준다. */
  private reward(turn: Turn): void {
    const { merges, points } = turn.slide;
    if (merges.length === 0) {
      sfx.flip();
      return;
    }

    this.score += points;
    this.hud.setScore(this.score);
    const top = merges.reduce((highest, merge) => Math.max(highest, merge.level), 0);
    sfx.hit(top);
    for (const merge of merges) {
      if (merge.level < FLOAT_FROM_LEVEL) continue;
      const { x, y } = this.centerOf(merge.cell);
      floatText(
        this,
        x,
        y - TILE / 2,
        `+${tileValue(merge.level) / 4}`,
        LOOK.text.points,
        this.bounds,
        DEPTH.effect,
      );
    }

    if (top > this.best) {
      this.best = top;
      this.hud.setSide(`최고 ${tileValue(top)}`, true);
    }
    if (turn.bonus > 0) {
      this.timeLeft += turn.bonus;
      this.hud.setTime(this.timeLeft, START_SECONDS);
      this.showBonus(turn.bonus);
      sfx.gold();
      vibrate(20);
    }
  }

  /** 시간이 늘었다는 것을 판 위에 큰 글자로 띄운다. 점수 글자보다 눈에 띄어야 한다. */
  private showBonus(seconds: number): void {
    const text = addText(this, GAME_WIDTH / 2, this.boardTop - 4, `+${seconds}초`, {
      size: FONT_SIZE.large,
      color: LOOK.text.bonus,
      originX: 0.5,
      originY: 1,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.effect);
    this.tweens.add({
      targets: text,
      scale: { from: 0.6, to: 1 },
      duration: 160,
      ease: 'Back.Out',
    });
    this.tweens.add({
      targets: text,
      y: text.y - 12,
      alpha: 0,
      delay: 420,
      duration: 380,
      ease: 'Quad.In',
      onComplete: () => text.destroy(),
    });
  }

  /** 마지막 5초는 1초마다 째깍 소리로 알린다. */
  private tickLastSeconds(): void {
    const second = Math.ceil(this.timeLeft);
    if (second > 5) {
      // 시간을 더 받아 5초 위로 올라갔으면 다시 내려올 때 처음부터 알린다.
      this.lastTick = 0;
      return;
    }
    if (second === this.lastTick || second <= 0) return;
    this.lastTick = second;
    sfx.tick();
  }

  private endRun(label: string): void {
    if (!this.playing) return;
    this.playing = false;
    this.touch = null;
    showBanner(this, this.boardTop + BOARD / 2, label, LOOK.text.over, 900, DEPTH.banner);
    vibrate([20, 40, 20]);
    this.finishMiniGame(this.score, [
      ['가장 큰 타일', String(tileValue(this.best))],
      ['합친 횟수', `${this.merges}번`],
      ['민 횟수', `${this.slides}번`],
    ]);
  }
}
