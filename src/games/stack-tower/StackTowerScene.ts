import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { COLOR, CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  BLOCK_HEIGHT,
  drop,
  moverLeft,
  moverSpeed,
  newTower,
  type DropOutcome,
  type Slab,
  type TowerState,
} from './rules';

interface BlockColors {
  face: number;
  light: number;
  dark: number;
}

interface Cloud {
  image: Phaser.GameObjects.Image;
  x: number;
  /** 땅에서부터의 높이. 탑이 올라가면 화면에서는 아래로 내려간다. */
  altitude: number;
  /** 옆으로 흘러가는 속도(px/s) */
  drift: number;
}

/** moving: 블록이 오가는 중, dropping: 내려놓는 중, over: 빗나가서 끝남 */
type Phase = 'moving' | 'dropping' | 'over';

/** 화면 아래쪽 땅의 두께 */
const GROUND_HEIGHT = 36;
/** 움직이는 블록이 놓일 자리 위에 떠 있는 높이 */
const HOVER_GAP = 8;
/** 내려놓는 데 걸리는 시간(ms) */
const DROP_MS = 70;
/**
 * 새 블록이 나온 직후 이 시간(초) 동안은 눌러도 내려놓지 않는다.
 * 사람이 새 블록을 보고 누르기에는 너무 짧은 시간이라, 손가락이 두 번 닿아 바로 빗나가는 일만 막는다.
 */
const SPAWN_LOCK_SECONDS = 0.18;
/** 탑이 높아지면 꼭대기가 놀이 영역의 이 높이(위에서부터의 비율)에 머물도록 화면이 따라 올라간다. */
const ANCHOR_RATIO = 0.36;
/** 화면이 탑을 따라가는 빠르기. 클수록 빨리 붙는다. */
const SCROLL_RATE = 10;
/** 일시정지에서 돌아온 뒤 다시 움직이기까지의 여유(초) */
const RESUME_GRACE_SECONDS = 0.8;
/** 이만큼 쌓을 때마다 알려 준다(층) */
const MILESTONE_FLOORS = 10;
/** 구름: 처음 가로 위치, 땅에서부터의 높이, 옆으로 흐르는 속도 */
const CLOUDS: ReadonlyArray<readonly [x: number, altitude: number, drift: number]> = [
  [150, 120, 5],
  [20, 215, 3],
  [120, 300, 6],
  [200, 395, 4],
  [60, 480, 5],
  [170, 570, 3],
];
/** 구름이 한 바퀴 도는 높이. 아래로 사라진 구름은 이만큼 위에서 다시 나온다. */
const CLOUD_LOOP = 560;
/** 구름은 탑보다 느리게 내려가서 멀리 있는 것처럼 보인다. */
const CLOUD_PARALLAX = 0.5;
const CLOUD_WIDTH = 48;

/**
 * 이 게임의 색을 한곳에 모아 둔다. 겉모습을 바꿀 때는 여기와 drawBlock()만 고치면 된다.
 */
const LOOK = {
  /** 블록의 테두리 */
  outline: COLOR.ink,
  /** 맨 아래 받침 */
  base: { face: COLOR.slate, light: COLOR.silver, dark: COLOR.charcoal } as BlockColors,
  /** 층마다 차례로 바뀌는 블록 색. 파랑에서 빨강까지 갔다가 다시 돈다. */
  floors: [
    { face: COLOR.blue, light: COLOR.sky, dark: COLOR.navy },
    { face: COLOR.sky, light: COLOR.cyan, dark: COLOR.blue },
    { face: COLOR.cyan, light: COLOR.white, dark: COLOR.sky },
    { face: COLOR.green, light: COLOR.lime, dark: COLOR.teal },
    { face: COLOR.lime, light: COLOR.white, dark: COLOR.green },
    { face: COLOR.yellow, light: COLOR.white, dark: COLOR.orange },
    { face: COLOR.orange, light: COLOR.yellow, dark: COLOR.red },
    { face: COLOR.red, light: COLOR.orange, dark: COLOR.plum },
  ] as readonly BlockColors[],
  /** 딱 맞혔을 때의 번쩍임과 불꽃 */
  flash: COLOR.white,
  sparks: [COLOR.yellow, COLOR.white, COLOR.cyan],
  text: {
    hint: CSS.white,
    hintSub: CSS.silver,
    shadow: CSS.ink,
    start: CSS.lime,
    ready: CSS.yellow,
    over: CSS.orange,
    perfect: CSS.yellow,
    grow: CSS.lime,
    milestone: CSS.cyan,
  },
} as const;

const DEPTH = { cloud: 1, world: 5, effect: 20, hud: 30, banner: 40 } as const;

/** level번째 층의 색. 0은 받침이다. */
function colorsFor(level: number): BlockColors {
  return level <= 0 ? LOOK.base : LOOK.floors[(level - 1) % LOOK.floors.length];
}

