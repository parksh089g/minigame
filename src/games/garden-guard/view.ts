/**
 * 한 판의 시뮬레이션 상태를 화면에 그린다: 풀밭과 울타리, 벌레, 물방울, 튀는 조각.
 * 시뮬레이션의 세로 길이는 늘 같으므로, 화면 길이에 맞춰 세로만 늘이거나 줄여서 놓는다(scaleY).
 */
import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { FONT_SIZE, GAME_WIDTH, THEME_CSS } from '../../config';
import { addText } from '../../core/ui';
import { store } from '../../core/store';
import { allySpot, cellCorner, shapeCells, shapeSize, starOf, type Ally } from './allies';
import { ALLY_SHOT, allyTexture, ENEMY_TINT, enemyTexture, LOOK, TEX } from './art';
import { ALLIES, CELL_COUNT, ENEMIES, GARDEN_CELLS, HOP, SHOOTER, type AllyId, type EnemyKind } from './data';
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
  /** 이 그림이 그리는 판의 동료. 옮겨서 칸이 바뀌면 그림도 따라 걸어간다. */
  ally: Ally;
  /** 차지한 칸을 옅게 칠한 것(모양이 보이게)과, 그때의 첫 칸 */
  plot: Phaser.GameObjects.Graphics;
  plotCell: number;
  image: Phaser.GameObjects.Image;
  stars: Phaser.GameObjects.Text;
  star: number;
  /** 방금 쏘아서 통통 튀는 남은 시간(초) */
  kick: number;
}

/**
 * 동료의 그림을 줄이는 배율. 칸을 많이 차지하는 동료일수록 크게 그리되(1칸, 2칸, 3칸),
 * 한 줄짜리 모양은 위아래 줄을 너무 가리지 않게 줄인다.
 */
