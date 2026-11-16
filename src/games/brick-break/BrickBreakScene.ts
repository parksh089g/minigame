import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { StartGate } from '../../core/start-gate';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  ballTexture,
  brickTexture,
  drawCeiling,
  drawField,
  drawLimit,
  drawLimitGlow,
  drawPaddle,
  LOOK,
  lookOf,
  toneOf,
  type BrickLook,
} from './art';
import {
  advance,
  aim,
  CELL_HEIGHT,
  cellLeft,
  clampPaddle,
  COLS,
  FIELD_HEIGHT,
  formatSeconds,
  frontY,
  heldBall,
  LIMIT_Y,
  MAX_BALLS,
  newGame,
  PADDLE_Y,
  type Game,
  type GameEvent,
  type Row,
} from './rules';

/** 화면에 놓인 줄 하나: 줄의 그릇과 칸마다의 벽돌 그림 */
interface RowView {
  container: Phaser.GameObjects.Container;
  bricks: Array<Phaser.GameObjects.Image | null>;
  /** 칸마다 지금 보여 주는 모습. 금이 가면 그림을 바꾼다. */
  looks: Array<BrickLook | null>;
  tone: number;
}

/** 공 하나의 그림과 그 뒤를 따라가는 옅은 자국들 */
interface BallView {
  image: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Image[];
}

/** 판의 위쪽과 HUD 사이의 틈 */
const FIELD_TOP_GAP = 6;
/** 판 아래에 손가락을 둘 자리로 적어도 이만큼은 남긴다. 화면이 더 길면 남는 높이의 일부를 판 위에 준다. */
const FINGER_ROOM = 44;
const SPARE_ABOVE_RATIO = 0.3;
/** 일시정지에서 돌아온 뒤 다시 움직이기까지의 여유(초) */
const RESUME_GRACE_SECONDS = 0.8;
/** 화살표 키를 누르고 있을 때 막대가 가는 빠르기(px/s) */
const KEY_SPEED = 300;
/** 벽돌이 바닥 선에서 이만큼 안으로 들어오면 선 둘레가 깜빡여 위험을 알린다. */
const DANGER_REACH = CELL_HEIGHT * 3;
/** 공의 자국: 개수와, 자국마다 공을 따라붙는 빠르기 */
const TRAIL = { count: 2, rate: 26, alpha: 0.28 } as const;
/** 벽이나 천장에 튀는 소리는 이보다 잦게 내지 않는다(초). 공이 여럿이면 소리가 쏟아지기 때문이다. */
const WALL_SOUND_GAP = 0.08;
/** 알림 글자가 놓이는 높이(판의 천장에서부터). 바닥 선 바로 위다. 작은 줄은 그 아래 NOTICE_SUB_GAP에 놓인다. */
const NOTICE_Y = LIMIT_Y - 44;
const NOTICE_SUB_GAP = 28;
/**
 * 판이 끝났을 때의 알림 자리. 끝나는 순간에는 맨 아래 벽돌 줄이 바닥 선에 닿아 있으므로,
 * 큰 글자는 바닥 선 바로 위에 두고 작은 줄은 바닥 선 아래(벽돌이 없는 곳)에 둔다.
 */
const OVER_NOTICE = { y: LIMIT_Y - 20, subY: LIMIT_Y + 16 } as const;
/** 떠오르는 점수 글자가 판의 천장 위(HUD와 판 사이)로 나가지 않게 이만큼 아래에서부터 띄운다. */
const FLOAT_TOP = 14;
/**
 * 판을 연 뒤 이 시간(ms) 안의 누름은 조종으로 치지 않는다. 결과 화면의 "다시 하기"를 두 번 잇달아 누르면
 * 두 번째 누름이 새 판에 떨어지는데, 그것이 첫 조작이 되어 공이 바로 떠나지 않게 한다.
 */
const OPEN_TAP_GUARD_MS = 400;
/** 도움말이 떠 있는 시간(ms) */
const HINT_MS = 5000;
/** 이어서 깬 수가 이만큼은 되어야 "연속"을 띄운다. */
const STREAK_NOTE_FROM = 4;

