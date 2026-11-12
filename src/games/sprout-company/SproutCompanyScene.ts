import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { paintArt } from '../../art/vector';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import type { BackAware } from '../../core/app-events';
import { dateKeyOf } from '../../core/daily';
import { vibrate } from '../../core/haptics';
import { setHome } from '../../core/home';
import { music } from '../../core/music';
import { sfx, tone } from '../../core/sfx';
import { store } from '../../core/store';
import { holdToasts } from '../../core/toast';
import { addBackdrop, addTapZone, addText, drawPanel, fadeIn, fadeToScene, PixelButton } from '../../core/ui';
import { syncScores } from '../../online/online';
import { MAX_SCORE } from '../../online/protocol';
import { floatText, showBanner } from '../../scenes/GameHud';
import { makeShareImage } from '../../share/card';
import { displayHost, shareFileName, shareNotice, shareTitle, shareUrl } from '../../share/link';
import { sendShare } from '../../share/send';
import { getGame, thisWeek } from '../registry';
import { COMPUTER_SIZE, computerTexture, registerCompanyTextures, SC, TASK_COLORS, taskTexture } from './art';
import {
  AWAY,
  BRANCH,
  BUDDY,
  COMPANY_GAME_ID,
  COMPANY_SCENE,
  DECOR,
  DECOR_ORDER,
  DECOR_SLOT_NAMES,
  DECOR_SLOTS,
  DEPARTMENT,
  DEPARTMENT_ORDER,
  DEPARTMENTS,
  EQUIPMENT,
  EQUIPMENT_ORDER,
  INBOX_SLOTS,
  LEAD,
  LEVEL_SPEED,
  OFFICES,
  PERK_ORDER,
  PERKS,
  PLAY_STARS,
  PROJECT_ORDER,
  PROJECTS,
  QUEUE,
  RUSH,
  SPECIALTY_BOOST,
  STAFF,
  TASKS,
  TIPS,
  TRAINING,
  type DecorDef,
  type DecorId,
  type DecorSlot,
  type DepartmentId,
  type Effect,
  type EquipmentDef,
  type EquipmentId,
  type PerkDef,
  type PerkId,
  type ProjectId,
  type StaffDef,
  type StaffId,
  type TaskKind,
} from './data';
import {
  acceptRush,
  advance,
  assign,
  availableProjects,
  awayRate,
  bossFor,
  breakOpen,
  buddyOf,
  buyDecor,
  buyEquipment,
  buyPerk,
  candidatesFor,
  cardsWaiting,
  catchUp,
  cheer,
  createCompany,
  decorBlock,
  decorOf,
  departmentBlock,
  departmentBoost,
  departmentCost,
  departmentLevel,
  departmentMembers,
  departmentSeats,
  departmentsMissing,
  dequeue,
  deskColumns,
  enqueue,
  equipmentBlock,
  equipmentCost,
  equipmentLevel,
  formatDuration,
  formatLeaves,
  formatRate,
  foundBlock,
  foundBranch,
  fruitFor,
  gameIncome,
  hasBuddy,
  hasFreeDesk,
  hire,
  hireBlock,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  joinBlock,
  joinDepartment,
  leadBlock,
  leadLevel,
  leaveDepartment,
  moveBlock,
  moveCoins,
  moveOffice,
  perkBlock,
  perkCost,
  perkLevel,
  projectBonus,
  projectReputation,
  promoteLead,
  queueBlock,
  release,
  seedLeaves,
  setStars,
  skill,
  specialtyOf,
  starsOf,
  startProject,
  swapDesks,
  totalReputation,
  train,
  trainBlock,
  trainCost,
  upgradeDepartment,
  useDecor,
  versionOf,
  type Away,
  type CompanyEvent,
  type CompanyState,
  type Release,
} from './rules';
import { claimGoal, GOAL_REWARD, goalText, hasGoalToClaim, isGoalDone, rollGoals, takeReleaseCoin } from './goals';
import { nextStarTarget, readStars } from './link';
import { OFFICE_SONG } from './music';
import { SOUNDS, type Note, type SoundId } from './sound';
import { companyStore } from './store';
import { markTip, nextTip } from './tips';

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
/** 책상 한 칸의 너비. 한 줄에 넷을 놓을 때는 좁은 것을 쓴다. */
const TILE_WIDTH = { wide: 68, narrow: 52 } as const;
const TILE_GAP = 4;
/** 책상 한 칸의 높이는 화면 길이와 줄 수에 맞춰 이 사이에서 정한다. named보다 낮으면 이름을 적지 않는다. */
const TILE_HEIGHT = { min: 58, max: 104, named: 80 } as const;
const CARD = { width: 23, height: 30, step: 27 } as const;

const DEPTH = { fx: 40, panel: 60, banner: 80 } as const;

/** 허브와 공유 카드에 적히는 이 게임의 이름 */
const COMPANY_TITLE = '새싹 컴퍼니';
/** 처음 안내가 떠 있는 시간(ms)과, 다음 안내까지 쉬는 시간(초) */
const TIP_MS = 4500;
const TIP_GAP = 8;

/** 저장하는 간격(초). 무언가를 사거나 맡길 때는 바로 저장한다. */
const SAVE_EVERY = 10;
/** 한 프레임에 흘리는 가장 긴 시간(초). 화면이 가려졌다 돌아왔을 때 한꺼번에 흐르지 않게 한다. */
const MAX_STEP = 0.5;

