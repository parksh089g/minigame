/**
 * 한 판 동안 화면 위쪽에 떠 있는 정보. 체력, 경험치, 시간, 지금 든 무기와 패시브를 보여 준다.
 * 체력은 눈이 가 있는 캐릭터 바로 아래에도 작은 막대로 한 번 더 보여 준다.
 */
import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { LK } from './art';
import { ENEMIES, MAX_LEVEL, MAX_WEAPONS, PASSIVES, RUN_SECONDS, WEAPON_ORDER, type PassiveId } from './data';
import { iconKey, passiveSlots, weaponSlots, type Slot } from './icons';
import { formatClock, xpToNext } from './rules';
import type { Enemy, Sim } from './sim';

/** HUD가 차지하는 높이. 이보다 위는 조이스틱이 받지 않고, 선택 화면의 머리글도 이 아래에 놓인다. */
export const HUD_HEIGHT = 68;

/** 하트와 체력 숫자, 레벨 글자가 시작하는 자리 */
const LABEL_X = 40;
const BAR_X = 78;
const BAR_WIDTH = 108;
const HP_BAR = { y: 8, height: 10 } as const;
const XP_BAR = { y: 24, height: 7 } as const;
/** 시간과 처치 수를 오른쪽 끝에 맞춘다. */
const RIGHT = GAME_WIDTH - 8;

/** 든 것을 늘어놓는 줄. 왼쪽이 무기, 오른쪽이 패시브다. */
const SLOT_Y = 38;
const SLOT_HEIGHT = 26;
const WEAPON_SLOT = { x: 8, width: 22, step: 24 } as const;
const PASSIVE_SLOT = { x: 108, width: 20, step: 21 } as const;
const PASSIVE_COUNT = Object.keys(PASSIVES).length;
/** 레벨을 나타내는 점 하나의 크기와 간격 */
const PIP = { size: 2, step: 3 } as const;
const PIPS_WIDTH = MAX_LEVEL * PIP.step - 1;

/** 체력이 이 비율 아래면 막대 색이 바뀐다. */
const HP_WARN = 0.5;
/** 체력이 이 비율 아래로 내려가면 위험하다고 알린다. */
export const HP_DANGER = 0.3;
/** 맞은 직후 체력 막대 테두리가 밝아지는 시간(초) */
const HURT_FLASH = 0.25;

/** 캐릭터 아래의 작은 체력 막대 */
const MINI = { width: 18, height: 3, below: 11 } as const;
const BOSS_BAR_WIDTH = 120;
/** HUD 아래로 보스의 이름과 체력 막대가 차지하는 높이. 싸움터에 띄우는 표시는 이 아래에 둔다. */
export const BOSS_BAR_HEIGHT = 26;

const hpColor = (ratio: number): number =>
  ratio <= HP_DANGER ? COLOR.red : ratio <= HP_WARN ? COLOR.yellow : COLOR.green;

export interface HudDepth {
  /** HUD 본체. 선택 화면의 어두운 막보다 위에 있어서 고르는 동안에도 든 무기가 보인다. */
  top: number;
  /** 보스 체력과 캐릭터 아래 막대. 게임 화면 바로 위. */
  field: number;
}

export class RunHud {
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly slots: Phaser.GameObjects.Graphics;
  private readonly field: Phaser.GameObjects.Graphics;
  private readonly heart: Phaser.GameObjects.Image;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly clockText: Phaser.GameObjects.Text;
  private readonly killText: Phaser.GameObjects.Text;
  private readonly bossText: Phaser.GameObjects.Text;
  private readonly weaponIcons: Phaser.GameObjects.Image[] = [];
  private readonly passiveIcons: Phaser.GameObjects.Image[] = [];

  private shownHp = -1;
  private shownDanger: boolean | null = null;
  private shownLevel = -1;
  private shownClock = '';
  private shownKills = -1;
  private shownBuild = -1;
  private hurtUntil = 0;

