import Phaser from 'phaser';
import { runnerTexture, type RunnerFrame } from '../../art/cosmetics';
import { TEXTURE, type SpriteKey } from '../../art/sprites';
import { COLOR, CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  FIRST_GAP_SECONDS,
  meters,
  newRunner,
  nextSpawn,
  OBSTACLE_BOX,
  RUNNER_BOX,
  runSpeed,
  scoreFor,
  STAR_BOX,
  STAR_HEIGHT,
  STAR_POINTS,
  STAR_SIZE,
  stepRunner,
  touches,
  type ObstacleKind,
  type RunnerState,
} from './rules';

interface Obstacle {
  kind: ObstacleKind;
  /** 판정 상자의 왼쪽 끝(화면 좌표) */
  x: number;
  sprite: Phaser.GameObjects.Image;
  /** 캐릭터가 이미 지나쳤는지 */
  passed: boolean;
}

interface Star {
  /** 중심의 가로 위치(화면 좌표) */
  x: number;
  sprite: Phaser.GameObjects.Image;
}

/** 스프라이트는 모두 두 배로 키워 그린다. */
const SPRITE_SCALE = 2;
/** 캐릭터가 서 있는 가로 위치. 화면 왼쪽에 두어 앞을 넓게 본다. */
const RUNNER_X = 52;
/** 땅의 높이. 화면 세로 길이에 대한 비율. */
const GROUND_RATIO = 0.72;
/** 한 번에 움직이는 가장 긴 시간(초). 프레임이 느려도 장애물을 건너뛰지 않게 잘게 나눈다. */
const SUBSTEP_SECONDS = 1 / 120;
/** 장애물을 화면 오른쪽 밖 어디까지 미리 놓아 둘지(px) */
const SPAWN_AHEAD = 40;
/** 일시정지에서 돌아온 뒤 다시 달리기까지의 여유(초) */
const RESUME_GRACE_SECONDS = 0.8;
/** 이만큼 달릴 때마다 알려 준다(m) */
const MILESTONE_METERS = 100;
/** 달리는 그림이 바뀌는 거리(px) */
const STRIDE_PIXELS = 14;
const BAT_FLAP_SECONDS = 0.14;
/** 구름: 처음 가로 위치, HUD 아래로부터의 높이, 땅에 견준 흐르는 속도 */
const CLOUDS: ReadonlyArray<readonly [x: number, top: number, drift: number]> = [
  [40, 34, 0.06],
  [170, 78, 0.1],
  [280, 132, 0.08],
];
/** 구름이 화면을 한 바퀴 도는 거리(px). 화면보다 넓어야 밖에서 돌아 들어온다. */
const CLOUD_LOOP = GAME_WIDTH + 120;

const OBSTACLE_ART: Readonly<Record<ObstacleKind, { frames: readonly SpriteKey[]; lift: number }>> = {
  spike: { frames: ['ob-spike'], lift: 0 },
  pillar: { frames: ['ob-pillar'], lift: 0 },
  thorns: { frames: ['ob-thorns'], lift: 0 },
  // 그림이 판정 상자보다 위아래로 2px씩 크다.
  bat: { frames: ['ob-bat1', 'ob-bat2'], lift: -2 },
};

const DEPTH = { hills: 1, ground: 2, star: 8, obstacle: 10, runner: 12, effect: 20, hud: 30, banner: 40 } as const;

/**
 * 점프 러너: 저절로 달리는 캐릭터를 화면을 눌러 뛰게 해서 장애물을 넘는다.
 * 길게 누르면 높이 뛰고, 부딪히면 끝난다. 멀리 갈수록, 별을 모을수록 점수가 오른다.
 */
export class JumpRunnerScene extends MiniGameScene {
  protected readonly gameId = 'jump-runner';

  private groundY = 0;
  private body: RunnerState = newRunner();
  private obstacles: Obstacle[] = [];
  private stars: Star[] = [];
  /** 가장 멀리 놓은 장애물의 뒤끝(화면 좌표). 여기서부터 다음 간격을 잰다. */
  private frontier = 0;
  private spawnCount = 0;
  private elapsed = 0;
  private distance = 0;
  private starCount = 0;
  private cleared = 0;
  private shownScore = -1;
  private nextMilestone = MILESTONE_METERS;
  /** 0보다 크면 잠깐 멈춰 있는 중 */
  private grace = 0;
  private pressed = false;
  private held = false;

