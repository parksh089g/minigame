import Phaser from 'phaser';
import { darknessTexture, flashOf, FLOOR_OF, HERO_FRAMES, LK, LOOK } from './art';
import { ENEMIES, STAGES } from './data';
import { auraStats, fireflyStats, isEvolved } from './rules';
import { AIM_LOCK_SECONDS, CHARGE_SECONDS, CHARGING, dashOf, type Gem, type ShotLook, type Sim } from './sim';
import { puddlesAround } from './terrain';

const DEPTH = {
  floor: 0,
  terrain: 1,
  ground: 2,
  gem: 3,
  enemy: 5,
  boss: 5.5,
  shot: 6,
  player: 7,
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
}

/** 번갯불이 지나간 길. 잠깐 보였다 사라진다. */
interface Flash {
  points: number[];
  evolved: boolean;
  life: number;
}

const RING_SECONDS = 0.22;
const FLASH_SECONDS = 0.2;

/** 등갓의 빛막: 등불지기를 두르는 고리의 반지름과, 발밑이 아니라 몸 가운데에 오도록 올리는 높이(px) */
const GUARD = { radius: 11, lift: -2 } as const;

/** 떨어져 있는 것의 그림. 빛 조각은 값이 클수록 큰 조각으로 보인다. */
function gemKey(gem: Gem): string {
  switch (gem.kind) {
    case 'heal':
      return LK.heal;
    case 'pull':
      return LK.pull;
    case 'blast':
      return LK.blast;
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
    this.width = width;
    this.height = height;
    this.centerX = Math.round(width / 2);
    this.centerY = Math.round(centerY);

    this.floor = scene.add.tileSprite(0, 0, width, height, FLOOR_OF[stage]).setOrigin(0, 0).setDepth(DEPTH.floor);
    this.terrain = scene.add.graphics().setDepth(DEPTH.terrain);
    this.ground = scene.add.graphics().setDepth(DEPTH.ground);
    this.gems = new Pool(scene, DEPTH.gem);
    this.enemies = new Pool(scene, DEPTH.enemy);
    this.shots = new Pool(scene, DEPTH.shot);
    this.air = scene.add.graphics().setDepth(DEPTH.shot);
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

  /** 적이 터진 자리에 퍼지는 붉은 고리 */
  pop(x: number, y: number, radius: number): void {
    this.rings.push({ x, y, radius, life: RING_SECONDS, hostile: true });
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
    for (const pool of [this.enemies, this.shots]) {
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
        if (e.mode !== 1 || (!info.bursts && !info.shoots)) continue;
        const x = Math.round(e.x + offsetX);
        const y = Math.round(e.y + offsetY);
        if (info.bursts) {
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
      if ((brain === 'charge' || brain === 'lord') && e.mode === 1) {
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
      } else if ((brain === 'volley' || brain === 'matron') && e.mode === CHARGING) {
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
  }

  /** 맞았을 때 잠깐 하얗게 */
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

  private playerKey(sim: Sim, seconds: number): string {
    const p = sim.state.player;
    const frame = p.moving ? Math.floor(this.stride / 7) % 2 : 0;
    const key = this.frames[frame];
    const hurt = p.inv > 0 && Math.floor(seconds * 16) % 2 === 0;
    return hurt ? flashOf(key) : key;
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

  sync(sim: Sim, seconds: number, dt: number): void {
    const s = sim.state;
    const p = s.player;
    const offsetX = this.centerX - p.x;
    const offsetY = this.centerY - p.y;
    const marginX = 16;
    const marginY = 20;

    this.floor.setTilePosition(Math.round(p.x - this.centerX), Math.round(p.y - this.centerY));

    if (this.puddles) this.drawPuddles(sim, seconds);

    // 웅덩이에서는 발이 무거워 걸음도 느려진다.
    if (p.moving) this.stride += (p.wading ? 36 : 60) * dt;
    const playerKey = this.playerKey(sim, seconds);
    if (this.player.texture.key !== playerKey) this.player.setTexture(playerKey);
    this.player.setFlipX(p.face < 0);

    // 빛 조각
    this.gems.begin();
    for (const gem of s.gems) {
      const x = gem.x + offsetX;
      const y = gem.y + offsetY;
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
      const image = this.enemies.put(lit ? flashOf(key) : key, x, y);
      const scale = 1 + 0.4 * swell;
      if (image.scaleX !== scale) image.setScale(scale);
      const depth = boss ? DEPTH.boss : DEPTH.enemy;
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
    this.drawGuard(sim, seconds, g);
    for (const strike of s.strikes) {
      g.lineStyle(1, LOOK.strike, 0.5);
      g.strokeCircle(Math.round(strike.x + offsetX), Math.round(strike.y + offsetY), strike.radius);
    }
    let kept = 0;
    for (const ring of this.rings) {
      ring.life -= dt;
      if (ring.life <= 0) continue;
      const progress = 1 - ring.life / RING_SECONDS;
      g.fillStyle(ring.hostile ? LOOK.threat : LOOK.strike, 0.35 * (1 - progress));
      g.fillCircle(Math.round(ring.x + offsetX), Math.round(ring.y + offsetY), ring.radius * (0.5 + 0.5 * progress));
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