const DEPTH = { field: 1, limit: 2, brick: 5, ceiling: 6, paddle: 8, ball: 10, effect: 20, hud: 30, banner: 40 } as const;

/**
 * 벽돌 깨기: 천장에서 벽돌 줄이 끝없이 내려온다. 막대를 좌우로 끌어 공을 튕겨 벽돌을 깨고,
 * 벽돌이 바닥 선에 닿기 전까지 버틴다. 공을 모두 놓치면 벽돌이 두 줄만큼 한꺼번에 내려온다.
 * 규칙과 숫자는 rules.ts에, 그림은 art.ts에 있다.
 */
export class BrickBreakScene extends MiniGameScene {
  protected readonly gameId = 'brick-break';

  private board: Game = newGame(Math.random);
  /** 막대가 가려는 곳(손가락의 가로 위치) */
  private targetX = GAME_WIDTH / 2;
  /** 지금 막대를 끌고 있는 손가락. 없으면 -1. */
  private dragId = -1;
  /** 누르고 있는 화살표 키의 방향(-1, 0, 1) */
  private keyDir = 0;
  /** 처음 화면을 누르거나 잠깐 기다릴 때까지 공이 떠나지 않는다. 처음 하는 사람이 설명을 읽을 틈이다. */
  private readonly gate = new StartGate();
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중. 그동안에는 막대도 서 있다. */
  private grace = 0;
  /** 판을 연 때(performance.now, 이벤트의 timeStamp와 같은 시계). OPEN_TAP_GUARD_MS가 지나기 전의 누름은 조종이 아니다. */
  private openedAt = 0;
  /** 벽에 튀는 소리를 마지막으로 낸 뒤 지난 시간(초) */
  private sinceWallSound = 0;
  /** 벽돌이 바닥 선에 가까워서 선 둘레가 깜빡이는 중인지 */
  private danger = false;
  /** 판의 천장이 화면에서 놓이는 높이 */
  private fieldTop = 0;
  /** 오른쪽 위에 지금 적혀 있는 글 */
  private sideLabel = '';

