import Phaser from 'phaser';
import { GOLD_ORB, ORB_LOOKS } from '../../art/cosmetics';
import { TEXTURE } from '../../art/sprites';
import { ORB_SIZE } from '../../art/textures';
import { GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  accuracy,
  comboBonus,
  goldChance,
  maxOrbs,
  orbLifetime,
  pointsFor,
  ROUND_SECONDS,
  spawnInterval,
  type OrbKind,
} from './rules';

interface Orb {
  kind: OrbKind;
  sprite: Phaser.GameObjects.Image;
  /** 나타난 뒤 지난 시간(초) */
  age: number;
  /** 머무는 시간(초) */
  lifetime: number;
}

const FIELD_MARGIN = 8;
const ORB_RADIUS = ORB_SIZE / 2;
/** 구슬 가장자리 바깥으로 이만큼까지는 명중으로 쳐 준다. 손가락은 마우스보다 덜 정확하다. */
const HIT_FORGIVENESS = 6;
/** 구슬끼리 떨어져 있어야 하는 최소 간격 */
const ORB_SPACING = ORB_SIZE + 8;

const DEPTH = { ring: 5, orb: 10, effect: 20, hud: 30, banner: 40 } as const;

/**
 * 번개 탭: 30초 동안 나타나는 구슬을 사라지기 전에 터치한다.
 * 연속으로 맞히면 보너스가 붙고, 빈 곳을 누르거나 구슬을 놓치면 콤보가 끊긴다.
 */
export class LightningTapScene extends MiniGameScene {
  protected readonly gameId = 'lightning-tap';

  private field!: Phaser.Geom.Rectangle;
  private orbs: Orb[] = [];
  private elapsed = 0;
  private spawnIn = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private hits = 0;
  private misses = 0;
  private lastTickSecond = 0;

  private hud!: GameHud;
  private rings!: Phaser.GameObjects.Graphics;
  /** 보통 구슬의 텍스처와 남은 시간 고리의 색. 고른 꾸미기에 따라 달라진다. */
  private orbTexture = '';
  private ringColor: number = THEME.skyDeep;
  private sparks!: Record<OrbKind, Phaser.GameObjects.Particles.ParticleEmitter>;

  constructor() {
    super(SCENE.lightningTap);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    this.field = new Phaser.Geom.Rectangle(
      FIELD_MARGIN,
      HUD_HEIGHT,
      GAME_WIDTH - FIELD_MARGIN * 2,
      height - HUD_HEIGHT - FIELD_MARGIN - 3,
    );

    addBackdrop(this);
    const fieldFrame = this.add.graphics();
    drawPanel(fieldFrame, this.field.x, this.field.y, this.field.width, this.field.height, {
      radius: 16,
    });

    this.rings = this.add.graphics().setDepth(DEPTH.ring);
    // 보통 구슬의 생김새는 상점에서 고른 꾸미기를 따른다.
    this.orbTexture = store.data.cosmetics.equipped.orb;
    const look = ORB_LOOKS[this.orbTexture];
    this.ringColor = look.ring;
    this.sparks = {
      normal: this.createSparks([...look.sparks]),
      gold: this.createSparks([...GOLD_ORB.sparks]),
    };

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.drawTimeBar();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.runCountdown();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    this.elapsed += dt;

    if (this.elapsed >= ROUND_SECONDS) {
      this.elapsed = ROUND_SECONDS;
      this.drawTimeBar();
      this.endRound();
      return;
    }

    this.updateSpawning(dt);
    this.updateOrbs(dt);
    this.drawTimeBar();
    this.tickLastSeconds();
  }

  private resetState(): void {
    this.orbs = [];
    this.elapsed = 0;
    this.spawnIn = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.lastTickSecond = 0;
  }

  // ───────── 화면 구성 ─────────

  private drawTimeBar(): void {
    this.hud.setTime(ROUND_SECONDS - this.elapsed, ROUND_SECONDS);
  }