/** 블록 하나를 (0, 0)에서부터 그린다. 윗줄은 밝게, 아랫줄은 어둡게 해서 층이 구분된다. */
function drawBlock(graphics: Phaser.GameObjects.Graphics, width: number, colors: BlockColors): void {
  graphics.clear();
  graphics.fillStyle(LOOK.outline, 1);
  graphics.fillRect(0, 0, width, BLOCK_HEIGHT);
  if (width < 3) {
    // 테두리를 그릴 자리가 없을 만큼 좁으면 색만 칠한다.
    graphics.fillStyle(colors.face, 1);
    graphics.fillRect(0, 0, width, BLOCK_HEIGHT - 1);
    return;
  }
  const inner = width - 2;
  graphics.fillStyle(colors.face, 1);
  graphics.fillRect(1, 0, inner, BLOCK_HEIGHT - 1);
  graphics.fillStyle(colors.light, 1);
  graphics.fillRect(1, 0, inner, 1);
  graphics.fillStyle(colors.dark, 1);
  graphics.fillRect(1, BLOCK_HEIGHT - 3, inner, 2);
}

/**
 * 탑 쌓기: 좌우로 오가는 블록을 화면을 눌러 내려놓는다.
 * 아래 블록에 걸친 만큼만 남아서 어긋날수록 블록이 좁아지고, 하나도 걸치지 않으면 끝난다.
 * 딱 맞히면 줄어들지 않고, 연속으로 딱 맞히면 다시 넓어진다.
 */
export class StackTowerScene extends MiniGameScene {
  protected readonly gameId = 'stack-tower';

  private tower: TowerState = newTower();
  private phase: Phase = 'moving';
  private moverWidth = 0;
  /** 움직이는 블록의 왼쪽 가장자리. 반올림한 값이 화면에 그려진다. */
  private moverX = 0;
  /** 지금 블록이 움직이기 시작한 뒤 지난 시간(초) */
  private moverTime = 0;
  private moverPace = 0;
  private fromLeft = true;
  /** 0보다 크면 잠깐 멈춰 있는 중 */
  private grace = 0;
  /** 탑을 따라 화면이 올라간 높이. scrollTarget을 부드럽게 따라간다. */
  private scroll = 0;
  private scrollTarget = 0;
  private groundY = 0;
  private anchorY = 0;

  private hud!: GameHud;
  /** 땅과 탑을 담는 그릇. 원점은 땅 윗면이고, 탑은 위쪽(음수)으로 자란다. */
  private world!: Phaser.GameObjects.Container;
  private mover!: Phaser.GameObjects.Graphics;
  private blocks: Phaser.GameObjects.Graphics[] = [];
  private clouds: Cloud[] = [];
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private playArea!: Phaser.Geom.Rectangle;

  constructor() {
    super(SCENE.stackTower);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.groundY = height - GROUND_HEIGHT;
    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.groundY - HUD_HEIGHT);
    this.anchorY = HUD_HEIGHT + Math.round(this.playArea.height * ANCHOR_RATIO);

    addBackdrop(this);
    this.add.image(GAME_WIDTH - 40, HUD_HEIGHT + 78, TEXTURE.runnerMoon).setScale(2);
    this.clouds = CLOUDS.map(([x, altitude, drift]) => ({
      image: this.add.image(0, 0, 'sky-cloud').setOrigin(0, 0).setScale(2).setDepth(DEPTH.cloud),
      x,
      altitude,
      drift,
    }));

