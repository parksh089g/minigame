/**
 * 한 판의 시뮬레이션 상태를 화면에 그린다: 풀밭과 울타리, 벌레, 물방울, 튀는 조각.
 * 시뮬레이션의 세로 길이는 늘 같으므로, 화면 길이에 맞춰 세로만 늘이거나 줄여서 놓는다(scaleY).
 */
import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { GAME_WIDTH, THEME_CSS } from '../../config';
import { addText } from '../../core/ui';
import { store } from '../../core/store';
import { starOf } from './allies';
import { ALLY_SHOT, allyTexture, ENEMY_TINT, enemyTexture, LOOK, TEX } from './art';
import { ALLY_ORDER, ALLY_SPOTS, ENEMIES, HOP, SHOOTER, type AllyId, type EnemyKind } from './data';
import { toScreenY, type FieldLayout } from './layout';
import { chargePhase, isBuried, type Enemy, type RunState, type SimEvent } from './sim';

export { aimDots, GARDEN_HEIGHT, layoutField, toScreenY, toSim, type FieldLayout } from './layout';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  span: number;
  size: number;
  color: number;
  /** 아래로 당기는 힘. 물방울은 떨어지고, 고리는 제자리에서 퍼진다. */
  gravity: number;
  ring: boolean;
}

interface BugView {
  image: Phaser.GameObjects.Image;
  kind: EnemyKind;
  /** 벌레마다 걸음의 박자가 어긋나게 하는 값 */
  beat: number;
  /** 지난번에 땅속에 있었는지. 들어가고 나오는 순간에 흙을 튀긴다. */
  buried: boolean;
}

/** 울타리 아래에 선 동료 하나의 그림과 별 */
interface AllyView {
  image: Phaser.GameObjects.Image;
  stars: Phaser.GameObjects.Text;
  star: number;
  /** 방금 쏘아서 통통 튀는 남은 시간(초) */
  kick: number;
}

/** 동료의 그림을 줄이는 배율. 여섯이 물총 양옆에 나란히 서야 한다. */
export const ALLY_SCALE = 0.78;
/** 동료가 선 자리(시뮬레이션 y)보다 그림의 발끝이 이만큼 아래다(화면 px). */
const ALLY_FOOT = 8;

/** 흙의 색: 땅강아지가 파고들고 나올 때와 장수풍뎅이가 내달릴 때 튄다. */
const DIRT = 0xd9b48f;

const PARTICLE_CAP = 160;