  private createSparks(tint: number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 40, max: 120 },
        lifespan: { min: 180, max: 360 },
        alpha: { start: 1, end: 0 },
        tint,
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }

  private runCountdown(): void {
    const centerX = GAME_WIDTH / 2;
    const centerY = Math.round(this.field.centerY);
    const hint = addText(this, centerX, centerY + 34, '구슬이 사라지기 전에 터치!\n금색 구슬은 5점', {
      color: THEME_CSS.sub,
      align: 'center',
      originX: 0.5,
    }).setDepth(DEPTH.banner);

    const steps = ['3', '2', '1', '시작!'];
    steps.forEach((label, index) => {
      this.time.delayedCall(index * 600, () => {
        const isGo = index === steps.length - 1;
        if (isGo) sfx.go();
        else sfx.count();
        this.showBanner(label, isGo ? THEME_CSS.good : THEME_CSS.ink, 520);
        if (isGo) {
          hint.destroy();
          this.playing = true;
        }
      });
    });
  }

  private showBanner(label: string, color: string, durationMs: number): void {
    showBanner(this, this.field.centerY, label, color, durationMs, DEPTH.banner);
  }

  // ───────── 구슬 ─────────

  private updateSpawning(dt: number): void {
    this.spawnIn -= dt;
    if (this.spawnIn > 0) return;
    if (this.orbs.length >= maxOrbs(this.elapsed)) return;
    if (this.spawnOrb()) this.spawnIn = spawnInterval(this.elapsed);
  }

  /** 다른 구슬과 겹치지 않는 자리를 찾아 구슬을 만든다. 자리가 없으면 false. */
  private spawnOrb(): boolean {
    const inset = ORB_RADIUS + 4;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const x = Phaser.Math.Between(this.field.left + inset, this.field.right - inset);
      const y = Phaser.Math.Between(this.field.top + inset, this.field.bottom - inset);
      const crowded = this.orbs.some(
        (orb) => Phaser.Math.Distance.Between(x, y, orb.sprite.x, orb.sprite.y) < ORB_SPACING,
      );
      if (crowded) continue;

      const kind: OrbKind = Math.random() < goldChance(this.elapsed) ? 'gold' : 'normal';
      const sprite = this.add
        .image(x, y, kind === 'gold' ? TEXTURE.orbGold : this.orbTexture)
        .setDepth(DEPTH.orb)
        .setScale(0.3);
      this.tweens.add({ targets: sprite, scale: 1, duration: 90, ease: 'Back.Out' });
      this.orbs.push({ kind, sprite, age: 0, lifetime: orbLifetime(this.elapsed, kind) });
      return true;
    }
    return false;
  }

  private updateOrbs(dt: number): void {
    this.rings.clear();
    for (const orb of [...this.orbs]) {
      orb.age += dt;
      const remaining = 1 - orb.age / orb.lifetime;
      if (remaining <= 0) {
        this.expireOrb(orb);
        continue;
      }
      // 남은 시간을 줄어드는 고리로 보여 주고, 거의 끝나면 깜빡인다.
      this.rings.lineStyle(1.5, orb.kind === 'gold' ? GOLD_ORB.ring : this.ringColor, 0.9);
      this.rings.strokeCircle(orb.sprite.x, orb.sprite.y, ORB_RADIUS + 1.5 + remaining * 8);
      const blinking = remaining < 0.3 && Math.floor(orb.age * 16) % 2 === 0;
      orb.sprite.setAlpha(blinking ? 0.45 : 1);
    }
  }

  private removeOrb(orb: Orb): void {
    const index = this.orbs.indexOf(orb);
    if (index >= 0) this.orbs.splice(index, 1);
    this.tweens.killTweensOf(orb.sprite);
  }

  private expireOrb(orb: Orb): void {
    this.removeOrb(orb);
    this.breakCombo();
    sfx.expire();
    this.tweens.add({
      targets: orb.sprite,
      scale: 0,
      alpha: 0,
      duration: 120,
      onComplete: () => orb.sprite.destroy(),
    });
  }

  // ───────── 입력과 점수 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 카메라가 화면을 확대해 그리므로 화면 좌표가 아니라 게임 좌표로 본다.
    const { worldX, worldY } = pointer;
    if (!this.playing || !this.field.contains(worldX, worldY)) return;

    let target: Orb | null = null;
    let nearest = ORB_RADIUS + HIT_FORGIVENESS;
    for (const orb of this.orbs) {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, orb.sprite.x, orb.sprite.y);
      if (distance <= nearest) {
        nearest = distance;
        target = orb;
      }
    }

    if (target) this.hitOrb(target);
    else this.missAt(worldX, worldY);
  }

  private hitOrb(orb: Orb): void {
    const { x, y } = orb.sprite;
    const points = pointsFor(orb.kind, this.combo);
    const bonusBefore = comboBonus(this.combo);

    this.removeOrb(orb);
    orb.sprite.destroy();

    this.hits += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += points;
    this.hud.setScore(this.score);
    this.showCombo(comboBonus(this.combo) > bonusBefore);

    if (orb.kind === 'gold') sfx.gold();
    else sfx.hit(this.combo);
    vibrate(orb.kind === 'gold' ? 25 : 10);
    this.sparks[orb.kind].explode(orb.kind === 'gold' ? 18 : 10, x, y);
    this.floatText(x, y - ORB_RADIUS, `+${points}`, orb.kind === 'gold' ? THEME_CSS.accent : THEME_CSS.ink);
  }

  private missAt(x: number, y: number): void {
    this.misses += 1;
    this.breakCombo();
    sfx.miss();
    vibrate(20);
    this.cameras.main.shake(90, 0.006);
    this.floatText(x, y - 6, '빗나감', THEME_CSS.bad);
  }

  private breakCombo(): void {
    this.combo = 0;
    this.hud.setSide('');
  }

  private showCombo(bonusJustIncreased: boolean): void {
    if (this.combo < 2) return;
    const bonus = comboBonus(this.combo);
    const label = bonus > 0 ? `콤보 ${this.combo} +${bonus}` : `콤보 ${this.combo}`;
    this.hud.setSide(label, bonusJustIncreased);
  }

  private floatText(x: number, y: number, label: string, color: string): void {
    floatText(this, x, y, label, color, this.field, DEPTH.effect);
  }

  private tickLastSeconds(): void {
    const remaining = Math.ceil(ROUND_SECONDS - this.elapsed);
    if (remaining <= 5 && remaining !== this.lastTickSecond) {
      this.lastTickSecond = remaining;
      sfx.tick();
    }
  }

  private endRound(): void {
    this.rings.clear();
    for (const orb of this.orbs) {
      this.tweens.killTweensOf(orb.sprite);
      this.tweens.add({
        targets: orb.sprite,
        alpha: 0,
        duration: 200,
        onComplete: () => orb.sprite.destroy(),
      });
    }
    this.orbs = [];
    this.showBanner('끝!', THEME_CSS.accent, 900);
    this.finishMiniGame(this.score, [
      ['명중', `${this.hits}번`],
      ['최대 콤보', String(this.maxCombo)],
      ['정확도', `${accuracy(this.hits, this.misses)}%`],
    ]);
  }
}