  constructor(
    scene: Phaser.Scene,
    depth: HudDepth,
    /** 화면에서 캐릭터가 서 있는 자리 */
    private readonly playerX: number,
    private readonly playerY: number,
    onPause: () => void,
  ) {
    scene.add.rectangle(0, 0, GAME_WIDTH, HUD_HEIGHT, COLOR.ink, 0.72).setOrigin(0, 0).setDepth(depth.top);

    // 일시정지 버튼. 공용 버튼은 깊이를 정할 수 없어 어둠 덮개에 가려지므로 HUD 위에 따로 그린다.
    const button = scene.add.graphics().setDepth(depth.top);
    const drawButton = (pressed: boolean): void => {
      button.clear();
      drawPanel(button, 8, 6, 26, 26, { fill: pressed ? COLOR.navy : COLOR.slate, shadow: COLOR.ink, radius: 8 });
    };
    drawButton(false);
    scene.add.image(21, 19, 'icon-pause').setDepth(depth.top);
    addTapZone(scene, 0, 0, 38, 36, drawButton, onPause);

    this.bars = scene.add.graphics().setDepth(depth.top);
    this.slots = scene.add.graphics().setDepth(depth.top);
    this.field = scene.add.graphics().setDepth(depth.field);

    this.heart = scene.add.image(LABEL_X, HP_BAR.y, LK.heart).setOrigin(0, 0).setDepth(depth.top);
    this.hpText = addText(scene, LABEL_X + 13, 5, '', { color: CSS.white, bold: true }).setDepth(depth.top);
    this.levelText = addText(scene, LABEL_X, 19, '', { color: CSS.cyan }).setDepth(depth.top);
    this.clockText = addText(scene, RIGHT, 5, '', { color: CSS.white, bold: true, originX: 1 }).setDepth(depth.top);
    this.killText = addText(scene, RIGHT, 21, '', {
      size: FONT_SIZE.small,
      color: CSS.silver,
      originX: 1,
    }).setDepth(depth.top);
    this.bossText = addText(scene, GAME_WIDTH / 2, HUD_HEIGHT + 4, '', {
      color: CSS.red,
      bold: true,
      originX: 0.5,
      shadow: CSS.ink,
    }).setDepth(depth.field);

    const iconY = SLOT_Y + 11;
    for (let i = 0; i < MAX_WEAPONS; i += 1) {
      const x = WEAPON_SLOT.x + i * WEAPON_SLOT.step + WEAPON_SLOT.width / 2;
      this.weaponIcons.push(scene.add.image(x, iconY, LK.heart).setVisible(false).setDepth(depth.top));
    }
    for (let i = 0; i < PASSIVE_COUNT; i += 1) {
      const x = PASSIVE_SLOT.x + i * PASSIVE_SLOT.step + PASSIVE_SLOT.width / 2;
      this.passiveIcons.push(scene.add.image(x, iconY, LK.heart).setVisible(false).setDepth(depth.top));
    }
  }

  /** 맞았을 때 부른다. 체력 막대가 잠깐 밝아진다. */
  hurt(seconds: number): void {
    this.hurtUntil = seconds + HURT_FLASH;
  }

  /**
   * 지금 상태를 그린다. seconds는 깜박임에 쓰는 흐른 시간이다.
   * choosing이면 선택 화면의 머리글과 겹치는 보스 체력을 잠깐 감춘다.
   */
  draw(sim: Sim, seconds: number, choosing = false): void {
    const s = sim.state;
    const p = s.player;
    const ratio = Phaser.Math.Clamp(p.hp / sim.maxHp, 0, 1);
    const danger = ratio <= HP_DANGER;
    const color = hpColor(ratio);

    const g = this.bars;
    g.clear();
    this.bar(g, HP_BAR.y, HP_BAR.height, ratio, color, seconds < this.hurtUntil ? COLOR.white : COLOR.slate);
    this.bar(g, XP_BAR.y, XP_BAR.height, p.xp / xpToNext(p.level), COLOR.sky, COLOR.slate);

    // 위험할 때는 하트가 깜박인다.
    this.heart.setAlpha(danger && Math.floor(seconds * 4) % 2 === 0 ? 0.3 : 1);
    const hp = Math.max(0, Math.ceil(p.hp));
    if (hp !== this.shownHp || danger !== this.shownDanger) {
      this.shownHp = hp;
      this.shownDanger = danger;
      this.hpText.setText(String(hp)).setColor(danger ? CSS.orange : CSS.white);
    }
    if (p.level !== this.shownLevel) {
      this.shownLevel = p.level;
      this.levelText.setText(`Lv ${p.level}`);
    }
    const clock = formatClock(Math.min(s.t, RUN_SECONDS));
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clockText.setText(clock).setColor(s.t >= RUN_SECONDS ? CSS.orange : CSS.white);
    }
    if (s.kills !== this.shownKills) {
      this.shownKills = s.kills;
      this.killText.setText(`처치 ${s.kills}`);
    }

    const build = buildSignature(sim);
    if (build !== this.shownBuild) {
      this.shownBuild = build;
      this.drawSlots(weaponSlots(s.weapons), passiveSlots(s.passives));
    }

    const f = this.field;
    f.clear();
    const miniX = Math.round(this.playerX - MINI.width / 2);
    const miniY = this.playerY + MINI.below;
    f.fillStyle(COLOR.ink, 0.85);
    f.fillRect(miniX - 1, miniY - 1, MINI.width + 2, MINI.height + 2);
    f.fillStyle(color, 1);
    f.fillRect(miniX, miniY, Math.round(MINI.width * ratio), MINI.height);

