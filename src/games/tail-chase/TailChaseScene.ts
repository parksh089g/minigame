import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { SWIPE_MIN_DISTANCE, swipeDirection } from '../../core/swipe';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  BED_LIP,
  BED_RIM,
  BugView,
  CELL,
  drawArrows,
  drawBed,
  drawCandy,
  drawCandyRing,
  drawFruit,
  LOOK,
  UNIT,
  type BugMood,
  type Point,
} from './art';
import {
  COLS,
  crawlFrom,
  FOOD_MIN_POINTS,
  FOOD_POINTS,
  foodPoints,
  isOpposite,
  newGarden,
  queueTurn,
  ROWS,
  step,
  stepMs,
  TREAT_STEPS,
  type Cell,
  type CrashCause,
  type Direction,
  type Garden,
  type StepEvent,
} from './rules';

/** ready: 첫 밀기를 기다리는 중, running: 기어가는 중, over: 끝남 */
type Phase = 'ready' | 'running' | 'over';

/** 머리가 닿으면 치를 일: 먹이나 별사탕을 먹은 걸음의 결과 */
type Bite = Extract<StepEvent, { kind: 'food' | 'treat' }>;

/** 화면에 닿아 있는 손가락 하나가 밀고 있는 것 */
interface SwipeTrack {
  /** 거리를 재기 시작한 자리. 방향이 정해질 때마다 그 자리로 옮긴다. */
  x: number;
  y: number;
  /** 이 손가락이 이미 한 번 방향을 바꿨는지 */
  turned: boolean;
}

/** 처음에 첫 밀기를 기다려 주는 시간(초). 그 안에 밀지 않으면 저절로 출발한다. */
const READY_SECONDS = 1.2;
/** 일시정지에서 돌아온 뒤 다시 기어가기까지의 여유(초). 그 안에 밀면 바로 출발한다. */
const RESUME_GRACE_SECONDS = 0.8;
/**
 * 손가락을 떼지 않고 이어서 꺾을 때 더 움직여야 하는 거리(px).
 * 처음보다 길게 잡아서, 한 번 민 손가락이 끝에서 살짝 휜 것을 두 번 꺾은 것으로 읽지 않는다.
 */
const CHAIN_SWIPE_DISTANCE = 24;
/** 한 걸음의 이만큼(0~1)을 갔을 때 머리가 먹이에 닿은 것으로 보고 먹는 모습을 보여 준다. */
const BITE_AT = 0.5;
/** 얼굴이 가는 쪽으로 돌아가는 빠르기(라디안/초) */
const FACE_TURN_SPEED = 22;
/** 부딪힐 때 머리가 막힌 쪽으로 밀리는 거리(px) */
const BUMP_REACH = 4;
/** 오래 놓인 먹이가 줄어드는 크기의 한계(배율). 통통할수록 점수가 크다. */
const STALE_FRUIT_SCALE = 0.72;
/** 별사탕이 이만큼 걸음밖에 남지 않으면 깜빡인다 */
const TREAT_BLINK_STEPS = 6;
/** 도움말이 떠 있는 시간(ms)과, 처음 방향을 바꾼 뒤에 더 떠 있는 시간(ms) */
const HINT_MS = 5000;
const HINT_AFTER_TURN_MS = 1200;
/** 별사탕을 처음 봤을 때의 알림이 떠 있는 시간(ms) */
const NOTE_MS = 2600;
/** 글자 한 줄이 테두리까지 쳐서 차지하는 높이(px) */
const LINE_HEIGHT = 18;
/** 큰 알림 글자가 놓이는 줄(위에서부터). 아래쪽에서 출발하는 애벌레를 가리지 않는다. */
const BANNER_ROW = 5;

const KEY_TURNS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** 방향마다 얼굴이 보는 각도(라디안). 오른쪽이 0이고 아래쪽이 +다. */
const FACING: Readonly<Record<Direction, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const DEPTH = { item: 5, bug: 6, guide: 7, effect: 20, hud: 30, banner: 40 } as const;

