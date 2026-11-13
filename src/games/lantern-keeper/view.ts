import Phaser from 'phaser';
import { darknessTexture, flashOf, FLOOR_OF, HERO_FRAMES, LK, LOOK } from './art';
import { ENEMIES, GLIDE, POSTS, QUAKE, STAGES } from './data';
import { HUD_HEIGHT } from './hud';
import { auraStats, beamStats, fireflyStats, isEvolved } from './rules';
import {
  AIM_LOCK_SECONDS,
  CHARGE_SECONDS,
  CHARGING,
  dashOf,
  WARDEN_CHARGING,
  type Gem,
  type Post,
  type ShotLook,
  type Sim,
} from './sim';
import { GUST, LEAP, puddlesAround, shroomsAround, VENT, ventClock, ventsAround } from './terrain';

const DEPTH = {
  floor: 0,
  terrain: 1,
  ground: 2,
  gem: 3,
  post: 4,
  enemy: 5,
  boss: 5.5,
  shot: 6,
  player: 7,
  /** 돌풍의 바람결은 캐릭터와 그림자 위로 지나간다. */
  wind: 7.5,
  dark: 8,
  pointer: 8.5,
  spark: 9,
} as const;

/** 화면 밖의 보스를 가리키는 화살표: 화면 가장자리에서 떨어진 거리와 크기 */
const POINTER = { inset: 12, size: 7 } as const;

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
  /** 적이 터진 자리면 위험한 색으로 그린다 */
  hostile?: boolean;
  /** 부싯돌이 터진 자리면 불꽃 색으로 그린다 */
  flint?: boolean;
}

/** 번갯불이 지나간 길. 잠깐 보였다 사라진다. */
interface Flash {
  points: number[];
  evolved: boolean;
  life: number;
}

const RING_SECONDS = 0.22;
const FLASH_SECONDS = 0.2;

/** 등불 기둥의 그림을 선 자리에서 이만큼(px) 올려 그린다. 받침이 그 자리에 놓인다. */
const POST_LIFT = 6;

/** 등갓의 빛막: 등불지기를 두르는 고리의 반지름과, 발밑이 아니라 몸 가운데에 오도록 올리는 높이(px) */
const GUARD = { radius: 11, lift: -2 } as const;

/** 빛버섯을 딛고 뛴 정예가 얼마나 날아왔는지(0~1). timer는 내려앉을 때까지 남은 시간이다. */
function glideProgress(timer: number): number {
  return Math.min(1, Math.max(0, 1 - timer / GLIDE.seconds));
}

/** 떨어져 있는 것의 그림. 빛 조각은 값이 클수록 큰 조각으로 보인다. */
function gemKey(gem: Gem): string {
  switch (gem.kind) {
    case 'heal':
      return LK.heal;
    case 'pull':
      return LK.pull;
    case 'blast':
      return LK.blast;
    case 'chest':
      return LK.chest;
    default:
      return gem.value >= 10 ? LK.gemBig : gem.value >= 3 ? LK.gemMid : LK.gemSmall;
  }
}

const SHOT_KEY: Record<ShotLook, string> = {
  ember: LK.ember,
  emberEvo: LK.emberEvo,
  lance: LK.lance,
  lanceEvo: LK.lanceEvo,
};

/** 스프라이트를 미리 만들어 두고 돌려쓴다. 프레임마다 앞에서부터 차례로 내준다. */
/** 돌풍의 바람결: 줄의 수, 기본 길이(px), 가장 셀 때 흘러가는 빠르기(px/초), 화면 밖으로 두는 여유(px) */
const WIND = { count: 34, length: 9, speed: 300, margin: 24 } as const;

/** 화면 밖의 보물 상자를 알리는 그림이 가장자리에서 이만큼(px) 안쪽에 선다. */
const CHEST_EDGE = 10;

/** 빛버섯을 딛고 뛰는 정예가 그림에서 가장 높이 떠오르는 높이(px) */
const GLIDE_LIFT = 26;

class Pool {
  private readonly items: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private shown = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  begin(): void {
    this.used = 0;
  }

  /** 화면 좌표 (x, y)에 key 그림을 하나 놓는다. */
  put(key: string, x: number, y: number): Phaser.GameObjects.Image {
    let image = this.items[this.used];
    if (!image) {
      image = this.scene.add.image(0, 0, key).setDepth(this.depth);
      this.items.push(image);
    }
    this.used += 1;
    if (image.texture.key !== key) image.setTexture(key);
    if (!image.visible) image.setVisible(true);
    image.setPosition(Math.round(x), Math.round(y));
    return image;
  }

  /** 이번 프레임에 쓰지 않은 것을 숨긴다. */
  end(): void {
    for (let i = this.used; i < this.shown; i += 1) this.items[i].setVisible(false);
    this.shown = this.used;
  }
}

/** 시뮬레이션 상태를 화면에 그린다. 플레이어는 늘 화면 가운데에 있고 세상이 움직인다. */
export class RunView {
  /** 플레이어가 서 있는 화면 좌표 */
  readonly centerX: number;
  readonly centerY: number;