export class FieldView {
  private readonly bugs = new Map<number, BugView>();
  private readonly shots = new Map<number, Phaser.GameObjects.Image>();
  private readonly spare: Phaser.GameObjects.Image[] = [];
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly sparks: Phaser.GameObjects.Graphics;
  private readonly fence: Phaser.GameObjects.Graphics;
  private readonly gun: Phaser.GameObjects.Image;
  private readonly shooter: Phaser.GameObjects.Image;
  private readonly allies = new Map<AllyId, AllyView>();
  private readonly particles: Particle[] = [];
  private clock = 0;
  /** 울타리가 갉혀서 흔들리는 남은 시간(초)과 갉힌 자리 */
  private shake = 0;
  private recoil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly layout: FieldLayout,
    private readonly depth: number,
  ) {
    this.drawGround();
    this.fence = scene.add.graphics().setDepth(depth + 3);
    this.bars = scene.add.graphics().setDepth(depth + 2.5);
    this.sparks = scene.add.graphics().setDepth(depth + 5);

    const shooterY = toScreenY(layout, SHOOTER.y);
    this.shooter = scene.add
      .image(SHOOTER.x, shooterY + 14, mascotTexture(store.data.cosmetics.equipped.runner, 'idle'))
      .setOrigin(0.5, 1)
      .setScale(0.6)
      .setDepth(depth + 4);
    this.gun = scene.add
      .image(SHOOTER.x, shooterY - 6, TEX.gun)
      .setOrigin(0.15, 0.5)
      .setDepth(depth + 4.5);
    this.drawFence(0);
  }

  private drawGround(): void {
    const { scene, layout } = this;
    const g = scene.add.graphics().setDepth(this.depth);
    g.fillStyle(LOOK.grass, 1);
    g.fillRect(0, 0, GAME_WIDTH, layout.fenceY + 6);
    // 풀 포기를 여기저기 놓는다. 판마다 같은 자리에 놓이도록 정해진 차례의 수를 쓴다.
    g.fillStyle(LOOK.tuft, 1);
    let seed = 7;
    const next = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const span = layout.fenceY - layout.top;
    for (let index = 0; index < 26; index += 1) {
      const x = 8 + next() * (GAME_WIDTH - 16);
      const y = layout.top + 6 + next() * (span - 22);
      g.fillEllipse(x - 3, y, 5, 3);
      g.fillEllipse(x + 3, y, 5, 3);
      g.fillEllipse(x, y - 2, 4, 5);
    }
    // 울타리 아래의 텃밭: 흙과 이랑, 그 위의 새싹
    g.fillStyle(LOOK.soil, 1);
    g.fillRect(0, layout.fenceY + 4, GAME_WIDTH, layout.height - layout.fenceY);
    g.fillStyle(LOOK.furrow, 1);
    for (let row = 0; row < 3; row += 1) {
      g.fillRoundedRect(8, layout.fenceY + 26 + row * 20, GAME_WIDTH - 16, 5, 2.5);
    }
  }

  /** 울타리를 그린다. lean은 갉혀서 흔들리는 정도(-1~1)다. */
  private drawFence(lean: number): void {
    const g = this.fence;
    const y = this.layout.fenceY;
    g.clear();
    g.fillStyle(LOOK.woodDeep, 1);
    g.fillRoundedRect(-2, y + 2, GAME_WIDTH + 4, 4, 2);
    const pitch = 12;
    for (let x = 3; x < GAME_WIDTH; x += pitch) {
      const dx = lean * 1.2;
      g.fillStyle(LOOK.woodDeep, 1);
      g.fillRoundedRect(x + dx, y - 7, 7, 17, 2.5);
      g.fillStyle(LOOK.wood, 1);
      g.fillRoundedRect(x + dx, y - 8, 7, 16, 2.5);
    }
  }

  private take(texture: string): Phaser.GameObjects.Image {
    const image = this.spare.pop();
    if (image) {
      return image
        .setTexture(texture)
        .setVisible(true)
        .setAlpha(1)
        .setScale(1)
        .setAngle(0)
        .setTintMode(Phaser.TintModes.MULTIPLY)
        .setTint(0xffffff);
    }
    return this.scene.add.image(0, 0, texture);
  }

  private give(image: Phaser.GameObjects.Image): void {
    this.scene.tweens.killTweensOf(image);
    this.spare.push(image.setVisible(false));
  }

  private burst(x: number, y: number, color: number, count: number, speed: number, size = 2): void {
    for (let index = 0; index < count && this.particles.length < PARTICLE_CAP; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const pace = speed * (0.45 + Math.random() * 0.55);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * pace,
        vy: Math.sin(angle) * pace - speed * 0.3,
        life: 0,
        span: 0.28 + Math.random() * 0.18,
        size: size * (0.7 + Math.random() * 0.6),
        color,
        gravity: 160,
        ring: false,
      });
    }
  }

  private ring(x: number, y: number, color: number, size: number, span = 0.3): void {
    if (this.particles.length >= PARTICLE_CAP) return;
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, span, size, color, gravity: 0, ring: true });
  }

  /** 시뮬레이션에서 일어난 일을 화면의 효과로 옮긴다. 소리는 씬이 낸다. */
  handle(events: readonly SimEvent[]): void {
    const { layout } = this;
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          const y = toScreenY(layout, event.y);
          if (event.crit) {
            this.burst(event.x, y, LOOK.crit, 5, 70, 2.4);
            this.ring(event.x, y, LOOK.crit, 9, 0.22);
          } else {
            this.burst(event.x, y, event.shell ? LOOK.shell : LOOK.drop, 3, 55);
          }
          break;
        }
        case 'kill': {
          const y = toScreenY(layout, event.y);
          const big = ENEMIES[event.kind].boss === true;
          this.burst(event.x, y, ENEMY_TINT[event.kind], big ? 18 : 6, big ? 120 : 75, big ? 3.4 : 2.4);
          this.burst(event.x, y, LOOK.dropLight, big ? 10 : 3, 60);
          this.ring(event.x, y, LOOK.dropLight, big ? 30 : 13, big ? 0.45 : 0.3);
          break;
        }
        case 'bite':
          this.shake = 0.22;
          this.burst(event.x, layout.fenceY - 2, LOOK.woodDeep, 3, 50);
          this.ring(event.x, layout.fenceY - 2, LOOK.bite, 8, 0.2);
          break;
        case 'guard':
          // 울타리 방울이 갉기를 막았다. 울타리는 흔들리지 않고 금빛 고리만 번진다.
          this.ring(event.x, layout.fenceY - 2, LOOK.crit, 10, 0.3);
          this.burst(event.x, layout.fenceY - 2, LOOK.crit, 2, 40);
          break;
        case 'storm':
          for (let index = 0; index < 60 && this.particles.length < PARTICLE_CAP; index += 1) {
            this.particles.push({
              x: Math.random() * GAME_WIDTH,
              y: layout.top - Math.random() * 60,
              vx: -20,
              vy: 420 + Math.random() * 160,
              life: 0,
              span: 0.5 + Math.random() * 0.4,
              size: 2.6,
              color: index % 3 === 0 ? LOOK.dropLight : LOOK.drop,
              gravity: 0,
              ring: false,
            });
          }
          break;
        case 'fire':
          if (event.ally === null) this.recoil = 0.08;
          else {
            const ally = this.allies.get(event.ally);
            if (ally) ally.kick = 0.12;
          }
          break;
        case 'buy': {
          // 새로 온 동료는 그림이 생길 때 튀어나오고, 합쳐서 별이 오른 동료는 반짝인다.
          const spot = ALLY_SPOTS[event.id];
          const y = toScreenY(layout, spot.y) - 6;
          this.burst(spot.x, y, LOOK.crit, event.star > 1 ? 12 : 5, event.star > 1 ? 90 : 60, 2.4);
          if (event.star > 1) this.ring(spot.x, y, LOOK.crit, 18, 0.4);
          break;
        }
        default:
          break;
      }
    }
  }

  /** 지금 상태대로 모든 것을 놓는다. dt는 지난 시간(초)이고, 효과를 움직이는 데 쓴다. */
  sync(state: RunState, dt: number): void {
    this.clock += dt;
    this.syncBugs(state);
    this.syncShots(state);
    this.syncAllies(state, dt);
    this.syncGun(state, dt);
    this.drawBars(state);
    this.drawParticles(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.drawFence(this.shake > 0 ? Math.sin(this.clock * 70) * (this.shake / 0.22) : 0);
    }
  }

  private syncBugs(state: RunState): void {
    const { layout } = this;
    const seen = new Set<number>();
    for (const enemy of state.enemies) {
      seen.add(enemy.id);
      let bug = this.bugs.get(enemy.id);
      if (!bug) {
        bug = { image: this.take(enemyTexture(enemy.kind)), kind: enemy.kind, beat: (enemy.id * 1.7) % 6.28, buried: false };
        this.bugs.set(enemy.id, bug);
      }
      const y = toScreenY(layout, enemy.y);
      const buried = isBuried(enemy);
      if (buried !== bug.buried) {
        bug.buried = buried;
        bug.image.setTexture(buried ? TEX.mound : enemyTexture(enemy.kind));
        this.burst(enemy.x, y, DIRT, 7, 70, 2.2);
      }
      // 내달리는 장수풍뎅이 뒤로 흙먼지가 인다.
      if (chargePhase(enemy) === 'rush' && Math.random() < 0.35) {
        this.burst(enemy.x + (Math.random() - 0.5) * 24, y - ENEMIES[enemy.kind].radius, DIRT, 1, 30, 2.6);
      }
      this.poseBug(bug, enemy, y);
    }
    for (const [id, bug] of this.bugs) {
      if (seen.has(id)) continue;
      this.bugs.delete(id);
      // 물에 씻겨 가듯이 커지면서 흐려진다.
      const image = bug.image.setTintMode(Phaser.TintModes.MULTIPLY).setTint(0xffffff);
      this.scene.tweens.add({
        targets: image,
        alpha: 0,
        scale: image.scale * 1.35,
        duration: 150,
        onComplete: () => this.give(image),
      });
    }
  }

  private poseBug(bug: BugView, enemy: Enemy, y: number): void {
    const def = ENEMIES[enemy.kind];
    const image = bug.image;
    const wave = Math.sin(this.clock * (def.boss ? 5 : 10) + bug.beat);
    let lift = 0;
    let scale = 1;
    let angle = wave * (def.boss ? 2.5 : 6);
    const charge = chargePhase(enemy);
    if (bug.buried) {
      // 흙더미가 꿈틀거리며 지나간다.
      angle = wave * 3;
      scale = 1 + Math.abs(wave) * 0.05;
    } else if (charge === 'windup') {
      // 돌진하기 전에 부르르 떨며 웅크린다.
      angle = Math.sin(this.clock * 48) * 4;
      scale = 1.06;
    } else if (charge === 'rush') {
      angle = 0;
      scale = 1.04;
    } else if (enemy.biting) {
      // 울타리를 갉는 동안에는 앞뒤로 들이받는다.
      lift = -Math.abs(Math.sin(this.clock * 9 + bug.beat)) * 2.5;
      angle = wave * 3;
    } else if (def.gait === 'hop') {
      const beat = HOP.rest + HOP.leap;
      const phase = enemy.clock % beat;
      if (phase >= HOP.rest) {
        const jump = Math.sin(((phase - HOP.rest) / HOP.leap) * Math.PI);
        lift = -jump * 9;
        scale = 1 + jump * 0.18;
      }
      angle = 0;
    } else if (def.gait === 'weave') {
      lift = wave * 1.5;
    }
    image
      .setPosition(enemy.x, y + lift)
      .setScale(scale * (1 + wave * 0.03), scale * (1 - wave * 0.03))
      .setAngle(angle)
      // 아래에 있는 벌레가 위의 벌레를 가린다.
      .setDepth(this.depth + 1 + enemy.y / 1000);
    // 맞은 순간에는 하얗게 번쩍이고, 찬물에 젖어 있는 동안에는 푸르스름하다.
    if (enemy.flash > 0) image.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else image.setTintMode(Phaser.TintModes.MULTIPLY).setTint(enemy.slowLeft > 0 ? LOOK.chilled : 0xffffff);
  }

  private syncShots(state: RunState): void {
    const { layout } = this;
    const seen = new Set<number>();
    for (const shot of state.shots) {
      seen.add(shot.id);
      let image = this.shots.get(shot.id);
      if (!image) {
        image = this.take(shot.ally ? ALLY_SHOT[shot.ally] : shot.crit ? TEX.dropCrit : TEX.drop).setDepth(this.depth + 2);
        // 화면에서 날아가는 쪽으로 뾰족한 끝을 돌린다(그림은 위를 보고 있다).
        image.setRotation(Math.atan2(shot.vy * layout.scaleY, shot.vx) + Math.PI / 2);
        this.shots.set(shot.id, image);
      }
      image.setPosition(shot.x, toScreenY(layout, shot.y));
    }
    for (const [id, image] of this.shots) {
      if (seen.has(id)) continue;
      this.shots.delete(id);
      this.give(image);
    }
  }

  private syncGun(state: RunState, dt: number): void {
    const { layout } = this;
    // 물총은 울타리 아래(화면이 늘이지 않는 곳)에 있어서, 물방울이 나가는 쪽이 시뮬레이션에서 겨눈 쪽 그대로다.
    const angle = state.aim;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt);
    const kick = (this.recoil / 0.08) * 2.5;
    const baseY = toScreenY(layout, SHOOTER.y) - 6;
    this.gun
      .setRotation(angle)
      .setPosition(SHOOTER.x - Math.cos(angle) * kick, baseY - Math.sin(angle) * kick)
      // 왼쪽을 겨눌 때 물총이 뒤집혀 보이지 않게 한다.
      .setFlipY(Math.cos(angle) < 0);
    const bob = Math.sin(this.clock * 3) * 0.015;
    this.shooter.setScale(0.6 * (1 + bob), 0.6 * (1 - bob));
  }

  /** 판에 선 동료를 자리에 세우고 별을 적는다. 새로 온 동료는 튀어나온다. */
  private syncAllies(state: RunState, dt: number): void {
    const { scene, layout } = this;
    for (const ally of state.allies) {
      const spot = ALLY_SPOTS[ally.id];
      const foot = toScreenY(layout, spot.y) + ALLY_FOOT;
      let view = this.allies.get(ally.id);
      if (!view) {
        const image = scene.add
          .image(spot.x, foot, allyTexture(ally.id))
          .setOrigin(0.5, 1)
          .setScale(ALLY_SCALE)
          .setDepth(this.depth + 4);
        const stars = addText(scene, spot.x, foot + 2, '', {
          size: 10,
          color: THEME_CSS.accent,
          originX: 0.5,
          originY: 0.5,
          stroke: THEME_CSS.white,
        }).setDepth(this.depth + 4.6);
        view = { image, stars, star: 0, kick: 0 };
        this.allies.set(ally.id, view);
        scene.tweens.add({ targets: image, scale: { from: 0.2, to: ALLY_SCALE }, duration: 260, ease: 'Back.Out' });
      }
      const star = starOf(ally.copies);
      if (star !== view.star) {
        view.star = star;
        view.stars.setText(`★${star}`);
        scene.tweens.add({ targets: view.stars, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
      if (view.kick > 0) view.kick = Math.max(0, view.kick - dt);
      const sway = Math.sin(this.clock * 2.4 + ALLY_ORDER.indexOf(ally.id) * 2) * 4;
      view.image.setAngle(sway).setY(foot - (view.kick / 0.12) * 2.5);
    }
  }

  private drawBars(state: RunState): void {
    const g = this.bars;
    const { layout } = this;
    g.clear();
    for (const enemy of state.enemies) {
      if (enemy.hp >= enemy.maxHp || enemy.hp <= 0 || isBuried(enemy)) continue;
      const def = ENEMIES[enemy.kind];
      const width = def.boss ? 36 : 14;
      const height = def.boss ? 4 : 2.5;
      const x = enemy.x - width / 2;
      const y = toScreenY(layout, enemy.y) - def.radius - (def.boss ? 12 : 7);
      g.fillStyle(LOOK.hpBack, 0.35);
      g.fillRoundedRect(x - 0.5, y - 0.5, width + 1, height + 1, height / 2);
      g.fillStyle(def.boss ? LOOK.hpBoss : LOOK.hpFill, 1);
      g.fillRoundedRect(x, y, Math.max(height, width * (enemy.hp / enemy.maxHp)), height, height / 2);
    }
  }

  private drawParticles(dt: number): void {
    const g = this.sparks;
    g.clear();
    let kept = 0;
    for (const particle of this.particles) {
      particle.life += dt;
      if (particle.life >= particle.span) continue;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += particle.gravity * dt;
      const left = 1 - particle.life / particle.span;
      if (particle.ring) {
        g.lineStyle(1.6, particle.color, left);
        g.strokeCircle(particle.x, particle.y, particle.size * (0.4 + (1 - left) * 0.8));
      } else {
        g.fillStyle(particle.color, Math.min(1, left * 1.6));
        g.fillCircle(particle.x, particle.y, particle.size * (0.5 + left * 0.5));
      }
      this.particles[kept] = particle;
      kept += 1;
    }
    this.particles.length = kept;
  }
}