/** 버틴 시간을 "45초", "1분 5초"처럼 적는다. */
function formatSeconds(seconds: number): string {
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}초`;
  return `${Math.floor(whole / 60)}분 ${whole % 60}초`;
}

/**
 * 꼬리 잡기: 밭을 저절로 기어가는 애벌레의 방향만 밀어서 바꾼다.
 * 먹이를 먹을 때마다 한 칸 길어지고 조금씩 빨라진다. 가끔 나오는 별사탕은 사라지기 전에 먹으면 점수가 크다.
 * 벽이나 제 몸에 부딪히면 끝난다.
 */
export class TailChaseScene extends MiniGameScene {
  protected readonly gameId = 'tail-chase';

  private garden: Garden = newGarden(Math.random);
  private phase: Phase = 'ready';
  /** 첫 밀기를 기다려 줄 시간이 이만큼 남았다(초) */
  private readyLeft = READY_SECONDS;
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 지금 걸음이 얼마나 나아갔는지(0~1). 1이 되면 다음 걸음을 뗀다. */
  private progress = 0;
  /** 지금 걸음에 걸리는 시간(초) */
  private stepSeconds = stepMs(0) / 1000;
  /** 지금 걸음에서 각 마디가 출발한 칸. garden.body의 같은 번호 칸으로 옮겨 가는 중이다. */
  private from: readonly Cell[] = [];
  /** 기어간 시간(초). 준비와 일시정지는 세지 않는다. */
  private elapsed = 0;
  /** 이번 걸음에 먹은 것. 머리가 닿는 때에 맞춰 치르려고 잠깐 들고 있는다. */
  private bite: Bite | null = null;
  /** 얼굴이 보고 있는 각도. 가는 쪽으로 부드럽게 돌아간다. */
  private facing = FACING.up;
  private mood: BugMood = 'calm';
  /** 트윈으로 움직이는 값: 머리의 배율과, 부딪힐 때 머리가 밀린 정도(0~1) */
  private pose = { headScale: 1, bump: 0 };
  /** 화면에 보이는 별사탕의 남은 걸음 수. 먹히는 걸음에도 고리가 끊기지 않게 따로 센다. */
  private candySteps = 0;
  /** 이번 판에서 별사탕을 본 적이 있는지. 처음 볼 때 한 번 알려 준다. */
  private candySeen = false;
  private swipes = new Map<number, SwipeTrack>();
  /** 이번 판에서 방향을 바꾼 적이 있는지 */
  private steered = false;

  private hud!: GameHud;
  /** 흙이 깔린 자리. 칸 (0, 0)의 왼쪽 위가 이 네모의 왼쪽 위다. */
  private bed!: Phaser.Geom.Rectangle;
  private bugView!: BugView;
  private fruitView!: Phaser.GameObjects.Container;
  private candyView!: Phaser.GameObjects.Container;
  private candyRing!: Phaser.GameObjects.Graphics;
  private arrows: Phaser.GameObjects.Graphics | null = null;
  private readyBanner: Phaser.GameObjects.Text | null = null;
  /** 처음에 떠 있는 도움말 줄들. 사라진 뒤에는 비어 있다. */
  private hints: Phaser.GameObjects.Text[] = [];
  private sparks!: Record<keyof typeof LOOK.sparks, Phaser.GameObjects.Particles.ParticleEmitter>;

  constructor() {
    super(SCENE.tailChase);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    // 밭의 크기는 정해져 있고, 테두리까지 친 덩어리를 HUD 아래에 남은 자리의 한가운데에 놓는다.
    const width = COLS * CELL;
    const height = ROWS * CELL;
    const spare = this.scale.height - HUD_HEIGHT - height - BED_RIM * 2 - BED_LIP;
    const top = HUD_HEIGHT + Math.round(spare / 2) + BED_RIM;
    this.bed = new Phaser.Geom.Rectangle((GAME_WIDTH - width) / 2, top, width, height);

    addBackdrop(this);
    drawBed(this.add.graphics().setPosition(this.bed.x, this.bed.y), COLS, ROWS);
    this.fruitView = this.createFruit();
    this.candyView = this.createCandy();
    this.bugView = new BugView(this, DEPTH.bug);
    this.sparks = {
      fruit: this.createSparks([...LOOK.sparks.fruit]),
      candy: this.createSparks([...LOOK.sparks.candy]),
    };

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.showLength(false);

    this.bindInput();
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.placeFruit();
    this.showReady();
    this.showHint();
    this.placeBug();
  }

  override update(_time: number, deltaMs: number): void {
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.phase === 'ready') {
      this.readyLeft -= dt;
      if (this.readyLeft <= 0) this.startRun();
    } else if (this.phase === 'running') {
      this.crawl(dt);
    }
    this.facing = Phaser.Math.Angle.RotateTo(
      this.facing,
      FACING[this.garden.heading],
      FACE_TURN_SPEED * dt,
    );
    this.placeBug();
    this.redrawCandyRing();
  }

  private resetState(): void {
    this.garden = newGarden(Math.random);
    this.phase = 'ready';
    this.readyLeft = READY_SECONDS;
    this.grace = 0;
    this.progress = 0;
    this.stepSeconds = stepMs(this.garden.body.length) / 1000;
    this.from = this.garden.body;
    this.elapsed = 0;
    this.bite = null;
    this.facing = FACING[this.garden.heading];
    this.mood = 'calm';
    this.pose = { headScale: 1, bump: 0 };
    this.candySteps = 0;
    this.candySeen = false;
    this.swipes = new Map();
    this.steered = false;
    this.arrows = null;
    this.readyBanner = null;
    this.hints = [];
  }

  // ───────── 화면 구성 ─────────

  /** 칸의 한가운데가 화면에서 놓이는 자리 */
  private centerOf(cell: Cell): Point {
    return {
      x: this.bed.x + (cell.col + 0.5) * CELL,
      y: this.bed.y + (cell.row + 0.5) * CELL,
    };
  }

  /** 먹이 그림. 그릇은 자리와 크기를 맡고, 안의 그림은 제자리에서 가만히 까딱거린다. */
  private createFruit(): Phaser.GameObjects.Container {
    const fruit = this.add.graphics();
    drawFruit(fruit);
    this.tweens.add({
      targets: fruit,
      y: { from: -0.8, to: 0.8 },
      duration: 520,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
    return this.add.container(0, 0, [fruit]).setDepth(DEPTH.item);
  }

  /** 별사탕 그림: 남은 시간 고리와 그 안에서 갸웃거리는 별. 나올 때까지는 숨겨 둔다. */
  private createCandy(): Phaser.GameObjects.Container {
    this.candyRing = this.add.graphics();
    const star = this.add.graphics();
    drawCandy(star);
    this.tweens.add({
      targets: star,
      angle: { from: -14, to: 14 },
      duration: 420,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
    return this.add.container(0, 0, [this.candyRing, star]).setDepth(DEPTH.item).setVisible(false);
  }

  private createSparks(tint: number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 25, max: 80 },
        lifespan: { min: 180, max: 360 },
        alpha: { start: 1, end: 0 },
        tint,
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }

  private showLength(bounce: boolean): void {
    this.hud.setSide(`길이 ${this.garden.body.length}`, bounce);
  }

  /** 큰 알림 글자가 놓이는 높이 */
  private get bannerY(): number {
    return this.bed.y + BANNER_ROW * CELL;
  }

  /** 밭 바로 위에 놓이는 한 줄(도움말, 알림)의 높이 */
  private get noteY(): number {
    return this.bed.y - BED_RIM - LINE_HEIGHT;
  }

  /** 출발하기 전: "준비" 글자와, 머리 둘레에 갈 수 있는 쪽을 가리키는 화살표를 보여 준다. */
  private showReady(): void {
    this.readyBanner = addText(this, GAME_WIDTH / 2, this.bannerY, '준비', {
      size: FONT_SIZE.huge,
      color: LOOK.text.ready,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
      shadow: LOOK.text.shadow,
    }).setDepth(DEPTH.banner);

    const { body, heading } = this.garden;
    const head = this.centerOf(body[0]);
    const open = (Object.keys(UNIT) as Direction[]).filter((way) => !isOpposite(way, heading));
    this.arrows = this.add.graphics().setPosition(head.x, head.y).setDepth(DEPTH.guide);
    drawArrows(this.arrows, open);
    this.tweens.add({
      targets: this.arrows,
      alpha: { from: 1, to: 0.35 },
      duration: 380,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /** 밭 위와 아래에 도움말을 한 줄씩 잠깐 띄운다. 가장 짧은 화면에서도 밭을 가리지 않는다. */
  private showHint(): void {
    const below = this.bed.bottom + BED_RIM + BED_LIP + 1;
    this.hints = [
      this.addLine(this.noteY, '화면을 밀어서 방향을 바꿔요', LOOK.text.hint),
      this.addLine(below, '벽이나 내 몸에 부딪히면 끝나요', LOOK.text.hintSub),
    ];
    this.fadeHint(HINT_MS);
  }

  private addLine(y: number, label: string, color: string): Phaser.GameObjects.Text {
    return addText(this, GAME_WIDTH / 2, y, label, {
      color,
      originX: 0.5,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.hud);
  }

  /** delayMs 뒤에 도움말을 흐리게 지운다. 이미 지워지는 중이면 새로 정한 때에 맞춘다. */
  private fadeHint(delayMs: number): void {
    const lines = this.hints;
    if (lines.length === 0) return;
    this.tweens.killTweensOf(lines);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: delayMs,
      duration: 400,
      onComplete: () => {
        for (const line of lines) line.destroy();
        if (this.hints === lines) this.hints = [];
      },
    });
  }

  /** 밭 위에 알림 한 줄을 잠깐 띄운다. 도움말이 아직 남아 있으면 먼저 치운다. */
  private showNote(label: string): void {
    this.tweens.killTweensOf(this.hints);
    for (const line of this.hints) line.destroy();
    this.hints = [];
    const note = this.addLine(this.noteY, label, LOOK.text.treat);
    this.tweens.add({
      targets: note,
      alpha: 0,
      delay: NOTE_MS,
      duration: 400,
      onComplete: () => note.destroy(),
    });
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const { input } = this;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    // 키보드로도 할 수 있다(컴퓨터에서 해 볼 때): 화살표와 WASD.
    input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      input.keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown, this);
    });
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)에서 시작한 것은 조종이 아니다.
    if (pointer.worldY < HUD_HEIGHT) return;
    this.swipes.set(pointer.id, { x: pointer.worldX, y: pointer.worldY, turned: false });
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const swipe = this.swipes.get(pointer.id);
    if (swipe && pointer.isDown) this.followSwipe(swipe, pointer);
  }

  /**
   * 손가락을 떼면 잊기만 한다. 방향은 움직이는 동안 이미 정해졌다.
   * 화면 밖에서 뗀 손가락은 worldX/worldY가 엉뚱한 값이라서, 뗀 자리로는 아무것도 정하지 않는다.
   */
  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.swipes.delete(pointer.id);
  }

  /**
   * 손가락이 움직이는 도중에, 정해진 거리를 넘는 순간 방향을 정한다. 떼기를 기다리지 않는다.
   * 정한 뒤에는 그 자리에서부터 다시 재므로, 손가락을 떼지 않고 "위, 왼쪽"으로 꺾어 밀어도 둘 다 읽는다.
   */
  private followSwipe(swipe: SwipeTrack, pointer: Phaser.Input.Pointer): void {
    const reach = swipe.turned ? CHAIN_SWIPE_DISTANCE : SWIPE_MIN_DISTANCE;
    const direction = swipeDirection(pointer.worldX - swipe.x, pointer.worldY - swipe.y, reach);
    if (!direction) return;
    swipe.x = pointer.worldX;
    swipe.y = pointer.worldY;
    swipe.turned = true;
    this.steer(direction);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const direction = KEY_TURNS[event.code];
    if (direction && !event.repeat) this.steer(direction);
  }

  /** 방향 전환을 받아 둔다. 기다리는 중이었으면(준비, 일시정지 뒤의 여유) 바로 출발한다. */
  private steer(direction: Direction): void {
    if (this.phase === 'over') return;
    const turned = queueTurn(this.garden, direction);
    if (turned !== this.garden) {
      this.garden = turned;
      sfx.flip();
      // 처음 방향을 바꿨으면 도움말은 읽은 것이니 곧 치운다.
      if (!this.steered) this.fadeHint(HINT_AFTER_TURN_MS);
      this.steered = true;
    }
    if (this.phase === 'ready') this.startRun();
    else this.grace = 0;
  }

  private onResume(): void {
    // 멈춰 있는 동안 손을 뗐을 수 있으니 밀던 손가락은 잊는다.
    this.swipes.clear();
    if (this.phase === 'ready') {
      this.readyLeft = READY_SECONDS;
    } else if (this.phase === 'running') {
      // 돌아오자마자 벽에 부딪히지 않도록 잠깐 멈춰서 밭을 다시 보게 한다.
      this.grace = RESUME_GRACE_SECONDS;
      showBanner(
        this,
        this.bannerY,
        '준비!',
        LOOK.text.ready,
        RESUME_GRACE_SECONDS * 1000,
        DEPTH.banner,
      );
    }
  }

  // ───────── 진행 ─────────

  private startRun(): void {
    this.phase = 'running';
    this.playing = true;
    this.progress = 0;
    sfx.go();

    const guides = [this.readyBanner, this.arrows].filter((guide) => guide !== null);
    this.readyBanner = null;
    this.arrows = null;
    this.tweens.killTweensOf(guides);
    this.tweens.add({
      targets: guides,
      alpha: 0,
      duration: 160,
      onComplete: () => {
        for (const guide of guides) guide.destroy();
      },
    });
    this.advance();
  }

  /** 시간을 흘려서 지금 걸음을 나아가고, 다 갔으면 다음 걸음을 뗀다. */
  private crawl(dt: number): void {
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    this.elapsed += dt;
    this.progress += dt / this.stepSeconds;
    if (this.progress >= BITE_AT) this.resolveBite();
    while (this.progress >= 1 && this.phase === 'running') {
      this.progress -= 1;
      this.advance();
    }
  }

  /**
   * 다음 걸음을 뗀다. 규칙은 걸음을 시작할 때 한꺼번에 적용하고, 화면은 그 걸음을 stepSeconds에 걸쳐 따라간다.
   * 그래서 부딪히는지는 머리가 앞 칸에 다 들어온 뒤에 정해지고, 그때까지 민 것은 모두 반영된다.
   */
  private advance(): void {
    this.resolveBite();
    if (this.garden.status === 'full') {
      this.win();
      return;
    }

    const before = this.garden.body;
    const { garden, event, treatAppeared, treatExpired } = step(this.garden, Math.random);
    this.garden = garden;
    if (event.kind === 'crash') {
      this.crash(event.cause);
      return;
    }
    if (event.kind === 'food' || event.kind === 'treat') this.bite = event;

    this.from = crawlFrom(before, garden.body);
    this.stepSeconds = stepMs(garden.body.length) / 1000;
    this.candySteps = garden.treat ? garden.treat.stepsLeft : Math.max(0, this.candySteps - 1);
    if (treatAppeared) this.showCandy();
    else if (treatExpired) this.loseCandy();
    if (event.kind !== 'food' && garden.food) this.wiltFruit(garden.food.age);
  }

  /** 머리가 먹이나 별사탕에 닿았을 때: 점수를 보여 주고, 먹은 것을 치우고, 새 먹이를 내놓는다. */
  private resolveBite(): void {
    const bite = this.bite;
    if (!bite) return;
    this.bite = null;

    const at = this.centerOf(bite.cell);
    this.hud.setScore(this.garden.score);
    this.tweens.add({
      targets: this.pose,
      headScale: { from: 1.22, to: 1 },
      duration: 200,
      ease: 'Quad.Out',
    });

    if (bite.kind === 'food') {
      sfx.hit(bite.points - FOOD_MIN_POINTS);
      vibrate(8);
      this.sparks.fruit.explode(6, at.x, at.y);
      this.float(at, `+${bite.points}`, LOOK.text.points);
      this.showLength(true);
      this.placeFruit();
      return;
    }
    sfx.gold();
    vibrate([12, 20, 12]);
    this.sparks.candy.explode(12, at.x, at.y);
    this.float(at, `+${bite.points}`, LOOK.text.treat);
    this.candyView.setVisible(false);
    this.cheer(600);
  }

  private float(at: Point, label: string, color: string): void {
    floatText(this, at.x, at.y - CELL / 2, label, color, this.bed, DEPTH.effect);
  }

  /** 잠깐 웃는 얼굴을 한다. */
  private cheer(durationMs: number): void {
    this.mood = 'happy';
    this.time.delayedCall(durationMs, () => {
      if (this.mood === 'happy' && this.phase === 'running') this.mood = 'calm';
    });
  }

  // ───────── 먹이와 별사탕 ─────────

  /** 지금 먹이를 제자리에 톡 내놓는다. 밭이 가득 차서 먹이가 없으면 숨긴다. */
  private placeFruit(): void {
    const { food } = this.garden;
    this.tweens.killTweensOf(this.fruitView);
    if (!food) {
      this.fruitView.setVisible(false);
      return;
    }
    const at = this.centerOf(food.cell);
    this.fruitView.setPosition(at.x, at.y).setVisible(true);
    this.tweens.add({
      targets: this.fruitView,
      scale: { from: 0, to: 1 },
      duration: 200,
      ease: 'Back.Out',
    });
  }

  /** 오래 놓인 먹이는 점수가 줄어든 만큼 작아진다. 점수가 바뀌는 걸음에만 움직인다. */
  private wiltFruit(age: number): void {
    const points = foodPoints(age);
    if (points === foodPoints(age - 1)) return;
    const fresh = (points - FOOD_MIN_POINTS) / (FOOD_POINTS - FOOD_MIN_POINTS);
    this.tweens.killTweensOf(this.fruitView);
    this.tweens.add({
      targets: this.fruitView,
      scale: STALE_FRUIT_SCALE + (1 - STALE_FRUIT_SCALE) * fresh,
      duration: 160,
      ease: 'Quad.Out',
    });
  }

  private showCandy(): void {
    const { treat } = this.garden;
    if (!treat) return;
    const at = this.centerOf(treat.cell);
    this.tweens.killTweensOf(this.candyView);
    this.candyView.setPosition(at.x, at.y).setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: this.candyView,
      scale: { from: 0, to: 1 },
      duration: 220,
      ease: 'Back.Out',
    });
    sfx.pop();
    if (this.candySeen) return;
    this.candySeen = true;
    this.showNote('별사탕! 사라지기 전에 먹어요');
  }

  /** 먹지 못한 별사탕이 작아지며 사라진다. */
  private loseCandy(): void {
    sfx.expire();
    this.tweens.killTweensOf(this.candyView);
    this.tweens.add({
      targets: this.candyView,
      scale: 0,
      alpha: 0,
      duration: 180,
      ease: 'Quad.In',
      onComplete: () => this.candyView.setVisible(false),
    });
  }

  /** 별사탕의 남은 시간 고리를 걸음 사이에도 매끄럽게 줄이고, 얼마 남지 않으면 깜빡인다. */
  private redrawCandyRing(): void {
    if (!this.candyView.visible || this.phase !== 'running') return;
    const left = this.candySteps - Math.min(1, this.progress);
    drawCandyRing(this.candyRing, left / TREAT_STEPS);
    if (!this.garden.treat) return;
    const blink = this.candySteps <= TREAT_BLINK_STEPS && this.progress >= 0.5;
    this.candyView.setAlpha(blink ? 0.45 : 1);
  }

  // ───────── 애벌레 ─────────

  /** 마디마다 출발한 칸과 가는 칸 사이의 지금 자리를 구해 애벌레를 놓는다. */
  private placeBug(): void {
    const along = Math.min(1, this.progress);
    const points = this.garden.body.map((cell, index) => {
      const start = this.centerOf(this.from[index]);
      const end = this.centerOf(cell);
      return { x: start.x + (end.x - start.x) * along, y: start.y + (end.y - start.y) * along };
    });
    // 부딪혔을 때 머리가 막힌 쪽으로 살짝 밀렸다가 돌아온다.
    const push = UNIT[this.garden.heading];
    points[0].x += push.x * BUMP_REACH * this.pose.bump;
    points[0].y += push.y * BUMP_REACH * this.pose.bump;
    this.bugView.show({
      points,
      facing: this.facing,
      mood: this.mood,
      headScale: this.pose.headScale,
    });
  }

  // ───────── 끝 ─────────

  /** 걸음을 멈추고 지금 칸에 그대로 세운다. */
  private halt(): void {
    this.phase = 'over';
    this.from = this.garden.body;
    this.progress = 0;
  }

  private crash(cause: CrashCause): void {
    this.halt();
    this.mood = 'dizzy';
    sfx.bump();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.01);
    this.tweens.add({
      targets: this.pose,
      bump: { from: 0, to: 1 },
      duration: 70,
      ease: 'Quad.Out',
      yoyo: true,
    });
    showBanner(this, this.bannerY, cause === 'wall' ? '쿵!' : '아야!', LOOK.text.over, 900, DEPTH.banner);
    this.endRun();
  }

  /** 밭을 몸으로 가득 채웠다. 더 갈 곳이 없으니 여기서 기분 좋게 끝낸다. */
  private win(): void {
    this.halt();
    this.mood = 'happy';
    sfx.gold();
    vibrate([15, 30, 15]);
    const head = this.centerOf(this.garden.body[0]);
    this.sparks.candy.explode(24, head.x, head.y);
    showBanner(this, this.bannerY, '완벽해요!', LOOK.text.win, 900, DEPTH.banner);
    this.endRun();
  }

  private endRun(): void {
    this.fadeHint(0);
    this.finishMiniGame(this.garden.score, [
      ['먹은 먹이', `${this.garden.eaten}개`],
      ['가장 긴 몸', `${this.garden.body.length}칸`],
      ['버틴 시간', formatSeconds(this.elapsed)],
    ]);
  }
}