  private readonly floor: Phaser.GameObjects.TileSprite;
  private readonly terrain: Phaser.GameObjects.Graphics;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;
  private readonly pointer: Phaser.GameObjects.Graphics;
  private readonly player: Phaser.GameObjects.Image;
  private readonly enemies: Pool;
  private readonly gems: Pool;
  private readonly posts: Pool;
  private readonly shots: Pool;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dark: Phaser.GameObjects.Image;
  private readonly darkPulse: Phaser.Tweens.Tween;
  private readonly rings: Ring[] = [];
  private readonly flashes: Flash[] = [];
  private readonly width: number;
  private readonly height: number;
  /** 이 판의 캐릭터가 걷는 그림 두 장 */
  private readonly frames: readonly [string, string];
  /** 웅덩이가 있는 스테이지인지 */
  private readonly puddles: boolean;
  /** 불구멍이 있는 스테이지인지 */
  private readonly vents: boolean;
  /** 빛버섯이 있는 스테이지인지 */
  private readonly shrooms: boolean;
  /** 돌풍의 바람결을 그리는 판. 돌풍이 없는 스테이지에는 없다. */
  private readonly wind?: Phaser.GameObjects.Graphics;
  /** 바람결이 지금까지 흘러간 거리(px). 바람이 셀수록 빨리 는다. */
  private windTravel = 0;
  private stride = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    centerY: number,
    sim: Sim,
    /**
     * top은 화면 위쪽에서 HUD가 차지하는 높이로, 그 아래부터가 싸움터로 보이는 곳이다.
     * bar는 그 바로 아래에 보스의 이름과 체력 막대가 놓이는 높이로, 화살표는 이것을 피해서 그린다.
     */
    private readonly frame: { top: number; bar: number } = { top: 0, bar: 0 },
  ) {
    const { width, height } = scene.scale;
    const { hero, stage } = sim.state;
    this.frames = HERO_FRAMES[hero];
    this.puddles = STAGES[stage].puddles;
    this.vents = STAGES[stage].vents;
    this.shrooms = STAGES[stage].shrooms;
    this.width = width;
    this.height = height;
    this.centerX = Math.round(width / 2);
    this.centerY = Math.round(centerY);

    this.floor = scene.add.tileSprite(0, 0, width, height, FLOOR_OF[stage]).setOrigin(0, 0).setDepth(DEPTH.floor);
    this.terrain = scene.add.graphics().setDepth(DEPTH.terrain);
    this.ground = scene.add.graphics().setDepth(DEPTH.ground);
    this.gems = new Pool(scene, DEPTH.gem);
    this.posts = new Pool(scene, DEPTH.post);
    this.enemies = new Pool(scene, DEPTH.enemy);
    this.shots = new Pool(scene, DEPTH.shot);
    this.air = scene.add.graphics().setDepth(DEPTH.shot);
    if (STAGES[stage].gusts) this.wind = scene.add.graphics().setDepth(DEPTH.wind);
    this.player = scene.add.image(this.centerX, this.centerY, this.frames[0]).setDepth(DEPTH.player);

    // 어둠 덮개는 플레이어를 중심으로 화면 전체를 덮을 만큼 크게 만든다.
    const reach = Math.max(this.centerY, height - this.centerY);
    this.dark = scene.add
      .image(this.centerX, this.centerY, darknessTexture(scene, width, reach * 2))
      .setDepth(DEPTH.dark);
    // 등불이 일렁이는 것처럼 아주 조금씩 밝아졌다 어두워진다.
    this.darkPulse = scene.tweens.add({
      targets: this.dark,
      alpha: 0.86,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    // 화살표는 어둠 덮개 위에 그려야 가장자리에서도 또렷하다.
    this.pointer = scene.add.graphics().setDepth(DEPTH.pointer);

    this.sparks = scene.add
      .particles(0, 0, LK.spark, {
        speed: { min: 20, max: 70 },
        lifespan: { min: 160, max: 320 },
        alpha: { start: 1, end: 0 },
        emitting: false,
      })
      .setDepth(DEPTH.spark);
  }

  /** 세상 좌표 (x, y)에서 불티가 튄다. */
  burst(sim: Sim, x: number, y: number, count: number): void {
    const p = sim.state.player;
    this.sparks.emitParticleAt(x - p.x + this.centerX, y - p.y + this.centerY, count);
  }

  /** 별똥이 떨어진 자리에 퍼지는 고리 */
  ring(x: number, y: number, radius: number): void {
    this.rings.push({ x, y, radius, life: RING_SECONDS });
  }

  /** 등불 기둥이 나타난 자리에 불티가 튀고 고리가 퍼져서, 어디에 생겼는지 눈에 띄게 한다. */
  beacon(sim: Sim, x: number, y: number): void {
    this.ring(x, y, 26);
    this.burst(sim, x, y - POST_LIFT, 12);
  }

  /** 적이 터진 자리에 퍼지는 붉은 고리 */
  pop(x: number, y: number, radius: number): void {
    this.rings.push({ x, y, radius, life: RING_SECONDS, hostile: true });
  }

  /** 부싯돌이 터진 자리에 퍼지는 불꽃 고리 */
  flint(sim: Sim, x: number, y: number, radius: number): void {
    this.rings.push({ x, y, radius, life: RING_SECONDS, flint: true });
    this.burst(sim, x, y, 5);
  }

  /** 번갯불이 지나간 길을 잠깐 그린다. points는 세상 좌표의 x, y가 번갈아 들어 있다. */
  bolt(points: number[], evolved: boolean): void {
    this.flashes.push({ points, evolved, life: FLASH_SECONDS });
  }

  /**
   * 새벽이 왔다: 화면에 남은 그림자가 불티로 흩어지고, 어둠이 ms 동안 걷힌다.
   * 판이 끝난 뒤에 한 번만 부른다. 이 뒤로는 sync를 부르지 않는다.
   */
  dawn(sim: Sim, ms: number): void {
    const p = sim.state.player;
    let left = 150;
    for (const e of sim.state.enemies) {
      if (left <= 0) break;
      const x = e.x - p.x + this.centerX;
      const y = e.y - p.y + this.centerY;
      if (x < 0 || x > this.width || y < 0 || y > this.height) continue;
      const count = ENEMIES[e.kind].boss ? 12 : 3;
      this.sparks.emitParticleAt(x, y, count);
      left -= count;
    }
    for (const pool of [this.enemies, this.shots, this.posts]) {
      pool.begin();
      pool.end();
    }
    this.ground.clear();
    this.air.clear();
    this.pointer.clear();
    this.darkPulse.stop();
    this.scene.tweens.add({ targets: this.dark, alpha: 0, duration: ms, ease: 'Sine.Out' });
  }

  /** 등불이 꺼졌다: 캐릭터가 ms 동안 흐려진다. */
  dusk(ms: number): void {
    this.scene.tweens.add({ targets: this.player, alpha: 0.25, duration: ms, ease: 'Sine.In' });
  }

  /**
   * 공격 예고. 보스가 돌진할 길과 적이 터질 둘레는 바닥에, 쏘려고 모으는 빛은 그 적 위에 그린다.
   * 예고가 보이는 동안 비키면 맞지 않는다.
   */
  private drawThreats(sim: Sim, seconds: number, offsetX: number, offsetY: number): void {
    const g = this.ground;
    const air = this.air;
    for (const e of sim.state.enemies) {
      const info = ENEMIES[e.kind];
      if (e.hp <= 0) continue;
      if (!info.boss) {
        if (e.mode !== 1 || (!info.bursts && !info.shoots && !info.springs)) continue;
        const x = Math.round(e.x + offsetX);
        const y = Math.round(e.y + offsetY);
        if (info.springs) {
          // 내려앉을 자리: 바닥의 원이 안에서부터 차오르고, 다 차면 내려앉는다.
          const progress = glideProgress(e.timer);
          const landX = Math.round(x + e.vx * Math.max(0, e.timer));
          const landY = Math.round(y + e.vy * Math.max(0, e.timer));
          g.fillStyle(LOOK.threat, 0.12);
          g.fillCircle(landX, landY, GLIDE.radius);
          g.fillStyle(LOOK.threat, 0.24);
          g.fillCircle(landX, landY, GLIDE.radius * progress);
          g.lineStyle(1, LOOK.threat, 0.8);
          g.strokeCircle(landX, landY, GLIDE.radius);
        } else if (info.bursts) {
          // 터질 둘레: 바닥의 원이 안에서부터 차오르고, 다 차면 터진다.
          const progress = 1 - Math.max(0, e.timer) / info.bursts.fuse;
          g.fillStyle(LOOK.threat, 0.1);
          g.fillCircle(x, y, info.bursts.radius);
          g.fillStyle(LOOK.threat, 0.22);
          g.fillCircle(x, y, info.bursts.radius * progress);
          g.lineStyle(1, LOOK.threat, 0.75);
          g.strokeCircle(x, y, info.bursts.radius);
        } else if (info.shoots) {
          // 쏘기 전에 모으는 어둠: 작은 고리가 조여들고 가운데가 밝아진다.
          const progress = 1 - Math.max(0, e.timer) / info.shoots.windup;
          air.lineStyle(1, LOOK.threat, 0.4 + 0.5 * progress);
          air.strokeCircle(x, y, info.radius + 2 + 7 * (1 - progress));
          air.fillStyle(LOOK.threatCore, 0.5 + 0.4 * progress);
          air.fillCircle(x, y, 1 + progress);
        }
        continue;
      }
      const x = Math.round(e.x + offsetX);
      const y = Math.round(e.y + offsetY);
      const brain = info.brain;
      if ((brain === 'charge' || brain === 'lord' || brain === 'warden') && e.mode === 1) {
        // 내달릴 길. 겨누는 동안에는 옅게 따라오다가, 방향이 굳으면 짙어지고 깜빡인다.
        const dash = dashOf(e.kind, e.tier);
        const length = dash.speed * dash.seconds + info.radius;
        const locked = e.timer <= AIM_LOCK_SECONDS;
        const blink = locked && Math.floor(seconds * 20) % 2 === 0;
        const endX = Math.round(x + e.vx * length);
        const endY = Math.round(y + e.vy * length);
        g.lineStyle(info.radius * 2, LOOK.threat, locked ? (blink ? 0.42 : 0.3) : 0.14);
        g.lineBetween(x, y, endX, endY);
        g.lineStyle(1, locked ? LOOK.threatCore : LOOK.threat, locked ? 0.85 : 0.5);
        g.lineBetween(x, y, endX, endY);
      } else if (brain === 'elder' && e.mode === CHARGING) {
        // 땅을 구르기 전: 보스의 발밑에 붉은 고리가 조여들며 짙어진다.
        const progress = 1 - Math.max(0, e.timer) / QUAKE.windup;
        const shake = Math.floor(seconds * 30) % 2 === 0 ? 1 : -1;
        g.fillStyle(LOOK.threat, 0.1 + 0.2 * progress);
        g.fillEllipse(x, y + 8, (info.radius + 10) * 2, info.radius + 10);
        g.lineStyle(2, LOOK.threat, 0.4 + 0.5 * progress);
        g.strokeEllipse(x + shake, y + 8, (info.radius + 4 + 18 * (1 - progress)) * 2, info.radius + 4 + 18 * (1 - progress));
      } else if (
        ((brain === 'volley' || brain === 'matron' || brain === 'blizzard') && e.mode === CHARGING) ||
        (brain === 'warden' && e.mode === WARDEN_CHARGING)
      ) {
        // 모으는 빛: 고리가 보스 쪽으로 조여들고 가운데가 밝아진다.
        const progress = 1 - Math.max(0, e.timer) / CHARGE_SECONDS;
        air.lineStyle(2, LOOK.threat, 0.35 + 0.55 * progress);
        air.strokeCircle(x, y, info.radius + 4 + 16 * (1 - progress));
        air.fillStyle(LOOK.threat, 0.5 + 0.3 * progress);
        air.fillCircle(x, y, 2 + 4 * progress);
        air.fillStyle(LOOK.threatCore, 0.9);
        air.fillCircle(x, y, 1 + 2 * progress);
      }
    }
  }

  /**
   * 화면 밖에 있는 보스가 어느 쪽에 있는지, 화면 가장자리에 화살표로 알려 준다.
   * 보스는 느려서 멀리 따돌리기 쉬운데, 어디 있는지 모르면 잡으러 갈 수도 피할 수도 없다.
   */
  private drawPointers(sim: Sim, seconds: number, offsetX: number, offsetY: number): void {
    const g = this.pointer;
    g.clear();
    const { inset, size } = POINTER;
    for (const e of sim.state.enemies) {
      if (!ENEMIES[e.kind].boss || e.hp <= 0) continue;
      const x = e.x + offsetX;
      const y = e.y + offsetY;
      // 몸의 가운데가 화면 안에 있으면 이미 보이는 것이다.
      if (x >= 0 && x <= this.width && y >= this.frame.top && y <= this.height) continue;
      const px = Math.min(this.width - inset, Math.max(inset, x));
      const py = Math.min(this.height - inset, Math.max(this.frame.top + this.frame.bar + inset, y));
      const angle = Math.atan2(y - py, x - px);
      const wing = 2.4;
      const corner = (turn: number, reach: number): [number, number] => [
        Math.round(px + Math.cos(angle + turn) * reach),
        Math.round(py + Math.sin(angle + turn) * reach),
      ];
      const draw = (reach: number): void => {
        const [tipX, tipY] = corner(0, reach);
        const [leftX, leftY] = corner(wing, reach);
        const [rightX, rightY] = corner(-wing, reach);
        g.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
      };
      // 밝은 테두리 안에 붉은 화살표. 테두리가 숨 쉬듯 깜빡여서 눈에 띈다.
      g.fillStyle(LOOK.pointerEdge, 0.65 + 0.3 * Math.sin(seconds * 8));
      draw(size + 2);
      g.fillStyle(LOOK.threat, 1);
      draw(size);
    }
    this.drawPostPointer(sim, offsetX, offsetY);
  }

  /** 아껴 둔(켜지 않은) 등불 기둥이 화면 밖에 있으면, 가장 가까운 것을 가장자리의 작은 노란 화살표로 가리킨다. */
  private drawPostPointer(sim: Sim, offsetX: number, offsetY: number): void {
    let nearest: Post | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const post of sim.state.posts ?? []) {
      if (post.lit > 0) continue;
      const x = post.x + offsetX;
      const y = post.y + offsetY;
      // 하나라도 화면 안에 보이면 가리킬 필요가 없다.
      if (x >= 0 && x <= this.width && y >= this.frame.top && y <= this.height) return;
      const distance = (x - this.centerX) ** 2 + (y - this.centerY) ** 2;
      if (distance < best) {
        best = distance;
        nearest = post;
      }
    }
    if (!nearest) return;
    const g = this.pointer;
    const { inset } = POINTER;
    const size = POINTER.size - 2;
    const x = nearest.x + offsetX;
    const y = nearest.y + offsetY;
    const px = Math.min(this.width - inset, Math.max(inset, x));
    const py = Math.min(this.height - inset, Math.max(this.frame.top + this.frame.bar + inset, y));
    const angle = Math.atan2(y - py, x - px);
    const corner = (turn: number, reach: number): [number, number] => [
      Math.round(px + Math.cos(angle + turn) * reach),
      Math.round(py + Math.sin(angle + turn) * reach),
    ];
    for (const [reach, color] of [
      [size + 2, LOOK.postPointerEdge],
      [size, LOOK.postLight],
    ] as const) {
      const [tipX, tipY] = corner(0, reach);
      const [leftX, leftY] = corner(2.4, reach);
      const [rightX, rightY] = corner(-2.4, reach);
      g.fillStyle(color, 1);
      g.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
    }
  }

  /**
   * 등불 기둥. 켜기 전에는 닿으라는 뜻으로 옅은 고리가 숨 쉬듯 커졌다 줄어들고,
   * 켜진 뒤에는 빛이 닿는 둘레가 바닥에 보인다. 꺼지기 직전에는 둘레가 깜빡인다.
   */
  private drawPosts(sim: Sim, seconds: number, offsetX: number, offsetY: number, g: Phaser.GameObjects.Graphics): void {
    this.posts.begin();
    for (const post of sim.state.posts ?? []) {
      const x = Math.round(post.x + offsetX);
      const y = Math.round(post.y + offsetY);
      const reach = POSTS.radius + 8;
      if (x < -reach || x > this.width + reach || y < -reach || y > this.height + reach) continue;
      const lit = post.lit > 0;
      // 그림의 받침이 기둥이 선 자리에 오도록 올려 놓는다.
      this.posts.put(lit ? LK.postLit : LK.post, x, y - POST_LIFT);
      if (!lit) {
        const breath = 0.5 + 0.5 * Math.sin(seconds * 3.4);
        g.fillStyle(LOOK.postLight, 0.06 + 0.06 * breath);
        g.fillCircle(x, y, POSTS.touch + 4);
        g.lineStyle(1, LOOK.postLight, 0.45 + 0.4 * breath);
        g.strokeCircle(x, y, POSTS.touch + 2 + 4 * breath);
        continue;
      }
      const ending = post.lit < 2.5 && Math.floor(seconds * 8) % 2 === 0;
      const flicker = 0.5 + 0.5 * Math.sin(seconds * 9 + post.x);
      g.fillStyle(LOOK.postLight, ending ? 0.05 : 0.1 + 0.04 * flicker);
      g.fillCircle(x, y, POSTS.radius);
      g.lineStyle(1, LOOK.postEdge, ending ? 0.3 : 0.7);
      g.strokeCircle(x, y, POSTS.radius);
    }
    this.posts.end();
  }

  /**
   * 등갓의 빛막. 서 있는 동안에는 등불지기를 두르는 고리로 보이고,
   * 깨진 뒤에는 다시 차오르는 만큼만 흐린 호로 보인다.
   */
  private drawGuard(sim: Sim, seconds: number, g: Phaser.GameObjects.Graphics): void {
    const charge = sim.guardCharge;
    if (charge <= 0) return;
    const y = this.centerY + GUARD.lift;
    if (sim.guardReady) {
      const glow = 0.5 + 0.5 * Math.sin(seconds * 4);
      g.fillStyle(LOOK.guard, 0.1 + 0.05 * glow);
      g.fillCircle(this.centerX, y, GUARD.radius);
      g.lineStyle(1, LOOK.guard, 0.7 + 0.25 * glow);
      g.strokeCircle(this.centerX, y, GUARD.radius);
      return;
    }
    const start = -Math.PI / 2;
    g.lineStyle(1, LOOK.guard, 0.3);
    g.beginPath();
    g.arc(this.centerX, y, GUARD.radius, start, start + Math.PI * 2 * charge);
    g.strokePath();
  }

  /** 맞았을 때 잠깐 하얗게 */
  private playerKey(sim: Sim, seconds: number): string {
    const p = sim.state.player;
    const frame = p.moving ? Math.floor(this.stride / 7) % 2 : 0;
    const key = this.frames[frame];
    const hurt = p.inv > 0 && Math.floor(seconds * 16) % 2 === 0;
    return hurt ? flashOf(key) : key;
  }

  /**
   * 화면에 걸치는 빛버섯을 그린다. 부푼 버섯은 둘레가 은은히 빛나고,
   * 밟힌 버섯은 납작하게 꺼져 있다가 다시 부풀 때가 되면 빠르게 솟는다.
   */
  private drawShrooms(sim: Sim, seconds: number): void {
    const s = sim.state;
    const p = s.player;
    const g = this.terrain;
    g.clear();
    const midX = p.x + this.width / 2 - this.centerX;
    const midY = p.y + this.height / 2 - this.centerY;
    for (const shroom of shroomsAround(midX, midY, this.width / 2 + 24, this.height / 2 + 24, s.seed)) {
      const x = Math.round(shroom.x - p.x + this.centerX);
      const y = Math.round(shroom.y - p.y + this.centerY);
      const r = shroom.r;
      const until = s.squashed?.[shroom.key];
      const rest = until === undefined ? 0 : Math.max(0, until - s.t);
      // 0이면 납작하게 꺼진 것, 1이면 다 부푼 것
      const puff = rest <= 0 ? 1 : 0.35 + 0.65 * Math.max(0, 1 - rest / LEAP.rest) ** 4;
      const ready = rest <= 0;
      if (ready) {
        const breath = 0.5 + 0.5 * Math.sin(seconds * 2.4 + shroom.x * 0.07);
        g.fillStyle(LOOK.shroomGlow, 0.1 + 0.08 * breath);
        g.fillEllipse(x, y - 2, r * 3.4, r * 2.2);
      }
      // 땅에 드리운 그림자와 대
      g.fillStyle(LOOK.shadow, 0.4);
      g.fillEllipse(x, y + 2, r * 1.6, 4);
      const stemTop = y - 3 - Math.round(2 * puff);
      g.fillStyle(LOOK.shroomStem, ready ? 1 : 0.7);
      g.fillRect(x - 2, stemTop, 4, y + 2 - stemTop);
      // 갓: 둥근 지붕. 밟혀 납작해지면 낮아지고 어두워진다.
      const height = Math.max(2, r * 0.95 * puff);
      const dome = (rx: number, ry: number, baseY: number): void => {
        g.beginPath();
        g.moveTo(x + rx, baseY);
        for (let k = 1; k <= 12; k += 1) {
          const angle = (Math.PI * k) / 12;
          g.lineTo(x + Math.cos(angle) * rx, baseY - Math.sin(angle) * ry);
        }
        g.closePath();
        g.fillPath();
      };
      g.fillStyle(ready ? LOOK.shroomRim : LOOK.shroomFlat, 1);
      dome(r + 1, height + 1, stemTop);
      g.fillStyle(ready ? LOOK.shroom : LOOK.shroomRim, ready ? 1 : 0.85);
      dome(r, height, stemTop - 1);
      // 갓 아래의 주름: 어두운 띠
      g.fillStyle(ready ? LOOK.shroomRim : LOOK.shroomFlat, 1);
      g.fillRect(x - r, stemTop - 1, r * 2 + 1, 2);
      if (ready) {
        g.fillStyle(LOOK.shroomSpot, 0.95);
        g.fillRect(x - Math.round(r * 0.5), stemTop - Math.round(height * 0.55), 2, 2);
        g.fillRect(x + Math.round(r * 0.25), stemTop - Math.round(height * 0.75), 2, 1);
        g.fillRect(x + Math.round(r * 0.55), stemTop - Math.round(height * 0.3), 1, 1);
      }
    }
  }

  /**
   * 빛버섯 숲에서 바닥에 그리는 것: 싹, 땅울림 고리, 공중에 뜬 것의 그림자.
   * 싹은 자랄수록 커지고 곧 자랄 때는 깜빡인다. 고리는 틈을 남기고 붉게 퍼진다.
   */
  private drawGrove(sim: Sim, seconds: number, offsetX: number, offsetY: number, g: Phaser.GameObjects.Graphics): void {
    const s = sim.state;
    const p = s.player;
    for (const sprout of s.sprouts ?? []) {
      const x = Math.round(sprout.x + offsetX);
      const y = Math.round(sprout.y + offsetY);
      if (x < -8 || x > this.width + 8 || y < -8 || y > this.height + 8) continue;
      const grown = Math.min(1, Math.max(0, 1 - sprout.t / 4));
      if (sprout.t < 1 && Math.floor(seconds * 10) % 2 === 0) continue;
      const tall = 2 + Math.round(4 * grown);
      g.fillStyle(LOOK.shadow, 0.35);
      g.fillEllipse(x, y + 1, 8, 3);
      g.fillStyle(LOOK.sproutStem, 1);
      g.fillRect(x, y - tall, 1, tall + 1);
      g.fillStyle(LOOK.sprout, 1);
      const leaf = 1 + Math.round(2 * grown);
      g.fillRect(x - leaf, y - tall, leaf, 2);
      g.fillRect(x + 1, y - tall - 1, leaf, 2);
    }
    for (const quake of s.quakes ?? []) {
      if (quake.delay > 0 || quake.r <= 0) continue;
      const x = quake.x + offsetX;
      const y = quake.y + offsetY;
      const fade = 1 - Math.min(1, quake.r / QUAKE.reach) * 0.5;
      const step = (Math.PI * 2) / QUAKE.gaps;
      const inner = Math.max(1, quake.r - QUAKE.band / 2);
      for (let k = 0; k < QUAKE.gaps; k += 1) {
        // 틈과 틈 사이의 호
        const from = quake.gap + k * step + QUAKE.gap / 2;
        const to = quake.gap + (k + 1) * step - QUAKE.gap / 2;
        g.lineStyle(QUAKE.band, LOOK.threat, 0.42 * fade);
        g.beginPath();
        g.arc(x, y, inner, from, to);
        g.strokePath();
        g.lineStyle(1, LOOK.threatCore, 0.75 * fade);
        g.beginPath();
        g.arc(x, y, quake.r, from, to);
        g.strokePath();
      }
    }
    // 공중에 뜬 것의 그림자: 높이 뜰수록 작아진다.
    if (p.leap) {
      const height = Math.sin(Math.PI * Math.min(1, p.leap.t / LEAP.seconds));
      g.fillStyle(LOOK.shadow, 0.45);
      g.fillEllipse(this.centerX, this.centerY + 7, 12 - 4 * height, 4 - height);
    }
    for (const e of s.enemies) {
      const info = ENEMIES[e.kind];
      if (!info.springs || e.mode !== 1 || e.hp <= 0) continue;
      const height = Math.sin(Math.PI * glideProgress(e.timer));
      g.fillStyle(LOOK.shadow, 0.45);
      g.fillEllipse(Math.round(e.x + offsetX), Math.round(e.y + offsetY) + 8, 22 - 8 * height, 7 - 2 * height);
    }
  }

  /** 화면에 걸치는 웅덩이를 그린다. 플레이어가 빠져 있으면 발밑에 물결이 인다. */
  private drawPuddles(sim: Sim, seconds: number): void {
    const s = sim.state;
    const p = s.player;
    const g = this.terrain;
    g.clear();
    const midX = p.x + this.width / 2 - this.centerX;
    const midY = p.y + this.height / 2 - this.centerY;
    for (const puddle of puddlesAround(midX, midY, this.width / 2 + 34, this.height / 2 + 24, s.seed)) {
      const x = Math.round(puddle.x - p.x + this.centerX);
      const y = Math.round(puddle.y - p.y + this.centerY);
      g.fillStyle(LOOK.puddleRim, 0.55);
      g.fillEllipse(x, y, puddle.rx * 2 + 4, puddle.ry * 2 + 4);
      g.fillStyle(LOOK.puddle, 0.9);
      g.fillEllipse(x, y, puddle.rx * 2, puddle.ry * 2);
      // 물에 비친 빛 한 줄
      g.fillStyle(LOOK.puddleShine, 0.28);
      g.fillRect(x - Math.round(puddle.rx * 0.5), y - Math.round(puddle.ry * 0.45), Math.round(puddle.rx * 0.6), 1);
    }
    if (p.wading) {
      const spread = (seconds * 1.6) % 1;
      g.lineStyle(1, LOOK.puddleShine, 0.6 * (1 - spread));
      g.strokeEllipse(this.centerX, this.centerY + 7, 10 + 12 * spread, 4 + 5 * spread);
    }
  }

  /**
   * 화면에 걸치는 불구멍을 그린다. 잠잠할 때는 어두운 구덩이, 달아오르면 안에서부터 불빛이 차오르고,
   * 솟는 동안에는 구덩이 가득 불길이 인다.
   */
  private drawVents(sim: Sim, seconds: number): void {
    const s = sim.state;
    const p = s.player;
    const g = this.terrain;
    g.clear();
    const midX = p.x + this.width / 2 - this.centerX;
    const midY = p.y + this.height / 2 - this.centerY;
    for (const vent of ventsAround(midX, midY, this.width / 2 + 26, this.height / 2 + 30, s.seed)) {
      const x = Math.round(vent.x - p.x + this.centerX);
      const y = Math.round(vent.y - p.y + this.centerY);
      const clock = ventClock(vent, s.t);
      g.fillStyle(LOOK.ventRim, 0.8);
      g.fillEllipse(x, y, vent.rx * 2 + 4, vent.ry * 2 + 4);
      g.fillStyle(LOOK.vent, 0.9);
      g.fillEllipse(x, y, vent.rx * 2, vent.ry * 2);
      if (clock < VENT.warm) {
        // 달아오른다: 불빛이 안에서부터 차오르고, 테두리가 깜빡여서 곧 솟는다는 것을 알린다.
        const heat = clock / VENT.warm;
        g.fillStyle(LOOK.ventWarm, 0.25 + 0.45 * heat);
        g.fillEllipse(x, y, vent.rx * 2 * heat, vent.ry * 2 * heat);
        const blink = Math.floor(seconds * (6 + 8 * heat)) % 2 === 0;
        g.lineStyle(1, LOOK.threat, blink ? 0.9 : 0.45);
        g.strokeEllipse(x, y, vent.rx * 2 + 2, vent.ry * 2 + 2);
      } else if (clock < VENT.warm + VENT.erupt) {
        // 솟는다: 구덩이 가득한 불빛 위로 불길 몇 가닥이 일렁이며 솟는다.
        const left = 1 - (clock - VENT.warm) / VENT.erupt;
        const fade = Math.min(1, left * 4);
        g.fillStyle(LOOK.ventWarm, 0.85 * fade);
        g.fillEllipse(x, y, vent.rx * 2, vent.ry * 2);
        g.fillStyle(LOOK.ventFire, 0.9 * fade);
        g.fillEllipse(x, y, vent.rx * 1.3, vent.ry * 1.3);
        for (let k = -2; k <= 2; k += 1) {
          const sway = Math.sin(seconds * 17 + k * 1.9 + vent.x);
          const tall = Math.round((9 + 5 * sway) * fade * (1 - Math.abs(k) * 0.22));
          const fx = Math.round(x + k * vent.rx * 0.36);
          g.fillStyle(k % 2 === 0 ? LOOK.ventFire : LOOK.ventWarm, 0.9 * fade);
          g.fillRect(fx - 1, y - tall, 3, tall);
          g.fillStyle(LOOK.ventCore, 0.8 * fade);
          g.fillRect(fx, y - Math.round(tall * 0.5), 1, Math.round(tall * 0.5));
        }
        g.lineStyle(1, LOOK.threat, 0.9 * fade);
        g.strokeEllipse(x, y, vent.rx * 2 + 2, vent.ry * 2 + 2);
      } else {
        // 잠잠하다: 바닥에 남은 불씨만 희미하게 숨 쉰다.
        const breath = 0.5 + 0.5 * Math.sin(seconds * 2 + vent.offset * 3);
        g.fillStyle(LOOK.ventWarm, 0.1 + 0.08 * breath);
        g.fillEllipse(x, y, vent.rx * 0.9, vent.ry * 0.9);
      }
    }
  }

  /**
   * 돌풍의 바람결: 바람 부는 쪽으로 흘러가는 짧은 줄들. 일기 시작할 때는 옅고 느리게 흘러서 어느 쪽에서 불지 알려 주고,
   * 세게 불 때는 짙고 빠르다. 줄의 자리는 번호로 정해 두고 흘러간 거리만큼 옮겨서, 화면을 벗어나면 맞은편에서 다시 들어온다.
   */
  private drawWind(sim: Sim, dt: number): void {
    const g = this.wind;
    const gust = sim.gust;
    if (!g || !gust) return;
    g.clear();
    if (gust.phase === 'calm') return;
    const warn = gust.phase === 'warn';
    const strength = warn ? 0.2 + 0.3 * Math.min(1, gust.since / GUST.warn) : 0.5 + 0.5 * gust.force;
    this.windTravel += WIND.speed * strength * dt;
    const spanX = this.width + WIND.margin * 2;
    const spanY = this.height + WIND.margin * 2;
    for (let i = 0; i < WIND.count; i += 1) {
      // 줄마다 자리와 길이, 빠르기가 조금씩 다르다.
      const pace = 0.7 + ((i * 37) % 10) / 16;
      const length = (WIND.length + ((i * 13) % 9)) * (0.5 + 0.5 * strength);
      const travel = this.windTravel * pace;
      const x = ((((i * 97) % spanX) + gust.dirX * travel) % spanX + spanX) % spanX - WIND.margin;
      const y = ((((i * 211) % spanY) + gust.dirY * travel) % spanY + spanY) % spanY - WIND.margin;
      g.lineStyle(1, LOOK.wind, (0.3 + 0.45 * strength) * (i % 3 === 0 ? 1 : 0.65));
      g.lineBetween(x, y, x - gust.dirX * length, y - gust.dirY * length);
    }
  }

  sync(sim: Sim, seconds: number, dt: number): void {
    const s = sim.state;
    const p = s.player;
    const offsetX = this.centerX - p.x;
    const offsetY = this.centerY - p.y;
    const marginX = 16;
    const marginY = 20;

    this.floor.setTilePosition(Math.round(p.x - this.centerX), Math.round(p.y - this.centerY));

    if (this.puddles) this.drawPuddles(sim, seconds);
    if (this.vents) this.drawVents(sim, seconds);
    if (this.wind) this.drawWind(sim, dt);
    if (this.shrooms) this.drawShrooms(sim, seconds);

    // 웅덩이에서는 발이 무거워 걸음도 느려진다.
    if (p.moving) this.stride += (p.wading ? 36 : 60) * dt;
    const playerKey = this.playerKey(sim, seconds);
    if (this.player.texture.key !== playerKey) this.player.setTexture(playerKey);
    this.player.setFlipX(p.face < 0);
    // 빛버섯을 밟고 뛰는 동안에는 캐릭터가 떠오른다. 발밑의 그림자는 바닥 그림에서 그린다.
    const lift = p.leap ? Math.round(LEAP.height * Math.sin(Math.PI * Math.min(1, p.leap.t / LEAP.seconds))) : 0;
    if (this.player.y !== this.centerY - lift) this.player.setY(this.centerY - lift);
    // 발이 얼어 있는 동안에는 얼음빛이 돈다.
    const chilled = (p.chilled ?? 0) > 0;
    if (chilled !== this.player.isTinted) {
      if (chilled) this.player.setTint(LOOK.chill);
      else this.player.clearTint();
    }

    // 빛 조각
    this.gems.begin();
    for (const gem of s.gems) {
      const x = gem.x + offsetX;
      const y = gem.y + offsetY;
      if (gem.kind === 'chest') {
        // 보물 상자는 놓치지 않게 살짝 들썩이고, 화면 밖에 있으면 그쪽 가장자리에서 깜빡인다.
        const edgeX = Phaser.Math.Clamp(x, CHEST_EDGE, this.width - CHEST_EDGE);
        const edgeY = Phaser.Math.Clamp(y, HUD_HEIGHT + CHEST_EDGE, this.height - CHEST_EDGE);
        const away = edgeX !== x || edgeY !== y;
        if (away && Math.floor(seconds * 4) % 2 === 0) continue;
        this.gems.put(LK.chest, edgeX, away ? edgeY : edgeY - (Math.floor(seconds * 3) % 2));
        continue;
      }
      if (x < -marginX || x > this.width + marginX || y < -marginY || y > this.height + marginY) continue;
      this.gems.put(gemKey(gem), x, y);
    }
    this.gems.end();

    // 적
    const beat = seconds * 3.2;
    this.enemies.begin();
    for (const e of s.enemies) {
      const x = e.x + offsetX;
      const y = e.y + offsetY;
      const reach = ENEMIES[e.kind].radius + 6;
      if (x < -reach || x > this.width + reach || y < -reach || y > this.height + reach) continue;
      const frames = LK[e.kind];
      // 뛰는 적은 웅크렸을 때와 뛸 때의 그림이 다르고, 나머지는 박자에 맞춰 꿈틀거린다.
      const frame = ENEMIES[e.kind].hops ? (e.mode === 1 ? 0 : 1) : Math.floor(beat + e.uid * 0.37) % 2;
      const key = frames[frame];
      const boss = Boolean(ENEMIES[e.kind].boss);
      const info = ENEMIES[e.kind];
      // 터지려고 부푸는 적은 점점 커지면서 깜빡인다.
      const swell = info.bursts && e.mode === 1 ? 1 - Math.max(0, e.timer) / info.bursts.fuse : 0;
      const lit = e.flash > 0 || (swell > 0 && Math.floor(seconds * (8 + 10 * swell)) % 2 === 0);
      // 빛버섯을 딛고 뛴 정예는 떠올랐다가 내려앉는다.
      const airborne = Boolean(info.springs) && e.mode === 1;
      const rise = airborne ? Math.round(GLIDE_LIFT * Math.sin(Math.PI * glideProgress(e.timer))) : 0;
      const image = this.enemies.put(lit ? flashOf(key) : key, x, y - rise);
      const scale = 1 + 0.4 * swell;
      if (image.scaleX !== scale) image.setScale(scale);
      const depth = boss || airborne ? DEPTH.boss : DEPTH.enemy;
      if (image.depth !== depth) image.setDepth(depth);
    }
    this.enemies.end();

    // 불씨탄, 빛화살, 반딧불, 떨어지는 별. 돌려쓰는 그림이라 방향을 매번 다시 정한다.
    this.shots.begin();
    for (const shot of s.shots) {
      const image = this.shots.put(SHOT_KEY[shot.look], shot.x + offsetX, shot.y + offsetY).setScale(1);
      const turned = shot.look === 'lance' || shot.look === 'lanceEvo';
      image.setRotation(turned ? Math.atan2(shot.vy, shot.vx) : 0);
    }
    if (s.weapons.firefly) {
      const stats = fireflyStats(s.weapons.firefly, sim.mods);
      const key = isEvolved(s.weapons.firefly) ? LK.fireflyEvo : LK.firefly;
      for (let k = 0; k < stats.count; k += 1) {
        const angle = s.fireflyAngle + (k / stats.count) * Math.PI * 2;
        this.shots
          .put(key, this.centerX + Math.cos(angle) * stats.orbit, this.centerY + Math.sin(angle) * stats.orbit)
          .setRotation(0)
          .setScale(1);
      }
    }
    // 보스가 쏜 빛덩이는 숨 쉬듯 커졌다 작아져서 우리 편 공격과 헷갈리지 않는다.
    const throb = 1 + 0.18 * Math.sin(seconds * 14);
    for (const hazard of s.hazards) {
      this.shots.put(LK.orb, hazard.x + offsetX, hazard.y + offsetY).setRotation(0).setScale(throb);
    }
    // 초승달은 빙글빙글 돌면서 날고, 보름달은 천천히 돈다.
    for (const moon of s.moons) {
      this.shots
        .put(moon.evolved ? LK.moonEvo : LK.moon, moon.x + offsetX, moon.y + offsetY)
        .setRotation(seconds * (moon.evolved ? 5 : 16))
        .setScale(1);
    }
    for (const strike of s.strikes) {
      // 비스듬히 떨어져 내려온다.
      const fall = strike.delay * 260;
      this.shots
        .put(strike.evolved ? LK.starEvo : LK.star, strike.x + offsetX + fall * 0.35, strike.y + offsetY - fall)
        .setRotation(0)
        .setScale(1);
    }
    this.shots.end();

    // 바닥에 그리는 것: 불길, 등불 고리, 별똥이 떨어질 자리, 퍼지는 고리
    const g = this.ground;
    g.clear();
    for (const fire of s.fires) {
      const x = Math.round(fire.x + offsetX);
      const y = Math.round(fire.y + offsetY);
      // 꺼지기 직전에는 흐려지고, 타는 동안에는 일렁인다.
      const fade = Math.min(1, fire.life / 0.5);
      const flicker = 0.5 + 0.5 * Math.sin(seconds * 11 + fire.x * 0.3);
      g.fillStyle(fire.evolved ? LOOK.fireEvo : LOOK.fire, (0.2 + 0.08 * flicker) * fade);
      g.fillCircle(x, y, fire.radius);
      g.fillStyle(LOOK.fireCore, (0.16 + 0.1 * flicker) * fade);
      g.fillCircle(x, y, fire.radius * (0.5 + 0.1 * flicker));
      g.lineStyle(1, LOOK.fire, 0.5 * fade);
      g.strokeCircle(x, y, fire.radius);
    }
    if (s.weapons.aura) {
      const stats = auraStats(s.weapons.aura, sim.mods);
      const evolved = isEvolved(s.weapons.aura);
      const pulse = 1 - Math.max(0, s.cd.aura) / stats.tick;
      g.fillStyle(evolved ? LOOK.auraEvo : LOOK.aura, 0.1 + 0.06 * (1 - pulse));
      g.fillCircle(this.centerX, this.centerY, stats.radius);
      g.lineStyle(evolved ? 2 : 1, evolved ? LOOK.auraEvoEdge : LOOK.auraEdge, evolved ? 0.7 : 0.55);
      g.strokeCircle(this.centerX, this.centerY, stats.radius);
    }
    if (s.weapons.beam) {
      // 등대빛: 플레이어에게서 뻗어 끝으로 갈수록 퍼지는 빛줄기. 바깥은 노랗고 옅게, 가운데는 희고 밝게 칠한다.
      const stats = beamStats(s.weapons.beam, sim.mods);
      const evolved = isEvolved(s.weapons.beam);
      const turn = s.beamAngle ?? 0;
      for (let k = 0; k < stats.count; k += 1) {
        const angle = turn + (k / stats.count) * Math.PI * 2;
        const ax = Math.cos(angle);
        const ay = Math.sin(angle);
        const tipX = this.centerX + ax * stats.length;
        const tipY = this.centerY + ay * stats.length;
        for (const [half, color, alpha] of [
          [stats.width + 3, LOOK.beam, evolved ? 0.4 : 0.32],
          [stats.width * 0.5 + 0.5, LOOK.beamCore, evolved ? 0.7 : 0.55],
        ] as const) {
          g.fillStyle(color, alpha);
          g.fillTriangle(this.centerX, this.centerY, tipX + ay * half, tipY - ax * half, tipX - ay * half, tipY + ax * half);
        }
      }
    }
    this.drawPosts(sim, seconds, offsetX, offsetY, g);
    this.drawGuard(sim, seconds, g);
    if (this.shrooms) this.drawGrove(sim, seconds, offsetX, offsetY, g);
    for (const strike of s.strikes) {
      g.lineStyle(1, LOOK.strike, 0.5);
      g.strokeCircle(Math.round(strike.x + offsetX), Math.round(strike.y + offsetY), strike.radius);
    }
    // 종소리: 퍼져 나가면서 옅어지는 고리
    for (const wave of s.waves) {
      if (wave.delay > 0 || wave.radius <= 0) continue;
      const fade = 1 - wave.radius / wave.max;
      const x = Math.round(wave.x + offsetX);
      const y = Math.round(wave.y + offsetY);
      g.lineStyle(3, wave.evolved ? LOOK.bellEvo : LOOK.bell, 0.25 + 0.5 * fade);
      g.strokeCircle(x, y, wave.radius);
      g.lineStyle(1, LOOK.bolt, 0.3 + 0.6 * fade);
      g.strokeCircle(x, y, wave.radius);
    }
    let kept = 0;
    for (const ring of this.rings) {
      ring.life -= dt;
      if (ring.life <= 0) continue;
      const progress = 1 - ring.life / RING_SECONDS;
      const ringX = Math.round(ring.x + offsetX);
      const ringY = Math.round(ring.y + offsetY);
      const reach = ring.radius * (0.5 + 0.5 * progress);
      g.fillStyle(ring.hostile ? LOOK.threat : ring.flint ? LOOK.flint : LOOK.strike, 0.35 * (1 - progress));
      g.fillCircle(ringX, ringY, reach);
      // 부싯돌이 터진 자리는 작아서, 가장자리를 밝게 둘러 눈에 띄게 한다.
      if (ring.flint) {
        g.lineStyle(1, LOOK.strike, 0.7 * (1 - progress));
        g.strokeCircle(ringX, ringY, reach);
      }
      this.rings[kept] = ring;
      kept += 1;
    }
    this.rings.length = kept;

    // 번갯불: 적에서 적으로 이어지는 꺾은선. 마디마다 조금씩 어긋나게 해서 번개처럼 보이게 한다.
    const air = this.air;
    air.clear();
    kept = 0;
    for (const flash of this.flashes) {
      flash.life -= dt;
      if (flash.life <= 0) continue;
      // 처음 절반은 또렷하게 보이다가 빠르게 사라진다.
      const alpha = Math.min(1, (flash.life / FLASH_SECONDS) * 2);
      const { points } = flash;
      const trace = (): void => {
        air.beginPath();
        air.moveTo(Math.round(points[0] + offsetX), Math.round(points[1] + offsetY));
        for (let i = 2; i < points.length; i += 2) {
          const midX = (points[i - 2] + points[i]) / 2;
          const midY = (points[i - 1] + points[i + 1]) / 2;
          const bend = i % 4 === 0 ? 4 : -4;
          air.lineTo(Math.round(midX + offsetX + bend), Math.round(midY + offsetY - bend));
          air.lineTo(Math.round(points[i] + offsetX), Math.round(points[i + 1] + offsetY));
        }
        air.strokePath();
      };
      // 바깥은 굵고 옅게, 안쪽은 가늘고 밝게 두 번 그어 빛나는 줄처럼 보이게 한다.
      air.lineStyle(flash.evolved ? 6 : 4, flash.evolved ? LOOK.boltEvoGlow : LOOK.boltGlow, 0.45 * alpha);
      trace();
      air.lineStyle(flash.evolved ? 2.5 : 1.5, LOOK.bolt, alpha);
      trace();
      this.flashes[kept] = flash;
      kept += 1;
    }
    this.flashes.length = kept;

    this.drawThreats(sim, seconds, offsetX, offsetY);
    this.drawPointers(sim, seconds, offsetX, offsetY);
  }
}
