import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import type { BackAware } from '../../core/app-events';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { holdToasts } from '../../core/toast';
import { addBackdrop, addTapZone, addText, drawPanel, fadeIn, fadeToScene, PixelButton } from '../../core/ui';
import { floatText, showBanner } from '../../scenes/GameHud';
import { thisWeek } from '../registry';
import { COMPUTER_SIZE, computerTexture, registerCompanyTextures, SC, TASK_COLORS, taskTexture } from './art';
import {
  COMPANY_GAME_ID,
  COMPANY_SCENE,
  EQUIPMENT,
  INBOX_SLOTS,
  OFFICES,
  PROJECTS,
  STAFF,
  TASKS,
  type Effect,
  type EquipmentDef,
  type ProjectId,
  type StaffDef,
  type StaffId,
  type TaskKind,
} from './data';
import {
  advance,
  assign,
  availableProjects,
  bossFor,
  buyEquipment,
  candidatesFor,
  cheer,
  createCompany,
  equipmentBlock,
  equipmentCost,
  equipmentLevel,
  formatLeaves,
  formatRate,
  hasFreeDesk,
  hire,
  hireBlock,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  moveBlock,
  moveOffice,
  projectBonus,
  projectReputation,
  release,
  specialtyOf,
  startProject,
  versionOf,
  type CompanyState,
  type TaskDone,
} from './rules';
import { companyStore } from './store';

type Container = Phaser.GameObjects.Container;
type Graphics = Phaser.GameObjects.Graphics;

const W = GAME_WIDTH;
const MARGIN = 8;
const INNER = W - MARGIN * 2;

const STRIP = { top: 42, height: 40 } as const;
const ROOM_TOP = 88;
const BUTTON_HEIGHT = 32;
const INBOX_HEIGHT = 42;
const HINT_HEIGHT = 16;
const TILE_WIDTH = 68;
const TILE_GAP = 4;
/** 책상 한 칸의 높이는 화면 길이에 맞춰 이 사이에서 정한다. */
const TILE_HEIGHT = { min: 86, max: 104 } as const;
const CARD = { width: 23, height: 30, step: 27 } as const;

const DEPTH = { fx: 40, panel: 60, banner: 80 } as const;

/** 저장하는 간격(초). 무언가를 사거나 맡길 때는 바로 저장한다. */
const SAVE_EVERY = 10;
/** 한 프레임에 흘리는 가장 긴 시간(초). 화면이 가려졌다 돌아왔을 때 한꺼번에 흐르지 않게 한다. */
const MAX_STEP = 0.5;

/** 사무실마다 다른 벽과 바닥의 색 */
const ROOM_COLORS = [
  { wall: 0xfff0c9, floor: 0xf6dcb5 },
  { wall: 0xe3f2ff, floor: 0xcfe2f2 },
  { wall: 0xe9e3ff, floor: 0xd6ccf5 },
] as const;

const BUTTONS = {
  pink: { face: THEME.pink, lip: THEME.pinkDeep },
  green: { face: THEME.mint, lip: THEME.mintDeep },
  yellow: { face: THEME.butter, lip: THEME.butterDeep },
  neutral: { face: THEME.card, lip: THEME.shadow },
} as const;
type ButtonStyle = keyof typeof BUTTONS;

interface Button {
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
  setStyle(style: ButtonStyle): void;
}

type PanelKind = 'project' | 'gear' | 'staff' | 'office';
const PANELS: readonly { kind: PanelKind; label: string }[] = [
  { kind: 'project', label: '프로젝트' },
  { kind: 'gear', label: '장비' },
  { kind: 'staff', label: '직원' },
  { kind: 'office', label: '사무실' },
];

interface DeskView {
  index: number;
  x: number;
  y: number;
  height: number;
  frame: Graphics;
  body: Phaser.GameObjects.Image | null;
  bodyY: number;
  computer: Phaser.GameObjects.Image | null;
  bubble: Graphics;
  bubbleIcon: Phaser.GameObjects.Image;
  bar: Graphics;
  tag: Phaser.GameObjects.Text;
  pressed: boolean;
  /** 지금 그려 둔 모습. 달라졌을 때만 다시 그린다. */
  shown: string;
  level: number;
}

const staffDef = (id: StaffId): StaffDef => STAFF[id];

function staffTexture(id: StaffId, pose: 'idle' | 'cheer' = 'idle'): string {
  const def = staffDef(id);
  return def.look ? mascotTexture(def.look, pose) : (def.texture ?? mascotTexture('runner-sprout', pose));
}

function effectText(effect: Effect): string {
  const percent = Math.round(effect.amount * 100);
  if (effect.key === 'workSpeed') return `일 속도 +${percent}%`;
  if (effect.key === 'income') return `수익 +${percent}%`;
  return `출시 보너스 +${percent}%`;
}

/** 몇 번째 출시인지 적는다. 처음은 새 게임이고 그 뒤로는 업데이트다. */
function versionText(version: number): string {
  return version <= 1 ? '새 게임' : `업데이트 ${version - 1}`;
}

/**
 * 새싹 컴퍼니: 직원에게 업무를 나눠 주고 게임을 출시해서 회사를 키운다.
 * 판이 끝나지 않고 이어지며, 진행은 따로 저장된다(store.ts).
 */
export class SproutCompanyScene extends Phaser.Scene implements BackAware {
  private state!: CompanyState;
  private built = false;
  /** create가 불린 횟수. 저장을 읽는 사이에 화면이 다시 만들어졌는지 알아본다. */
  private opened = 0;

  private leavesText!: Phaser.GameObjects.Text;
  private rateText!: Phaser.GameObjects.Text;
  private reputationText!: Phaser.GameObjects.Text;
  private officeText!: Phaser.GameObjects.Text;
  private reputationBar!: Graphics;
  private hint!: Phaser.GameObjects.Text;
  private strip!: Container;
  private room!: Container;
  private inbox!: Container;
  private panel: Container | null = null;
  private panelKind: PanelKind | null = null;
  private panelSignature = '';
  private dots: Partial<Record<PanelKind, Phaser.GameObjects.Arc>> = {};
  private desks: DeskView[] = [];