/** 사무실마다 다른 벽과 바닥의 색 */
const ROOM_COLORS = [
  { wall: 0xfff0c9, floor: 0xf6dcb5 },
  { wall: 0xe3f2ff, floor: 0xcfe2f2 },
  { wall: 0xe9e3ff, floor: 0xd6ccf5 },
  { wall: 0xe0f5ea, floor: 0xc6e8d6 },
  { wall: 0xffe6ec, floor: 0xf7cfd9 },
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

/** 아래쪽 버튼으로 여는 창 다섯과, 사무실 창에서 여는 부서 창, 위쪽의 수익을 눌러 여는 출시작 창, 돌아왔을 때 저절로 뜨는 알림 */
type PanelKind =
  | 'project'
  | 'gear'
  | 'staff'
  | 'seats'
  | 'office'
  | 'goals'
  | 'dept'
  | 'games'
  | 'branch'
  | 'found'
  | 'decor'
  | 'away';
const PANELS: readonly { kind: PanelKind; label: string }[] = [
  { kind: 'project', label: '게임' },
  { kind: 'gear', label: '장비' },
  { kind: 'staff', label: '직원' },
  { kind: 'office', label: '사무실' },
  { kind: 'goals', label: '목표' },
];

interface DeskView {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 책상 윗면의 y */
  deskTop: number;
  /** 말풍선 가운데의 x */
  bubbleX: number;
  /** 컴퓨터를 그리는 배율 */
  gearScale: number;
  /** 막대의 오른쪽을 줄이는 길이. 낮은 칸에서 하트를 달 자리를 낸다. */
  barTrim: number;
  frame: Graphics;
  body: Phaser.GameObjects.Image | null;
  bodyY: number;
  computer: Phaser.GameObjects.Image | null;
  bubble: Graphics;
  bubbleIcon: Phaser.GameObjects.Image;
  bar: Graphics;
  /** 기운을 보여 주는 가는 막대. 휴게실이 있는 사무실에서만 그린다. */
  energy: Graphics;
  /** 지금 그려 둔 기운 막대의 모습 */
  energyShown: string;
  /** 쉬는 중일 때 다는 그림 */
  nap: Phaser.GameObjects.Image;
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

const equipmentDef = (id: EquipmentId): EquipmentDef => EQUIPMENT[id];

/** 회사 장비의 그림. 컴퓨터는 레벨에 따라 달라서 여기 없다. */
const GEAR_TEXTURES: Partial<Record<EquipmentId, string>> = {
  coffee: SC.coffee,
  tray: SC.tray,
  internet: SC.internet,
  server: SC.server,
  plant: SC.plant,
  chair: SC.chair,
  printer: SC.printer,
  meeting: SC.meeting,
  sofa: SC.sofa,
  snack: SC.snack,
};

/**
 * 꾸미기의 무늬를 네모 안에 그린다. 바탕색은 이미 칠해져 있고, 여기서는 그 위의 무늬만 그린다.
 * 그리는 것은 모두 네모 안에 들어간다.
 */
function paintPattern(graphics: Graphics, def: DecorDef, x: number, y: number, width: number, height: number): void {
  if (def.pattern === 'plain' || width <= 0 || height <= 0) return;
  graphics.fillStyle(def.mark, 1);
  const right = x + width;
  const bottom = y + height;
  if (def.pattern === 'stripe') {
    for (let left = x + 4; left < right; left += 16) graphics.fillRect(left, y, Math.min(8, right - left), height);
  } else if (def.pattern === 'grid') {
    for (let left = x + 6; left + 2 <= right; left += 12) graphics.fillRect(left, y, 2, height);
    for (let top = y + 6; top + 2 <= bottom; top += 12) graphics.fillRect(x, top, width, 2);
  } else if (def.pattern === 'check') {
    const size = 10;
    for (let row = 0; y + row * size < bottom; row += 1) {
      for (let column = row % 2; x + column * size < right; column += 2) {
        const left = x + column * size;
        const top = y + row * size;
        graphics.fillRect(left, top, Math.min(size, right - left), Math.min(size, bottom - top));
      }
    }
  } else if (def.pattern === 'dot') {
    for (let row = 0; y + 7 + row * 12 + 3 <= bottom; row += 1) {
      for (let left = x + 7 + (row % 2) * 8; left + 3 <= right; left += 16) graphics.fillCircle(left, y + 7 + row * 12, 2.5);
    }
  } else if (def.pattern === 'cloud') {
    for (let row = 0; y + 12 + row * 30 + 7 <= bottom; row += 1) {
      for (let left = x + 20 + (row % 2) * 34; left + 16 <= right; left += 68) {
        const top = y + 12 + row * 30;
        graphics.fillCircle(left - 8, top + 2, 5).fillCircle(left, top - 1, 7).fillCircle(left + 8, top + 2, 5);
        graphics.fillRect(left - 8, top + 2, 16, 5);
      }
    }
  } else if (def.pattern === 'plank') {
    for (let row = 0; y + row * 9 < bottom; row += 1) {
      const top = y + row * 9;
      if (row > 0) graphics.fillRect(x, top, width, 1.5);
      // 널빤지의 이음매는 줄마다 엇갈린다.
      for (let left = x + 22 + (row % 2) * 24; left + 2 <= right; left += 48) graphics.fillRect(left, top, 1.5, Math.min(9, bottom - top));
    }
  } else {
    for (let row = 0; y + 4 + row * 9 + 4 <= bottom; row += 1) {
      for (let left = x + 8 + (row % 2) * 9; left + 4 <= right; left += 18) {
        const top = y + 4 + row * 9;
        graphics.fillTriangle(left - 3, top + 4, left - 1.5, top, left, top + 4).fillTriangle(left, top + 4, left + 1.5, top, left + 3, top + 4);
      }
    }
  }
}

/** 효과를 한 줄로 적는다. level만큼 쌓인 것을 적고, everyone이면 모두에게 걸리는 것이다. */
function effectText(effect: Effect, level = 1, everyone = false): string {
  const percent = Math.round(effect.amount * level * 100);
  if (effect.key === 'workSpeed') return `${everyone ? '모두의 ' : ''}일 속도 +${percent}%`;
  if (effect.key === 'income') return `수익 +${percent}%`;
  if (effect.key === 'ease') return `카드에 드는 일 -${percent}%`;
  if (effect.key === 'reputation') return `출시 평판 +${percent}%`;
  if (effect.key === 'away') return `닫아 둔 동안의 수익 +${percent}%`;
  if (effect.key === 'cheer') return `응원이 ${percent}% 더 오래가요`;
  if (effect.key === 'rest') return `쉬는 속도 +${percent}%`;
  if (effect.key === 'stamina') return `기운이 ${percent}% 더 오래가요`;
  return `출시 보너스 +${percent}%`;
}

/** 배수를 적는다: 2배, 2.6배 */
function timesText(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}배`;
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
  private rateChip!: Graphics;
  private rateStar!: Phaser.GameObjects.Image;
  private starsText!: Phaser.GameObjects.Text;
  private ratePressed = false;
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
  /** 닫아 둔 동안 있었던 일과 그동안의 출시로 받은 코인. 돌아왔을 때의 알림이 읽는다. */
  private away: Away | null = null;
  private awayCoins = 0;
  /** 부서 창에 띄운 부서 */
  private deptShown: DepartmentId = DEPARTMENT_ORDER[0];
  /** 자리 바꾸기 창에서 먼저 고른 책상. 고르지 않았으면 -1 */
  private seatPicked = -1;
  /** 꾸미기 창에서 보고 있는 곳 */
  private decorShown: DecorSlot = 'wall';
  private signPlate!: Graphics;
  private shownSign = '';
  private dots: Partial<Record<PanelKind, Phaser.GameObjects.Arc>> = {};
  /** 창마다 보고 있는 쪽 */
  private pages: Partial<Record<PanelKind, number>> = {};
  private offerChip!: Container;
  private offerBar: Graphics | null = null;
  private offerSignature = '';
  private hintColor = '';
  /** 떠 있는 처음 안내와, 다음 안내를 살피기까지 남은 시간(초) */
  private tipView: Container | null = null;
  private tipIn = 3;
  /** 미리 만들어 둔 공유 카드와, 그것을 만든 때의 회사 모습 */
  private shareImage: File | null = null;
  private shareKey = '';
  private sharing = false;
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
    this.seatPicked = -1;
    this.clock = 0;
    this.slowTick = 0;
    this.saveIn = SAVE_EVERY;
    this.shownLeaves = -1;
    this.shownRate = '';
    this.shownReputation = -1;
    this.stripSignature = '';
    this.inboxSignature = '';
    this.pages = {};
    this.offerBar = null;
    this.offerSignature = '';
    this.hintColor = '';
    this.tipView = null;
    this.tipIn = 3;
    this.shareKey = '';
    this.shareImage = null;
    this.sharing = false;

    registerCompanyTextures(this);
    // 여기서 하러 보낸 게임에서 돌아왔다. 이제부터 나가는 길은 다시 허브다.
    setHome(null);
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
    // 화면이 가려지면 그때를 적어 두고, 다시 보이면 그동안의 몫을 한꺼번에 셈한다.
    const onHidden = (): void => this.save();
    const onVisible = (): void => this.welcomeBack();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.game.events.on(Phaser.Core.Events.VISIBLE, onVisible);
    // 멈추거나 떠나면 음악도 잦아든다.
    music.hush(false);
    const rest = (): void => music.rest();
    this.events.on(Phaser.Scenes.Events.PAUSE, rest);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, rest);
      rest();
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.game.events.off(Phaser.Core.Events.VISIBLE, onVisible);
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
      this.dismissPanel();
      return;
    }
    this.save();
    fadeToScene(this, SCENE.hub);
  }

  override update(_time: number, delta: number): void {
    if (!this.built) return;
    const dt = Math.min(delta / 1000, MAX_STEP);
    this.clock += dt;
    music.tick();
    for (const event of advance(this.state, dt)) this.onEvent(event);

    this.syncTop();
    for (const view of this.desks) this.syncDesk(view);

    this.slowTick -= dt;
    if (this.slowTick <= 0) {
      this.slowTick = 0.3;
      this.rollDay();
      this.syncTip(0.3);
      this.syncStrip();
      this.syncInbox();
      this.syncOffer();
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
    this.rollDay();
    const risen = this.syncStars();
    music.play(OFFICE_SONG);

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
    this.offerChip = this.add.container(0, 0);
    this.buildButtons(buttonsTop);
    this.buildRoom();

    this.built = true;
    this.update(0, 0);
    if (founded) {
      showBanner(this, (ROOM_TOP + this.roomBottom) / 2, '새싹 컴퍼니', THEME_CSS.good, 1600, DEPTH.banner);
    } else {
      this.welcomeBack();
    }
    this.announceStars(risen);
  }

  /** 허브에 적힌 게임마다의 최고 기록으로 출시작의 별을 맞춘다. 별이 는 게임의 id를 돌려준다. */
  private syncStars(): ProjectId[] {
    const risen = setStars(this.state, readStars((id) => store.data.games[id]?.best ?? 0));
    if (risen.length > 0) companyStore.set(this.state);
    return risen;
  }

  /** 새로 딴 별을 알린다. */
  private announceStars(risen: readonly ProjectId[]): void {
    if (risen.length === 0) return;
    const state = this.state;
    let text: string;
    if (risen.length === 1) {
      const id = risen[0];
      const stars = starsOf(state, id);
      text = `${PROJECTS[id].title} 별 ${stars}개! 수익 +${Math.round(PLAY_STARS.income * stars * 100)}%`;
    } else {
      const total = risen.reduce((sum, id) => sum + starsOf(state, id), 0);
      text = `게임을 직접 해서 딴 별이 ${total}개 있어요`;
    }
    this.play('reward');
    this.pill(text, 2600).setDepth(DEPTH.banner);
  }

  /** 닫아 둔 동안의 수익과 일을 셈하고, 알릴 것이 있으면 알린다. */
  private welcomeBack(): void {
    if (!this.built) return;
    const away = catchUp(this.state, (Date.now() - this.state.savedAt) / 1000);
    if (!away) return;
    // 예약해 둔 덕분에 그동안 저절로 된 출시도 허브에 적는다.
    let coins = 0;
    for (let index = 0; index < away.releases.length; index += 1) coins += this.recordRelease();
    if (away.releases.length > 0) void syncScores();
    this.selected = 0;
    this.save();
    this.refreshNow();
    if (away.leaves < 1 && away.tasks === 0 && away.releases.length === 0) return;
    this.away = away;
    this.awayCoins = coins;
    this.openPanel('away');
    this.play('reward');
  }

  /** 날이 바뀌었으면 오늘의 목표를 새로 정한다. */
  private rollDay(): void {
    const state = this.state;
    state.goals = rollGoals(state.goals, dateKeyOf(new Date()), state.office);
  }

  private save(): void {
    this.saveIn = SAVE_EVERY;
    if (this.built) companyStore.set(this.state);
  }

  // ───────── 위쪽: 잎사귀와 평판 ─────────

  private buildTop(): void {
    this.add.image(49, 16, SC.leaf).setDisplaySize(14, 14);
    this.leavesText = addText(this, 59, 6, '0', { size: 16, color: THEME_CSS.inkDeep });
    // 초당 수익은 누르면 출시작 창이 열리는 작은 단추다. 딴 별의 수를 옆에 적는다.
    this.rateChip = this.add.graphics();
    this.rateText = addText(this, 46, 26, '', { size: FONT_SIZE.small, color: THEME_CSS.sub });
    this.rateStar = this.add.image(0, 32, 'icon-star').setDisplaySize(9, 9);
    this.starsText = addText(this, 0, 26, '', { size: FONT_SIZE.small, color: THEME_CSS.accent });
    addTapZone(
      this,
      38,
      2,
      100,
      38,
      (pressed) => {
        this.ratePressed = pressed;
        this.shownRate = '';
      },
      () => {
        sfx.click();
        this.openPanel('games');
      },
    );
    this.reputationText = addText(this, W - MARGIN, 6, '', { color: THEME_CSS.accent, originX: 1 });
    this.signPlate = this.add.graphics();
    this.shownSign = '';
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
    const stars = PROJECT_ORDER.reduce((sum, id) => sum + starsOf(state, id), 0);
    const rate = `${formatRate(incomePerSecond(state))}|${stars}`;
    if (rate !== this.shownRate) {
      this.shownRate = rate;
      this.rateText.setText(`초마다 +${formatRate(incomePerSecond(state))}`);
      this.rateStar.setX(this.rateText.x + this.rateText.width + 9);
      this.starsText.setText(String(stars)).setX(this.rateStar.x + 7);
      const width = this.starsText.x + this.starsText.width + 7 - 40;
      this.rateChip
        .clear()
        .fillStyle(THEME.shadow, 1)
        .fillRoundedRect(40, 26, width, 15, 7.5)
        .fillStyle(this.ratePressed ? THEME.dim : THEME.white, 1)
        .fillRoundedRect(40, this.ratePressed ? 26 : 24.5, width, 15, 7.5);
    }
    if (state.reputation !== this.shownReputation) {
      this.shownReputation = state.reputation;
      const next = OFFICES[state.office + 1];
      // 다음 사무실까지 평판이 얼마나 찼는지. 가장 큰 사무실에서는 자회사를 세울 평판까지, 그 뒤로는 다음 열매까지를 보여 준다.
      let from = OFFICES[state.office].reputation;
      let goal = next ? next.reputation : BRANCH.reputation;
      let counting = true;
      if (!next && state.reputation >= BRANCH.reputation) {
        from = fruitFor(state.reputation) * BRANCH.perFruit;
        goal = from + BRANCH.perFruit;
        counting = false;
      }
      this.reputationText.setText(counting ? `평판 ${state.reputation}/${goal}` : `평판 ${state.reputation}`);
      const share = Phaser.Math.Clamp((state.reputation - from) / (goal - from), 0, 1);
      const width = 70;
      const left = W - MARGIN - width;
      this.reputationBar
        .clear()
        .fillStyle(THEME.shadow, 1)
        .fillRoundedRect(left, 22, width, 5, 2.5)
        .fillStyle(THEME.gold, 1);
      if (share > 0) this.reputationBar.fillRoundedRect(left, 22, Math.max(5, width * share), 5, 2.5);
    }
    const sign = `${state.office}|${state.decor.sign ?? ''}`;
    if (sign !== this.shownSign) {
      this.shownSign = sign;
      // 간판을 달았으면 사무실 이름 뒤에 판을 깐다.
      const plate = decorOf(state, 'sign');
      this.officeText
        .setText(OFFICES[state.office].name)
        .setColor(plate ? THEME_CSS.inkDeep : THEME_CSS.sub)
        .setX(W - MARGIN - (plate ? 6 : 0));
      this.signPlate.clear();
      if (plate) {
        const width = Math.ceil(this.officeText.width) + 12;
        const left = W - MARGIN - width;
        this.signPlate
          .fillStyle(plate.mark, 1)
          .fillRoundedRect(left, 29.5, width, 11.5, 5.5)
          .fillStyle(plate.color, 1)
          .fillRoundedRect(left, 28.5, width, 11.5, 5.5);
      }
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
    // 카드가 많은 게임은 숫자가 길어서 막대를 줄인다.
    const barWidth = ready ? 78 : project.total >= 10 ? 96 : 108;
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
    const result = release(this.state);
    if (result) this.celebrate(result);
  }

  /**
   * 출시 한 번을 허브에 적는다. 허브에는 한 판으로 세고, 카드에는 평판이 기록으로 남고, 랭킹에도 평판이 오른다.
   * 자회사가 된 회사들의 평판도 합쳐서 적으므로, 자회사를 세워도 기록은 줄지 않는다.
   * 코인은 하루 상한까지만 나온다. 받은 코인을 돌려준다.
   */
  private recordRelease(): number {
    const state = this.state;
    const coins = takeReleaseCoin(state.goals);
    store.recordPlay(COMPANY_GAME_ID, Math.min(totalReputation(state), MAX_SCORE), coins, null, thisWeek(store.data.weekly));
    return coins;
  }

  /** 출시를 알린다. 직접 누른 출시와 예약으로 저절로 된 출시가 함께 쓴다. */
  private celebrate(result: Release): void {
    this.play('release');
    vibrate([12, 50, 12]);
    const centerY = (ROOM_TOP + this.roomBottom) / 2;
    showBanner(this, centerY, result.version === 1 ? '출시!' : '업데이트!', THEME_CSS.accent, 1500, DEPTH.banner);
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    floatText(this, 70, 44, `+${formatLeaves(result.bonus)}`, THEME_CSS.good, bounds, DEPTH.fx);
    floatText(this, W - 40, 44, `평판 +${result.reputation}`, THEME_CSS.accent, bounds, DEPTH.fx);
    this.burst(W / 2, STRIP.top + STRIP.height / 2, 10, 46);

    const coins = this.recordRelease();
    if (coins > 0) floatText(this, W / 2, 60, `코인 +${coins}`, THEME_CSS.accent, bounds, DEPTH.fx);
    void syncScores();
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
    const wall = decorOf(state, 'wall');
    const floor = decorOf(state, 'floor');
    const count = state.desks.length;
    // 자리가 늘면 한 줄에 더 많이 놓고, 넷씩 놓을 때는 칸을 좁힌다.
    const columns = deskColumns(count);
    const tileWidth = columns === 4 ? TILE_WIDTH.narrow : TILE_WIDTH.wide;
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
    const blockWidth = columns * tileWidth + (columns - 1) * TILE_GAP;
    const blockLeft = MARGIN + Math.round((INNER - blockWidth) / 2);

    const walls = this.add.graphics();
    drawPanel(walls, MARGIN, ROOM_TOP, INNER, roomHeight - 3, { fill: wall?.color ?? colors.wall, depth: 3 });
    const floorTop = blockTop + blockHeight - 30;
    // 무늬는 둥근 모서리를 벗어나지 않게 조금 안쪽에만 그린다.
    if (wall) paintPattern(walls, wall, MARGIN + 6, ROOM_TOP + 6, INNER - 12, floorTop - ROOM_TOP - 6);
    walls
      .fillStyle(floor?.color ?? colors.floor, 1)
      .fillRoundedRect(MARGIN, floorTop, INNER, this.roomBottom - 3 - floorTop, { tl: 0, tr: 0, bl: 12, br: 12 });
    if (floor) paintPattern(walls, floor, MARGIN + 6, floorTop, INNER - 12, this.roomBottom - 3 - floorTop - 6);
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
      const rowLeft = blockLeft + Math.round(((columns - inRow) * (tileWidth + TILE_GAP)) / 2);
      const x = rowLeft + (index % columns) * (tileWidth + TILE_GAP);
      const y = blockTop + row * (tileHeight + TILE_GAP);
      this.desks.push(this.buildDesk(index, x, y, tileWidth, tileHeight));
    }
  }

  private buildDesk(index: number, x: number, y: number, width: number, height: number): DeskView {
    const state = this.state;
    const room = this.room;
    const desk = state.desks[index];
    // 칸이 낮으면 이름을 빼고, 좁으면 컴퓨터를 줄여서 넣는다.
    const compact = height < TILE_HEIGHT.named;
    const narrow = width < TILE_WIDTH.wide;
    const deskTop = y + height - (compact ? 25 : 40);
    const bubbleX = x + width - (narrow ? 13 : 20);
    const frame = this.add.graphics();
    const bubble = this.add.graphics().setVisible(false);
    const bubbleIcon = this.add.image(bubbleX, y + 13, taskTexture('plan')).setDisplaySize(13, 13).setVisible(false);
    const bar = this.add.graphics();
    const energy = this.add.graphics();
    const nap = this.add.image(bubbleX, y + 13, SC.nap).setVisible(false);
    const tag = addText(this, x + 21, y + 5, '2배', { size: FONT_SIZE.small, color: THEME_CSS.accent }).setVisible(false);
    const view: DeskView = {
      index,
      x,
      y,
      width,
      height,
      deskTop,
      bubbleX,
      gearScale: narrow ? 0.8 : 1,
      barTrim: compact && hasBuddy(state, index) ? 8 : 0,
      frame,
      body: null,
      bodyY: 0,
      computer: null,
      bubble,
      bubbleIcon,
      bar,
      energy,
      energyShown: '',
      nap,
      tag,
      pressed: false,
      shown: '',
      level: -1,
    };
    room.add(frame);

    if (!desk.staff) {
      room.add(
        addText(this, x + width / 2, y + height / 2 - 8, '+', {
          size: FONT_SIZE.large,
          color: THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      room.add(
        addText(this, x + width / 2, y + height / 2 + 12, '채용', {
          size: FONT_SIZE.small,
          color: THEME_CSS.faint,
          originX: 0.5,
          originY: 0.5,
        }),
      );
    } else {
      const def = staffDef(desk.staff);
      // 친구는 책상 뒤에 앉아서 윗몸만 보인다.
      const tall = def.look ? Math.min(38, height - 28) : Math.min(28, height - 34);
      view.bodyY = deskTop + (def.look ? 7 : 2);
      view.body = this.add
        .image(x + (narrow ? 16 : 22), view.bodyY, staffTexture(desk.staff))
        .setOrigin(0.5, 1)
        .setDisplaySize(def.look ? (tall * 62) / 66 : tall, tall);
      const table = this.add.graphics();
      const legs = compact ? 14 : 16;
      table.fillStyle(0xe0b98a, 1).fillRect(x + 8, deskTop + 6, 4, legs).fillRect(x + width - 12, deskTop + 6, 4, legs);
      table.fillStyle(0xf0cfa5, 1).fillRoundedRect(x + 3, deskTop, width - 6, 8, 3);
      view.computer = this.add
        .image(x + width - (narrow ? 14 : 20), deskTop + 1, computerTexture(0))
        .setOrigin(0.5, 1)
        .setDisplaySize(COMPUTER_SIZE.width * view.gearScale, COMPUTER_SIZE.height * view.gearScale);
      room.add([view.body, table, view.computer, bubble, bubbleIcon, bar, energy, nap, tag]);

      // 무엇을 잘하는지 왼쪽 위에 달아 둔다. 사장은 별이다.
      const specialty = specialtyOf(state, desk.staff);
      const badge = this.add.graphics();
      badge.fillStyle(THEME.white, 1).fillCircle(x + 11, y + 11, 8);
      // 부서에 든 친구는 그 부서의 색으로 테를 두른다.
      if (desk.dept) badge.lineStyle(2, TASK_COLORS[DEPARTMENTS[desk.dept].kind].deep, 1).strokeCircle(x + 11, y + 11, 8.5);
      room.add(badge);
      room.add(
        this.add
          .image(x + 11, y + 11, specialty ? taskTexture(specialty) : 'icon-star')
          .setDisplaySize(11, 11),
      );
      // 단짝과 옆자리에 앉은 친구는 하트를 단다.
      if (hasBuddy(state, index)) room.add(this.add.image(x + width - 8, y + height - 8, SC.heart));
      if (!compact) {
        // 팀장은 사장 옆자리(둘째 자리)에 앉은 친구가 맡는다.
        const label = index === 1 && state.lead > 0 ? `${def.name} 팀장` : def.name;
        const name = addText(this, x + width / 2, y + height - 9, label, {
          size: FONT_SIZE.small,
          color: THEME_CSS.ink,
          originX: 0.5,
          originY: 0.5,
        });
        name.setScale(Math.min(1, (width - 6) / name.width));
        room.add(name);
      }
    }

    room.add(
      addTapZone(
        this,
        x,
        y,
        width,
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
      .fillRoundedRect(view.x, view.y, view.width, view.height, 10)
      .lineStyle(1.5, THEME.faint, 0.5)
      .strokeRoundedRect(view.x + 1, view.y + 1, view.width - 2, view.height - 2, 9);
  }

  private syncDesk(view: DeskView): void {
    const state = this.state;
    const desk = state.desks[view.index];
    if (!desk?.staff) return;
    const task = desk.task;
    const cheered = desk.cheer > 0;
    const resting = desk.resting;
    const card = state.inbox[this.selected];
    const calling = !task && !resting && card !== undefined;
    // 고른 카드의 업무를 남보다 잘하는 친구(특기이거나 그 부서에 든 친구)는 얼마나 빠른지를 달아 둔다.
    const fit = calling ? skill(state, view.index, card.kind) : 1;
    const match = fit > 1;
    const rush = task?.rush === true;
    const signature = `${task?.kind ?? ''}|${rush}|${cheered}|${calling}|${fit}|${view.pressed}|${resting}`;

    if (signature !== view.shown) {
      view.shown = signature;
      const { x, y, width, height } = view;
      const frame = view.frame.clear();
      frame
        .fillStyle(view.pressed ? THEME.dim : THEME.white, task ? 0.55 : calling ? 0.95 : 0.4)
        .fillRoundedRect(x, y, width, height, 10);
      const border = cheered ? THEME.gold : match ? TASK_COLORS[card.kind].deep : calling ? THEME.pink : null;
      if (border !== null) frame.lineStyle(2, border, 1).strokeRoundedRect(x + 1, y + 1, width - 2, height - 2, 9);

      view.bubble.clear().setVisible(task !== null);
      view.bubbleIcon.setVisible(task !== null);
      if (task) {
        const colors = TASK_COLORS[task.kind];
        const left = view.bubbleX - 10;
        view.bubble
          .fillStyle(rush ? THEME.coral : colors.deep, 1)
          .fillRoundedRect(left, y + 5, 20, 19, 5)
          .fillStyle(colors.face, 1)
          .fillRoundedRect(left, y + 3, 20, 19, 5);
        // 급한 의뢰의 업무는 테두리가 붉다.
        if (rush) view.bubble.lineStyle(1.5, THEME.coral, 1).strokeRoundedRect(left, y + 3, 20, 19, 5);
        view.bubbleIcon.setTexture(taskTexture(task.kind)).setDisplaySize(13, 13);
      } else {
        view.bar.clear();
      }
      view.tag.setText(timesText(fit)).setVisible(match);
      if (view.body && staffDef(desk.staff).look) view.body.setTexture(staffTexture(desk.staff, cheered ? 'cheer' : 'idle'));
      // 쉬러 간 친구는 자리가 흐려지고 쉬는 그림이 뜬다.
      view.body?.setAlpha(resting ? 0.35 : 1);
      view.nap.setVisible(resting);
    }

    if (breakOpen(state)) {
      const inset = view.width < TILE_WIDTH.wide ? 9 : 15;
      const left = view.x + inset;
      const length = view.width - inset * 2 - view.barTrim;
      const filled = Math.round(length * Phaser.Math.Clamp(desk.energy, 0, 1));
      const shown = `${filled}|${resting}`;
      if (shown !== view.energyShown) {
        view.energyShown = shown;
        const top = view.deskTop + 19;
        view.energy.clear().fillStyle(THEME.white, 0.8).fillRoundedRect(left, top, length, 3, 1.5);
        // 남은 기운은 금빛, 쉬면서 채우는 기운은 풀빛이다.
        if (filled >= 3) view.energy.fillStyle(resting ? THEME.mintDeep : THEME.gold, 1).fillRoundedRect(left, top, filled, 3, 1.5);
      }
    }

    const level = equipmentLevel(state, 'computer', view.index);
    if (level !== view.level && view.computer) {
      view.level = level;
      view.computer
        .setTexture(computerTexture(level))
        .setDisplaySize(COMPUTER_SIZE.width * view.gearScale, COMPUTER_SIZE.height * view.gearScale);
    }

    if (task) {
      const inset = view.width < TILE_WIDTH.wide ? 9 : 15;
      const left = view.x + inset;
      const length = view.width - inset * 2 - view.barTrim;
      const share = Phaser.Math.Clamp(1 - task.left / task.total, 0, 1);
      view.bar
        .clear()
        .fillStyle(THEME.white, 0.9)
        .fillRoundedRect(left, view.deskTop + 11, length, 6, 3)
        .fillStyle(rush ? THEME.coral : TASK_COLORS[task.kind].deep, 1);
      if (share > 0) view.bar.fillRoundedRect(left, view.deskTop + 11, Math.max(6, length * share), 6, 3);
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
    if (desk.resting) {
      sfx.deny();
      this.pill('휴게실에서 쉬는 중이에요', 1200).setDepth(DEPTH.banner);
      return;
    }
    if (desk.task) {
      cheer(state, index);
      this.play('cheer');
      vibrate(6);
      this.burst(view.x + view.width / 3, view.deskTop - 22, 3, 18);
      return;
    }
    if (state.inbox.length > 0) {
      const card = Math.min(this.selected, state.inbox.length - 1);
      if (assign(state, card, index)) {
        this.play('assign');
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

  /** 시간이 흐르는 동안 일어난 일을 화면과 소리로 알린다. */
  private onEvent(event: CompanyEvent): void {
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    const centerY = (ROOM_TOP + this.roomBottom) / 2;
    if (event.type === 'release') {
      this.celebrate(event.release);
      return;
    }
    if (event.type === 'task') {
      const view = this.desks[event.desk];
      if (view) {
        const color = event.rush ? THEME_CSS.accent : TASK_COLORS[event.kind].css;
        floatText(this, view.x + view.width / 2, view.y + 22, `${TASKS[event.kind].name} 끝`, color, bounds, DEPTH.fx);
      }
      this.play(!event.rush && isReady(this.state) ? 'ready' : 'done');
    } else if (event.type === 'rushOffer') {
      this.play('rushIn');
      vibrate(10);
    } else if (event.type === 'rushWon') {
      this.play('rushWon');
      vibrate([12, 50, 12]);
      showBanner(this, centerY, '의뢰 성공!', THEME_CSS.good, 1300, DEPTH.banner);
      floatText(this, 70, 44, `+${formatLeaves(event.reward)}`, THEME_CSS.good, bounds, DEPTH.fx);
      this.burst(W / 2, centerY, 8, 40);
    } else {
      this.play('rushLost');
      showBanner(this, centerY, '의뢰를 놓쳤어요', THEME_CSS.sub, 1300, DEPTH.banner);
    }
    this.selected = Math.min(this.selected, Math.max(0, this.state.inbox.length - 1));
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
    // 카드가 많으면 보이는 만큼만 놓고, 나머지는 몇 장인지만 적는다.
    const shown = Math.min(state.inbox.length, INBOX_SLOTS);
    if (this.selected >= shown) this.selected = 0;
    const more = cardsWaiting(state) - shown;
    const cards = state.inbox.slice(0, shown).map((task) => `${task.kind}${task.rush ? '!' : ''}`);
    const signature = `${cards.join(',')}|${more}|${this.selected}|${state.project?.id ?? ''}|${isReady(state)}`;
    if (signature === this.inboxSignature) return;
    this.inboxSignature = signature;

    const inbox = this.inbox;
    inbox.removeAll(true);
    const top = this.inboxTop;
    if (shown === 0) {
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

    const reserve = more > 0 ? 22 : 0;
    const step = Math.min(CARD.step, Math.floor((INNER - 6 - reserve - CARD.width) / Math.max(1, shown - 1)));
    const left = MARGIN + Math.round((INNER - ((shown - 1) * step + CARD.width + reserve)) / 2);
    for (let index = 0; index < shown; index += 1) {
      const task = state.inbox[index];
      const kind: TaskKind = task.kind;
      const colors = TASK_COLORS[kind];
      const picked = index === this.selected;
      const x = left + index * step;
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
          .fillStyle(task.rush ? THEME.coral : colors.deep, 1)
          .fillRoundedRect(x, y + 3, CARD.width, CARD.height - 3, 5)
          .fillStyle(colors.face, 1)
          .fillRoundedRect(x, y + offset, CARD.width, CARD.height - 3, 5);
        // 급한 의뢰의 카드는 테두리가 붉다.
        if (task.rush) {
          face.lineStyle(2, THEME.coral, 1).strokeRoundedRect(x + 1, y + offset + 1, CARD.width - 2, CARD.height - 5, 4);
        }
        icon.setY(y + 13 + offset);
      };
      draw(false);
      const zone = addTapZone(this, x - (step - CARD.width) / 2, top, step, INBOX_HEIGHT - 2, draw, () => {
        if (this.selected === index) return;
        this.selected = index;
        sfx.tick();
        this.refreshNow();
      });
      inbox.add([face, icon, zone]);
    }
    if (more > 0) {
      inbox.add(
        addText(this, left + (shown - 1) * step + CARD.width + reserve / 2 + 2, top + (INBOX_HEIGHT - 2) / 2, `+${more}`, {
          color: THEME_CSS.sub,
          originX: 0.5,
          originY: 0.5,
        }),
      );
    }
  }

  // ───────── 급한 의뢰 ─────────

  /** 급한 의뢰가 들어오면 안내 줄 자리에 받을지 묻는 띠를 띄운다. 받지 않고 두면 지나간다. */
  private syncOffer(): void {
    const offer = this.state.offer;
    // 안내 줄을 덮고, 사무실 쪽으로는 바닥의 빈 곳만큼만 올라간다.
    const top = this.inboxTop - HINT_HEIGHT - 10;
    const signature = offer ? `${offer.kinds.join(',')}|${offer.reward}` : '';
    if (signature !== this.offerSignature) {
      this.offerSignature = signature;
      const chip = this.offerChip;
      chip.removeAll(true);
      this.offerBar = null;
      if (offer) {
        const height = 27;
        const frame = this.add.graphics();
        frame
          .fillStyle(THEME.white, 1)
          .fillRoundedRect(MARGIN, top, INNER, height, 10)
          .lineStyle(2, THEME.coral, 1)
          .strokeRoundedRect(MARGIN + 1, top + 1, INNER - 2, height - 2, 9);
        // 띠를 눌렀을 때 뒤의 책상이 눌리지 않게 한다.
        const blocker = this.add.zone(MARGIN, top, INNER, height).setOrigin(0, 0).setInteractive();
        const bar = this.add.graphics();
        const detail = addText(
          this,
          MARGIN + 30,
          top + 12,
          `카드 ${offer.kinds.length}장  ${RUSH.seconds}초 안에  잎 +${formatLeaves(offer.reward)}`,
          { size: FONT_SIZE.small, color: THEME_CSS.sub },
        );
        detail.setScale(Math.min(1, (INNER - 30 - 62) / detail.width));
        chip.add([
          frame,
          blocker,
          bar,
          this.add.image(MARGIN + 16, top + 13.5, SC.rush),
          addText(this, MARGIN + 30, top + 1, '급한 의뢰가 들어왔어요', { size: FONT_SIZE.small, color: THEME_CSS.accent }),
          detail,
        ]);
        this.offerBar = bar;
        this.button(chip, MARGIN + INNER - 56, top + 2, 50, 23, '받기', 'pink', () => this.takeRush());
      }
    }
    if (offer && this.offerBar) {
      // 받을 수 있는 시간이 줄어드는 것을 띠 아래의 줄로 보인다.
      const share = Phaser.Math.Clamp(offer.left / RUSH.offerSeconds, 0, 1);
      this.offerBar.clear().fillStyle(THEME.coral, 0.8);
      if (share > 0) this.offerBar.fillRoundedRect(MARGIN + 30, top + 23.5, Math.max(2, (INNER - 30 - 62) * share), 2, 1);
    }
  }

  private takeRush(): void {
    if (!acceptRush(this.state)) return;
    this.selected = 0;
    this.play('rushStart');
    this.save();
    this.refreshNow();
  }

  // ───────── 안내 한 줄 ─────────

  private syncHint(): void {
    const state = this.state;
    let text: string;
    const rush = state.rush;
    const idle = state.desks.some((desk) => desk.staff !== null && desk.task === null && !desk.resting);
    if (rush) text = `급한 의뢰 ${rush.done}/${rush.total}  남은 시간 ${Math.max(0, Math.ceil(rush.left))}초`;
    else if (isReady(state)) text = '다 만들었어요! 출시하기를 눌러요';
    else if (!state.project) text = state.releases === 0 ? '게임 고르기를 눌러 첫 게임을 만들어요' : '다음에 만들 게임을 골라요';
    else if (state.inbox.length > 0 && idle) {
      const first = state.lead > 0 ? '팀장이 곧 맡겨요. 직접 맡기면 더 빨라요' : '쉬는 친구를 눌러 카드를 맡겨요';
      text = Math.floor(this.clock / 4) % 2 === 0 ? first : '카드와 같은 그림을 단 친구는 두 배 빨라요';
    } else if (moveBlock(state) === null) text = '사무실 버튼에서 더 큰 곳으로 이사할 수 있어요';
    else if (state.queue.length > 0) text = `다 만들면 저절로 출시해요. 다음은 ${PROJECTS[state.queue[0]].title}`;
    else if (foundBlock(state) === null && Math.floor(this.clock / 4) % 2 === 1) {
      text = `자회사를 세우면 열매 ${fruitFor(state.reputation)}개를 받아요`;
    } else text = '일하는 친구를 누르면 응원으로 빨라져요';
    if (this.hint.text !== text) this.hint.setText(text);
    const color = rush ? THEME_CSS.accent : THEME_CSS.sub;
    if (this.hintColor !== color) {
      this.hintColor = color;
      this.hint.setColor(color);
    }
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
    const canBuy = EQUIPMENT_ORDER.some((id) =>
      equipmentDef(id).scope === 'company'
        ? equipmentBlock(state, id) === null
        : state.desks.some((_, index) => equipmentBlock(state, id, index) === null),
    );
    const canHire =
      (hasFreeDesk(state) && hirePool(state).length > 0 && state.leaves >= hireCost(state)) ||
      leadBlock(state) === null ||
      state.desks.some((_, index) => trainBlock(state, index) === null);
    this.dots.project?.setVisible(!state.project);
    this.dots.gear?.setVisible(canBuy);
    this.dots.staff?.setVisible(canHire);
    const canGrow = DEPARTMENT_ORDER.some((id) => departmentBlock(state, id) === null);
    const canPower = PERK_ORDER.some((id) => perkBlock(state, id) === null);
    this.dots.office?.setVisible(moveBlock(state) === null || canGrow || canPower);
    this.dots.goals?.setVisible(hasGoalToClaim(state.goals));
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
    this.syncOffer();
    this.syncHint();
    this.syncDots();
    this.syncPanel();
  }

  // ───────── 겹쳐 뜨는 창 ─────────

  private openPanel(kind: PanelKind): void {
    this.closePanel();
    this.panelKind = kind;
    const panel = this.add.container(0, 0).setDepth(DEPTH.panel);
    this.panel = panel;

    const height = this.scale.height;
    const scrim = this.add.rectangle(0, 0, W, height, THEME.inkDeep, 0.35).setOrigin(0, 0).setInteractive();
    scrim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.dismissPanel());
    panel.add(scrim);

    if (kind === 'project') this.buildProjectPanel(panel);
    else if (kind === 'gear') this.buildGearPanel(panel);
    else if (kind === 'staff') this.buildStaffPanel(panel);
    else if (kind === 'seats') this.buildSeatsPanel(panel);
    else if (kind === 'office') this.buildOfficePanel(panel);
    else if (kind === 'goals') this.buildGoalsPanel(panel);
    else if (kind === 'dept') this.buildDeptPanel(panel);
    else if (kind === 'games') this.buildGamesPanel(panel);
    else if (kind === 'branch') this.buildBranchPanel(panel);
    else if (kind === 'found') this.buildFoundPanel(panel);
    else if (kind === 'decor') this.buildDecorPanel(panel);
    else this.buildAwayPanel(panel);
    // 창을 만드는 동안 쪽 번호가 맞춰지므로, 다 만든 뒤의 모습을 적어 둔다.
    this.panelSignature = this.signatureOf(kind);
  }

  private closePanel(): void {
    this.panel?.destroy(true);
    this.panel = null;
    this.panelKind = null;
  }

  /** 닫기를 눌렀을 때. 부서 창과 자회사 창은 사무실 창에서 열었으니 그리로 돌아간다. */
  private dismissPanel(): void {
    if (this.panelKind === 'dept' || this.panelKind === 'branch' || this.panelKind === 'decor') this.openPanel('office');
    else if (this.panelKind === 'found') this.openPanel('branch');
    else if (this.panelKind === 'seats') this.openPanel('staff');
    else this.closePanel();
  }

  /** 창에 보이는 것이 달라졌으면 다시 그린다. */
  private syncPanel(): void {
    const kind = this.panelKind;
    if (!kind || !this.panel) return;
    if (this.signatureOf(kind) !== this.panelSignature) this.openPanel(kind);
  }

  private signatureOf(kind: PanelKind): string {
    const state = this.state;
    const page = this.pages[kind] ?? 0;
    if (kind === 'project') {
      const projects = availableProjects(state).map((id) => `${versionOf(state, id)}${departmentsMissing(state, id)}`);
      return `${page}|${state.project?.id ?? ''}|${state.office}|${projects.join(',')}|${state.queue.join(',')}`;
    }
    if (kind === 'gear') {
      const one = (id: EquipmentId, desk: number): string =>
        `${equipmentLevel(state, id, desk)}${equipmentBlock(state, id, desk) ?? ''}`;
      const gear = EQUIPMENT_ORDER.map((id) =>
        equipmentDef(id).scope === 'company' ? one(id, -1) : state.desks.map((_, index) => one(id, index)).join(','),
      );
      return `${page}|${state.office}|${gear.join('|')}`;
    }
    if (kind === 'staff') {
      const staff = state.desks.map((desk, index) => `${desk.staff ?? ''}${desk.level}${trainBlock(state, index) ?? ''}`).join(',');
      return `${page}|${staff}|${state.leaves >= hireCost(state)}|${state.office}|${state.lead}${leadBlock(state) ?? ''}`;
    }
    if (kind === 'seats') return `${state.desks.map((desk) => desk.staff ?? '').join(',')}|${this.seatPicked}`;
    if (kind === 'away') return 'away';
    if (kind === 'decor') {
      const decor = state.decor;
      return `${this.decorShown}|${decor.owned.join(',')}|${decor.wall}|${decor.floor}|${decor.sign}|${store.data.coins}|${state.office}`;
    }
    if (kind === 'games') {
      const games = PROJECT_ORDER.map((id) => `${versionOf(state, id)}${starsOf(state, id)}`).join(',');
      return `${page}|${games}|${formatRate(incomePerSecond(state))}`;
    }
    if (kind === 'dept') {
      const id = this.deptShown;
      const seats = state.desks.map((desk) => `${desk.staff ?? ''}${desk.dept ?? ''}`).join(',');
      return `${page}|${id}|${departmentLevel(state, id)}${departmentBlock(state, id) ?? ''}|${seats}`;
    }
    if (kind === 'goals') return `${state.goals.day}|${state.goals.progress.join(',')}|${state.goals.claimed.join(',')}`;
    const branch = `${state.branches}|${state.fruit}|${foundBlock(state) ?? ''}|${state.reputation}`;
    if (kind === 'found') return branch;
    if (kind === 'branch') return `${page}|${branch}|${PERK_ORDER.map((id) => `${perkLevel(state, id)}${perkBlock(state, id) ?? ''}`).join(',')}`;
    const departments = DEPARTMENT_ORDER.map(
      (id) => `${departmentLevel(state, id)}${departmentBlock(state, id) ?? ''}${departmentMembers(state, id).length}`,
    );
    return `${state.office}|${moveBlock(state) ?? ''}|${branch}|${departments.join(',')}|${this.canPower()}`;
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
    this.button(panel, left + width - 54, top + 8, 44, 24, '닫기', 'neutral', () => this.dismissPanel());
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

  /**
   * 줄이 많으면 쪽을 넘기는 목록 창을 만든다. 줄마다 draw를 부르고, 목록이 끝난 곳의 y를 돌려준다.
   * extra는 목록 아래에 더 쓸 높이다. header를 주면 목록 위에 그만큼의 자리를 내고 거기를 그리게 한다.
   */
  private listPanel<T>(
    panel: Container,
    kind: PanelKind,
    title: string,
    items: readonly T[],
    rowHeight: number,
    extra: number,
    draw: (item: T, middle: number, left: number, width: number) => void,
    header?: { height: number; draw: (top: number, left: number, width: number) => void },
  ): number {
    const navHeight = 30;
    const headHeight = header?.height ?? 0;
    const space = this.scale.height - 16 - 44 - extra - headHeight;
    const perPage =
      items.length * rowHeight <= space ? Math.max(1, items.length) : Math.max(1, Math.floor((space - navHeight) / rowHeight));
    const pageCount = Math.max(1, Math.ceil(items.length / perPage));
    const page = Phaser.Math.Clamp(this.pages[kind] ?? 0, 0, pageCount - 1);
    this.pages[kind] = page;
    const rows = items.slice(page * perPage, (page + 1) * perPage);
    // 쪽을 넘겨도 창의 크기가 바뀌지 않게, 마지막 쪽도 한 쪽만큼의 높이를 쓴다.
    const listHeight = (pageCount > 1 ? perPage : rows.length) * rowHeight;
    const frame = this.panelFrame(panel, title, headHeight + listHeight + (pageCount > 1 ? navHeight : 0) + extra);
    const { left, width } = frame;
    header?.draw(frame.top, left, width);
    const top = frame.top + headHeight;
    if (header) this.rowLine(panel, left, top, width);
    rows.forEach((item, index) => {
      const y = top + index * rowHeight;
      if (index > 0) this.rowLine(panel, left, y, width);
      draw(item, y + rowHeight / 2, left, width);
    });
    let bottom = top + listHeight;
    if (pageCount > 1) {
      this.rowLine(panel, left, bottom, width);
      const turn = (step: number) => (): void => {
        this.pages[kind] = page + step;
        this.openPanel(kind);
      };
      const previous = this.button(panel, left + 12, bottom + 4, 52, 24, '이전', 'neutral', turn(-1));
      const next = this.button(panel, left + width - 64, bottom + 4, 52, 24, '다음', 'neutral', turn(1));
      if (page === 0) previous.setEnabled(false);
      if (page === pageCount - 1) next.setEnabled(false);
      panel.add(
        addText(this, W / 2, bottom + 15, `${page + 1} / ${pageCount}`, {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      bottom += navHeight;
    }
    return bottom;
  }

  /** 줄의 오른쪽에 살 수 없는 까닭을 적는다. */
  private rowState(panel: Container, left: number, width: number, middle: number, label: string): void {
    panel.add(
      addText(this, left + width - 38, middle, label, {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
        originY: 0.5,
      }),
    );
  }

  /** 줄의 둘째 줄에 작은 글씨로 설명을 적는다. 길면 줄여서 넣는다. */
  private rowDetail(panel: Container, x: number, middle: number, right: number, text: string): void {
    const line = addText(this, x, middle + 2, text, { size: FONT_SIZE.small, color: THEME_CSS.sub });
    line.setScale(Math.min(1, (right - x) / line.width));
    panel.add(line);
  }

  private buildProjectPanel(panel: Container): void {
    const state = this.state;
    // 큰 게임이 위에 오도록 뒤에서부터 적는다.
    const ids = [...availableProjects(state)].reverse();
    // 예약 줄이 열린 사무실에서는, 만드는 게임이 있는 동안 다음 게임을 예약한다.
    const queueOpen = QUEUE.unlockOffice <= state.office;
    const bottom = this.listPanel(panel, 'project', '프로젝트', ids, 38, queueOpen ? 54 : 18, (id: ProjectId, middle, left, width) => {
      const def = PROJECTS[id];
      panel.add(this.add.image(left + 24, middle, def.icon).setDisplaySize(24, 24));
      const title = addText(this, left + 42, middle - 14, def.title, { color: THEME_CSS.inkDeep });
      const version = versionOf(state, id) + 1;
      const tag = addText(this, title.x + title.width + 4, middle - 12, versionText(version), {
        size: FONT_SIZE.small,
        color: version === 1 ? THEME_CSS.good : THEME_CSS.lilacDeep,
      });
      panel.add([title, tag]);
      const missing = departmentsMissing(state, id);
      if (missing > 0) {
        // 부서를 더 세워야 만들 수 있는 게임
        this.rowDetail(panel, left + 42, middle, left + width - 62, `부서를 ${missing}개 더 세우면 만들 수 있어요`);
        this.rowState(panel, left, width, middle, '잠김');
        return;
      }
      this.rowDetail(
        panel,
        left + 42,
        middle,
        left + width - 62,
        `카드 ${def.cards.length}장  평판 +${projectReputation(state, id)}  잎 +${formatLeaves(projectBonus(state, id))}`,
      );

      if (queueOpen && state.project) {
        const reserve = this.button(panel, left + width - 58, middle - 13, 48, 26, '예약', 'yellow', () => {
          if (!enqueue(state, id)) return;
          this.save();
          this.refreshNow();
        });
        if (queueBlock(state, id) !== null) reserve.setEnabled(false);
        return;
      }
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
    let noteTop = bottom + 3;
    let note = state.project ? '지금 만드는 게임을 출시하면 다음 게임을 고를 수 있어요' : '이미 낸 게임을 다시 만들면 업데이트가 돼요';
    if (queueOpen) {
      this.buildQueueRow(panel, bottom);
      noteTop += 36;
      if (state.project) note = '다 만들면 저절로 출시하고 예약한 게임을 만들어요';
    }
    const line = addText(this, W / 2, noteTop, note, { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 });
    panel.add(line.setScale(Math.min(0.95, (W - 36) / line.width)));
  }

  /** 예약 줄: 예약한 게임이 차례로 놓인다. 누르면 예약에서 뺀다. */
  private buildQueueRow(panel: Container, top: number): void {
    const state = this.state;
    const left = 10;
    const width = W - 20;
    const middle = top + 18;
    this.rowLine(panel, left, top, width);
    panel.add(addText(this, left + 14, middle, '예약', { color: THEME_CSS.inkDeep, originY: 0.5 }));
    for (let slot = 0; slot < QUEUE.slots; slot += 1) {
      const x = left + 62 + slot * 36;
      const id = state.queue[slot];
      const back = this.add.graphics();
      panel.add(back);
      if (!id) {
        back.lineStyle(1.5, THEME.faint, 0.6).strokeCircle(x, middle, 13);
        continue;
      }
      const icon = this.add.image(x, middle, PROJECTS[id].icon).setDisplaySize(22, 22);
      const cross = addText(this, x + 12, middle - 11, '×', { size: FONT_SIZE.small, color: THEME_CSS.white, originX: 0.5, originY: 0.5 });
      const draw = (pressed: boolean): void => {
        back
          .clear()
          .fillStyle(pressed ? THEME.dim : THEME.white, 1)
          .fillCircle(x, middle, 14)
          .lineStyle(1.5, THEME.butterDeep, 1)
          .strokeCircle(x, middle, 14)
          .fillStyle(THEME.coral, 1)
          .fillCircle(x + 12, middle - 11, 6);
      };
      draw(false);
      const zone = addTapZone(this, x - 17, top + 1, 34, 34, draw, () => {
        if (!dequeue(state, slot)) return;
        sfx.tick();
        this.save();
        this.refreshNow();
      });
      panel.add([icon, cross, zone]);
    }
    panel.add(
      addText(this, left + width - 14, middle, `${state.queue.length}/${QUEUE.slots}`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 1,
        originY: 0.5,
      }),
    );
  }

  private buildGearPanel(panel: Container): void {
    const state = this.state;
    // 지금 둘 수 있는 회사 장비, 자리마다의 장비, 다음 사무실에서 열리는 장비의 차례로 적는다.
    const company = EQUIPMENT_ORDER.filter((id) => equipmentDef(id).scope === 'company');
    const personal = EQUIPMENT_ORDER.filter((id) => equipmentDef(id).scope === 'desk');
    const rows: { id: EquipmentId; desk: number }[] = [];
    for (const id of company) if (equipmentDef(id).unlockOffice <= state.office) rows.push({ id, desk: -1 });
    state.desks.forEach((desk, index) => {
      if (desk.staff) for (const id of personal) rows.push({ id, desk: index });
    });
    for (const id of company) if (equipmentDef(id).unlockOffice === state.office + 1) rows.push({ id, desk: -1 });

    this.listPanel(panel, 'gear', '장비', rows, 36, 4, ({ id, desk }, middle, left, width) => {
      const def = equipmentDef(id);
      const level = equipmentLevel(state, id, desk);
      const staff = desk >= 0 ? state.desks[desk]?.staff : null;
      const texture = GEAR_TEXTURES[id];
      panel.add(
        texture
          ? this.add.image(left + 24, middle, texture)
          : this.add.image(left + 24, middle, computerTexture(level)).setDisplaySize(COMPUTER_SIZE.width, COMPUTER_SIZE.height),
      );
      panel.add(addText(this, left + 42, middle - 14, staff ? `${staffDef(staff).name}의 ${def.name}` : def.name, { color: THEME_CSS.inkDeep }));
      const everyone = def.scope === 'company';
      const block = equipmentBlock(state, id, desk);
      const detail =
        block === 'locked'
          ? `${OFFICES[def.unlockOffice].name}부터 둘 수 있어요`
          : level > 0
            ? `레벨 ${level}  ${effectText(def.effect, level, everyone)}`
            : `사면 ${effectText(def.effect, 1, everyone)}`;
      this.rowDetail(panel, left + 42, middle, left + width - 70, detail);
      if (block === 'locked' || block === 'max') {
        this.rowState(panel, left, width, middle, block === 'max' ? '최고' : '잠김');
        return;
      }
      this.costButton(panel, left + width - 66, middle - 13, equipmentCost(id, level), block === null, () => {
        if (!buyEquipment(state, id, desk)) return;
        this.play('upgrade');
        this.save();
        if (id === 'coffee' && level === 0) this.buildRoom();
        this.refreshNow();
      });
    });
  }

  private buildStaffPanel(panel: Container): void {
    const state = this.state;
    const free = hasFreeDesk(state);
    const pool = hirePool(state);
    const candidates = free && pool.length > 0 ? candidatesFor(state) : [];
    type Row = { kind: 'candidate'; id: StaffId } | { kind: 'lead' } | { kind: 'member'; desk: number };
    const rows: Row[] = candidates.map((id) => ({ kind: 'candidate', id }));
    rows.push({ kind: 'lead' });
    state.desks.forEach((desk, index) => {
      if (desk.staff) rows.push({ kind: 'member', desk: index });
    });
    const cost = hireCost(state);
    const step = Math.round(LEVEL_SPEED * 100);

    const inCompany = (id: StaffId | null): boolean => id !== null && state.desks.some((desk) => desk.staff === id);
    const bottom = this.listPanel(panel, 'staff', '직원', rows, 38, 50, (row, middle, left, width) => {
      const right = left + width - 70;
      if (row.kind === 'candidate') {
        const def = staffDef(row.id);
        panel.add(this.portrait(left + 24, middle, row.id, 28));
        panel.add(addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep }));
        panel.add(this.add.image(left + 48, middle + 8, taskTexture(def.specialty)).setDisplaySize(11, 11));
        // 단짝이 이미 회사에 있으면 알려 준다.
        const buddy = buddyOf(row.id);
        const pal = buddy && inCompany(buddy) ? `  단짝 ${staffDef(buddy).name}` : '';
        this.rowDetail(panel, left + 56, middle, right, `${TASKS[def.specialty].name} 2배  ${effectText(def.trait)}${pal}`);
        this.costButton(panel, left + width - 66, middle - 13, cost, hireBlock(state, row.id) === null, () => {
          if (hire(state, row.id) < 0) return;
          this.play('hire');
          this.save();
          this.buildRoom();
          this.closePanel();
          showBanner(this, (ROOM_TOP + this.roomBottom) / 2, `${def.name} 입사!`, THEME_CSS.good, 1300, DEPTH.banner);
          this.refreshNow();
        });
        return;
      }

      if (row.kind === 'lead') {
        // 팀장: 쉬는 친구에게 카드를 알아서 맡긴다. 사장 옆자리의 첫 직원이 맡는다.
        const block = leadBlock(state);
        const next = LEAD.levels[state.lead];
        const second = state.desks[1]?.staff;
        if (second) panel.add(this.portrait(left + 24, middle, second, 28));
        panel.add(
          addText(this, left + 42, middle - 15, state.lead > 0 ? `팀장 ${state.lead}단계` : '팀장', { color: THEME_CSS.inkDeep }),
        );
        const detail =
          block === 'locked'
            ? `${OFFICES[LEAD.unlockOffice].name}부터 둘 수 있어요`
            : (next?.description ?? leadLevel(state)?.description ?? '');
        this.rowDetail(panel, left + 42, middle, right, detail);
        if (block === 'locked' || block === 'max' || !next) {
          this.rowState(panel, left, width, middle, block === 'locked' ? '잠김' : '최고');
          return;
        }
        this.costButton(panel, left + width - 66, middle - 13, next.cost, block === null, () => {
          if (!promoteLead(state)) return;
          this.play('hire');
          this.save();
          this.buildRoom();
          this.refreshNow();
        });
        return;
      }

      // 우리 회사 친구: 교육으로 레벨을 올린다.
      const desk = state.desks[row.desk];
      const id = desk.staff as StaffId;
      const def = staffDef(id);
      const specialty = specialtyOf(state, id);
      panel.add(this.portrait(left + 24, middle, id, 28));
      const name = addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep });
      panel.add(name);
      panel.add(
        this.add.image(name.x + name.width + 9, middle - 8, specialty ? taskTexture(specialty) : 'icon-star').setDisplaySize(11, 11),
      );
      const paired = hasBuddy(state, row.desk);
      if (paired) panel.add(this.add.image(name.x + name.width + 21, middle - 8, SC.heart));
      const note = addText(this, name.x + name.width + (paired ? 29 : 18), middle - 13, specialty ? effectText(def.trait) : `사장  ${effectText(def.trait)}`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
      });
      note.setScale(Math.min(1, (right - note.x) / note.width));
      panel.add(note);
      const block = trainBlock(state, row.desk);
      const detail =
        block === 'locked'
          ? `${OFFICES[TRAINING.unlockOffice].name}부터 교육할 수 있어요`
          : desk.level > 0
            ? `레벨 ${desk.level}  일 속도 +${step * desk.level}%`
            : `교육하면 일 속도 +${step}%`;
      this.rowDetail(panel, left + 42, middle, right, detail);
      if (block === 'locked' || block === 'max') {
        this.rowState(panel, left, width, middle, block === 'locked' ? '잠김' : '최고');
        return;
      }
      this.costButton(panel, left + width - 66, middle - 13, trainCost(desk.level), block === null, () => {
        if (!train(state, row.desk)) return;
        this.play('upgrade');
        this.save();
        this.refreshNow();
      });
    });

    const message =
      candidates.length > 0
        ? '새 친구를 뽑거나, 교육으로 레벨을 올려요'
        : pool.length === 0
          ? '모든 친구가 회사에 들어왔어요'
          : state.office + 1 < OFFICES.length
            ? '빈 자리가 없어요. 이사하면 더 뽑을 수 있어요'
            : '빈 자리가 없어요';
    panel.add(
      addText(this, W / 2, bottom + 3, message, {
        size: FONT_SIZE.small,
        color: candidates.length > 0 ? THEME_CSS.faint : THEME_CSS.accent,
        originX: 0.5,
      }),
    );
    // 단짝끼리 옆자리에 앉히려면 자리를 바꾼다.
    const frameLeft = 10;
    const frameWidth = W - 20;
    this.rowLine(panel, frameLeft, bottom + 20, frameWidth);
    panel.add(this.add.image(frameLeft + 19, bottom + 37, SC.heart));
    panel.add(
      addText(this, frameLeft + 28, bottom + 37, `단짝과 옆자리면 일 속도 +${Math.round(BUDDY.speed * 100)}%`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originY: 0.5,
      }),
    );
    this.button(panel, frameLeft + frameWidth - 66, bottom + 25, 56, 24, '자리', 'yellow', () => {
      this.seatPicked = -1;
      this.openPanel('seats');
    });
  }

  /**
   * 자리 바꾸기 창: 사무실과 같은 차례로 책상을 늘어놓고, 둘을 차례로 누르면 자리를 맞바꾼다.
   * 단짝끼리 같은 줄의 바로 옆에 앉으면 둘 다 빨라진다.
   */
  private buildSeatsPanel(panel: Container): void {
    const state = this.state;
    const count = state.desks.length;
    const columns = deskColumns(count);
    const rows = Math.ceil(count / columns);
    const cellHeight = 46;
    const gap = 4;
    const { left, top, width } = this.panelFrame(panel, '자리 바꾸기', 18 + rows * (cellHeight + gap) + 36);
    const cellWidth = Math.min(62, Math.floor((width - 20 - gap * (columns - 1)) / columns));
    const gridWidth = columns * cellWidth + (columns - 1) * gap;
    const gridLeft = left + Math.round((width - gridWidth) / 2);
    const gridTop = top + 18;
    const picked = this.seatPicked >= 0 && this.seatPicked < count ? this.seatPicked : -1;
    const pickedStaff = picked >= 0 ? state.desks[picked].staff : null;
    const pickedBuddy = pickedStaff ? buddyOf(pickedStaff) : null;

    panel.add(
      addText(this, W / 2, top, picked < 0 ? '옮길 친구를 눌러요' : '바꿀 자리를 눌러요', {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 0.5,
      }),
    );
    state.desks.forEach((desk, index) => {
      const row = Math.floor(index / columns);
      const inRow = Math.min(columns, count - row * columns);
      const rowLeft = gridLeft + Math.round(((columns - inRow) * (cellWidth + gap)) / 2);
      const x = rowLeft + (index % columns) * (cellWidth + gap);
      const y = gridTop + row * (cellHeight + gap);
      const here = index === picked;
      // 고른 친구의 단짝이 앉은 자리는 눈에 띄게 한다.
      const pal = pickedBuddy !== null && desk.staff === pickedBuddy;
      const cell = this.add.graphics();
      const draw = (pressed: boolean): void => {
        cell
          .clear()
          .fillStyle(pressed ? THEME.dim : here ? THEME.pink : pal ? THEME.butter : THEME.card, 1)
          .fillRoundedRect(x, y, cellWidth, cellHeight, 8);
        if (here || pal) cell.lineStyle(2, here ? THEME.pinkDeep : THEME.butterDeep, 1).strokeRoundedRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2, 7);
      };
      draw(false);
      panel.add(cell);
      if (desk.staff) {
        panel.add(this.portrait(x + cellWidth / 2, y + 17, desk.staff, 26));
        const name = addText(this, x + cellWidth / 2, y + cellHeight - 8, staffDef(desk.staff).name, {
          size: FONT_SIZE.small,
          color: THEME_CSS.ink,
          originX: 0.5,
          originY: 0.5,
        });
        panel.add(name.setScale(Math.min(1, (cellWidth - 4) / name.width)));
        if (hasBuddy(state, index)) panel.add(this.add.image(x + cellWidth - 8, y + 8, SC.heart));
      } else {
        panel.add(
          addText(this, x + cellWidth / 2, y + cellHeight / 2, '빈 자리', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5, originY: 0.5 }),
        );
      }
      panel.add(
        addTapZone(this, x, y, cellWidth, cellHeight, draw, () => {
          if (picked < 0) {
            sfx.click();
            this.seatPicked = index;
          } else if (picked === index) {
            sfx.click();
            this.seatPicked = -1;
          } else if (swapDesks(state, picked, index)) {
            this.play('assign');
            vibrate(8);
            this.seatPicked = -1;
            this.save();
            this.buildRoom();
            this.refreshNow();
          } else {
            // 빈 자리끼리는 바꿀 것이 없으니, 새로 누른 자리를 고른 것으로 친다.
            sfx.click();
            this.seatPicked = index;
          }
          this.openPanel('seats');
        }),
      );
    });

    const below = gridTop + rows * (cellHeight + gap);
    let note = `단짝끼리 옆자리에 앉으면 둘 다 일 속도 +${Math.round(BUDDY.speed * 100)}%`;
    if (pickedStaff) {
      note = pickedBuddy ? `${staffDef(pickedStaff).name}의 단짝: ${staffDef(pickedBuddy).name}` : `${staffDef(pickedStaff).name}의 단짝은 아직 없어요`;
      if (pickedBuddy && !state.desks.some((desk) => desk.staff === pickedBuddy)) note += ' (아직 회사에 없어요)';
    }
    const line = addText(this, W / 2, below + 4, note, { size: FONT_SIZE.small, color: pickedStaff ? THEME_CSS.accent : THEME_CSS.sub, originX: 0.5 });
    panel.add(line.setScale(Math.min(1, (width - 24) / line.width)));
    panel.add(
      addText(this, W / 2, below + 19, '하던 일과 컴퓨터도 함께 옮겨 가요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  private buildOfficePanel(panel: Container): void {
    const state = this.state;
    const rowHeight = 42;
    // 부서가 열린 사무실에서는 지나온 사무실을 접고, 그 자리에 부서를 적는다.
    const deptOpen = DEPARTMENT.unlockOffice <= state.office;
    const first = deptOpen ? state.office : 0;
    const officeRows = OFFICES.length - first;
    // 가장 큰 사무실에 왔거나 자회사를 세운 적이 있으면 자회사 줄이 하나 더 붙는다.
    const branchOpen = state.office === OFFICES.length - 1 || state.branches > 0;
    const deptRows = deptOpen ? DEPARTMENT_ORDER.length : 0;
    const rowCount = officeRows + deptRows + (branchOpen ? 1 : 0);
    const { left, top, width } = this.panelFrame(panel, '사무실', rowCount * rowHeight + 20 + 34);
    OFFICES.forEach((office, index) => {
      if (index < first) return;
      const y = top + (index - first) * rowHeight;
      if (index > first) this.rowLine(panel, left, y, width);
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
          // 새 사무실에 처음 온 값으로 허브의 코인을 한 번 받는다. 자회사를 세운 뒤에 다시 지나갈 때는 받지 않는다.
          const coins = moveCoins(state);
          if (!moveOffice(state)) return;
          this.play('move');
          vibrate([12, 50, 12]);
          if (coins > 0) {
            store.update((save) => {
              save.coins += coins;
            });
          }
          this.save();
          this.shownReputation = -1;
          this.buildRoom();
          this.closePanel();
          const centerY = (ROOM_TOP + this.roomBottom) / 2;
          showBanner(this, centerY, '이사했어요!', THEME_CSS.good, 1500, DEPTH.banner);
          if (coins > 0) {
            const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
            floatText(this, W / 2, centerY + 26, `코인 +${coins}`, THEME_CSS.accent, bounds, DEPTH.banner);
          }
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
    if (deptOpen) {
      DEPARTMENT_ORDER.forEach((id, index) => {
        const y = top + (officeRows + index) * rowHeight;
        this.rowLine(panel, left, y, width);
        this.buildDeptRow(panel, id, y + rowHeight / 2, left, width);
      });
    }
    if (branchOpen) {
      const y = top + (officeRows + deptRows) * rowHeight;
      this.rowLine(panel, left, y, width);
      this.buildBranchRow(panel, y + rowHeight / 2, left, width);
    }
    const note = deptOpen
      ? '부서원은 그 부서의 일을 더 빨리 해요'
      : state.office + 1 < OFFICES.length
        ? '평판은 게임을 출시하면 올라요'
        : '가장 큰 사무실에 왔어요';
    const below = top + rowCount * rowHeight;
    panel.add(addText(this, W / 2, below + 4, note, { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }));

    // 회사의 모습이 적힌 카드를 친구에게 보낸다.
    this.rowLine(panel, left, below + 20, width);
    panel.add(addText(this, left + 14, below + 37, '꾸미고 자랑해요', { size: FONT_SIZE.small, color: THEME_CSS.sub, originY: 0.5 }));
    this.button(panel, left + width - 126, below + 25, 56, 24, '꾸미기', 'pink', () => this.openPanel('decor'));
    this.button(panel, left + width - 66, below + 25, 56, 24, '공유', 'yellow', () => this.share());
    this.prepareShare();
  }

  /**
   * 꾸미기 창: 허브의 코인으로 벽지와 바닥, 간판을 사서 회사의 모습을 바꾼다.
   * 한 번 산 것은 자회사를 세워도 남고, 언제든 기본 모습이나 다른 것으로 바꿔 쓸 수 있다.
   */
  private buildDecorPanel(panel: Container): void {
    const state = this.state;
    const slot = this.decorShown;
    const rows: (DecorId | null)[] = [null, ...DECOR_ORDER.filter((id) => (DECOR[id] as DecorDef).slot === slot)];
    const coins = store.data.coins;
    const base = ROOM_COLORS[Math.min(state.office, ROOM_COLORS.length - 1)];
    const header = {
      height: 36,
      draw: (top: number, left: number, width: number): void => {
        DECOR_SLOTS.forEach((id, index) => {
          this.button(panel, left + 12 + index * 48, top + 3, 44, 26, DECOR_SLOT_NAMES[id], id === slot ? 'yellow' : 'neutral', () => {
            this.decorShown = id;
            this.openPanel('decor');
          });
        });
        const count = addText(this, left + width - 12, top + 15, String(coins), { color: THEME_CSS.accent, originX: 1, originY: 0.5 });
        panel.add(count);
        panel.add(this.add.image(count.x - count.width - 9, top + 15, 'coin').setDisplaySize(12, 12));
      },
    };
    const bottom = this.listPanel(
      panel,
      'decor',
      '꾸미기',
      rows,
      36,
      20,
      (id, middle, left, width) => {
        const def: DecorDef | null = id ? DECOR[id] : null;
        const swatch = this.add.graphics();
        const x = left + 12;
        const y = middle - 12;
        if (slot === 'sign') {
          // 간판은 이름 뒤에 까는 판의 모습 그대로 보여 준다.
          if (def) swatch.fillStyle(def.mark, 1).fillRoundedRect(x, y + 6, 28, 13, 6).fillStyle(def.color, 1).fillRoundedRect(x, y + 5, 28, 12.5, 6);
          else swatch.lineStyle(1.5, THEME.faint, 0.6).strokeRoundedRect(x + 1, y + 6, 26, 12, 6);
        } else {
          swatch.fillStyle(THEME.shadow, 1).fillRoundedRect(x, y + 2, 28, 24, 5);
          swatch.fillStyle(def?.color ?? base[slot], 1).fillRoundedRect(x, y, 28, 24, 5);
          // 구름은 작은 칸에 들어가지 않아서 하나만 줄여서 그린다.
          if (def?.pattern === 'cloud') {
            swatch.fillStyle(def.mark, 1).fillCircle(x + 9, y + 14, 3.5).fillCircle(x + 14, y + 11, 5).fillCircle(x + 19, y + 14, 3.5);
            swatch.fillRect(x + 9, y + 13, 10, 4.5);
          } else if (def) paintPattern(swatch, def, x + 2, y + 2, 24, 20);
        }
        panel.add(swatch);
        panel.add(addText(this, left + 48, middle - 14, def?.name ?? '기본', { color: THEME_CSS.inkDeep }));
        const using = state.decor[slot] === id;
        const owned = id === null || state.decor.owned.includes(id);
        const detail = !def ? (slot === 'sign' ? '간판을 달지 않아요' : '사무실마다 다른 색이에요') : owned ? '사 둔 꾸미기예요' : `코인 ${def.cost}개`;
        this.rowDetail(panel, left + 48, middle, left + width - 70, detail);
        if (using) {
          this.rowState(panel, left, width, middle, '쓰는 중');
          return;
        }
        if (owned) {
          this.button(panel, left + width - 66, middle - 13, 56, 26, '쓰기', 'neutral', () => {
            if (!useDecor(state, slot, id)) return;
            this.afterDecor();
          });
          return;
        }
        const affordable = decorBlock(state, id, coins) === null;
        const buy = this.button(panel, left + width - 66, middle - 13, 56, 26, `  ${def?.cost ?? 0}`, affordable ? 'green' : 'neutral', () => {
          const paid = buyDecor(state, id, store.data.coins);
          if (paid <= 0) return;
          store.update((save) => {
            save.coins -= paid;
          });
          this.play('upgrade');
          this.afterDecor();
        });
        panel.add(this.add.image(left + width - 53, middle - 1.5, 'coin').setDisplaySize(11, 11).setAlpha(affordable ? 1 : 0.45));
        if (!affordable) buy.setEnabled(false);
      },
      header,
    );
    panel.add(
      addText(this, W / 2, bottom + 4, '코인은 미니게임과 오늘의 목표로 모아요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  /** 꾸미기를 바꾼 뒤에 방과 간판을 다시 그린다. */
  private afterDecor(): void {
    this.save();
    this.buildRoom();
    this.refreshNow();
  }

  /**
   * 출시작 창: 낸 게임마다 버는 수익과 딴 별을 보여 주고, 그 게임을 바로 하러 간다.
   * 직접 해서 최고 기록을 올리면 별을 따고, 별만큼 그 게임의 수익이 는다.
   */
  private buildGamesPanel(panel: Container): void {
    const state = this.state;
    // 큰 게임이 위에 오도록 뒤에서부터 적는다.
    const ids = [...PROJECT_ORDER].reverse().filter((id) => versionOf(state, id) > 0);
    const percent = Math.round(PLAY_STARS.income * 100);
    if (ids.length === 0) {
      const { top } = this.panelFrame(panel, '우리 게임', 56);
      panel.add(addText(this, W / 2, top + 6, '아직 낸 게임이 없어요', { color: THEME_CSS.sub, originX: 0.5 }));
      panel.add(
        addText(this, W / 2, top + 30, '게임을 내면 여기서 직접 해 볼 수 있어요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
      );
      return;
    }
    const bottom = this.listPanel(panel, 'games', '우리 게임', ids, 40, 34, (id: ProjectId, middle, left, width) => {
      const def = PROJECTS[id];
      const stars = starsOf(state, id);
      panel.add(this.add.image(left + 24, middle, def.icon).setDisplaySize(24, 24));
      const title = addText(this, left + 42, middle - 15, def.title, { color: THEME_CSS.inkDeep });
      panel.add(title);
      for (let star = 0; star < PLAY_STARS.count; star += 1) {
        panel.add(
          this.add
            .image(title.x + title.width + 9 + star * 11, middle - 8, 'icon-star')
            .setDisplaySize(10, 10)
            .setAlpha(star < stars ? 1 : 0.22),
        );
      }
      const best = store.data.games[id]?.best ?? 0;
      const next = nextStarTarget(id, best);
      const record = next === null ? `기록 ${best}` : `기록 ${best}/${next}`;
      this.rowDetail(panel, left + 42, middle + 1, left + width - 62, `초마다 +${formatRate(gameIncome(state, id))}  ${record}`);
      const game = getGame(id);
      if (!game?.sceneKey) return;
      const sceneKey = game.sceneKey;
      this.button(panel, left + width - 58, middle - 13, 48, 26, '하기', 'green', () => this.playGame(sceneKey));
    });
    panel.add(
      addText(this, W / 2, bottom + 4, `직접 해서 기록을 올리면 별을 따요`, { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 0.5 }),
    );
    panel.add(
      addText(this, W / 2, bottom + 18, `별 하나마다 그 게임의 수익 +${percent}%`, { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  /** 출시작을 직접 하러 간다. 그 게임이 끝나거나 그만두면 허브가 아니라 회사로 돌아온다. */
  private playGame(sceneKey: string): void {
    this.save();
    setHome({ scene: COMPANY_SCENE, label: '회사로 돌아가기' });
    fadeToScene(this, sceneKey);
  }

  /** 부서의 그림: 그 부서가 맡는 업무의 카드 그림을 그 색의 동그라미에 넣는다. */
  private deptIcon(panel: Container, x: number, y: number, id: DepartmentId, dim = false): void {
    const kind = DEPARTMENTS[id].kind;
    const colors = TASK_COLORS[kind];
    panel.add(this.add.graphics().fillStyle(colors.deep, 1).fillCircle(x, y + 1.5, 12).fillStyle(colors.face, 1).fillCircle(x, y, 12).setAlpha(dim ? 0.5 : 1));
    panel.add(this.add.image(x, y, taskTexture(kind)).setDisplaySize(14, 14).setAlpha(dim ? 0.5 : 1));
  }

  /** 사무실 창의 부서 한 줄. 아직 없는 부서는 여기서 세우고, 세운 부서는 눌러서 부서 창을 연다. */
  private buildDeptRow(panel: Container, id: DepartmentId, middle: number, left: number, width: number): void {
    const state = this.state;
    const def = DEPARTMENTS[id];
    const level = departmentLevel(state, id);
    const task = TASKS[def.kind].name;
    this.deptIcon(panel, left + 24, middle, id, level === 0);
    const name = addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep });
    panel.add(name);
    if (level > 0) {
      panel.add(addText(this, name.x + name.width + 4, middle - 13, `${level}단계`, { size: FONT_SIZE.small, color: THEME_CSS.lilacDeep }));
    }
    const percent = Math.round(departmentBoost(Math.max(1, level)) * 100);
    const detail =
      level > 0
        ? `부서원 ${departmentMembers(state, id).length}/${departmentSeats(level)}명  ${task} 일 +${percent}%`
        : `세우면 부서원의 ${task} 일 +${percent}%`;
    this.rowDetail(panel, left + 42, middle, left + width - 70, detail);
    if (level === 0) {
      this.costButton(panel, left + width - 66, middle - 13, departmentCost(0), departmentBlock(state, id) === null, () => {
        if (!upgradeDepartment(state, id)) return;
        this.play('hire');
        vibrate([12, 50, 12]);
        this.save();
        this.buildRoom();
        this.pill(`새 부서 ${def.name}`, 1600).setDepth(DEPTH.banner);
        this.refreshNow();
      });
      return;
    }
    // 단계를 올릴 수 있으면 버튼의 색으로 알린다.
    this.button(panel, left + width - 66, middle - 13, 56, 26, '꾸리기', departmentBlock(state, id) === null ? 'green' : 'neutral', () => {
      this.deptShown = id;
      this.pages.dept = 0;
      this.openPanel('dept');
    });
  }

  /** 부서 창: 단계를 올리고, 누구를 넣을지 정한다. */
  private buildDeptPanel(panel: Container): void {
    const state = this.state;
    const id = this.deptShown;
    const def = DEPARTMENTS[id];
    const kind = def.kind;
    const task = TASKS[kind].name;
    const level = departmentLevel(state, id);
    const seats = departmentSeats(level);
    const team = 1 + departmentBoost(level);
    /** 이 부서에 들었을 때 이 친구가 부서의 업무를 하는 배수 */
    const fitOf = (staff: StaffId): number => (specialtyOf(state, staff) === kind ? SPECIALTY_BOOST : 1) * team;
    const rows: number[] = [];
    state.desks.forEach((desk, index) => {
      if (desk.staff) rows.push(index);
    });
    // 부서원이 먼저, 그다음은 이 부서의 일을 잘할 친구부터 적는다.
    const rank = (index: number): number => {
      const desk = state.desks[index];
      return (desk.dept === id ? 100 : 0) + fitOf(desk.staff as StaffId);
    };
    rows.sort((a, b) => rank(b) - rank(a) || a - b);

    const header = {
      height: 44,
      draw: (top: number, left: number, width: number): void => {
        const count = departmentMembers(state, id).length;
        this.deptIcon(panel, left + 24, top + 18, id);
        const summary = addText(this, left + 42, top + 3, `부서원 ${count}/${seats}명  ${task} 일 +${Math.round((team - 1) * 100)}%`, {
          color: THEME_CSS.inkDeep,
        });
        panel.add(summary.setScale(Math.min(1, (width - 42 - 72) / summary.width)));
        const block = departmentBlock(state, id);
        if (block === 'max') {
          this.rowDetail(panel, left + 42, top + 18, left + width - 70, '가장 높은 단계예요');
          this.rowState(panel, left, width, top + 18, '최고');
          return;
        }
        const more = departmentSeats(level + 1) > seats ? `, 자리 ${departmentSeats(level + 1)}` : '';
        this.rowDetail(panel, left + 42, top + 18, left + width - 70, `다음 단계: +${Math.round(departmentBoost(level + 1) * 100)}%${more}`);
        this.costButton(panel, left + width - 66, top + 5, departmentCost(level), block === null, () => {
          if (!upgradeDepartment(state, id)) return;
          this.play('upgrade');
          this.save();
          this.buildRoom();
          this.refreshNow();
        });
      },
    };

    const bottom = this.listPanel(
      panel,
      'dept',
      `${def.name} ${level}단계`,
      rows,
      34,
      18,
      (index, middle, left, width) => {
        const desk = state.desks[index];
        const staff = desk.staff as StaffId;
        const specialty = specialtyOf(state, staff);
        const member = desk.dept === id;
        panel.add(this.portrait(left + 22, middle, staff, 24));
        const name = addText(this, left + 40, middle - 14, staffDef(staff).name, { color: THEME_CSS.inkDeep });
        panel.add(name);
        panel.add(
          this.add.image(name.x + name.width + 9, middle - 7, specialty ? taskTexture(specialty) : 'icon-star').setDisplaySize(11, 11),
        );
        const times = `${task} 일 ${timesText(fitOf(staff))}`;
        const detail = member ? `부서원  ${times}` : desk.dept ? `지금 ${DEPARTMENTS[desk.dept].name}  옮기면 ${times}` : `넣으면 ${times}`;
        this.rowDetail(panel, left + 40, middle - 1, left + width - 62, detail);
        const change = (done: boolean): void => {
          if (!done) return;
          sfx.tick();
          this.save();
          this.buildRoom();
          this.refreshNow();
        };
        if (member) {
          this.button(panel, left + width - 58, middle - 12, 48, 24, '빼기', 'neutral', () => change(leaveDepartment(state, index)));
          return;
        }
        if (joinBlock(state, index, id) !== null) {
          this.rowState(panel, left, width, middle, '자리 없음');
          return;
        }
        const label = desk.dept ? '옮기기' : '넣기';
        this.button(panel, left + width - 58, middle - 12, 48, 24, label, desk.dept ? 'yellow' : 'green', () => change(joinDepartment(state, index, id)));
      },
      header,
    );
    panel.add(
      addText(this, W / 2, bottom + 3, '한 사람은 한 부서에만 들 수 있어요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  // ───────── 자회사 ─────────

  /** 열매로 올릴 수 있는 본사의 힘이 있는가 */
  private canPower(): boolean {
    return PERK_ORDER.some((id) => perkBlock(this.state, id) === null);
  }

  /** 열매 그림과 수를 (x, y)를 왼쪽 가운데로 적는다. 적은 글을 돌려준다. */
  private fruitCount(panel: Container, x: number, y: number, text: string, color: string = THEME_CSS.inkDeep): Phaser.GameObjects.Text {
    panel.add(this.add.image(x + 6, y, SC.fruit).setDisplaySize(12, 12));
    const label = addText(this, x + 15, y, text, { color, originY: 0.5 });
    panel.add(label);
    return label;
  }

  /** 사무실 창의 자회사 한 줄. 눌러서 자회사 창을 연다. */
  private buildBranchRow(panel: Container, middle: number, left: number, width: number): void {
    const state = this.state;
    const block = foundBlock(state);
    panel.add(this.add.image(left + 24, middle, SC.fruit).setDisplaySize(22, 22));
    const name = addText(this, left + 42, middle - 15, '자회사', { color: THEME_CSS.inkDeep });
    panel.add(name);
    if (state.branches > 0) {
      panel.add(addText(this, name.x + name.width + 4, middle - 13, `${state.branches}곳`, { size: FONT_SIZE.small, color: THEME_CSS.lilacDeep }));
    }
    let detail: string;
    if (block === null) detail = `지금 세우면 열매 ${fruitFor(state.reputation)}개를 받아요`;
    else if (block === 'reputation') detail = `평판 ${state.reputation}/${BRANCH.reputation}이 되면 세워요`;
    else detail = `열매 ${state.fruit}개  수익 +${Math.round(BRANCH.income * state.branches * 100)}%`;
    this.rowDetail(panel, left + 42, middle, left + width - 70, detail);
    const ready = block === null || this.canPower();
    this.button(panel, left + width - 66, middle - 13, 56, 26, '열기', ready ? 'green' : 'neutral', () => {
      this.pages.branch = 0;
      this.openPanel('branch');
    });
  }

  /** 본사의 힘이 지금 주는 것을 짧게 적는다: +60%, 2.0만 */
  private perkNow(id: PerkId): string {
    const def: PerkDef = PERKS[id];
    const level = perkLevel(this.state, id);
    if (def.effect) return `+${Math.round(def.effect.amount * level * 100)}%`;
    return def.seed && level > 0 ? formatLeaves(def.seed[Math.min(level, def.seed.length) - 1]) : '';
  }

  /** 자회사 창: 자회사를 세우고, 받은 열매로 본사의 힘을 올린다. */
  private buildBranchPanel(panel: Container): void {
    const state = this.state;
    const block = foundBlock(state);
    const header = {
      height: 62,
      draw: (top: number, left: number, width: number): void => {
        const fruit = this.fruitCount(panel, left + 14, top + 8, `열매 ${state.fruit}개`);
        const share = Math.round(BRANCH.income * state.branches * 100);
        const owned = state.branches > 0 ? `자회사 ${state.branches}곳  수익 +${share}%` : `자회사마다 수익 +${Math.round(BRANCH.income * 100)}%`;
        const summary = addText(this, left + width - 14, top + 8, owned, { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 1, originY: 0.5 });
        panel.add(summary.setScale(Math.min(1, (left + width - 20 - fruit.x - fruit.width) / summary.width)));

        let first: string;
        let second: string;
        if (block === null) {
          const gain = fruitFor(state.reputation);
          first = `지금 세우면 열매 ${gain}개를 받아요`;
          second = `평판 ${(gain + 1) * BRANCH.perFruit}이 되면 하나 더 받아요`;
        } else if (block === 'reputation') {
          first = `평판 ${state.reputation}/${BRANCH.reputation}이 되면 세울 수 있어요`;
          second = `평판 ${BRANCH.perFruit}마다 열매를 하나 받아요`;
        } else {
          first = `${OFFICES[OFFICES.length - 1].name}에서 평판 ${BRANCH.reputation}을 채우면`;
          second = '자회사를 또 세울 수 있어요';
        }
        const right = left + width - (block === null ? 74 : 14);
        const one = addText(this, left + 14, top + 24, first, { size: FONT_SIZE.small, color: block === null ? THEME_CSS.good : THEME_CSS.ink });
        const two = addText(this, left + 14, top + 39, second, { size: FONT_SIZE.small, color: THEME_CSS.sub });
        panel.add([one.setScale(Math.min(1, (right - left - 14) / one.width)), two.setScale(Math.min(1, (right - left - 14) / two.width))]);
        if (block === null) {
          this.button(panel, left + width - 68, top + 24, 58, 28, '세우기', 'pink', () => this.openPanel('found'));
        }
      },
    };
    const bottom = this.listPanel(
      panel,
      'branch',
      '자회사',
      PERK_ORDER,
      38,
      18,
      (id: PerkId, middle, left, width) => {
        const def: PerkDef = PERKS[id];
        const level = perkLevel(state, id);
        const name = addText(this, left + 14, middle - 15, def.name, { color: THEME_CSS.inkDeep });
        panel.add(name);
        if (level > 0) {
          panel.add(
            addText(this, name.x + name.width + 4, middle - 13, `${level}단계 ${this.perkNow(id)}`, {
              size: FONT_SIZE.small,
              color: THEME_CSS.lilacDeep,
            }),
          );
        }
        // 종잣돈은 단계마다 값이 달라서, 다음 단계에 들고 시작할 잎사귀를 적는다.
        const seed = def.seed?.[Math.min(level, def.seed.length - 1)];
        const detail = seed === undefined ? def.description : `잎사귀 ${formatLeaves(seed)}로 새 회사를 시작`;
        this.rowDetail(panel, left + 14, middle, left + width - 70, detail);
        const perk = perkBlock(state, id);
        if (perk === 'max') {
          this.rowState(panel, left, width, middle, '최고');
          return;
        }
        const x = left + width - 66;
        const cost = perkCost(id, level);
        const button = this.button(panel, x, middle - 13, 56, 26, `  ${cost}`, perk === null ? 'green' : 'neutral', () => {
          if (!buyPerk(state, id)) return;
          this.play('upgrade');
          this.save();
          this.refreshNow();
        });
        panel.add(this.add.image(x + 17, middle - 1.5, SC.fruit).setDisplaySize(11, 11).setAlpha(perk === null ? 1 : 0.45));
        if (perk !== null) button.setEnabled(false);
      },
      header,
    );
    panel.add(
      addText(this, W / 2, bottom + 3, '열매로 올린 힘은 새 회사에도 그대로 남아요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  /** 자회사를 세울지 한 번 더 묻는다. 되돌릴 수 없는 일이라 받는 것과 처음으로 돌아가는 것을 적어 준다. */
  private buildFoundPanel(panel: Container): void {
    const state = this.state;
    if (foundBlock(state) !== null) {
      // 열어 둔 사이에 세울 수 없게 됐으면 자회사 창으로 돌아간다.
      this.panelKind = 'branch';
      this.buildBranchPanel(panel);
      return;
    }
    const gain = fruitFor(state.reputation);
    const { left, top, width } = this.panelFrame(panel, '자회사 세우기', 172);
    const line = (y: number, text: string, color: string, size: number = FONT_SIZE.small): void => {
      const label = addText(this, W / 2, y, text, { size, color, originX: 0.5 });
      panel.add(label.setScale(Math.min(1, (width - 24) / label.width)));
    };
    line(top, '지금 회사는 자회사가 되고,', THEME_CSS.ink, FONT_SIZE.normal);
    line(top + 16, '옥탑방에서 새 회사를 시작해요', THEME_CSS.ink, FONT_SIZE.normal);

    const amount = addText(this, W / 2 + 10, top + 52, `열매 +${gain}`, { size: FONT_SIZE.large, color: THEME_CSS.good, originX: 0.5, originY: 0.5 });
    panel.add([amount, this.add.image(amount.x - amount.width / 2 - 13, top + 52, SC.fruit).setDisplaySize(20, 20)]);
    line(top + 70, `자회사가 생겨서 수익 +${Math.round(BRANCH.income * 100)}%`, THEME_CSS.good);

    this.rowLine(panel, left, top + 88, width);
    line(top + 94, '남는 것: 열매와 본사의 힘, 딴 별, 평판 기록', THEME_CSS.sub);
    line(top + 108, '처음부터: 잎사귀, 직원, 장비, 사무실, 부서', THEME_CSS.accent);

    this.button(panel, left + 14, top + 132, 84, 30, '아직이요', 'neutral', () => this.openPanel('branch'));
    this.button(panel, left + width - 98, top + 132, 84, 30, '세우기', 'pink', () => this.foundNow());
  }

  /** 자회사를 세운다. 회사가 옥탑방으로 돌아가므로 화면을 처음부터 다시 맞춘다. */
  private foundNow(): void {
    const state = this.state;
    const founded = foundBranch(state);
    if (!founded) return;
    this.play('found');
    vibrate([12, 50, 12, 50, 20]);
    store.update((save) => {
      save.coins += BRANCH.coins;
    });
    this.selected = 0;
    this.pages = {};
    this.shownReputation = -1;
    this.stripSignature = '';
    this.inboxSignature = '';
    this.offerSignature = '';
    this.save();
    this.buildRoom();
    // 받은 열매를 바로 쓸 수 있게 자회사 창을 다시 연다.
    this.openPanel('branch');
    this.refreshNow();
    const centerY = (ROOM_TOP + this.roomBottom) / 2;
    showBanner(this, centerY, `자회사 ${founded.branches}호!`, THEME_CSS.good, 1800, DEPTH.banner);
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    floatText(this, W / 2, centerY + 26, `열매 +${founded.fruit}  코인 +${BRANCH.coins}`, THEME_CSS.accent, bounds, DEPTH.banner);
    if (seedLeaves(state) > 0) floatText(this, 70, 44, `+${formatLeaves(founded.seed)}`, THEME_CSS.good, bounds, DEPTH.banner);
  }

  /** 오늘의 목표: 채우면 허브의 코인을 받는다. */
  private buildGoalsPanel(panel: Container): void {
    const state = this.state;
    const goals = state.goals;
    const rowHeight = 42;
    const { left, top, width } = this.panelFrame(panel, '오늘의 목표', goals.list.length * rowHeight + 20);
    goals.list.forEach((goal, index) => {
      const y = top + index * rowHeight;
      if (index > 0) this.rowLine(panel, left, y, width);
      const middle = y + rowHeight / 2;
      const done = isGoalDone(goals, index);
      const claimed = goals.claimed[index] === true;
      const progress = Math.min(goal.target, goals.progress[index] ?? 0);
      panel.add(addText(this, left + 14, middle - 16, goalText(goal), { color: claimed ? THEME_CSS.faint : THEME_CSS.inkDeep }));
      const barWidth = 96;
      const bar = this.add.graphics();
      bar.fillStyle(THEME.dim, 1).fillRoundedRect(left + 14, middle + 4, barWidth, 6, 3);
      if (progress > 0) {
        bar
          .fillStyle(done ? THEME.mintDeep : THEME.gold, 1)
          .fillRoundedRect(left + 14, middle + 4, Math.max(6, (barWidth * progress) / goal.target), 6, 3);
      }
      panel.add(bar);
      panel.add(
        addText(this, left + 14 + barWidth + 6, middle + 7, `${progress}/${goal.target}`, {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          originY: 0.5,
        }),
      );

      if (claimed) {
        this.rowState(panel, left, width, middle, '받았어요');
        return;
      }
      const x = left + width - 66;
      const button = this.button(panel, x, middle - 13, 56, 26, `  ${GOAL_REWARD}`, done ? 'yellow' : 'neutral', () => {
        const coins = claimGoal(goals, index);
        if (coins <= 0) return;
        store.update((save) => {
          save.coins += coins;
        });
        this.play('reward');
        this.save();
        const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
        floatText(this, x + 28, middle - 18, `코인 +${coins}`, THEME_CSS.accent, bounds, DEPTH.banner);
        this.refreshNow();
      });
      panel.add(this.add.image(x + 15, middle - 1.5, 'coin').setDisplaySize(12, 12).setAlpha(done ? 1 : 0.45));
      if (!done) button.setEnabled(false);
    });
    panel.add(
      addText(this, W / 2, top + goals.list.length * rowHeight + 4, '목표는 날마다 바뀌어요', {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
      }),
    );
  }

  // ───────── 처음 안내와 알림 ─────────

  /** 사무실 위쪽에 잠깐 떴다가 사라지는 한 줄. 끝나면 after를 부른다. */
  private pill(text: string, hold: number, after?: () => void): Container {
    const y = ROOM_TOP + 16;
    const label = addText(this, W / 2, y, text, { size: FONT_SIZE.small, color: THEME_CSS.white, originX: 0.5, originY: 0.5 });
    label.setScale(Math.min(1, (INNER - 24) / label.width));
    const width = Math.ceil(label.displayWidth) + 20;
    const back = this.add.graphics();
    back.fillStyle(THEME.inkDeep, 0.9).fillRoundedRect(Math.round(W / 2 - width / 2), y - 10, width, 20, 10);
    const view = this.add.container(0, 0, [back, label]).setDepth(DEPTH.fx).setAlpha(0);
    this.tweens.add({ targets: view, alpha: 1, duration: 180 });
    this.tweens.add({
      targets: view,
      alpha: 0,
      delay: hold,
      duration: 250,
      onComplete: () => {
        view.destroy(true);
        after?.();
      },
    });
    return view;
  }

  /** 처음 겪는 일이 있으면 안내를 한 번 띄운다. 창이 떠 있는 동안에는 기다린다. */
  private syncTip(dt: number): void {
    if (this.tipView || this.panel) return;
    this.tipIn -= dt;
    if (this.tipIn > 0) return;
    const id = nextTip(this.state);
    if (!id) {
      this.tipIn = 1;
      return;
    }
    markTip(this.state, id);
    this.save();
    this.play('tip');
    this.tipView = this.pill(TIPS[id], TIP_MS, () => {
      this.tipView = null;
      this.tipIn = TIP_GAP;
    });
  }

  // ───────── 소리 ─────────

  private play(id: SoundId): void {
    for (const note of SOUNDS[id] as readonly Note[]) {
      tone(note.f, note.d, { type: note.type ?? 'triangle', volume: note.v ?? 0.3, slideTo: note.to, delay: note.at });
    }
  }

  // ───────── 공유 ─────────

  /**
   * 회사의 모습이 적힌 카드를 미리 만들어 둔다. 누른 그 자리에서 공유 창을 열어야 브라우저가 허락하기 때문이다.
   * 그림이 되기 전에 누르면 그림 없이 주소만 보낸다.
   */
  private prepareShare(): void {
    const state = this.state;
    const key = `${totalReputation(state)}|${state.office}|${state.releases}|${state.branches}`;
    if (key === this.shareKey) return;
    this.shareKey = key;
    this.shareImage = null;
    void makeShareImage(
      {
        title: COMPANY_TITLE,
        score: totalReputation(state),
        best: totalReputation(state),
        isNewBest: false,
        note:
          state.branches > 0
            ? `자회사 ${state.branches}곳 · 게임 ${state.releases}번 출시`
            : `${OFFICES[state.office].name} · 게임 ${state.releases}번 출시`,
        invite: '나도 회사 차리기',
        host: displayHost(window.location.href),
        icon: 'icon-company',
        mascot: mascotTexture(store.data.cosmetics.equipped.runner, 'cheer'),
        paint: (context, name, x, y, width, height) => {
          if (paintArt(context, name, x, y, width, height) || !this.textures.exists(name)) return;
          context.drawImage(this.textures.get(name).getSourceImage() as CanvasImageSource, x, y, width, height);
        },
      },
      shareFileName(COMPANY_GAME_ID),
    ).then((file) => {
      if (key === this.shareKey) this.shareImage = file;
    });
  }

  private share(): void {
    if (this.sharing) return;
    this.sharing = true;
    const state = this.state;
    const pageUrl = window.location.href;
    void sendShare({
      title: shareTitle(COMPANY_TITLE),
      text: `포켓 아케이드 [${COMPANY_TITLE}] 평판 ${totalReputation(state)}! 우리 회사에 놀러 오세요`,
      url: shareUrl(pageUrl, COMPANY_GAME_ID),
      image: this.shareImage,
    }).then((outcome) => {
      this.sharing = false;
      const notice = shareNotice(outcome);
      if (notice && this.sys.isActive()) this.pill(notice, 1600).setDepth(DEPTH.banner);
    });
  }

  /** 돌아왔을 때 뜨는 알림: 닫아 둔 동안 번 잎사귀와 끝난 업무 */
  private buildAwayPanel(panel: Container): void {
    const away = this.away;
    if (!away) return;
    const earned = away.leaves >= 1;
    const released = away.releases.length;
    const { top } = this.panelFrame(panel, '자리를 비운 동안', (earned ? 34 : 0) + (away.tasks > 0 ? 16 : 0) + (released > 0 ? 16 : 0) + 76);
    let y = top;
    panel.add(
      addText(this, W / 2, y, `${formatDuration(away.seconds)} 동안 회사가 돌아갔어요`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 0.5,
      }),
    );
    y += 18;
    if (earned) {
      const amount = addText(this, W / 2 + 9, y + 14, `+${formatLeaves(away.leaves)}`, {
        size: FONT_SIZE.large,
        color: THEME_CSS.good,
        originX: 0.5,
        originY: 0.5,
      });
      panel.add([amount, this.add.image(amount.x - amount.width / 2 - 11, y + 14, SC.leaf).setDisplaySize(16, 16)]);
      y += 34;
    }
    if (away.tasks > 0) {
      panel.add(
        addText(this, W / 2, y, `맡겨 둔 업무 ${away.tasks}개가 끝났어요`, { size: FONT_SIZE.small, color: THEME_CSS.ink, originX: 0.5 }),
      );
      y += 16;
    }
    if (released > 0) {
      const coins = this.awayCoins > 0 ? `  코인 +${this.awayCoins}` : '';
      panel.add(
        addText(this, W / 2, y, `예약한 게임 ${released}개를 출시했어요${coins}`, { size: FONT_SIZE.small, color: THEME_CSS.accent, originX: 0.5 }),
      );
      y += 16;
    }
    const percent = Math.round(awayRate(this.state) * 100);
    panel.add(
      addText(this, W / 2, y + 2, `닫아 둔 동안에는 수익의 ${percent}%가 ${formatDuration(AWAY.maxSeconds)}까지 쌓여요`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.faint,
        originX: 0.5,
      }).setScale(0.95),
    );
    this.button(panel, W / 2 - 45, y + 22, 90, 28, '좋아요', 'pink', () => this.closePanel());
  }

  /** 친구의 얼굴을 (x, y)를 가운데로 size 높이로 그린다. */
  private portrait(x: number, y: number, id: StaffId, size: number): Phaser.GameObjects.Image {
    const def = staffDef(id);
    const image = this.add.image(x, y, staffTexture(id));
    return def.look ? image.setDisplaySize((size * 62) / 66, size) : image.setDisplaySize(size * 0.8, size * 0.8);
  }
}