    const boss = choosing ? null : findBoss(sim);
    if (boss) {
      const y = HUD_HEIGHT + 20;
      const x = Math.round((GAME_WIDTH - BOSS_BAR_WIDTH) / 2);
      drawPanel(f, x, y, BOSS_BAR_WIDTH, 6, { fill: COLOR.ink, shadow: null, radius: 3 });
      f.fillStyle(COLOR.red, 1);
      f.fillRect(x + 1, y + 1, Math.round((BOSS_BAR_WIDTH - 2) * Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1)), 4);
      this.bossText.setText(ENEMIES[boss.kind].name);
    } else if (this.bossText.text !== '') {
      this.bossText.setText('');
    }
  }

  private bar(
    g: Phaser.GameObjects.Graphics,
    y: number,
    height: number,
    ratio: number,
    color: number,
    border: number,
  ): void {
    g.fillStyle(border, 1);
    g.fillRoundedRect(BAR_X, y, BAR_WIDTH, height, 3);
    g.fillStyle(COLOR.ink, 1);
    g.fillRoundedRect(BAR_X + 1, y + 1, BAR_WIDTH - 2, height - 2, 2);
    const filled = Math.round((BAR_WIDTH - 2) * Phaser.Math.Clamp(ratio, 0, 1));
    if (filled <= 0) return;
    g.fillStyle(color, 1);
    g.fillRoundedRect(BAR_X + 1, y + 1, filled, height - 2, Math.min(2, filled / 2));
  }

  private drawSlots(weapons: readonly Slot[], passives: readonly Slot[]): void {
    const g = this.slots;
    g.clear();
    for (let i = 0; i < MAX_WEAPONS; i += 1) {
      const x = WEAPON_SLOT.x + i * WEAPON_SLOT.step;
      const slot = weapons[i];
      const icon = this.weaponIcons[i];
      icon.setVisible(Boolean(slot));
      if (!slot) {
        // 빈 칸도 그려서 무기를 몇 개까지 들 수 있는지 보이게 한다.
        g.lineStyle(1, COLOR.slate, 0.7);
        g.strokeRoundedRect(x + 0.5, SLOT_Y + 0.5, WEAPON_SLOT.width - 1, SLOT_HEIGHT - 1, 5);
        continue;
      }
      drawPanel(g, x, SLOT_Y, WEAPON_SLOT.width, SLOT_HEIGHT, {
        fill: COLOR.navy,
        border: slot.evolved ? COLOR.yellow : undefined,
        shadow: null,
        radius: 5,
      });
      icon.setTexture(iconKey(slot.icon));
      this.pips(g, x + (WEAPON_SLOT.width - PIPS_WIDTH) / 2, slot, COLOR.yellow);
    }
    for (let i = 0; i < PASSIVE_COUNT; i += 1) {
      const slot = passives[i];
      const icon = this.passiveIcons[i];
      icon.setVisible(Boolean(slot));
      if (!slot) continue;
      const x = PASSIVE_SLOT.x + i * PASSIVE_SLOT.step;
      drawPanel(g, x, SLOT_Y, PASSIVE_SLOT.width, SLOT_HEIGHT, { fill: COLOR.charcoal, shadow: null, radius: 5 });
      icon.setTexture(iconKey(slot.icon));
      this.pips(g, x + (PASSIVE_SLOT.width - PIPS_WIDTH) / 2, slot, COLOR.cyan);
    }
  }

  /** 칸 아래쪽에 레벨만큼 점을 켠다. 진화한 무기는 점 대신 한 줄로 꽉 채운다. */
  private pips(g: Phaser.GameObjects.Graphics, x: number, slot: Slot, color: number): void {
    const y = SLOT_Y + SLOT_HEIGHT - 5;
    const left = Math.round(x);
    if (slot.evolved) {
      g.fillStyle(COLOR.yellow, 1);
      g.fillRect(left, y, PIPS_WIDTH, PIP.size);
      return;
    }
    for (let i = 0; i < MAX_LEVEL; i += 1) {
      g.fillStyle(i < slot.level ? color : COLOR.ink, 1);
      g.fillRect(left + i * PIP.step, y, PIP.size, PIP.size);
    }
  }
}

/** 든 것이 바뀌었는지 싸게 알아보는 값. 레벨이 하나라도 바뀌면 달라진다. */
function buildSignature(sim: Sim): number {
  const { weapons, passives } = sim.state;
  let value = 0;
  for (const id of WEAPON_ORDER) value = value * 8 + (weapons[id] ?? 0);
  for (const id of Object.keys(PASSIVES) as PassiveId[]) value = value * 8 + (passives[id] ?? 0);
  return value;
}

function findBoss(sim: Sim): Enemy | null {
  let found: Enemy | null = null;
  for (const enemy of sim.state.enemies) {
    if (ENEMIES[enemy.kind].boss && enemy.hp > 0) found = enemy;
  }
  return found;
}