export function allyScale(id: AllyId): number {
  const size = Math.min(1.08, 0.54 + ALLIES[id].cells * 0.18);
  const rows = shapeSize(id).height;
  return Math.min(size, (rows * GARDEN_CELLS.cell + 14) / 38);
}
/** 다시 늘어놓아 칸이 바뀐 동료가 새 자리로 걸어가는 빠르기(화면 px/초) */
const ALLY_WALK = 160;
/** 동료의 그림은 차지한 칸을 감싼 네모의 아래쪽 끝보다 이만큼 위에 발을 딛는다(화면 px). */
const ALLY_FOOT = 3;
/** 동료 그림의 세로 길이(배율 1) */
const ALLY_ART_HEIGHT = 38;
/** 동료가 차지한 칸을 칠하는 색과 짙기 */
const PLOT = { color: 0xfff0c9, alpha: 0.75, inset: 1.5 } as const;

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
  private readonly allies = new Map<Ally, AllyView>();
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
    // 동료가 서는 칸: 물총의 양옆에 넷씩, 세 줄. 칸마다 북돋운 두둑
    const size = GARDEN_CELLS.cell;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const corner = cellCorner(cell);
      const x = corner.x;
      const y = toScreenY(layout, corner.y);
      g.fillStyle(LOOK.furrow, 1);
      g.fillRoundedRect(x + 1.5, y + 1.5, size - 3, size - 3, 5);
      g.fillStyle(LOOK.soil, 1);
      g.fillRoundedRect(x + 4, y + 4, size - 8, size - 9, 3.5);
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
            for (const view of this.allies.values()) if (view.ally.cell === event.cell) view.kick = 0.12;
          }
          break;
        case 'buy':
        case 'join': {
          // 새로 온 동료는 그림이 생길 때 튀어나오고, 합쳐서 별이 오른 동료는 반짝인다.
          const y = toScreenY(layout, event.y);
          const big = (event.type === 'join' || event.mode === 'merge') && event.star > 1;
          this.burst(event.x, y, LOOK.crit, big ? 12 : 5, big ? 90 : 60, 2.4);
          if (big) this.ring(event.x, y, LOOK.crit, 18, 0.4);
          break;
        }
        case 'move':
          this.burst(event.x, toScreenY(layout, event.y) + 8, DIRT, 4, 40, 1.8);
          break;
        case 'dismiss':
          // 내보낸 동료는 흙먼지와 함께 사라진다.
          this.burst(event.x, toScreenY(layout, event.y), DIRT, 8, 60, 2.2);
          break;
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

  /** 판에 선 동료를 자리에 세우고 별을 적는다. 새로 온 동료는 튀어나오고, 내보낸 동료는 줄어들며 사라진다. */
  private syncAllies(state: RunState, dt: number): void {
    const { scene, layout } = this;
    for (const [ally, view] of this.allies) {
      if (state.allies.includes(ally)) continue;
      this.allies.delete(ally);
      view.plot.destroy();
      scene.tweens.killTweensOf(view.image);
      scene.tweens.add({
        targets: [view.image, view.stars],
        scale: 0,
        alpha: 0,
        duration: 200,
        onComplete: () => {
          view.image.destroy();
          view.stars.destroy();
        },
      });
    }
    state.allies.forEach((ally, index) => {
      const spot = allySpot(ally);
      const { height } = shapeSize(ally.id);
      const bottom = toScreenY(layout, spot.y) + (height * GARDEN_CELLS.cell) / 2;
      const scale = allyScale(ally.id);
      // 세로로 긴 모양은 그림을 차지한 칸의 가운데쯤에 세운다.
      const room = height * GARDEN_CELLS.cell - ALLY_FOOT - ALLY_ART_HEIGHT * scale;
      const foot = bottom - ALLY_FOOT - Math.max(0, room / 2);
      let view = this.allies.get(ally);
      if (!view) {
        const plot = scene.add.graphics().setDepth(this.depth + 0.5);
        const image = scene.add
          .image(spot.x, foot, allyTexture(ally.id))
          .setOrigin(0.5, 1)
          .setScale(scale)
          .setDepth(this.depth + 4);
        // 가장 작은 글자 크기(10px)보다 작게 쓰지 않는다(11차 검토 G16).
        const stars = addText(scene, spot.x, foot + ALLY_FOOT - 2, '', {
          size: FONT_SIZE.small,
          color: THEME_CSS.accent,
          originX: 0.5,
          originY: 0.5,
          stroke: THEME_CSS.white,
        }).setDepth(this.depth + 4.6);
        view = { ally, plot, plotCell: -1, image, stars, star: 0, kick: 0 };
        this.allies.set(ally, view);
        scene.tweens.add({ targets: image, scale: { from: 0.2, to: scale }, duration: 260, ease: 'Back.Out' });
      }
      if (view.plotCell !== ally.cell) {
        // 차지한 칸을 옅게 칠해서 모양이 보이게 한다.
        view.plotCell = ally.cell;
        view.plot.clear();
        view.plot.fillStyle(PLOT.color, PLOT.alpha);
        for (const cell of shapeCells(ally.id, ally.cell) ?? []) {
          const corner = cellCorner(cell);
          view.plot.fillRoundedRect(
            corner.x + PLOT.inset,
            toScreenY(layout, corner.y) + PLOT.inset,
            GARDEN_CELLS.cell - PLOT.inset * 2,
            GARDEN_CELLS.cell - PLOT.inset * 2,
            5,
          );
        }
      }
      const star = starOf(ally.copies);
      if (star !== view.star) {
        view.star = star;
        view.stars.setText(`★${star}`);
        scene.tweens.add({ targets: view.stars, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
      if (view.kick > 0) view.kick = Math.max(0, view.kick - dt);
      // 옮겨서 칸이 바뀌었으면 새 자리로 걸어간다.
      const step = ALLY_WALK * dt;
      const toward = (from: number, to: number): number => (Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step);
      const x = toward(view.image.x, spot.x);
      const baseY = toward(view.stars.y + 2 - ALLY_FOOT, foot);
      const sway = Math.sin(this.clock * 2.4 + index * 2) * (4 / Math.max(1, ALLIES[ally.id].cells * 0.7));
      view.image.setAngle(sway).setPosition(x, baseY - (view.kick / 0.12) * 2.5);
      view.stars.setPosition(x, baseY + ALLY_FOOT - 2);
    });
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