  /** 일감함에서 고른 카드의 번호 */
  private selected = 0;
  private clock = 0;
  private slowTick = 0;
  private saveIn = SAVE_EVERY;
  private shownLeaves = -1;
  private shownRate = '';
  private shownReputation = -1;
  private stripSignature = '';
  private inboxSignature = '';
  private roomBottom = 0;
  private inboxTop = 0;

  constructor() {
    super(COMPANY_SCENE);
  }

  create(): void {
    this.built = false;
    this.panel = null;
    this.panelKind = null;
    this.desks = [];
    this.dots = {};
    this.selected = 0;
    this.clock = 0;
    this.slowTick = 0;
    this.saveIn = SAVE_EVERY;
    this.shownLeaves = -1;
    this.shownRate = '';
    this.shownReputation = -1;
    this.stripSignature = '';
    this.inboxSignature = '';

    registerCompanyTextures(this);
    addBackdrop(this);
    new PixelButton(this, {
      x: MARGIN,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-back',
      hitPadding: 6,
      onTap: () => this.onBackRequest(),
    });

    // 안내 문구는 화면 아래쪽의 버튼을 덮으므로 여기서는 띄우지 않는다.
    holdToasts(true);
    const onHidden = (): void => this.save();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      holdToasts(false);
      this.save();
      this.built = false;
    });
    fadeIn(this);

    const token = (this.opened += 1);
    void companyStore.load().then(() => {
      if (token !== this.opened || !this.sys.isActive()) return;
      this.open();
    });
  }

  onBackRequest(): void {
    if (this.panel) {
      this.closePanel();
      return;
    }
    this.save();
    fadeToScene(this, SCENE.hub);
  }

  override update(_time: number, delta: number): void {
    if (!this.built) return;
    const dt = Math.min(delta / 1000, MAX_STEP);
    this.clock += dt;
    for (const event of advance(this.state, dt)) this.onTaskDone(event);

    this.syncTop();
    for (const view of this.desks) this.syncDesk(view);

    this.slowTick -= dt;
    if (this.slowTick <= 0) {
      this.slowTick = 0.3;
      this.syncStrip();
      this.syncInbox();
      this.syncHint();
      this.syncDots();
      this.syncPanel();
    }
    this.saveIn -= dt;
    if (this.saveIn <= 0) this.save();
  }

  // ───────── 열기와 저장 ─────────

  private open(): void {
    let founded = false;
    if (!companyStore.data) {
      // 회사를 처음 세운다. 지금 꾸미기에서 고른 캐릭터가 사장이 된다.
      companyStore.set(createCompany(bossFor(store.data.cosmetics.equipped.runner)));
      founded = true;
    }
    if (!companyStore.data) return;
    this.state = companyStore.data;

    const height = this.scale.height;
    const buttonsTop = height - MARGIN - BUTTON_HEIGHT;
    this.inboxTop = buttonsTop - 6 - INBOX_HEIGHT;
    const hintTop = this.inboxTop - HINT_HEIGHT;
    this.roomBottom = hintTop - 3;

    this.buildTop();
    this.strip = this.add.container(0, 0);
    this.room = this.add.container(0, 0);
    this.hint = addText(this, W / 2, hintTop + HINT_HEIGHT / 2, '', {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    });
    drawPanel(this.add.graphics(), MARGIN, this.inboxTop, INNER, INBOX_HEIGHT - 3, { depth: 3, radius: 10 });
    this.inbox = this.add.container(0, 0);
    this.buildButtons(buttonsTop);
    this.buildRoom();

    this.built = true;
    this.update(0, 0);
    if (founded) {
      showBanner(this, (ROOM_TOP + this.roomBottom) / 2, '새싹 컴퍼니', THEME_CSS.good, 1600, DEPTH.banner);
    }
  }

  private save(): void {
    this.saveIn = SAVE_EVERY;
    if (this.built) companyStore.set(this.state);
  }

  // ───────── 위쪽: 잎사귀와 평판 ─────────

  private buildTop(): void {
    this.add.image(49, 16, SC.leaf).setDisplaySize(14, 14);
    this.leavesText = addText(this, 59, 6, '0', { size: 16, color: THEME_CSS.inkDeep });
    this.rateText = addText(this, 42, 26, '', { size: FONT_SIZE.small, color: THEME_CSS.sub });
    this.reputationText = addText(this, W - MARGIN, 6, '', { color: THEME_CSS.accent, originX: 1 });
    this.officeText = addText(this, W - MARGIN, 30, '', { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 1 });
    this.reputationBar = this.add.graphics();
  }

  private syncTop(): void {
    const state = this.state;
    const leaves = Math.floor(state.leaves);
    if (leaves !== this.shownLeaves) {
      this.shownLeaves = leaves;
      this.leavesText.setText(formatLeaves(leaves));
    }
    const rate = formatRate(incomePerSecond(state));
    if (rate !== this.shownRate) {
      this.shownRate = rate;
      this.rateText.setText(`초마다 +${rate}`);
    }
    if (state.reputation !== this.shownReputation) {
      this.shownReputation = state.reputation;
      const next = OFFICES[state.office + 1];
      this.reputationText.setText(next ? `평판 ${state.reputation}/${next.reputation}` : `평판 ${state.reputation}`);
      this.officeText.setText(OFFICES[state.office].name);
      // 다음 사무실까지 평판이 얼마나 찼는지
      const from = OFFICES[state.office].reputation;
      const share = next ? Phaser.Math.Clamp((state.reputation - from) / (next.reputation - from), 0, 1) : 1;
      const width = 70;
      const left = W - MARGIN - width;
      this.reputationBar
        .clear()
        .fillStyle(THEME.shadow, 1)
        .fillRoundedRect(left, 22, width, 5, 2.5)
        .fillStyle(THEME.gold, 1);
      if (share > 0) this.reputationBar.fillRoundedRect(left, 22, Math.max(5, width * share), 5, 2.5);
    }
  }

  // ───────── 지금 만드는 게임 ─────────

  private syncStrip(): void {
    const state = this.state;
    const project = state.project;
    const signature = project ? `${project.id}|${project.done}|${isReady(state)}` : 'none';
    if (signature === this.stripSignature) return;
    this.stripSignature = signature;

    const strip = this.strip;
    strip.removeAll(true);
    const { top, height } = STRIP;
    const frame = this.add.graphics();
    drawPanel(frame, MARGIN, top, INNER, height - 3, { depth: 3 });
    strip.add(frame);

    if (!project) {
      strip.add(
        addText(this, MARGIN + 12, top + (height - 3) / 2, '무엇을 만들까요?', { originY: 0.5, color: THEME_CSS.ink }),
      );
      this.button(strip, MARGIN + INNER - 92, top + 5, 86, 28, '게임 고르기', 'pink', () => this.openPanel('project'));
      return;
    }

    const def = PROJECTS[project.id];
    const ready = isReady(state);
    strip.add(this.add.image(MARGIN + 21, top + 18, def.icon).setDisplaySize(28, 28));
    const title = addText(this, MARGIN + 40, top + 4, def.title, { color: THEME_CSS.inkDeep });
    const version = versionOf(state, project.id) + 1;
    const tag = addText(this, title.x + title.width + 4, top + 6, versionText(version), {
      size: FONT_SIZE.small,
      color: version === 1 ? THEME_CSS.good : THEME_CSS.lilacDeep,
    });
    strip.add([title, tag]);

    const barLeft = MARGIN + 40;
    const barWidth = ready ? 78 : 108;
    const share = project.done / project.total;
    const bar = this.add.graphics();
    bar.fillStyle(THEME.dim, 1).fillRoundedRect(barLeft, top + 23, barWidth, 7, 3.5);
    if (share > 0) {
      bar.fillStyle(THEME.mintDeep, 1).fillRoundedRect(barLeft, top + 23, Math.max(7, barWidth * share), 7, 3.5);
    }
    strip.add(bar);

    if (ready) {
      this.button(strip, MARGIN + INNER - 82, top + 5, 76, 28, '출시하기', 'pink', () => this.releaseProject());
      return;
    }
    strip.add(
      addText(this, barLeft + barWidth + 5, top + 26, `${project.done}/${project.total}`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originY: 0.5,
      }),
    );
    // 출시하면 받는 것
    const right = MARGIN + INNER - 8;
    const bonus = addText(this, right, top + 5, `+${formatLeaves(projectBonus(state, project.id))}`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.good,
      originX: 1,
    });
    const reputation = addText(this, right, top + 20, `+${projectReputation(state, project.id)}`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.accent,
      originX: 1,
    });
    strip.add([
      bonus,
      reputation,
      this.add.image(bonus.x - bonus.width - 6, top + 11, SC.leaf).setDisplaySize(10, 10),
      this.add.image(reputation.x - reputation.width - 6, top + 26, 'icon-star').setDisplaySize(10, 10),
    ]);
  }

  private releaseProject(): void {
    const state = this.state;
    const result = release(state);
    if (!result) return;
    sfx.fanfare();
    vibrate([12, 50, 12]);
    const centerY = (ROOM_TOP + this.roomBottom) / 2;
    showBanner(this, centerY, result.version === 1 ? '출시!' : '업데이트!', THEME_CSS.accent, 1500, DEPTH.banner);
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    floatText(this, 70, 44, `+${formatLeaves(result.bonus)}`, THEME_CSS.good, bounds, DEPTH.fx);
    floatText(this, W - 40, 44, `평판 +${result.reputation}`, THEME_CSS.accent, bounds, DEPTH.fx);
    this.burst(W / 2, STRIP.top + STRIP.height / 2, 10, 46);

    // 허브에는 출시 한 번을 한 판으로 적는다. 카드에는 평판이 기록으로 남는다.
    store.recordPlay(COMPANY_GAME_ID, state.reputation, 1, null, thisWeek(store.data.weekly));
    this.selected = 0;
    this.save();
    this.refreshNow();
  }

  // ───────── 사무실과 책상 ─────────

  private buildRoom(): void {
    const state = this.state;
    const room = this.room;
    room.removeAll(true);
    this.desks = [];

    const roomHeight = this.roomBottom - ROOM_TOP;
    const colors = ROOM_COLORS[Math.min(state.office, ROOM_COLORS.length - 1)];
    const count = state.desks.length;
    const columns = count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const tileHeight = Phaser.Math.Clamp(
      Math.floor((roomHeight - 16 - TILE_GAP * (rows - 1)) / Math.max(2, rows)),
      TILE_HEIGHT.min,
      TILE_HEIGHT.max,
    );
    const blockHeight = rows * tileHeight + (rows - 1) * TILE_GAP;
    // 한 줄뿐이면 바닥 쪽에 붙여서 벽에 창문을 걸 자리를 낸다.
    const blockTop =
      rows === 1 ? this.roomBottom - 10 - blockHeight : ROOM_TOP + Math.round((roomHeight - blockHeight) / 2);
    const blockWidth = columns * TILE_WIDTH + (columns - 1) * TILE_GAP;
    const blockLeft = MARGIN + Math.round((INNER - blockWidth) / 2);

    const walls = this.add.graphics();
    drawPanel(walls, MARGIN, ROOM_TOP, INNER, roomHeight - 3, { fill: colors.wall, depth: 3 });
    const floorTop = blockTop + blockHeight - 30;
    walls
      .fillStyle(colors.floor, 1)
      .fillRoundedRect(MARGIN, floorTop, INNER, this.roomBottom - 3 - floorTop, { tl: 0, tr: 0, bl: 12, br: 12 });
    room.add(walls);

    const wallSpace = blockTop - ROOM_TOP;
    if (wallSpace >= 44) {
      room.add(this.add.image(MARGIN + 34, ROOM_TOP + 10 + 13, SC.window));
      room.add(
        addText(this, W / 2, ROOM_TOP + 14, OFFICES[state.office].name, {
          color: THEME_CSS.sub,
          originX: 0.5,
        }),
      );
    }
    const sideSpace = blockLeft - MARGIN;
    if (sideSpace >= 26) {
      const floorY = this.roomBottom - 12;
      room.add(this.add.image(MARGIN + INNER - sideSpace / 2, floorY, SC.plant).setOrigin(0.5, 1));
      if (equipmentLevel(state, 'coffee') > 0) {
        room.add(this.add.image(MARGIN + sideSpace / 2, floorY, SC.coffee).setOrigin(0.5, 1));
      }
    }

    for (let index = 0; index < count; index += 1) {
      const row = Math.floor(index / columns);
      const inRow = Math.min(columns, count - row * columns);
      const rowLeft = blockLeft + Math.round(((columns - inRow) * (TILE_WIDTH + TILE_GAP)) / 2);
      const x = rowLeft + (index % columns) * (TILE_WIDTH + TILE_GAP);
      const y = blockTop + row * (tileHeight + TILE_GAP);
      this.desks.push(this.buildDesk(index, x, y, tileHeight));
    }
  }

  private buildDesk(index: number, x: number, y: number, height: number): DeskView {
    const state = this.state;
    const room = this.room;
    const desk = state.desks[index];
    const frame = this.add.graphics();
    const bubble = this.add.graphics().setVisible(false);
    const bubbleIcon = this.add.image(x + 48, y + 13, taskTexture('plan')).setDisplaySize(13, 13).setVisible(false);
    const bar = this.add.graphics();
    const tag = addText(this, x + 21, y + 5, '2배', { size: FONT_SIZE.small, color: THEME_CSS.accent }).setVisible(false);
    const view: DeskView = {
      index,
      x,
      y,
      height,
      frame,
      body: null,
      bodyY: 0,
      computer: null,
      bubble,
      bubbleIcon,
      bar,
      tag,
      pressed: false,
      shown: '',
      level: -1,
    };
    room.add(frame);

    if (!desk.staff) {
      room.add(
        addText(this, x + TILE_WIDTH / 2, y + height / 2 - 8, '+', {
          size: FONT_SIZE.large,
          color: THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      room.add(
        addText(this, x + TILE_WIDTH / 2, y + height / 2 + 12, '채용', {
          size: FONT_SIZE.small,
          color: THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
    } else {
      const def = staffDef(desk.staff);
      const deskTop = y + height - 40;
      // 친구는 책상 뒤에 앉아서 윗몸만 보인다.
      const tall = def.look ? 38 : 28;
      view.bodyY = deskTop + (def.look ? 7 : 2);
      view.body = this.add
        .image(x + 22, view.bodyY, staffTexture(desk.staff))
        .setOrigin(0.5, 1)
        .setDisplaySize(def.look ? (tall * 62) / 66 : tall, tall);
      const table = this.add.graphics();
      table.fillStyle(0xe0b98a, 1).fillRect(x + 8, deskTop + 6, 4, 16).fillRect(x + 56, deskTop + 6, 4, 16);
      table.fillStyle(0xf0cfa5, 1).fillRoundedRect(x + 3, deskTop, 62, 8, 3);
      view.computer = this.add
        .image(x + 48, deskTop + 1, computerTexture(0))
        .setOrigin(0.5, 1)
        .setDisplaySize(COMPUTER_SIZE.width, COMPUTER_SIZE.height);
      room.add([view.body, table, view.computer, bubble, bubbleIcon, bar, tag]);

      // 무엇을 잘하는지 왼쪽 위에 달아 둔다. 사장은 별이다.
      const specialty = specialtyOf(state, desk.staff);
      const badge = this.add.graphics();
      badge.fillStyle(THEME.white, 1).fillCircle(x + 11, y + 11, 8);
      room.add(badge);
      room.add(
        this.add
          .image(x + 11, y + 11, specialty ? taskTexture(specialty) : 'icon-star')
          .setDisplaySize(11, 11),
      );
      const name = addText(this, x + TILE_WIDTH / 2, y + height - 9, def.name, {
        size: FONT_SIZE.small,
        color: THEME_CSS.ink,
        originX: 0.5,
        originY: 0.5,
      });
      name.setScale(Math.min(1, (TILE_WIDTH - 6) / name.width));
      room.add(name);
    }

    room.add(
      addTapZone(
        this,
        x,
        y,
        TILE_WIDTH,
        height,
        (pressed) => {
          view.pressed = pressed;
          if (!desk.staff) this.drawEmptyDesk(view);
        },
        () => this.tapDesk(index),
      ),
    );
    if (!desk.staff) this.drawEmptyDesk(view);
    return view;
  }

  private drawEmptyDesk(view: DeskView): void {
    view.frame
      .clear()
      .fillStyle(THEME.white, view.pressed ? 0.7 : 0.4)
      .fillRoundedRect(view.x, view.y, TILE_WIDTH, view.height, 10)
      .lineStyle(1.5, THEME.faint, 0.5)
      .strokeRoundedRect(view.x + 1, view.y + 1, TILE_WIDTH - 2, view.height - 2, 9);
  }

  private syncDesk(view: DeskView): void {
    const state = this.state;
    const desk = state.desks[view.index];
    if (!desk?.staff) return;
    const task = desk.task;
    const cheered = desk.cheer > 0;
    const card = state.inbox[this.selected];
    const calling = !task && card !== undefined;
    const match = calling && specialtyOf(state, desk.staff) === card.kind;
    const signature = `${task?.kind ?? ''}|${cheered}|${calling}|${match}|${view.pressed}`;

    if (signature !== view.shown) {
      view.shown = signature;
      const { x, y, height } = view;
      const frame = view.frame.clear();
      frame
        .fillStyle(view.pressed ? THEME.dim : THEME.white, task ? 0.55 : calling ? 0.95 : 0.4)
        .fillRoundedRect(x, y, TILE_WIDTH, height, 10);
      const border = cheered ? THEME.gold : match ? TASK_COLORS[card.kind].deep : calling ? THEME.pink : null;
      if (border !== null) frame.lineStyle(2, border, 1).strokeRoundedRect(x + 1, y + 1, TILE_WIDTH - 2, height - 2, 9);

      view.bubble.clear().setVisible(task !== null);
      view.bubbleIcon.setVisible(task !== null);
      if (task) {
        const colors = TASK_COLORS[task.kind];
        view.bubble
          .fillStyle(colors.deep, 1)
          .fillRoundedRect(x + 38, y + 5, 20, 19, 5)
          .fillStyle(colors.face, 1)
          .fillRoundedRect(x + 38, y + 3, 20, 19, 5);
        view.bubbleIcon.setTexture(taskTexture(task.kind)).setDisplaySize(13, 13);
      } else {
        view.bar.clear();
      }
      view.tag.setVisible(match);
      if (view.body && staffDef(desk.staff).look) view.body.setTexture(staffTexture(desk.staff, cheered ? 'cheer' : 'idle'));
    }

    const level = equipmentLevel(state, 'computer', view.index);
    if (level !== view.level && view.computer) {
      view.level = level;
      view.computer.setTexture(computerTexture(level)).setDisplaySize(COMPUTER_SIZE.width, COMPUTER_SIZE.height);
    }

    if (task) {
      const deskTop = view.y + view.height - 40;
      const share = Phaser.Math.Clamp(1 - task.left / task.total, 0, 1);
      view.bar
        .clear()
        .fillStyle(THEME.white, 0.9)
        .fillRoundedRect(view.x + 15, deskTop + 11, 38, 6, 3)
        .fillStyle(TASK_COLORS[task.kind].deep, 1);
      if (share > 0) view.bar.fillRoundedRect(view.x + 15, deskTop + 11, Math.max(6, 38 * share), 6, 3);
    }
    // 일하는 동안에는 몸이 살짝 들썩인다.
    if (view.body) {
      const bob = task ? Math.sin(this.clock * (cheered ? 18 : 9) + view.index * 1.7) * (cheered ? 1.5 : 0.8) : 0;
      view.body.y = view.bodyY + bob;
    }
  }

  private tapDesk(index: number): void {
    const state = this.state;
    const desk = state.desks[index];
    const view = this.desks[index];
    if (!desk || !view) return;
    if (!desk.staff) {
      sfx.click();
      this.openPanel('staff');
      return;
    }
    if (desk.task) {
      cheer(state, index);
      sfx.tick();
      vibrate(6);
      this.burst(view.x + 22, view.y + view.height - 62, 3, 18);
      return;
    }
    if (state.inbox.length > 0) {
      const card = Math.min(this.selected, state.inbox.length - 1);
      if (assign(state, card, index)) {
        sfx.flip();
        vibrate(8);
        this.selected = 0;
        this.save();
        this.refreshNow();
      }
      return;
    }
    if (!state.project) {
      sfx.click();
      this.openPanel('project');
      return;
    }
    sfx.deny();
  }

  private onTaskDone(event: TaskDone): void {
    const view = this.desks[event.desk];
    if (view) {
      const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
      floatText(this, view.x + TILE_WIDTH / 2, view.y + 22, `${TASKS[event.kind].name} 끝`, TASK_COLORS[event.kind].css, bounds, DEPTH.fx);
    }
    if (isReady(this.state)) sfx.gold();
    else sfx.pop();
    this.save();
    this.refreshNow();
  }

  /** 반짝이가 사방으로 튄다. */
  private burst(x: number, y: number, count: number, reach: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.8;
      const distance = reach * (0.6 + Math.random() * 0.4);
      const spark = this.add.image(x, y, SC.spark).setDepth(DEPTH.fx).setScale(0.6 + Math.random() * 0.5);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        duration: 420,
        ease: 'Quad.Out',
        onComplete: () => spark.destroy(),
      });
    }
  }

  // ───────── 일감함 ─────────

  private syncInbox(): void {
    const state = this.state;
    if (this.selected >= state.inbox.length) this.selected = 0;
    const signature = `${state.inbox.map((task) => task.kind).join(',')}|${this.selected}|${state.project?.id ?? ''}|${isReady(state)}`;
    if (signature === this.inboxSignature) return;
    this.inboxSignature = signature;

    const inbox = this.inbox;
    inbox.removeAll(true);
    const top = this.inboxTop;
    if (state.inbox.length === 0) {
      const message = !state.project
        ? '게임을 고르면 업무 카드가 여기 놓여요'
        : isReady(state)
          ? '업무를 모두 끝냈어요'
          : '카드를 모두 맡겼어요';
      inbox.add(
        addText(this, W / 2, top + (INBOX_HEIGHT - 2) / 2, message, {
          size: FONT_SIZE.small,
          color: THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      return;
    }

    const shown = Math.min(state.inbox.length, INBOX_SLOTS);
    const left = MARGIN + Math.round((INNER - ((shown - 1) * CARD.step + CARD.width)) / 2);
    for (let index = 0; index < shown; index += 1) {
      const kind: TaskKind = state.inbox[index].kind;
      const colors = TASK_COLORS[kind];
      const picked = index === this.selected;
      const x = left + index * CARD.step;
      const y = top + (picked ? 3 : 6);
      const face = this.add.graphics();
      const icon = this.add.image(x + CARD.width / 2, y + 13, taskTexture(kind)).setDisplaySize(15, 15);
      const draw = (pressed: boolean): void => {
        const offset = pressed ? 2 : 0;
        face.clear();
        if (picked) {
          face.fillStyle(THEME.inkDeep, 1).fillRoundedRect(x - 2, y - 2, CARD.width + 4, CARD.height + 4, 7);
        }
        face
          .fillStyle(colors.deep, 1)
          .fillRoundedRect(x, y + 3, CARD.width, CARD.height - 3, 5)
          .fillStyle(colors.face, 1)
          .fillRoundedRect(x, y + offset, CARD.width, CARD.height - 3, 5);
        icon.setY(y + 13 + offset);
      };
      draw(false);
      const zone = addTapZone(this, x - 2, top, CARD.step, INBOX_HEIGHT - 2, draw, () => {
        if (this.selected === index) return;
        this.selected = index;
        sfx.tick();
        this.refreshNow();
      });
      inbox.add([face, icon, zone]);
    }
  }

  // ───────── 안내 한 줄 ─────────

  private syncHint(): void {
    const state = this.state;
    let text: string;
    const idle = state.desks.some((desk) => desk.staff !== null && desk.task === null);
    if (isReady(state)) text = '다 만들었어요! 출시하기를 눌러요';
    else if (!state.project) text = state.releases === 0 ? '게임 고르기를 눌러 첫 게임을 만들어요' : '다음에 만들 게임을 골라요';
    else if (state.inbox.length > 0 && idle) {
      text = Math.floor(this.clock / 4) % 2 === 0 ? '쉬는 친구를 눌러 카드를 맡겨요' : '카드와 같은 그림을 단 친구는 두 배 빨라요';
    } else if (moveBlock(state) === null) text = '사무실 버튼에서 더 큰 곳으로 이사할 수 있어요';
    else text = '일하는 친구를 누르면 응원으로 빨라져요';
    if (this.hint.text !== text) this.hint.setText(text);
  }

  // ───────── 아래쪽 버튼 ─────────

  private buildButtons(top: number): void {
    const gap = 4;
    const width = (INNER - gap * (PANELS.length - 1)) / PANELS.length;
    const layer = this.add.container(0, 0);
    PANELS.forEach(({ kind, label }, index) => {
      const x = MARGIN + index * (width + gap);
      this.button(layer, x, top, width, BUTTON_HEIGHT, label, 'neutral', () => this.openPanel(kind));
      const dot = this.add.circle(x + width - 5, top + 4, 4, THEME.coral).setStrokeStyle(1.5, THEME.white).setVisible(false);
      layer.add(dot);
      this.dots[kind] = dot;
    });
  }

  /** 지금 할 수 있는 일이 있는 버튼에 점을 찍는다. */
  private syncDots(): void {
    const state = this.state;
    const canBuy =
      equipmentBlock(state, 'coffee') === null ||
      state.desks.some((_, index) => equipmentBlock(state, 'computer', index) === null);
    const canHire = hasFreeDesk(state) && hirePool(state).length > 0 && state.leaves >= hireCost(state);
    this.dots.project?.setVisible(!state.project);
    this.dots.gear?.setVisible(canBuy);
    this.dots.staff?.setVisible(canHire);
    this.dots.office?.setVisible(moveBlock(state) === null);
  }

  /** 누르면 들어가는 둥근 버튼을 parent 안에 만든다. */
  private button(
    parent: Container,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    style: ButtonStyle,
    onTap: () => void,
  ): Button {
    const graphics = this.add.graphics();
    const text = addText(this, 0, 0, label, { originX: 0.5, originY: 0.5, color: THEME_CSS.inkDeep });
    text.setScale(Math.min(1, (width - 6) / text.width));
    let enabled = true;
    let current = style;
    const face = height - 3;
    const radius = Math.min(11, face / 2);
    const draw = (pressed: boolean): void => {
      const colors = BUTTONS[current];
      const offset = pressed && enabled ? 2 : 0;
      graphics
        .clear()
        .fillStyle(colors.lip, 1)
        .fillRoundedRect(x, y + 3, width, face, radius)
        .fillStyle(colors.face, 1)
        .fillRoundedRect(x, y + offset, width, face, radius);
      text.setPosition(Math.round(x + width / 2), Math.round(y + offset + face / 2));
    };
    draw(false);
    const zone = addTapZone(this, x, y, width, height, draw, () => {
      if (!enabled) {
        sfx.deny();
        return;
      }
      sfx.click();
      vibrate(8);
      onTap();
    });
    parent.add([graphics, text, zone]);
    return {
      setLabel: (next) => {
        text.setText(next).setScale(1);
        text.setScale(Math.min(1, (width - 6) / text.width));
      },
      setEnabled: (next) => {
        enabled = next;
        graphics.setAlpha(next ? 1 : 0.45);
        text.setAlpha(next ? 1 : 0.45);
      },
      setStyle: (next) => {
        current = next;
        draw(false);
      },
    };
  }

  /** 상태가 바뀐 직후에 화면을 바로 맞춘다. */
  private refreshNow(): void {
    this.syncStrip();
    this.syncInbox();
    this.syncHint();
    this.syncDots();
    this.syncPanel();
  }

  // ───────── 겹쳐 뜨는 창 ─────────

  private openPanel(kind: PanelKind): void {
    this.closePanel();
    this.panelKind = kind;
    this.panelSignature = this.signatureOf(kind);
    const panel = this.add.container(0, 0).setDepth(DEPTH.panel);
    this.panel = panel;

    const height = this.scale.height;
    const scrim = this.add.rectangle(0, 0, W, height, THEME.inkDeep, 0.35).setOrigin(0, 0).setInteractive();
    scrim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.closePanel());
    panel.add(scrim);

    if (kind === 'project') this.buildProjectPanel(panel);
    else if (kind === 'gear') this.buildGearPanel(panel);
    else if (kind === 'staff') this.buildStaffPanel(panel);
    else this.buildOfficePanel(panel);
  }

  private closePanel(): void {
    this.panel?.destroy(true);
    this.panel = null;
    this.panelKind = null;
  }

  /** 창에 보이는 것이 달라졌으면 다시 그린다. */
  private syncPanel(): void {
    const kind = this.panelKind;
    if (!kind || !this.panel) return;
    if (this.signatureOf(kind) !== this.panelSignature) this.openPanel(kind);
  }

  private signatureOf(kind: PanelKind): string {
    const state = this.state;
    if (kind === 'project') {
      return `${state.project?.id ?? ''}|${state.office}|${availableProjects(state).map((id) => versionOf(state, id)).join(',')}`;
    }
    if (kind === 'gear') {
      const desks = state.desks.map((desk, index) =>
        desk.staff ? `${equipmentLevel(state, 'computer', index)}${equipmentBlock(state, 'computer', index) ?? ''}` : '',
      );
      return `${desks.join(',')}|${equipmentLevel(state, 'coffee')}${equipmentBlock(state, 'coffee') ?? ''}`;
    }
    if (kind === 'staff') {
      return `${state.desks.map((desk) => desk.staff ?? '').join(',')}|${state.leaves >= hireCost(state)}|${state.office}`;
    }
    return `${state.office}|${moveBlock(state) ?? ''}|${state.reputation}`;
  }

  /** 창의 바탕과 제목, 닫기 버튼을 만든다. 내용이 놓일 맨 위 y를 돌려준다. */
  private panelFrame(panel: Container, title: string, contentHeight: number): { left: number; top: number; width: number } {
    const width = W - 20;
    const left = 10;
    const fullHeight = Math.min(this.scale.height - 16, contentHeight + 44);
    const top = Math.max(8, Math.round((this.scale.height - fullHeight) / 2));
    const frame = this.add.graphics();
    drawPanel(frame, left, top, width, fullHeight - 3, { depth: 3, radius: 14 });
    // 창 안쪽을 눌렀을 때 뒤의 막이 눌려 닫히지 않게 한다.
    const blocker = this.add.zone(left, top, width, fullHeight).setOrigin(0, 0).setInteractive();
    panel.add([frame, blocker]);
    panel.add(addText(this, left + 14, top + 10, title, { size: 16, color: THEME_CSS.inkDeep }));
    this.button(panel, left + width - 54, top + 8, 44, 24, '닫기', 'neutral', () => this.closePanel());
    return { left, top: top + 40, width };
  }

  private rowLine(panel: Container, left: number, y: number, width: number): void {
    panel.add(this.add.graphics().fillStyle(THEME.dim, 1).fillRect(left + 10, y, width - 20, 1));
  }

  /** 값을 치르는 버튼. 잎사귀 그림과 값이 적힌다. */
  private costButton(panel: Container, x: number, y: number, cost: number, affordable: boolean, onTap: () => void): void {
    const button = this.button(panel, x, y, 56, 26, `  ${formatLeaves(cost)}`, affordable ? 'green' : 'neutral', onTap);
    panel.add(this.add.image(x + 11, y + 11.5, SC.leaf).setDisplaySize(10, 10).setAlpha(affordable ? 1 : 0.45));
    if (!affordable) button.setEnabled(false);
  }

  private buildProjectPanel(panel: Container): void {
    const state = this.state;
    // 큰 게임이 위에 오도록 뒤에서부터 적는다.
    const ids = [...availableProjects(state)].reverse();
    const rowHeight = Math.min(38, Math.floor((this.scale.height - 16 - 44 - 18) / ids.length));
    const { left, top, width } = this.panelFrame(panel, '프로젝트', ids.length * rowHeight + 18);
    ids.forEach((id: ProjectId, index) => {
      const def = PROJECTS[id];
      const y = top + index * rowHeight;
      if (index > 0) this.rowLine(panel, left, y, width);
      const middle = y + rowHeight / 2;
      panel.add(this.add.image(left + 24, middle, def.icon).setDisplaySize(24, 24));
      const title = addText(this, left + 42, middle - 14, def.title, { color: THEME_CSS.inkDeep });
      const version = versionOf(state, id) + 1;
      const tag = addText(this, title.x + title.width + 4, middle - 12, versionText(version), {
        size: FONT_SIZE.small,
        color: version === 1 ? THEME_CSS.good : THEME_CSS.lilacDeep,
      });
      const details = addText(
        this,
        left + 42,
        middle + 2,
        `카드 ${def.cards.length}장  평판 +${projectReputation(state, id)}  잎 +${formatLeaves(projectBonus(state, id))}`,
        { size: FONT_SIZE.small, color: THEME_CSS.sub },
      );
      details.setScale(Math.min(1, (width - 42 - 62) / details.width));
      panel.add([title, tag, details]);

      const making = state.project?.id === id;
      const button = this.button(panel, left + width - 58, middle - 13, 48, 26, making ? '만드는 중' : '만들기', 'pink', () => {
        if (!startProject(state, id)) return;
        this.selected = 0;
        this.closePanel();
        sfx.go();
        this.save();
        this.refreshNow();
      });
      if (state.project) button.setEnabled(false);
    });
    panel.add(
      addText(this, W / 2, top + ids.length * rowHeight + 3, state.project ? '지금 만드는 게임을 출시하면 다음 게임을 고를 수 있어요' : '이미 낸 게임을 다시 만들면 업데이트가 돼요', {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
      }).setScale(0.95),
    );
  }

  private buildGearPanel(panel: Container): void {
    const state = this.state;
    const seats = state.desks.map((desk, index) => ({ desk, index })).filter((seat) => seat.desk.staff !== null);
    const rowHeight = 36;
    const { left, top, width } = this.panelFrame(panel, '장비', (seats.length + 1) * rowHeight + 4);
    const computer: EquipmentDef = EQUIPMENT.computer;
    const coffee: EquipmentDef = EQUIPMENT.coffee;

    const row = (index: number, picture: Phaser.GameObjects.Image, title: string, detail: string, id: 'computer' | 'coffee', desk: number): void => {
      const y = top + index * rowHeight;
      if (index > 0) this.rowLine(panel, left, y, width);
      const middle = y + rowHeight / 2;
      panel.add(picture.setPosition(left + 24, middle));
      panel.add(addText(this, left + 42, middle - 14, title, { color: THEME_CSS.inkDeep }));
      const line = addText(this, left + 42, middle + 2, detail, { size: FONT_SIZE.small, color: THEME_CSS.sub });
      line.setScale(Math.min(1, (width - 42 - 70) / line.width));
      panel.add(line);
      const block = equipmentBlock(state, id, desk);
      if (block === 'locked' || block === 'max') {
        panel.add(
          addText(this, left + width - 38, middle, block === 'max' ? '최고' : '잠김', {
            size: FONT_SIZE.small,
            color: THEME_CSS.faint,
            originX: 0.5,
            originY: 0.5,
          }),
        );
        return;
      }
      const level = equipmentLevel(state, id, desk);
      this.costButton(panel, left + width - 66, middle - 13, equipmentCost(id, level), block === null, () => {
        if (!buyEquipment(state, id, desk)) return;
        sfx.coin();
        this.save();
        if (id === 'coffee' && level === 0) this.buildRoom();
        this.refreshNow();
      });
    };

    seats.forEach((seat, index) => {
      const staff = seat.desk.staff as StaffId;
      const level = equipmentLevel(state, 'computer', seat.index);
      const picture = this.add.image(0, 0, computerTexture(level)).setDisplaySize(COMPUTER_SIZE.width, COMPUTER_SIZE.height);
      const percent = Math.round(computer.effect.amount * level * 100);
      const step = Math.round(computer.effect.amount * 100);
      const detail = level > 0 ? `레벨 ${level}  일 속도 +${percent}%` : `아직 없어요. 사면 일 속도 +${step}%`;
      row(index, picture, `${staffDef(staff).name}의 컴퓨터`, detail, 'computer', seat.index);
    });
    const level = equipmentLevel(state, 'coffee');
    const locked = coffee.unlockOffice > state.office;
    row(
      seats.length,
      this.add.image(0, 0, SC.coffee),
      coffee.name,
      locked
        ? `${OFFICES[coffee.unlockOffice].name}부터 둘 수 있어요`
        : level > 0
          ? `레벨 ${level}  모두의 일 속도 +${Math.round(coffee.effect.amount * level * 100)}%`
          : `사면 모두의 일 속도 +${Math.round(coffee.effect.amount * 100)}%`,
      'coffee',
      -1,
    );
  }

  private buildStaffPanel(panel: Container): void {
    const state = this.state;
    const free = hasFreeDesk(state);
    const pool = hirePool(state);
    const candidates = free && pool.length > 0 ? candidatesFor(state) : [];
    const staffed = state.desks.filter((desk) => desk.staff !== null);
    const rowHeight = 40;
    const teamRows = Math.ceil(staffed.length / 2);
    const noticeHeight = candidates.length === 0 ? 30 : 0;
    const { left, top, width } = this.panelFrame(
      panel,
      '직원',
      noticeHeight + candidates.length * rowHeight + 22 + teamRows * 22 + 4,
    );

    let y = top;
    if (candidates.length === 0) {
      const message = pool.length === 0
        ? '모든 친구가 회사에 들어왔어요'
        : state.office + 1 < OFFICES.length
          ? '빈 자리가 없어요. 이사하면 더 뽑을 수 있어요'
          : '빈 자리가 없어요';
      panel.add(addText(this, W / 2, y + 8, message, { size: FONT_SIZE.small, color: THEME_CSS.accent, originX: 0.5 }));
      y += noticeHeight;
    }

    const cost = hireCost(state);
    candidates.forEach((id, index) => {
      const def = staffDef(id);
      if (index > 0) this.rowLine(panel, left, y, width);
      const middle = y + rowHeight / 2;
      panel.add(this.portrait(left + 24, middle, id, 28));
      panel.add(addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep }));
      panel.add(this.add.image(left + 48, middle + 8, taskTexture(def.specialty)).setDisplaySize(11, 11));
      const line = addText(this, left + 56, middle + 2, `${TASKS[def.specialty].name} 2배  ${effectText(def.trait)}`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
      });
      line.setScale(Math.min(1, (width - 56 - 70) / line.width));
      panel.add(line);
      this.costButton(panel, left + width - 66, middle - 13, cost, hireBlock(state, id) === null, () => {
        if (hire(state, id) < 0) return;
        sfx.gold();
        this.save();
        this.buildRoom();
        this.closePanel();
        showBanner(this, (ROOM_TOP + this.roomBottom) / 2, `${def.name} 입사!`, THEME_CSS.good, 1300, DEPTH.banner);
        this.refreshNow();
      });
      y += rowHeight;
    });

    this.rowLine(panel, left, y + 2, width);
    panel.add(addText(this, left + 14, y + 7, '우리 회사 친구들', { size: FONT_SIZE.small, color: THEME_CSS.faint }));
    y += 22;
    staffed.forEach((desk, index) => {
      const id = desk.staff as StaffId;
      const x = left + 12 + (index % 2) * ((width - 24) / 2);
      const middle = y + Math.floor(index / 2) * 22 + 10;
      const specialty = specialtyOf(state, id);
      panel.add(this.portrait(x + 9, middle, id, 18));
      const name = addText(this, x + 21, middle, staffDef(id).name, { size: FONT_SIZE.small, color: THEME_CSS.ink, originY: 0.5 });
      panel.add(name);
      panel.add(
        this.add.image(name.x + name.width + 8, middle, specialty ? taskTexture(specialty) : 'icon-star').setDisplaySize(10, 10),
      );
      if (!specialty) {
        panel.add(addText(this, name.x + name.width + 16, middle, '사장', { size: FONT_SIZE.small, color: THEME_CSS.accent, originY: 0.5 }));
      }
    });
  }

  private buildOfficePanel(panel: Container): void {
    const state = this.state;
    const rowHeight = 42;
    const { left, top, width } = this.panelFrame(panel, '사무실', OFFICES.length * rowHeight + 20);
    OFFICES.forEach((office, index) => {
      const y = top + index * rowHeight;
      if (index > 0) this.rowLine(panel, left, y, width);
      const middle = y + rowHeight / 2;
      const here = index === state.office;
      const next = index === state.office + 1;
      panel.add(addText(this, left + 14, middle - 15, office.name, { color: index > state.office + 1 ? THEME_CSS.faint : THEME_CSS.inkDeep }));
      let detail = `책상 ${office.desks}개`;
      if (next) detail = `책상 ${office.desks}개  평판 ${Math.min(state.reputation, office.reputation)}/${office.reputation}`;
      else if (index > state.office) detail = `책상 ${office.desks}개  평판 ${office.reputation}`;
      // 평판이 모자라서 못 가는 동안에는 그 줄을 눈에 띄게 적는다.
      const lacking = next && moveBlock(state) === 'reputation';
      panel.add(
        addText(this, left + 14, middle + 2, detail, { size: FONT_SIZE.small, color: lacking ? THEME_CSS.accent : THEME_CSS.sub }),
      );

      if (next) {
        this.costButton(panel, left + width - 66, middle - 13, office.cost, moveBlock(state) === null, () => {
          if (!moveOffice(state)) return;
          sfx.fanfare();
          vibrate([12, 50, 12]);
          this.save();
          this.shownReputation = -1;
          this.buildRoom();
          this.closePanel();
          showBanner(this, (ROOM_TOP + this.roomBottom) / 2, '이사했어요!', THEME_CSS.good, 1500, DEPTH.banner);
          this.refreshNow();
        });
        return;
      }
      const label = here ? '지금 여기' : index < state.office ? '지나온 곳' : '잠김';
      panel.add(
        addText(this, left + width - 38, middle, label, {
          size: FONT_SIZE.small,
          color: here ? THEME_CSS.good : THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
    });
    const note = state.office + 1 < OFFICES.length ? '평판은 게임을 출시하면 올라요' : '더 큰 사무실은 다음에 열려요';
    panel.add(
      addText(this, W / 2, top + OFFICES.length * rowHeight + 4, note, { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  /** 친구의 얼굴을 (x, y)를 가운데로 size 높이로 그린다. */
  private portrait(x: number, y: number, id: StaffId, size: number): Phaser.GameObjects.Image {
    const def = staffDef(id);
    const image = this.add.image(x, y, staffTexture(id));
    return def.look ? image.setDisplaySize((size * 62) / 66, size) : image.setDisplaySize(size * 0.8, size * 0.8);
  }
}
