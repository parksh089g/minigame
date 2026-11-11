import Phaser from 'phaser';
import { darknessTexture, flashOf, FLOOR_OF, HERO_FRAMES, LK, LOOK } from './art';
import { ENEMIES, STAGES } from './data';
import { auraStats, fireflyStats, isEvolved } from './rules';
import type { ShotLook, Sim } from './sim';
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
  spark: 9,
} as const;

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
}

/** 번갯불이 지나간 길. 잠깐 보였다 사라진다. */
interface Flash {
  points: number[];
  evolved: boolean;
  life: number;
}

const RING_SECONDS = 0.22;
const FLASH_SECONDS = 0.2;

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
  private readonly player: Phaser.GameObjects.Image;
  private readonly enemies: Pool;
  private readonly gems: Pool;
  private readonly shots: Pool;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rings: Ring[] = [];
  private readonly flashes: Flash[] = [];
  private readonly width: number;
  private readonly height: number;
  /** 이 판의 캐릭터가 걷는 그림 두 장 */
  private readonly frames: readonly [string, string];
  /** 웅덩이가 있는 스테이지인지 */
  private readonly puddles: boolean;
  private stride = 0;

  constructor(scene: Phaser.Scene, centerY: number, sim: Sim) {
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
    const dark = scene.add
      .image(this.centerX, this.centerY, darknessTexture(scene, width, reach * 2))
      .setDepth(DEPTH.dark);
    // 등불이 일렁이는 것처럼 아주 조금씩 밝아졌다 어두워진다.
    scene.tweens.add({ targets: dark, alpha: 0.86, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

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

  /** 번갯불이 지나간 길을 잠깐 그린다. points는 세상 좌표의 x, y가 번갈아 들어 있다. */
  bolt(points: number[], evolved: boolean): void {
    this.flashes.push({ points, evolved, life: FLASH_SECONDS });
  }

  /** 맞았을 때 잠깐 하얗게 */
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
      const key =
        gem.kind === 'heal' ? LK.heal : gem.value >= 10 ? LK.gemBig : gem.value >= 3 ? LK.gemMid : LK.gemSmall;
      this.gems.put(key, x, y);
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
      const image = this.enemies.put(e.flash > 0 ? flashOf(key) : key, x, y);
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
    for (const strike of s.strikes) {
      g.lineStyle(1, LOOK.strike, 0.5);
      g.strokeCircle(Math.round(strike.x + offsetX), Math.round(strike.y + offsetY), strike.radius);
    }
    let kept = 0;
    for (const ring of this.rings) {
      ring.life -= dt;
      if (ring.life <= 0) continue;
      const progress = 1 - ring.life / RING_SECONDS;
      g.fillStyle(LOOK.strike, 0.35 * (1 - progress));
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
  }
}