  private hud!: GameHud;
  private runner!: Phaser.GameObjects.Image;
  /** 달리는 캐릭터의 꾸미기 id */
  private skin = '';
  private hills!: Phaser.GameObjects.TileSprite;
  private clouds: Phaser.GameObjects.Image[] = [];
  private edge!: Phaser.GameObjects.TileSprite;
  private soil!: Phaser.GameObjects.TileSprite;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private playArea!: Phaser.Geom.Rectangle;

  constructor() {
    super(SCENE.jumpRunner);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.groundY = Math.round(height * GROUND_RATIO);
    this.playArea = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.groundY - HUD_HEIGHT);

    addBackdrop(this);
    this.add.image(GAME_WIDTH - 46, HUD_HEIGHT + 44, TEXTURE.runnerMoon).setScale(SPRITE_SCALE);
    this.clouds = CLOUDS.map(([, top]) =>
      this.add.image(0, HUD_HEIGHT + top, 'sky-cloud').setOrigin(0, 0).setScale(SPRITE_SCALE),
    );
    this.hills = this.add
      .tileSprite(0, this.groundY, GAME_WIDTH, 40, TEXTURE.runnerHills)
      .setOrigin(0, 1)
      .setDepth(DEPTH.hills);
    this.soil = this.add
      .tileSprite(0, this.groundY, GAME_WIDTH, height - this.groundY, TEXTURE.runnerSoil)
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground);
    this.edge = this.add
      .tileSprite(0, this.groundY, GAME_WIDTH, 4, TEXTURE.runnerEdge)
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground);

    this.skin = store.data.cosmetics.equipped.runner;
    this.runner = this.add
      .image(RUNNER_X, this.groundY, runnerTexture(this.skin, 'run1'))
      .setOrigin(0.5, 1)
      .setScale(SPRITE_SCALE)
      .setDepth(DEPTH.runner);

    this.dust = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 15, max: 45 },
        angle: { min: 180, max: 360 },
        lifespan: { min: 160, max: 300 },
        alpha: { start: 0.9, end: 0 },
        tint: [COLOR.silver, COLOR.slate],
        emitting: false,
      })
      .setDepth(DEPTH.effect);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 40, max: 110 },
        lifespan: { min: 200, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: [COLOR.yellow, COLOR.orange, COLOR.white],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);

    this.bindInput();
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.showHint();
    this.spawnAhead();
    this.draw();
    showBanner(this, this.playArea.centerY, '출발!', CSS.lime, 600, DEPTH.banner);
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    let remaining = Math.min(deltaMs, 100) / 1000;

    if (this.grace > 0) {
      this.grace -= remaining;
      this.pressed = false;
      return;
    }

    while (remaining > 0 && this.playing) {
      const dt = Math.min(SUBSTEP_SECONDS, remaining);
      remaining -= dt;
      this.advance(dt);
    }
    // 부딪힌 뒤에는 쓰러지는 연출이 캐릭터를 움직이므로 손대지 않는다.
    if (this.playing) this.draw();
  }

  private resetState(): void {
    this.body = newRunner();
    this.obstacles = [];
    this.stars = [];
    this.frontier = RUNNER_X;
    this.spawnCount = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.starCount = 0;
    this.cleared = 0;
    this.shownScore = -1;
    this.nextMilestone = MILESTONE_METERS;
    this.grace = 0;
    this.pressed = false;
    this.held = false;
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const press = (): void => {
      if (!this.playing) return;
      this.pressed = true;
      this.held = true;
    };
    const release = (): void => {
      this.held = false;
    };

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // 위쪽 HUD(일시정지 버튼)를 누른 것은 점프가 아니다.
      if (pointer.y >= HUD_HEIGHT) press();
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, release);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release);

    // 키보드로도 할 수 있다(컴퓨터에서 해 볼 때).
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!event.repeat) press();
      };
      keyboard.on('keydown-SPACE', onKeyDown);
      keyboard.on('keyup-SPACE', release);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off('keydown-SPACE', onKeyDown);
        keyboard.off('keyup-SPACE', release);
      });
    }
  }

  private onResume(): void {
    // 멈춰 있는 동안 손을 뗐을 수 있으니 누름 상태를 지운다.
    this.pressed = false;
    this.held = false;
    if (!this.playing) return;
    // 돌아오자마자 부딪히지 않도록 잠깐 숨을 고를 시간을 준다.
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.playArea.centerY, '준비!', CSS.yellow, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  private showHint(): void {
    const { height } = this.scale;
    const centerY = Math.round((this.groundY + height) / 2);
    const lines = [
      addText(this, GAME_WIDTH / 2, centerY - 8, '화면을 누르면 점프!', {
        color: CSS.white,
        originX: 0.5,
        originY: 0.5,
        shadow: CSS.ink,
      }),
      addText(this, GAME_WIDTH / 2, centerY + 8, '길게 누르면 더 높이 뛰어요', {
        color: CSS.silver,
        originX: 0.5,
        originY: 0.5,
        shadow: CSS.ink,
      }),
    ];
    for (const line of lines) line.setDepth(DEPTH.hud);
    this.tweens.add({
      targets: lines,
      alpha: 0,
      delay: 4500,
      duration: 500,
      onComplete: () => {
        for (const line of lines) line.destroy();
      },
    });
  }

  // ───────── 진행 ─────────

  /** 아주 짧은 시간만큼 세상을 움직이고 부딪힘을 확인한다. */
  private advance(dt: number): void {
    this.elapsed += dt;
    const dx = runSpeed(this.elapsed) * dt;
    this.distance += dx;

    const step = stepRunner(this.body, { pressed: this.pressed, held: this.held }, dt);
    this.pressed = false;
    this.body = step.state;
    if (step.event === 'jump') this.onJump();
    else if (step.event === 'land') this.onLand();

    this.frontier -= dx;
    for (const obstacle of this.obstacles) obstacle.x -= dx;
    for (const star of this.stars) star.x -= dx;
    this.spawnAhead();

    for (let i = this.stars.length - 1; i >= 0; i -= 1) {
      const star = this.stars[i];
      if (touches(RUNNER_X, this.body.y, star.x - STAR_SIZE / 2, STAR_BOX)) {
        this.collectStar(star);
        this.stars.splice(i, 1);
      } else if (star.x < -STAR_SIZE) {
        star.sprite.destroy();
        this.stars.splice(i, 1);
      }
    }

    for (let i = this.obstacles.length - 1; i >= 0; i -= 1) {
      const obstacle = this.obstacles[i];
      const box = OBSTACLE_BOX[obstacle.kind];
      if (touches(RUNNER_X, this.body.y, obstacle.x, box)) {
        this.crash();
        return;
      }
      const right = obstacle.x + box.width;
      if (!obstacle.passed && right < RUNNER_X - RUNNER_BOX.width / 2) {
        obstacle.passed = true;
        this.cleared += 1;
      }
      if (right < -40) {
        obstacle.sprite.destroy();
        this.obstacles.splice(i, 1);
      }
    }

    if (meters(this.distance) >= this.nextMilestone) {
      const reached = this.nextMilestone;
      this.nextMilestone += MILESTONE_METERS;
      sfx.count();
      floatText(this, RUNNER_X + 44, this.groundY - 96, `${reached}m!`, CSS.cyan, this.playArea, DEPTH.effect);
    }
  }

  /** 화면 오른쪽 밖에 항상 다음 장애물이 준비되어 있게 한다. */
  private spawnAhead(): void {
    while (this.frontier < GAME_WIDTH + SPAWN_AHEAD) {
      const spawn = nextSpawn(this.elapsed, Math.random);
      const isFirst = this.spawnCount === 0;
      // 첫 장애물은 조작을 읽을 시간을 두고 나온다.
      const gap = isFirst ? Math.round(runSpeed(0) * FIRST_GAP_SECONDS) : spawn.gap;
      const box = OBSTACLE_BOX[spawn.kind];
      const art = OBSTACLE_ART[spawn.kind];
      const x = Math.max(this.frontier + gap, GAME_WIDTH + 16);

      const sprite = this.add
        .image(0, this.groundY - box.bottom - art.lift, art.frames[0])
        .setOrigin(0.5, 1)
        .setScale(SPRITE_SCALE)
        .setDepth(DEPTH.obstacle);
      this.obstacles.push({ kind: spawn.kind, x, sprite, passed: false });

      // 빈 곳의 별은 앞 장애물과의 사이에 놓이므로, 앞 장애물이 없는 첫 번째에는 두지 않는다.
      if (spawn.star && (spawn.star.along >= 0 || !isFirst)) {
        const starX = x + spawn.star.along;
        const starSprite = this.add
          .image(0, this.groundY - STAR_HEIGHT, 'icon-star')
          .setScale(SPRITE_SCALE)
          .setDepth(DEPTH.star);
        this.stars.push({ x: starX, sprite: starSprite });
      }

      this.frontier = x + box.width;
      this.spawnCount += 1;
    }
  }

  private currentScore(): number {
    return scoreFor(this.distance, this.starCount);
  }

  // ───────── 사건 ─────────

  private onJump(): void {
    sfx.jump();
    this.stretch(0.84, 1.16);
  }

  private onLand(): void {
    sfx.land();
    this.stretch(1.18, 0.84);
    this.dust.explode(5, RUNNER_X - 4, this.groundY - 1);
  }

  /** 뛰거나 내려앉을 때 몸이 잠깐 늘어났다 돌아온다. */
  private stretch(scaleX: number, scaleY: number): void {
    this.tweens.killTweensOf(this.runner);
    this.runner.setScale(SPRITE_SCALE * scaleX, SPRITE_SCALE * scaleY);
    this.tweens.add({
      targets: this.runner,
      scaleX: SPRITE_SCALE,
      scaleY: SPRITE_SCALE,
      duration: 130,
      ease: 'Quad.Out',
    });
  }

  private collectStar(star: Star): void {
    this.starCount += 1;
    sfx.coin();
    vibrate(10);
    const y = star.sprite.y;
    this.sparks.explode(8, RUNNER_X + 6, y);
    floatText(this, RUNNER_X + 6, y - 8, `+${STAR_POINTS}`, CSS.yellow, this.playArea, DEPTH.effect);
    star.sprite.destroy();
    this.hud.setSide(`별 ${this.starCount}`, true);
  }

  private crash(): void {
    sfx.miss();
    vibrate([40, 30, 80]);
    this.cameras.main.shake(180, 0.012);
    this.draw();

    // 튕겨 올랐다가 화면 아래로 떨어진다.
    const { height } = this.scale;
    this.tweens.killTweensOf(this.runner);
    this.runner.setTexture(runnerTexture(this.skin, 'hit')).setScale(SPRITE_SCALE);
    this.tweens.add({
      targets: this.runner,
      y: this.runner.y - 30,
      angle: -25,
      duration: 180,
      ease: 'Quad.Out',
      onComplete: () => {
        this.tweens.add({
          targets: this.runner,
          y: height + 40,
          angle: 120,
          duration: 520,
          ease: 'Quad.In',
        });
      },
    });

    showBanner(this, this.playArea.centerY, '앗!', CSS.orange, 900, DEPTH.banner);
    this.finishMiniGame(this.currentScore(), [
      ['달린 거리', `${meters(this.distance)}m`],
      ['모은 별', `${this.starCount}개`],
      ['넘은 장애물', `${this.cleared}개`],
    ]);
  }

  // ───────── 그리기 ─────────

  /** 지금 상태를 화면에 옮긴다. 흔들림이 없도록 좌표는 정수로 맞춘다. */
  private draw(): void {
    this.runner.y = this.groundY - Math.round(this.body.y);
    const frame: RunnerFrame = !this.body.grounded
      ? 'jump'
      : Math.floor(this.distance / STRIDE_PIXELS) % 2 === 0
        ? 'run1'
        : 'run2';
    this.runner.setTexture(runnerTexture(this.skin, frame));

    const flap = Math.floor(this.elapsed / BAT_FLAP_SECONDS) % 2;
    for (const obstacle of this.obstacles) {
      const frames = OBSTACLE_ART[obstacle.kind].frames;
      obstacle.sprite.x = Math.round(obstacle.x + OBSTACLE_BOX[obstacle.kind].width / 2);
      if (frames.length > 1) obstacle.sprite.setTexture(frames[flap % frames.length]);
    }
    const bob = Math.round(Math.sin(this.elapsed * 6) * 2);
    for (const star of this.stars) {
      star.sprite.x = Math.round(star.x);
      star.sprite.y = this.groundY - STAR_HEIGHT + bob;
    }

    this.clouds.forEach((cloud, index) => {
      const [startX, , drift] = CLOUDS[index];
      // 왼쪽 밖(-60)으로 나가면 오른쪽 밖에서 다시 들어온다.
      const travelled = (startX + 60 - this.distance * drift) % CLOUD_LOOP;
      cloud.x = Math.round(((travelled + CLOUD_LOOP) % CLOUD_LOOP) - 60);
    });

    this.soil.tilePositionX = Math.round(this.distance);
    this.edge.tilePositionX = Math.round(this.distance);
    this.hills.tilePositionX = Math.round(this.distance * 0.2);

    const score = this.currentScore();
    if (score !== this.shownScore) {
      this.shownScore = score;
      this.hud.setScore(score);
    }
  }
}