  private hud!: GameHud;
  /** 떠오르는 점수 글자가 머무는 곳: 판의 안쪽 */
  private floatArea!: Phaser.Geom.Rectangle;
  private rowViews = new Map<number, RowView>();
  private ballViews: BallView[] = [];
  private paddle!: Phaser.GameObjects.Graphics;
  /** 바닥 선 둘레의 붉은 띠. 벽돌이 선에 가까울 때만 깜빡인다. */
  private limitGlow!: Phaser.GameObjects.Graphics;
  private limitPulse: Phaser.Tweens.Tween | null = null;
  private hints: Phaser.GameObjects.Text[] = [];
  /** 판 가운데에 떠 있는 알림 글자 */
  private notices: Phaser.GameObjects.Text[] = [];
  /** 벽돌 색마다 하나씩 둔 알갱이. 깨진 벽돌의 색으로 튄다. */
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private puffs!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.brickBreak);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    const spare = height - HUD_HEIGHT - FIELD_TOP_GAP - FIELD_HEIGHT - FINGER_ROOM;
    this.fieldTop = HUD_HEIGHT + FIELD_TOP_GAP + Math.round(Math.max(0, spare) * SPARE_ABOVE_RATIO);
    this.floatArea = new Phaser.Geom.Rectangle(0, this.fieldTop + FLOAT_TOP, GAME_WIDTH, FIELD_HEIGHT - FLOAT_TOP);

    addBackdrop(this);
    drawField(this.add.graphics().setPosition(0, this.fieldTop).setDepth(DEPTH.field));
    this.limitGlow = this.add.graphics().setPosition(0, this.fieldTop).setDepth(DEPTH.limit).setAlpha(0);
    drawLimitGlow(this.limitGlow);
    drawLimit(this.add.graphics().setPosition(0, this.fieldTop).setDepth(DEPTH.limit));
    drawCeiling(this.add.graphics().setPosition(0, this.fieldTop).setDepth(DEPTH.ceiling));
    this.paddle = this.add.graphics().setDepth(DEPTH.paddle);
    drawPaddle(this.paddle);
    this.createBalls();
    this.sparks = LOOK.tones.map((tone) => this.createEmitter([tone.face, tone.light, tone.dark]));
    this.puffs = this.createEmitter([...LOOK.puffs]);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.showSide();

    this.bindInput();
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.showHint();
    this.render(0);
    // 공은 첫 터치와 함께(또는 잠깐 기다린 뒤) 떠난다. update()가 문을 본다.
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;

    if (this.grace > 0) {
      // 일시정지에서 돌아와 잠깐 멈춘 동안에는 막대도 서 있다. 멈춘 판을 보면서 받을 자리를 미리 골라 둘 수 없다.
      // 그동안의 손가락과 키는 잊어서, 다시 움직이기 시작할 때 막대가 한꺼번에 옮겨 가지도 않는다.
      this.grace -= dt;
      this.targetX = this.board.paddleX;
      this.render(dt);
      return;
    }
    if (this.keyDir !== 0) this.targetX = clampPaddle(this.targetX + this.keyDir * KEY_SPEED * dt);

    // 출발하기 전에는 막대만 손가락을 따라 움직인다. 공과 벽돌은 멈춰 있다.
    if (!this.gate.open) {
      if (this.gate.wait(dt)) this.setOff();
      this.board = aim(this.board, dt, this.targetX);
    } else {
      this.sinceWallSound += dt;
      const { game, events } = advance(this.board, dt, this.targetX, Math.random);
      this.board = game;
      for (const event of events) this.onEvent(event);
    }
    this.render(dt);
  }

  private resetState(): void {
    this.board = newGame(Math.random);
    this.targetX = this.board.paddleX;
    this.dragId = -1;
    this.keyDir = 0;
    this.gate.reset();
    this.grace = 0;
    this.openedAt = performance.now();
    this.sinceWallSound = 0;
    this.danger = false;
    this.sideLabel = '';
    this.rowViews = new Map();
    this.ballViews = [];
    this.limitPulse = null;
    this.hints = [];
    this.notices = [];
    this.sparks = [];
  }

  /** 막대 위에 있던 첫 공이 떠난다. */
  private setOff(): void {
    this.showNotice('출발!', LOOK.text.start, 600);
    sfx.go();
  }

  /**
   * 판 가운데에 큰 글자를 잠깐 띄운다. sub를 주면 그 아래에 작은 줄을 덧붙인다.
   * 앞서 띄운 것이 아직 떠 있으면 지우고 띄운다. 공을 놓친 알림이 떠 있는 채로 판이 끝나도 글자가 겹치지 않는다.
   */
  private showNotice(
    label: string,
    color: string,
    durationMs: number,
    sub?: string,
    place: { y: number; subY: number } = { y: NOTICE_Y, subY: NOTICE_Y + NOTICE_SUB_GAP },
  ): void {
    for (const line of this.notices) {
      this.tweens.killTweensOf(line);
      line.destroy();
    }
    const lines = [
      addText(this, GAME_WIDTH / 2, this.fieldTop + place.y, label, {
        size: FONT_SIZE.huge,
        color,
        originX: 0.5,
        originY: 0.5,
        stroke: LOOK.text.outline,
        shadow: LOOK.text.shadow,
      }),
    ];
    if (sub) {
      lines.push(
        addText(this, GAME_WIDTH / 2, this.fieldTop + place.subY, sub, {
          color,
          originX: 0.5,
          originY: 0.5,
          stroke: LOOK.text.outline,
        }),
      );
    }
    for (const line of lines) line.setDepth(DEPTH.banner);
    this.notices = lines;
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: durationMs * 0.6,
      duration: durationMs * 0.4,
      onComplete: () => {
        for (const line of lines) line.destroy();
        if (this.notices === lines) this.notices = [];
      },
    });
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const follow = (pointer: Phaser.Input.Pointer): void => {
      // 일시정지에서 돌아와 멈춘 동안에는 막대가 서 있다(update가 붙잡아 둔다).
      if (this.grace > 0) return;
      this.targetX = clampPaddle(pointer.worldX);
    };
    const letGo = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id === this.dragId) this.dragId = -1;
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // 위쪽 HUD(일시정지 버튼)를 누른 것은 조종이 아니다.
      if (pointer.worldY < HUD_HEIGHT) return;
      // 판을 막 열었을 때의 누름은 앞 화면(결과 화면의 "다시 하기")을 두 번 누른 것이다.
      // 누른 때는 이벤트가 생긴 때로 잰다. 느린 기기에서 새 판을 그리느라 이벤트가 늦게 처리되어도 같다.
      if (pointer.downTime - this.openedAt < OPEN_TAP_GUARD_MS) return;
      this.dragId = pointer.id;
      follow(pointer);
      if (this.playing && this.gate.start()) this.setOff();
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      // 손가락은 끌고 있는 것만 따라가고, 마우스는 누르지 않고 움직이기만 해도 따라간다.
      if (!pointer.wasTouch || (pointer.id === this.dragId && pointer.isDown)) follow(pointer);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, letGo);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, letGo);

    // 키보드로도 할 수 있다(컴퓨터에서 해 볼 때). 화살표를 누르고 있는 동안 막대가 그쪽으로 간다.
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const held = { left: false, right: false };
    const steer = (): void => {
      this.keyDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    };
    const press = (side: 'left' | 'right', down: boolean) => (): void => {
      held[side] = down;
      steer();
      if (down && this.playing && this.gate.start()) this.setOff();
    };
    const keys: Array<[string, () => void]> = [
      ['keydown-LEFT', press('left', true)],
      ['keyup-LEFT', press('left', false)],
      ['keydown-RIGHT', press('right', true)],
      ['keyup-RIGHT', press('right', false)],
    ];
    for (const [name, handler] of keys) keyboard.on(name, handler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [name, handler] of keys) keyboard.off(name, handler);
    });
  }

  private onResume(): void {
    // 멈춰 있는 동안 손이나 키를 뗐을 수 있으니 잊는다.
    this.dragId = -1;
    this.keyDir = 0;
    // 아직 출발하지 않았으면 숨 고를 시간도 필요 없다.
    if (!this.playing || !this.gate.open) return;
    // 돌아오자마자 공을 놓치지 않도록 잠깐 멈춰서 판을 다시 보게 한다.
    this.grace = RESUME_GRACE_SECONDS;
    this.showNotice('준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000);
  }

  private showHint(): void {
    const top = this.fieldTop + FIELD_HEIGHT + 6;
    this.hints = [
      addText(this, GAME_WIDTH / 2, top, '좌우로 끌어 막대로 공을 튕겨요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 16, '벽돌이 점선에 닿으면 끝나요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of this.hints) line.setDepth(DEPTH.hud);
    const lines = this.hints;
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: HINT_MS,
      duration: 500,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }

  // ───────── 일어난 일 ─────────

  private onEvent(event: GameEvent): void {
    switch (event.kind) {
      case 'wall':
        if (this.sinceWallSound >= WALL_SOUND_GAP) {
          this.sinceWallSound = 0;
          sfx.tick();
        }
        break;
      case 'paddle':
        sfx.flip();
        this.tweens.killTweensOf(this.paddle);
        this.paddle.setScale(1, 0.7);
        this.tweens.add({ targets: this.paddle, scaleY: 1, duration: 160, ease: 'Back.Out' });
        break;
      case 'crack':
        sfx.land();
        break;
      case 'break':
        this.onBreak(event);
        break;
      case 'gift':
        sfx.gold();
        vibrate(15);
        floatText(
          this,
          event.x,
          this.fieldTop + event.y - 6,
          event.extra ? '공 하나 더!' : `+${event.points}`,
          LOOK.text.gift,
          this.floatArea,
          DEPTH.effect,
        );
        if (!event.extra) this.hud.setScore(this.board.score);
        break;
      case 'lost':
        this.puffs.explode(event.last ? 10 : 5, event.x, this.fieldTop + FIELD_HEIGHT - 4);
        if (event.last) this.onMiss();
        else sfx.expire();
        break;
      case 'serve':
        sfx.pop();
        break;
      case 'over':
        this.endGame();
        break;
    }
  }

  private onBreak(event: Extract<GameEvent, { kind: 'break' }>): void {
    const y = this.fieldTop + event.y;
    const view = this.rowViews.get(event.row);
    const tone = view?.tone ?? toneOf(event.row);
    // 깨진 벽돌은 살짝 커지면서 사라진다.
    const look = view?.looks[event.col];
    if (view && look) {
      view.bricks[event.col]?.destroy();
      view.bricks[event.col] = null;
      view.looks[event.col] = null;
      // 천장에서 들어오는 중인 줄의 벽돌은 들어온 만큼 납작하게 보이므로 깨지는 그림도 그만큼 납작하다.
      const squash = view.container.scaleY;
      const ghost = this.add
        .image(event.x, y, brickTexture(this, look, tone))
        .setScale(1, squash)
        .setDepth(DEPTH.brick);
      this.tweens.add({
        targets: ghost,
        scaleX: 1.25,
        scaleY: 1.25 * squash,
        alpha: 0,
        duration: 140,
        onComplete: () => ghost.destroy(),
      });
    }
    this.sparks[tone].explode(5, event.x, y);
    sfx.hit(event.streak - 1);
    if (event.points > 1) {
      floatText(this, event.x, y - 4, `+${event.points}`, LOOK.text.points, this.floatArea, DEPTH.effect);
    }
    this.hud.setScore(this.board.score);
    // 길게 이어 깨기 시작하면 오른쪽 위가 "연속"으로 바뀌면서 한 번 튄다.
    if (event.streak === STREAK_NOTE_FROM) this.showSide(true);
  }

  /** 공을 모두 놓쳤다: 벽돌이 두 줄만큼 내려온다. */
  private onMiss(): void {
    sfx.miss();
    vibrate([30, 30, 30]);
    this.cameras.main.shake(140, 0.008);
    this.showNotice('앗!', LOOK.text.miss, 1000, '벽돌이 두 줄 내려와요');
  }

  private endGame(): void {
    sfx.bump();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.012);
    this.setDanger(false);
    this.showNotice('끝!', LOOK.text.over, 900, '벽돌이 점선에 닿았어요', OVER_NOTICE);
    this.finishMiniGame(this.board.score, [
      ['깬 벽돌', `${this.board.broken}개`],
      ['가장 긴 연속', `${this.board.bestStreak}개`],
      ['버틴 시간', formatSeconds(this.board.elapsed)],
    ]);
  }

  /**
   * 오른쪽 위에는 여느 때 깬 벽돌의 수를 적고, 공 하나가 막대에 닿지 않고 길게 이어 깨는 동안에는 그 수를 적는다.
   * 프레임마다 불리므로 글이 바뀔 때만 다시 쓴다.
   */
  private showSide(bounce = false): void {
    const streak = Math.max(0, ...this.board.balls.map((ball) => ball.streak));
    const label = streak >= STREAK_NOTE_FROM ? `연속 ${streak}` : `벽돌 ${this.board.broken}`;
    if (label === this.sideLabel && !bounce) return;
    this.sideLabel = label;
    this.hud.setSide(label, bounce);
  }

  // ───────── 그리기 ─────────

  /** 지금 판을 화면에 옮긴다. dt는 공의 자국이 따라붙는 데 쓴다. */
  private render(dt: number): void {
    const game = this.board;
    this.paddle.setPosition(game.paddleX, this.fieldTop + PADDLE_Y);
    this.syncRows(game.rows);
    this.syncBalls(dt);

    this.showSide();
    this.setDanger(this.playing && frontY(game) >= LIMIT_Y - DANGER_REACH);
  }

  private syncRows(rows: readonly Row[]): void {
    const alive = new Set<number>();
    for (const row of rows) {
      alive.add(row.id);
      const view = this.rowViews.get(row.id) ?? this.createRow(row);
      // 천장에서 들어오는 줄은 들어온 만큼만 보인다: 천장에 붙은 채 아래로 자라난다.
      view.container.y = this.fieldTop + Math.max(0, row.y);
      view.container.scaleY = Phaser.Math.Clamp((row.y + CELL_HEIGHT) / CELL_HEIGHT, 0, 1);
      for (let col = 0; col < COLS; col += 1) {
        const brick = row.cells[col];
        const image = view.bricks[col];
        if (!image) continue;
        if (!brick) {
          // 깨진 벽돌은 onBreak가 치운다. 여기까지 남은 것은 그냥 지운다.
          image.destroy();
          view.bricks[col] = null;
          view.looks[col] = null;
          continue;
        }
        const look = lookOf(brick);
        if (look !== view.looks[col]) {
          view.looks[col] = look;
          image.setTexture(brickTexture(this, look, view.tone));
          this.tweens.add({ targets: image, alpha: { from: 0.5, to: 1 }, duration: 120 });
        }
      }
    }
    for (const [id, view] of this.rowViews) {
      if (alive.has(id)) continue;
      view.container.destroy();
      this.rowViews.delete(id);
    }
  }

  private createRow(row: Row): RowView {
    const tone = toneOf(row.id);
    const looks = row.cells.map((brick) => (brick ? lookOf(brick) : null));
    const bricks = looks.map((look, col) =>
      look ? this.add.image(cellLeft(col), 0, brickTexture(this, look, tone)).setOrigin(0, 0) : null,
    );
    const container = this.add
      .container(0, this.fieldTop + row.y, bricks.filter((brick) => brick !== null))
      .setDepth(DEPTH.brick);
    const view: RowView = { container, bricks, looks, tone };
    this.rowViews.set(row.id, view);
    return view;
  }

  private createBalls(): void {
    const texture = ballTexture(this);
    this.ballViews = Array.from({ length: MAX_BALLS }, () => {
      const trail = Array.from({ length: TRAIL.count }, (_, index) =>
        this.add
          .image(0, 0, texture)
          .setDepth(DEPTH.ball)
          .setAlpha(TRAIL.alpha / (index + 1))
          .setScale(0.85 - index * 0.15)
          .setVisible(false),
      );
      const image = this.add.image(0, 0, texture).setDepth(DEPTH.ball).setVisible(false);
      return { image, trail };
    });
  }

  private syncBalls(dt: number): void {
    const held = heldBall(this.board);
    const spots = held ? [held] : this.board.balls;
    this.ballViews.forEach((view, index) => {
      const spot = spots[index];
      if (!spot) {
        view.image.setVisible(false);
        for (const ghost of view.trail) ghost.setVisible(false);
        return;
      }
      const x = spot.x;
      const y = this.fieldTop + spot.y;
      const fresh = !view.image.visible;
      view.image.setPosition(x, y).setVisible(true);
      // 자국은 앞의 것을 따라붙는다. 막대 위에 놓인 공과 방금 나타난 공은 자국을 끌지 않는다.
      let leadX = x;
      let leadY = y;
      for (const ghost of view.trail) {
        if (fresh || held) ghost.setPosition(x, y);
        else {
          const pull = 1 - Math.exp(-TRAIL.rate * dt);
          ghost.setPosition(ghost.x + (leadX - ghost.x) * pull, ghost.y + (leadY - ghost.y) * pull);
        }
        ghost.setVisible(!held);
        leadX = ghost.x;
        leadY = ghost.y;
      }
    });
  }

  /** 벽돌이 바닥 선에 가까우면 선 둘레가 붉게 깜빡인다. */
  private setDanger(danger: boolean): void {
    if (danger === this.danger) return;
    this.danger = danger;
    this.limitPulse?.remove();
    this.limitPulse = null;
    this.limitGlow.setAlpha(0);
    if (!danger) return;
    this.limitPulse = this.tweens.add({
      targets: this.limitGlow,
      alpha: { from: 0.15, to: 0.7 },
      duration: 320,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private createEmitter(tints: number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 200, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: tints,
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }
}