    this.world = this.add.container(0, this.groundY).setDepth(DEPTH.world);
    this.world.add([
      this.add.tileSprite(0, 0, GAME_WIDTH, GROUND_HEIGHT, TEXTURE.runnerSoil).setOrigin(0, 0),
      this.add.tileSprite(0, 0, GAME_WIDTH, 4, TEXTURE.runnerEdge).setOrigin(0, 0),
    ]);
    this.addBlock(this.tower.top, 0);
    this.mover = this.add.graphics();
    this.world.add(this.mover);

    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 100 },
        lifespan: { min: 180, max: 340 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setSide('0층');

    this.bindInput();
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.showHint();
    this.drawClouds();
    this.spawnMover();
    showBanner(this, this.playArea.top + 76, '시작!', LOOK.text.start, 600, DEPTH.banner);
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    // 끝난 뒤에도 화면은 탑을 마저 따라가고 구름은 계속 흐른다.
    this.followTower(dt);
    for (const cloud of this.clouds) cloud.x += cloud.drift * dt;
    this.drawClouds();

    if (!this.playing) return;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    if (this.phase === 'moving') {
      this.moverTime += dt;
      this.placeMover();
    }
  }

  private resetState(): void {
    this.tower = newTower();
    this.phase = 'moving';
    this.moverWidth = 0;
    this.moverX = 0;
    this.moverTime = 0;
    this.moverPace = 0;
    this.fromLeft = true;
    this.grace = 0;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.blocks = [];
    this.clouds = [];
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // 위쪽 HUD(일시정지 버튼)를 누른 것은 내려놓기가 아니다.
      if (pointer.worldY >= HUD_HEIGHT) this.release();
    });

    // 키보드로도 할 수 있다(컴퓨터에서 해 볼 때).
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!event.repeat) this.release();
      };
      keyboard.on('keydown-SPACE', onKeyDown);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown-SPACE', onKeyDown));
    }
  }

  private onResume(): void {
    if (!this.playing) return;
    // 돌아오자마자 블록이 지나가 버리지 않도록 잠깐 멈춰서 자리를 다시 보게 한다.
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.playArea.top + 76, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  private showHint(): void {
    const top = this.playArea.top + 18;
    const lines = [
      addText(this, GAME_WIDTH / 2, top, '화면을 누르면 블록을 내려놓아요', {
        color: LOOK.text.hint,
        originX: 0.5,
        shadow: LOOK.text.shadow,
      }),
      addText(this, GAME_WIDTH / 2, top + 16, '딱 맞추면 줄어들지 않아요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        shadow: LOOK.text.shadow,
      }),
    ];
    for (const line of lines) line.setDepth(DEPTH.hud);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: 5000,
      duration: 500,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }

  // ───────── 진행 ─────────

  /** level번째 층의 윗면 높이(땅 윗면이 0, 위가 음수). 0은 받침이다. */
  private levelTop(level: number): number {
    return -(level + 1) * BLOCK_HEIGHT;
  }

  /** 다음 블록을 한쪽 끝에 올려 움직이기 시작한다. 출발하는 쪽은 층마다 번갈아 바뀐다. */
  private spawnMover(): void {
    const level = this.tower.floors + 1;
    this.moverWidth = this.tower.top.width;
    this.fromLeft = level % 2 === 1;
    this.moverPace = moverSpeed(this.tower.floors, Math.random());
    this.moverTime = 0;

    drawBlock(this.mover, this.moverWidth, colorsFor(level));
    this.mover.setVisible(true).setAngle(0);
    this.mover.y = this.levelTop(level) - HOVER_GAP;
    this.world.bringToTop(this.mover);
    this.placeMover();
    this.phase = 'moving';
  }

  private placeMover(): void {
    this.moverX = moverLeft(this.moverWidth, this.moverPace, this.moverTime, this.fromLeft);
    this.mover.x = Math.round(this.moverX);
  }

  /** 화면을 눌렀을 때: 지금 보이는 자리에 블록을 내려놓는다. */
  private release(): void {
    if (!this.playing || this.phase !== 'moving' || this.grace > 0) return;
    if (this.moverTime < SPAWN_LOCK_SECONDS) return;
    // 판정은 마지막으로 그려진 자리로 한다. 본 그대로 놓여야 억울하지 않다.
    const { state, outcome } = drop(this.tower, this.mover.x);
    if (outcome.kind === 'miss') {
      this.fallOff();
      return;
    }

    this.tower = state;
    this.phase = 'dropping';
    this.tweens.add({
      targets: this.mover,
      y: this.levelTop(state.floors),
      duration: DROP_MS,
      ease: 'Quad.In',
      onComplete: () => this.land(outcome),
    });
  }

  /** 블록이 탑에 닿았을 때: 남은 조각을 탑에 올리고 다음 블록을 낸다. */
  private land(outcome: Exclude<DropOutcome, { kind: 'miss' }>): void {
    const level = this.tower.floors;
    this.mover.setVisible(false);
    this.addBlock(outcome.placed, level);

    if (outcome.kind === 'trim') {
      this.dropPiece(outcome.cut, level);
      sfx.stack();
      vibrate(8);
    } else {
      this.celebrate(outcome.placed, level, outcome.grew);
    }

    this.hud.setScore(this.tower.score);
    this.hud.setSide(`${level}층`, true);
    if (level % MILESTONE_FLOORS === 0) {
      sfx.count();
      floatText(
        this,
        GAME_WIDTH / 2,
        this.world.y + this.levelTop(level) - 34,
        `${level}층!`,
        LOOK.text.milestone,
        this.playArea,
        DEPTH.effect,
      );
    }

    // 탑의 꼭대기가 정해진 높이보다 올라가면 그만큼 화면을 내린다.
    this.scrollTarget = Math.max(0, this.anchorY - (this.groundY + this.levelTop(level)));
    this.pruneBlocks();
    this.spawnMover();
  }

  private addBlock(slab: Slab, level: number): void {
    const block = this.add.graphics();
    drawBlock(block, slab.width, colorsFor(level));
    block.setPosition(slab.left, this.levelTop(level));
    this.world.add(block);
    this.blocks.push(block);
  }

  /** 삐져나온 조각이 기울며 아래로 떨어진다. */
  private dropPiece(cut: Slab, level: number): void {
    const piece = this.add.graphics();
    drawBlock(piece, cut.width, colorsFor(level));
    piece.setPosition(cut.left, this.levelTop(level));
    this.world.add(piece);
    const outward = cut.left > this.tower.top.left ? 1 : -1;
    this.tweens.add({
      targets: piece,
      y: piece.y + 220,
      x: piece.x + outward * 10,
      angle: outward * 35,
      alpha: { from: 1, to: 0.2 },
      duration: 620,
      ease: 'Quad.In',
      onComplete: () => piece.destroy(),
    });
  }

  /** 딱 맞혔을 때의 번쩍임과 소리. 이어서 맞힐수록 소리가 높아진다. */
  private celebrate(placed: Slab, level: number, grew: boolean): void {
    const top = this.levelTop(level);
    const centerX = placed.left + placed.width / 2;
    const screenY = this.world.y + top;
    const streak = this.tower.streak;

    const flash = this.add
      .rectangle(placed.left, top, placed.width, BLOCK_HEIGHT, LOOK.flash)
      .setOrigin(0, 0);
    const ring = this.add
      .rectangle(centerX, top + BLOCK_HEIGHT / 2, placed.width + 2, BLOCK_HEIGHT + 2)
      .setStrokeStyle(1, LOOK.flash);
    this.world.add([flash, ring]);
    this.tweens.add({
      targets: flash,
      alpha: { from: 0.85, to: 0 },
      duration: 240,
      onComplete: () => flash.destroy(),
    });
    this.tweens.add({
      targets: ring,
      scaleX: 1 + 14 / Math.max(14, placed.width),
      scaleY: 1.9,
      alpha: 0,
      duration: 300,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });

    this.sparks.explode(5, placed.left, screenY + BLOCK_HEIGHT / 2);
    this.sparks.explode(5, placed.left + placed.width, screenY + BLOCK_HEIGHT / 2);
    floatText(
      this,
      centerX,
      screenY - HOVER_GAP - BLOCK_HEIGHT,
      streak > 1 ? `완벽 x${streak}` : '완벽!',
      grew ? LOOK.text.grow : LOOK.text.perfect,
      this.playArea,
      DEPTH.effect,
    );
    if (grew) sfx.gold();
    else sfx.hit(streak);
    vibrate(grew ? [12, 20, 12] : 12);
  }

  /** 하나도 걸치지 않았을 때: 블록이 탑 옆으로 떨어지고 게임이 끝난다. */
  private fallOff(): void {
    this.phase = 'over';
    sfx.miss();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.012);

    const outward = this.mover.x > this.tower.top.left ? 1 : -1;
    this.tweens.add({
      targets: this.mover,
      y: this.scale.height - this.world.y + 40,
      angle: outward * 60,
      duration: 700,
      ease: 'Quad.In',
    });

    showBanner(this, this.playArea.top + 76, '앗!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(this.tower.score, [
      ['쌓은 층', `${this.tower.floors}층`],
      ['딱 맞춤', `${this.tower.perfects}번`],
      ['최대 연속', `${this.tower.bestStreak}번`],
    ]);
  }

  // ───────── 화면 따라가기 ─────────

  private followTower(dt: number): void {
    const gap = this.scrollTarget - this.scroll;
    if (gap === 0) return;
    this.scroll = Math.abs(gap) < 0.5 ? this.scrollTarget : this.scroll + gap * Math.min(1, dt * SCROLL_RATE);
    // 흔들림이 없도록 좌표는 정수로 맞춘다.
    this.world.y = this.groundY + Math.round(this.scroll);
  }

  /** 화면 아래로 내려가서 다시 보일 일이 없는 블록을 지운다. */
  private pruneBlocks(): void {
    const limit = this.scale.height - this.groundY - this.scrollTarget;
    while (this.blocks.length > 0 && this.blocks[0].y > limit) {
      this.blocks.shift()?.destroy();
    }
  }

  private drawClouds(): void {
    const { height } = this.scale;
    for (const cloud of this.clouds) {
      if (cloud.x > GAME_WIDTH) cloud.x = -CLOUD_WIDTH;
      let y = this.groundY - cloud.altitude + this.scroll * CLOUD_PARALLAX;
      if (y > height) {
        // 아래로 사라진 구름은 위에서 다시 내려온다.
        cloud.altitude += CLOUD_LOOP;
        y -= CLOUD_LOOP;
      }
      cloud.image.setPosition(Math.round(cloud.x), Math.round(y));
    }
  }
}
