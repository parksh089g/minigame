import Phaser from 'phaser';
import { mascotTexture } from '../../art/cosmetics';
import { paintArt } from '../../art/vector';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import type { BackAware, RefitAware } from '../../core/app-events';
import { dateKeyOf } from '../../core/daily';
import { vibrate } from '../../core/haptics';
import { homeScene, setHome } from '../../core/home';
import { music } from '../../core/music';
import { sfx, tone } from '../../core/sfx';
import { store } from '../../core/store';
import { holdToasts } from '../../core/toast';
import { bakedPanel, bakeShape } from '../../core/bake';
import { addBackdrop, addTapZone, addText, drawPanel, fadeIn, fadeToScene, PixelButton } from '../../core/ui';
import { syncScores } from '../../online/online';
import { MAX_SCORE } from '../../online/protocol';
import { floatText, showBanner } from '../../scenes/GameHud';
import { announceLastWeek } from '../../scenes/weekly-settle';
import { makeShareImage } from '../../share/card';
import { displayHost, shareFileName, shareNotice, shareTitle, shareUrl } from '../../share/link';
import { sendShare } from '../../share/send';
import { getGame, thisWeek } from '../registry';
import { COMPUTER_SIZE, computerTexture, departmentLook, registerCompanyTextures, SC, TASK_COLORS, taskTexture } from './art';
import { addPlainRect, addRoundRect, circle, Pill, ring, roundRect, roundStroke } from './shapes';
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
  MAX_FLOWERS,
  OFFICES,
  PERK_ORDER,
  PERKS,
  PLAY_STARS,
  PLAY_TRIP,
  PROJECT_ORDER,
  PROJECTS,
  QUEUE,
  RATING,
  RUSH,
  SKILL_LEVEL,
  SKILLS,
  SPECIALS,
  SPECIALTY_BOOST,
  STAFF,
  TASKS,
  TIPS,
  TRAINING,
  type DecorDef,
  type DecorId,
  type DecorSlot,
  type DepartmentDef,
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
  bestFlowers,
  cardBoost,
  cheerReach,
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
  flowersNow,
  formatDuration,
  formatLeaves,
  formatRate,
  foundBlock,
  foundBranch,
  fruitFor,
  gameIncome,
  goalLimits,
  hasBuddy,
  hasFreeDesk,
  hire,
  hireBlock,
  hireCost,
  hirePool,
  incomePerSecond,
  isReady,
  isStuck,
  joinBlock,
  joinDepartment,
  leadBlock,
  leadLevel,
  leaveDepartment,
  moveBlock,
  moveCoins,
  moveOffice,
  passOpen,
  perkBlock,
  perkCost,
  perkLevel,
  projectBonus,
  projectReputation,
  ratedBonus,
  promoteLead,
  queueBlock,
  release,
  seedLeaves,
  setStars,
  skillAt,
  skillOpen,
  skill,
  specialtyOf,
  squash,
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
  type Passed,
  type CompanyEvent,
  type CompanyState,
  type Release,
} from './rules';
import { advanceGuide, GUIDE_DONE, guideStep, guideView, skipGuide, type GuideTarget } from './guide';
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
/** 만드는 게임의 진행 막대. 끝낸 카드 수를 안에 적으므로 작은 글자 한 줄이 들어가는 높이다. 그 옆에 평가의 꽃이 놓인다. */
const STRIP_BAR = { width: 70, height: 11 } as const;
/** 몇 번째 출시인지 적은 글과 그 옆에 놓인 것(출시하기 버튼, 받을 잎사귀, 평가의 꽃) 사이에 두는 틈 */
const STRIP_TAG_GAP = 3;
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

/** 특별한 카드에 다는 그림의 크기: 카드와 말풍선 귀퉁이에 달 때, 버그가 나왔을 때 */
const BADGE = 11;
const BUG_SIZE = 17;

const DEPTH = { fx: 40, guide: 45, panel: 60, banner: 80 } as const;

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

/** 화면 크기가 바뀌어 다시 열 때 넘겨받는 것: 열려 있던 창과 창마다 보던 쪽 */
export interface CompanyStart {
  panel?: PanelKind;
  pages?: Partial<Record<PanelKind, number>>;
}

/** 아래쪽 버튼으로 여는 창 다섯과, 사무실 창에서 여는 부서 창, 위쪽의 수익을 눌러 여는 출시작 창, 돌아왔을 때 저절로 뜨는 알림 */
export type PanelKind =
  | 'project'
  | 'gear'
  | 'staff'
  | 'seats'
  | 'office'
  | 'goals'
  | 'dept'
  | 'depts'
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
  /** 칸의 바탕. 흰 둥근 네모에 색과 투명도를 입혀서 모습을 바꾼다. */
  frame: Phaser.GameObjects.Image;
  /** 칸의 테. 응원하는 중이거나 고른 카드를 맡길 수 있을 때 두른다. */
  border: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image | null;
  bodyY: number;
  computer: Phaser.GameObjects.Image | null;
  /** 직원이 앉은 자리에만 있는 것들. 빈 자리면 null */
  work: DeskWork | null;
  pressed: boolean;
  /** 지금 그려 둔 모습. 달라졌을 때만 다시 그린다. */
  shown: string;
  level: number;
}

/** 직원이 앉은 책상에만 다는 것들 */
interface DeskWork {
  /** 맡은 업무의 말풍선 */
  bubble: Phaser.GameObjects.Image;
  bubbleIcon: Phaser.GameObjects.Image;
  /** 업무의 진행 막대: 바탕과 채움 */
  barBack: Phaser.GameObjects.Image;
  bar: Pill;
  /** 기운을 보여 주는 가는 막대. 휴게실이 있는 사무실에서만 보인다. */
  energyBack: Phaser.GameObjects.Image;
  energy: Pill;
  /** 지금 그려 둔 기운 막대의 모습 */
  energyShown: string;
  /** 쉬는 중일 때 다는 그림 */
  nap: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  /** 특별한 카드를 맡았을 때 말풍선 귀퉁이에 다는 그림. 버그가 나오면 말풍선 한가운데로 커진다. */
  badge: Phaser.GameObjects.Image;
}

const staffDef = (id: StaffId): StaffDef => STAFF[id];

/** 위쪽의 평판 막대의 길이 */
const REPUTATION_BAR = 70;

/** 아래쪽 버튼에 찍는 점: 흰 테를 두른 붉은 동그라미 */
function dotTexture(scene: Phaser.Scene): string {
  return bakeShape(scene, 'sc-dot', { width: 10, height: 10 }, (graphics) => {
    graphics.fillStyle(THEME.coral, 1).fillCircle(0, 0, 4).lineStyle(1.5, THEME.white, 1).strokeCircle(0, 0, 4);
  });
}

/**
 * 책상의 말풍선: 그 업무의 색으로 칠한 둥근 네모. 급한 의뢰의 업무면 아랫단과 테두리가 붉다.
 * 그림의 (1, 1)이 말풍선의 왼쪽 위다.
 */
function bubbleTexture(scene: Phaser.Scene, kind: TaskKind, rush: boolean): string {
  const colors = TASK_COLORS[kind];
  return bakeShape(scene, `sc-bubble:${kind}:${rush}`, { width: 22, height: 23, originX: 1, originY: 1 }, (graphics) => {
    graphics.fillStyle(rush ? THEME.coral : colors.deep, 1).fillRoundedRect(0, 2, 20, 19, 5);
    graphics.fillStyle(colors.face, 1).fillRoundedRect(0, 0, 20, 19, 5);
    if (rush) graphics.lineStyle(1.5, THEME.coral, 1).strokeRoundedRect(0, 0, 20, 19, 5);
  });
}

/** 책상: 둥근 윗판과 다리 둘. 그림의 왼쪽 위가 칸의 왼쪽 끝, 윗판의 위다. */
function tableTexture(scene: Phaser.Scene, width: number, legs: number): string {
  return bakeShape(scene, `sc-table:${width}:${legs}`, { width, height: 6 + legs, originX: 0, originY: 0 }, (graphics) => {
    graphics.fillStyle(0xe0b98a, 1).fillRect(8, 6, 4, legs).fillRect(width - 12, 6, 4, legs);
    graphics.fillStyle(0xf0cfa5, 1).fillRoundedRect(3, 0, width - 6, 8, 3);
  });
}

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

/** 돕는 부서의 몫을 좁은 줄에 맞게 짧게 적는다. count는 단계 × 사람 수다. */
function supportText(effect: Effect, count: number): string {
  const percent = Math.round(effect.amount * count * 100);
  if (effect.key === 'away') return `닫은 동안 수익 +${percent}%`;
  return effectText(effect, count);
}

/** 배수를 적는다: 2배, 2.6배 */
function timesText(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}배`;
}

/** 몇 번째 출시인지 적는다. 처음은 새 게임이고 그 뒤로는 업데이트다. */
function versionText(version: number): string {
  return version <= 1 ? '새 게임' : `업데이트 ${version - 1}`;
}

/** 글이 room보다 넓으면 그 너비에 차도록 줄인다. 좁으면 그대로 둔다. */
function fitWidth(text: Phaser.GameObjects.Text, room: number): void {
  if (text.width > room) text.setScale(Math.max(0, room) / text.width);
}

/**
 * 새싹 컴퍼니: 직원에게 업무를 나눠 주고 게임을 출시해서 회사를 키운다.
 * 판이 끝나지 않고 이어지며, 진행은 따로 저장된다(store.ts).
 */
export class SproutCompanyScene extends Phaser.Scene implements BackAware, RefitAware {
  private state!: CompanyState;
  private built = false;
  /**
   * 같은 기기의 다른 곳(다른 탭이나 설치한 앱)에 회사를 넘겨주고 기다리는 중이거나, 저장된 회사를 다시 읽는 중이면 true.
   * 이때는 시간을 흘리지도 저장하지도 않는다. 낡은 회사로 다른 곳의 새 기록을 덮지 않도록.
   */
  private waiting = false;
  private resuming = false;
  /** 다른 곳에서 회사를 열었다고 알리는 막 */
  private yieldView: Container | null = null;
  /** create가 불린 횟수. 저장을 읽는 사이에 화면이 다시 만들어졌는지 알아본다. */
  private opened = 0;
  /** 여기서 보낸 게임("우리 게임")을 하고 돌아와서 열었는지. 그 시간은 회사를 열어 둔 것으로 친다(welcomeBack). */
  private fromGame = false;
  /** 화면 크기가 바뀌어 다시 만들 때 넘겨받은, 다시 열 창 */
  private restore: CompanyStart | null = null;

  private leavesText!: Phaser.GameObjects.Text;
  private rateText!: Phaser.GameObjects.Text;
  /** 초당 수익 단추의 그림자와 얼굴 */
  private rateShadow!: Pill;
  private rateFace!: Pill;
  private rateStar!: Phaser.GameObjects.Image;
  private starsText!: Phaser.GameObjects.Text;
  private ratePressed = false;
  private reputationText!: Phaser.GameObjects.Text;
  private officeText!: Phaser.GameObjects.Text;
  /** 다음 사무실까지의 평판 막대의 채움 */
  private reputationFill!: Pill;
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
  /** 간판을 달았을 때 사무실 이름 뒤에 까는 판: 아랫단과 윗단 */
  private signLip!: Pill;
  private signFace!: Pill;
  /** 길잡이의 말풍선과, 짚는 곳에 두르는 테 */
  private guideLayer!: Container;
  private guideRing!: Graphics;
  private guideSignature = '';
  /** 아래쪽 버튼이 놓인 자리. 길잡이가 짚을 때 쓴다. */
  private buttonRects: Partial<Record<PanelKind, Phaser.Geom.Rectangle>> = {};
  private shownSign = '';
  private dots: Partial<Record<PanelKind, Phaser.GameObjects.Image>> = {};
  /** 창마다 보고 있는 쪽 */
  private pages: Partial<Record<PanelKind, number>> = {};
  private offerChip!: Container;
  private offerBar: Phaser.GameObjects.Image | null = null;
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
  /**
   * 지금 사무실의 벽과 바닥을 구운 그림의 이름. 사무실의 모양이 바뀌면 앞의 그림을 지운다.
   * 화면을 닫았다 열어도 같은 모양이면 다시 쓰도록, create에서 비우지 않는다.
   */
  private roomTexture: string | null = null;
  private inboxTop = 0;

  constructor() {
    super(COMPANY_SCENE);
  }

  create(data?: CompanyStart): void {
    this.built = false;
    // 화면 크기가 바뀌어 다시 만든 것이면 열려 있던 창을 다시 연다(open의 끝).
    this.restore = data?.panel ? data : null;
    // Phaser는 데이터 없이 다시 시작하면 앞에 받은 데이터를 그대로 넘긴다. 다음에 허브에서 열 때 창이 뜨지 않게 지운다.
    this.sys.settings.data = {};
    this.waiting = false;
    this.resuming = false;
    this.yieldView = null;
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
    this.pages = { ...this.restore?.pages };
    this.offerBar = null;
    this.offerSignature = '';
    this.hintColor = '';
    this.tipView = null;
    this.tipIn = 3;
    this.shareKey = '';
    this.shareImage = null;
    this.sharing = false;

    registerCompanyTextures(this);
    // 여기서 하러 보낸 게임에서 돌아왔으면 돌아갈 곳이 아직 회사로 적혀 있다(허브를 거쳤으면 지워져 있다).
    // 이제부터 나가는 길은 다시 허브다.
    this.fromGame = homeScene() === COMPANY_SCENE;
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
    // 화면이 가려지면 그때를 적어 두고, 다시 보이면 저장된 회사를 다시 읽은 뒤 그동안의 몫을 한꺼번에 셈한다.
    const onHidden = (): void => this.save();
    const onVisible = (): void => this.resume();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.game.events.on(Phaser.Core.Events.VISIBLE, onVisible);
    // 같은 기기의 다른 곳에서 회사를 열거나 저장하면 알려 온다.
    const unwatch = companyStore.onChange(() => this.onStoreChange());
    // 멈추거나 떠나면 음악도 잦아든다.
    music.hush(false);
    const rest = (): void => music.rest();
    this.events.on(Phaser.Scenes.Events.PAUSE, rest);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, rest);
      rest();
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.game.events.off(Phaser.Core.Events.VISIBLE, onVisible);
      unwatch();
      holdToasts(false);
      this.save();
      this.built = false;
    });
    fadeIn(this);

    // 다른 곳에서 그사이 저장한 것이 있으면 그것을 읽어 와서 연다. 이제부터는 이 곳이 회사를 맡는다.
    const token = (this.opened += 1);
    // 읽지 못해도 가진 것으로 연다.
    void companyStore.refresh().catch(() => undefined).then(() => {
      if (token !== this.opened || !this.sys.isActive()) return;
      companyStore.claim();
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
    if (!this.built || this.waiting) return;
    const dt = Math.min(delta / 1000, MAX_STEP);
    this.clock += dt;
    music.tick();
    for (const event of advance(this.state, dt)) this.onEvent(event);

    this.syncTop();
    for (const view of this.desks) this.syncDesk(view);
    // 길잡이가 짚는 곳의 테는 숨 쉬듯 밝아졌다 어두워진다.
    if (this.guideRing.visible) this.guideRing.setAlpha(0.6 + 0.4 * Math.sin(this.clock * 6));

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
      this.syncGuide();
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
    this.add
      .image(MARGIN, this.inboxTop, bakedPanel(this, INNER, INBOX_HEIGHT - 3, { fill: THEME.card, shadow: THEME.shadow, radius: 10, depth: 3 }))
      .setOrigin(0, 0);
    this.inbox = this.add.container(0, 0);
    this.offerChip = this.add.container(0, 0);
    this.buildButtons(buttonsTop);
    this.buildRoom();
    this.guideRing = this.add.graphics().setDepth(DEPTH.guide).setVisible(false);
    this.guideLayer = this.add.container(0, 0).setDepth(DEPTH.guide);
    this.guideSignature = '';

    this.built = true;
    this.update(0, 0);
    if (founded) {
      this.fromGame = false;
      showBanner(this, (ROOM_TOP + this.roomBottom) / 2, '새싹 컴퍼니', THEME_CSS.good, 1600, DEPTH.banner);
    }
    const notice = founded ? null : this.welcomeBack();
    // 게임을 하고 온 동안의 몫을 먼저 한 줄로 알리고, 그 게임에서 딴 별은 그 뒤에 알린다.
    if (notice) this.pill(notice, 2200, () => this.announceStars(risen)).setDepth(DEPTH.banner);
    else this.announceStars(risen);
    // 화면 크기가 바뀌어 다시 만들었으면 보던 창을 다시 연다. 그사이 다른 창(돌아왔을 때의 알림)이 떴으면 그것을 둔다.
    const restore = this.restore?.panel;
    this.restore = null;
    if (restore && !this.panel) this.openPanel(restore);
  }

  /** 화면 크기가 바뀌어 다시 만들 때(core/refit.ts) 열려 있던 창과 그 창에서 보던 쪽을 넘긴다. */
  refitData(): CompanyStart | undefined {
    const kind = this.panelKind;
    // 돌아왔을 때의 알림은 한 번 보면 되는 것이라 다시 띄우지 않는다.
    if (!this.built || !kind || kind === 'away') return undefined;
    return { panel: kind, pages: { ...this.pages } };
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

  /**
   * 닫아 둔 동안의 수익과 일을 셈하고, 알릴 것이 있으면 "자리를 비운 동안" 창을 띄운다.
   * 여기서 보낸 게임을 하고 돌아왔으면 그 시간(PLAY_TRIP.maxSeconds까지)은 회사를 열어 둔 것처럼 흘리고,
   * 창 대신 한 줄로 알릴 말을 돌려준다. 그보다 오래 비웠으면 나머지만 닫아 둔 동안으로 셈한다.
   */
  private welcomeBack(): string | null {
    if (!this.built) return null;
    let seconds = (Date.now() - this.state.savedAt) / 1000;
    let played: Passed | null = null;
    if (this.fromGame) {
      this.fromGame = false;
      const open = Phaser.Math.Clamp(seconds, 0, PLAY_TRIP.maxSeconds);
      played = passOpen(this.state, open);
      seconds -= open;
    }
    const away = catchUp(this.state, seconds);
    if (!away && !played) return null;
    // 예약해 둔 덕분에 그동안 저절로 된 출시도 허브에 적는다.
    const releases = played?.releases.length ?? 0;
    for (let index = 0; index < releases; index += 1) this.recordRelease();
    let coins = 0;
    for (let index = 0; index < (away?.releases.length ?? 0); index += 1) coins += this.recordRelease();
    if (releases > 0 || (away?.releases.length ?? 0) > 0) void syncScores();
    this.selected = 0;
    this.save();
    this.refreshNow();
    if (away && (away.leaves >= 1 || away.tasks > 0 || away.releases.length > 0)) {
      this.away = away;
      this.awayCoins = coins;
      this.openPanel('away');
      this.play('reward');
      return null;
    }
    if (!played || played.leaves < 1) return null;
    return `게임하는 동안 잎 +${formatLeaves(played.leaves)}${releases > 0 ? ` · 출시 ${releases}번` : ''}`;
  }

  /** 날이 바뀌었으면 오늘의 목표를 새로 정한다. */
  private rollDay(): void {
    const state = this.state;
    state.goals = rollGoals(state.goals, dateKeyOf(new Date()), state.office, goalLimits(state));
  }

  private save(): void {
    this.saveIn = SAVE_EVERY;
    // 다른 곳에 회사를 넘겨준 동안에는 저장하지 않는다. 그 곳의 새 기록을 낡은 것으로 덮지 않도록.
    if (this.built && !this.waiting && companyStore.leading) companyStore.set(this.state);
  }

  // ───────── 같은 기기의 다른 곳과 나눠 쓰기 ─────────

  /** 다른 곳이 회사를 맡았거나, 다른 곳에서 저장한 회사를 보내왔다. */
  private onStoreChange(): void {
    // 여는 중이거나 다시 읽는 중이면 그쪽에서 새것을 본다.
    if (!this.built || this.resuming) return;
    if (!companyStore.leading) {
      this.waitForOther();
      return;
    }
    // 이 곳이 맡고 있는데 다른 곳에서 회사를 보내왔다(백업 가져오기나 기록 지우기). 받은 회사로 다시 연다.
    if (companyStore.data !== this.state) this.reopen();
  }

  /** 다른 곳이 회사를 맡았으니 멈추고 기다린다. 화면이 보이는 동안이면 누르면 이어 한다고 알린다. */
  private waitForOther(): void {
    if (this.waiting) return;
    this.waiting = true;
    this.closePanel();
    // 가려진 채로 넘겨줬으면 다시 보일 때 저절로 이어 맡으므로 알릴 것이 없다.
    if (!document.hidden) this.showYield();
  }

  /** 저장된 회사를 다시 읽어 와서 이 곳이 이어 맡는다. 다시 보일 때와, 기다리던 화면을 누를 때 부른다. */
  private resume(): void {
    if (!this.built || this.resuming) return;
    // 읽는 동안에는 시간을 흘리지도 저장하지도 않는다.
    this.waiting = true;
    this.resuming = true;
    const token = this.opened;
    // 읽지 못해도 가진 것으로 이어 한다. 멈춘 채로 남지 않도록.
    void companyStore.refresh().catch(() => undefined).then(() => {
      this.resuming = false;
      if (token !== this.opened || !this.built) return;
      companyStore.claim();
      // 다른 곳에서 그사이 저장했으면 그 회사로 다시 연다. 다시 열면서 그 뒤로 흐른 몫을 셈한다.
      if (companyStore.data !== this.state) {
        this.reopen();
        return;
      }
      this.waiting = false;
      this.yieldView?.destroy(true);
      this.yieldView = null;
      this.welcomeBack();
    });
  }

  /** 받은 회사로 화면을 처음부터 다시 연다. 지금 들고 있는 낡은 회사는 저장하지 않는다. */
  private reopen(): void {
    this.built = false;
    this.scene.restart();
  }

  /** 다른 곳에서 회사를 열었다고 화면을 덮어 알린다. 아무 데나 누르면 여기서 이어 한다. */
  private showYield(): void {
    if (this.yieldView) return;
    const height = this.scale.height;
    const scrim = this.add.rectangle(0, 0, W, height, THEME.inkDeep, 0.45).setOrigin(0, 0).setInteractive();
    scrim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      sfx.click();
      this.resume();
    });
    const boxWidth = INNER - 40;
    const boxHeight = 64;
    const left = Math.round((W - boxWidth) / 2);
    const top = Math.round(height / 2 - boxHeight / 2);
    const box = this.add.graphics();
    drawPanel(box, left, top, boxWidth, boxHeight, { radius: 14 });
    const title = addText(this, W / 2, top + 22, '다른 곳에서 회사를 열었어요', {
      color: THEME_CSS.inkDeep,
      originX: 0.5,
      originY: 0.5,
    });
    const help = addText(this, W / 2, top + 44, '눌러서 여기서 이어 하기', {
      size: FONT_SIZE.small,
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    });
    this.yieldView = this.add.container(0, 0, [scrim, box, title, help]).setDepth(DEPTH.banner + 5);
  }

  // ───────── 위쪽: 잎사귀와 평판 ─────────

  private buildTop(): void {
    this.add.image(49, 16, SC.leaf).setDisplaySize(14, 14);
    this.leavesText = addText(this, 59, 6, '0', { size: 16, color: THEME_CSS.inkDeep });
    // 초당 수익은 누르면 출시작 창이 열리는 작은 단추다. 딴 별의 수를 옆에 적는다.
    this.rateShadow = new Pill(this, 40, 26, 15, THEME.shadow);
    this.rateFace = new Pill(this, 40, 24.5, 15, THEME.white);
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
    this.signLip = new Pill(this, 0, 29.5, 11.5, THEME.white).setVisible(false);
    this.signFace = new Pill(this, 0, 28.5, 11.5, THEME.white).setVisible(false);
    this.shownSign = '';
    this.officeText = addText(this, W - MARGIN, 30, '', { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 1 });
    new Pill(this, W - MARGIN - REPUTATION_BAR, 22, 5, THEME.shadow).setLength(REPUTATION_BAR);
    this.reputationFill = new Pill(this, W - MARGIN - REPUTATION_BAR, 22, 5, THEME.gold).setVisible(false);
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
      this.rateShadow.setLength(width);
      this.rateFace
        .setLength(width)
        .setPosition(40, this.ratePressed ? 26 : 24.5)
        .setColor(this.ratePressed ? THEME.dim : THEME.white);
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
      this.reputationFill.setVisible(share > 0).setLength(Math.max(5, REPUTATION_BAR * share));
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
      this.signLip.setVisible(plate !== null);
      this.signFace.setVisible(plate !== null);
      if (plate) {
        const width = Math.ceil(this.officeText.width) + 12;
        const left = W - MARGIN - width;
        this.signLip.setPosition(left, 29.5).setLength(width).setColor(plate.mark);
        this.signFace.setPosition(left, 28.5).setLength(width).setColor(plate.color);
      }
    }
  }

  // ───────── 지금 만드는 게임 ─────────

  private syncStrip(): void {
    const state = this.state;
    const project = state.project;
    const flowers = flowersNow(state);
    const signature = project ? `${project.id}|${project.done}|${isReady(state)}|${flowers}` : 'none';
    if (signature === this.stripSignature) return;
    this.stripSignature = signature;

    const strip = this.strip;
    strip.removeAll(true);
    const { top, height } = STRIP;
    strip.add(
      this.add
        .image(MARGIN, top, bakedPanel(this, INNER, height - 3, { fill: THEME.card, shadow: THEME.shadow, radius: 12, depth: 3 }))
        .setOrigin(0, 0),
    );

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
    if (ready) {
      // 다 만들었으면 막대 대신 받을 평가를 크게 보여 준다.
      const flower = { size: 10, gap: 1 };
      const flowersLeft = barLeft + flower.size / 2;
      strip.add(this.flowerRow(flowersLeft, top + 27, flower.size, flower.gap, flowers));
      const buttonLeft = MARGIN + INNER - 82;
      // 이름이 길어서 몇 번째 출시인지가 출시하기 버튼 밑으로 들어가면, 아랫줄의 꽃 옆으로 내린다.
      if (tag.x + tag.width > buttonLeft - STRIP_TAG_GAP) {
        const flowersRight = flowersLeft + (MAX_FLOWERS - 1) * (flower.size + flower.gap) + flower.size / 2;
        tag.setOrigin(0, 0.5).setPosition(flowersRight + STRIP_TAG_GAP, top + 27);
        fitWidth(tag, buttonLeft - STRIP_TAG_GAP - tag.x);
      }
      this.button(strip, buttonLeft, top + 5, 76, 28, '출시하기', 'pink', () => this.releaseProject());
      return;
    }
    const bar = { ...STRIP_BAR, top: top + 21 };
    const middle = bar.top + bar.height / 2;
    const share = project.done / project.total;
    strip.add(addRoundRect(this, barLeft, bar.top, bar.width, bar.height, bar.height / 2, THEME.dim));
    if (share > 0) {
      const length = Math.max(bar.height, bar.width * share);
      strip.add([...new Pill(this, barLeft, bar.top, bar.height, THEME.mintDeep).setLength(length).parts]);
    }
    // 끝낸 카드 수를 막대 안에 적는다. 카드가 서른두 장인 게임은 막대만 보고는 몇 장 남았는지 가늠하기 어렵다.
    strip.add(
      addText(this, barLeft + bar.width / 2, middle, `${project.done}/${project.total}`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      }),
    );
    // 여태 끝낸 카드로 받는 평가. 끝낸 카드가 없으면 모두 피지 않은 꽃이다.
    strip.add(this.flowerRow(barLeft + bar.width + 9, middle, 8, 1, flowers));
    // 출시하면 받는 것. 잎사귀는 지금의 평가대로 받는 만큼이다.
    const right = MARGIN + INNER - 8;
    const bonus = addText(this, right, top + 5, `+${formatLeaves(ratedBonus(state))}`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.good,
      originX: 1,
    });
    const reputation = addText(this, right, top + 20, `+${projectReputation(state, project.id)}`, {
      size: FONT_SIZE.small,
      color: THEME_CSS.accent,
      originX: 1,
    });
    const leafX = bonus.x - bonus.width - 6;
    strip.add([
      bonus,
      reputation,
      this.add.image(leafX, top + 11, SC.leaf).setDisplaySize(10, 10),
      this.add.image(reputation.x - reputation.width - 6, top + 26, 'icon-star').setDisplaySize(10, 10),
    ]);
    // 받을 잎사귀의 숫자가 길어져서 이름 줄까지 오면, 몇 번째 출시인지를 그 앞까지만 차게 줄인다.
    fitWidth(tag, leafX - 5 - STRIP_TAG_GAP - tag.x);
  }

  /**
   * 평가의 꽃을 한 줄로 놓는다. x는 첫 꽃의 가운데, y는 줄의 가운데, lit은 핀 꽃의 수다.
   * 만든 그림들을 돌려주므로 받는 쪽에서 컨테이너에 넣거나 움직인다.
   */
  private flowerRow(x: number, y: number, size: number, gap: number, lit: number): Phaser.GameObjects.Image[] {
    return Array.from({ length: MAX_FLOWERS }, (_, index) =>
      this.add.image(x + index * (size + gap), y, index < lit ? SC.flower : SC.flowerOff).setDisplaySize(size, size),
    );
  }

  private releaseProject(): void {
    const result = release(this.state, Math.random);
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
    const result = store.recordPlay(
      COMPANY_GAME_ID,
      Math.min(totalReputation(state), MAX_SCORE),
      coins,
      null,
      thisWeek(store.data.weekly),
    );
    // 회사를 열어 둔 채 주가 바뀌었으면 지난주 미션 보상이 여기서 들어온다. 안내는 회사를 나간 뒤에 뜬다.
    announceLastWeek(result.lastWeekCoins);
    return coins;
  }

  /** 출시를 알린다. 직접 누른 출시와 예약으로 저절로 된 출시가 함께 쓴다. */
  private celebrate(result: Release): void {
    this.play(result.hit ? 'hit' : 'release');
    vibrate(result.hit ? [20, 40, 20, 40, 60] : [12, 50, 12]);
    const centerY = (ROOM_TOP + this.roomBottom) / 2;
    const life = result.hit ? 2400 : 1700;
    const title = result.hit ? '대박!' : result.version === 1 ? '출시!' : '업데이트!';
    showBanner(this, centerY - 14, title, THEME_CSS.accent, life, DEPTH.banner);
    this.showRating(centerY + 10, result, life);
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    floatText(this, 70, 44, `+${formatLeaves(result.bonus)}`, THEME_CSS.good, bounds, DEPTH.fx);
    floatText(this, W - 40, 44, `평판 +${result.reputation}`, THEME_CSS.accent, bounds, DEPTH.fx);
    this.burst(W / 2, STRIP.top + STRIP.height / 2, 10, 46);
    if (result.hit) {
      // 대박이 나면 방 여기저기에서 반짝이가 이어서 터진다.
      for (let index = 0; index < 5; index += 1) {
        this.time.delayedCall(140 * index, () => {
          if (!this.sys.isActive()) return;
          this.burst(40 + Math.random() * (W - 80), centerY - 30 + Math.random() * 60, 8, 40);
        });
      }
    }

    const coins = this.recordRelease();
    if (coins > 0) floatText(this, W / 2, 60, `코인 +${coins}`, THEME_CSS.accent, bounds, DEPTH.fx);
    void syncScores();
    this.selected = 0;
    this.save();
    this.refreshNow();
  }

  /**
   * 출시 알림 아래에 평가를 띄운다: 꽃이 한 송이씩 피고, 그 아래에 평가로 더 받은 것을 적는다.
   * life는 알림이 떠 있는 시간(ms)이다.
   */
  private showRating(y: number, result: Release, life: number): void {
    const size = 15;
    const gap = 2;
    const left = W / 2 - ((MAX_FLOWERS - 1) * (size + gap)) / 2;
    const row = this.flowerRow(left, y, size, gap, result.flowers);
    row.forEach((flower, index) => {
      const scale = flower.scale;
      flower.setDepth(DEPTH.banner).setScale(0);
      this.tweens.add({ targets: flower, scale, delay: 120 + index * 90, duration: 220, ease: 'Back.Out' });
      this.tweens.add({ targets: flower, alpha: 0, delay: life * 0.6, duration: life * 0.4, onComplete: () => flower.destroy() });
    });
    const extra = Math.round((RATING.bonus[result.flowers - 1] - 1) * 100);
    let note = '';
    if (result.hit) note = `잎사귀 ${RATING.hit.bonus}배 · 평판 ${RATING.hit.reputation}배`;
    else if (extra > 0) note = `정성 보너스 +${extra}%`;
    if (note) showBanner(this, y + 18, note, THEME_CSS.good, life, DEPTH.banner, FONT_SIZE.normal);
  }

  /** 끝난 카드가 받은 정성만큼 그 자리에서 작은 꽃이 떠오른다. */
  private popCare(x: number, y: number, care: number): void {
    const count = Math.min(care, RATING.full + RATING.catch);
    for (let index = 0; index < count; index += 1) {
      const flower = this.add
        .image(x + (index - (count - 1) / 2) * 10, y, SC.flower)
        .setDisplaySize(9, 9)
        .setDepth(DEPTH.fx);
      this.tweens.add({
        targets: flower,
        y: y - 16,
        alpha: 0,
        delay: 80 * index,
        duration: 620,
        ease: 'Quad.Out',
        onComplete: () => flower.destroy(),
      });
    }
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

    const floorTop = blockTop + blockHeight - 30;
    const wallColor = wall?.color ?? colors.wall;
    const floorColor = floor?.color ?? colors.floor;
    // 벽과 바닥은 무늬까지 그림 한 장으로 구워 둔다. 모양이 바뀌면(이사, 꾸미기, 자리가 늘 때) 새로 굽고 앞의 그림은 지운다.
    const key = ['sc-room', roomHeight, floorTop, wallColor, floorColor, wall ? state.decor.wall : '', floor ? state.decor.floor : ''].join(':');
    if (this.roomTexture !== null && this.roomTexture !== key && this.textures.exists(this.roomTexture)) {
      this.textures.remove(this.roomTexture);
    }
    this.roomTexture = key;
    bakeShape(this, key, { width: INNER, height: roomHeight, originX: -MARGIN, originY: -ROOM_TOP }, (walls) => {
      drawPanel(walls, MARGIN, ROOM_TOP, INNER, roomHeight - 3, { fill: wallColor, depth: 3 });
      // 무늬는 둥근 모서리를 벗어나지 않게 조금 안쪽에만 그린다.
      if (wall) paintPattern(walls, wall, MARGIN + 6, ROOM_TOP + 6, INNER - 12, floorTop - ROOM_TOP - 6);
      walls
        .fillStyle(floorColor, 1)
        .fillRoundedRect(MARGIN, floorTop, INNER, this.roomBottom - 3 - floorTop, { tl: 0, tr: 0, bl: 12, br: 12 });
      if (floor) paintPattern(walls, floor, MARGIN + 6, floorTop, INNER - 12, this.roomBottom - 3 - floorTop - 6);
    });
    room.add(this.add.image(MARGIN, ROOM_TOP, key).setOrigin(0, 0));

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
    // 칸의 바탕과 테는 흰 그림에 색을 입혀서 쓴다. 빈 자리의 테는 더 가늘다.
    const frame = this.add.image(x, y, roundRect(this, width, height, 10)).setOrigin(0, 0);
    const border = this.add
      .image(x, y, roundStroke(this, width, height, 9, desk.staff ? 2 : 1.5, 1))
      .setOrigin(0, 0)
      .setVisible(false);
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
      border,
      body: null,
      bodyY: 0,
      computer: null,
      work: null,
      pressed: false,
      shown: '',
      level: -1,
    };
    room.add([frame, border]);

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
      const table = this.add.image(x, deskTop, tableTexture(this, width, compact ? 14 : 16)).setOrigin(0, 0);
      view.computer = this.add
        .image(x + width - (narrow ? 14 : 20), deskTop + 1, computerTexture(0))
        .setOrigin(0.5, 1)
        .setDisplaySize(COMPUTER_SIZE.width * view.gearScale, COMPUTER_SIZE.height * view.gearScale);
      // 진행 막대와 기운 막대는 같은 자리, 같은 길이다. 막대의 바탕은 늘 그 길이이고 채움만 늘었다 줄었다 한다.
      const inset = narrow ? 9 : 15;
      const left = x + inset;
      const length = width - inset * 2 - view.barTrim;
      const work: DeskWork = {
        bubble: this.add.image(bubbleX - 11, y + 2, bubbleTexture(this, 'plan', false)).setOrigin(0, 0).setVisible(false),
        bubbleIcon: this.add.image(bubbleX, y + 13, taskTexture('plan')).setDisplaySize(13, 13).setVisible(false),
        barBack: addRoundRect(this, left, deskTop + 11, length, 6, 3, THEME.white, 0.9).setVisible(false),
        bar: new Pill(this, left, deskTop + 11, 6, THEME.white).setVisible(false),
        energyBack: addRoundRect(this, left, deskTop + 19, length, 3, 1.5, THEME.white, 0.8).setVisible(false),
        energy: new Pill(this, left, deskTop + 19, 3, THEME.gold).setVisible(false),
        energyShown: '',
        nap: this.add.image(bubbleX, y + 13, SC.nap).setVisible(false),
        tag: addText(this, x + 21, y + 5, '2배', { size: FONT_SIZE.small, color: THEME_CSS.accent }).setVisible(false),
        badge: this.add.image(bubbleX - 9, y + 4, SC.idea).setDisplaySize(BADGE, BADGE).setVisible(false),
      };
      view.work = work;
      room.add([
        view.body,
        table,
        view.computer,
        work.bubble,
        work.bubbleIcon,
        work.barBack,
        ...work.bar.parts,
        work.energyBack,
        ...work.energy.parts,
        work.nap,
        work.tag,
        work.badge,
      ]);

      // 무엇을 잘하는지 왼쪽 위에 달아 둔다. 사장은 별이다.
      const specialty = specialtyOf(state, desk.staff);
      room.add(this.add.image(x + 11, y + 11, circle(this, 8)));
      // 부서에 든 친구는 그 부서의 색으로 테를 두른다.
      if (desk.dept) room.add(this.add.image(x + 11, y + 11, ring(this, 8.5, 2)).setTint(departmentLook(desk.dept).deep));
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
    view.frame.setTint(THEME.white).setAlpha(view.pressed ? 0.7 : 0.4);
    view.border.setTint(THEME.faint).setAlpha(0.5).setVisible(true);
  }

  private syncDesk(view: DeskView): void {
    const state = this.state;
    const desk = state.desks[view.index];
    const work = view.work;
    if (!desk?.staff || !work) return;
    const task = desk.task;
    const cheered = desk.cheer > 0;
    const resting = desk.resting;
    const card = state.inbox[this.selected];
    const calling = !task && !resting && card !== undefined;
    // 고른 카드의 업무를 남보다 잘하는 친구(특기이거나 그 부서에 든 친구)는 얼마나 빠른지를 달아 둔다.
    // 협업 카드나 협동하는 친구는 지금 옆자리가 일하고 있는 만큼을 더 쳐서 보여 준다.
    const fit = calling ? skill(state, view.index, card.kind) * cardBoost(state, view.index, card) : 1;
    const match = fit > 1;
    const rush = task?.rush === true;
    const special = task?.special ?? '';
    const stuck = isStuck(state, view.index);
    const signature = `${task?.kind ?? ''}|${rush}|${cheered}|${calling}|${fit}|${view.pressed}|${resting}|${special}|${stuck}`;

    if (signature !== view.shown) {
      view.shown = signature;
      view.frame.setTint(view.pressed ? THEME.dim : THEME.white).setAlpha(task ? 0.55 : calling ? 0.95 : 0.4);
      const border = stuck ? THEME.coral : cheered ? THEME.gold : match ? TASK_COLORS[card.kind].deep : calling ? THEME.pink : null;
      view.border.setVisible(border !== null);
      if (border !== null) view.border.setTint(border);

      work.bubble.setVisible(task !== null);
      work.bubbleIcon.setVisible(task !== null);
      work.barBack.setVisible(task !== null);
      work.bar.setVisible(task !== null);
      if (task) {
        // 급한 의뢰의 업무는 말풍선의 테두리와 막대가 붉다.
        work.bubble.setTexture(bubbleTexture(this, task.kind, rush));
        work.bubbleIcon.setTexture(taskTexture(task.kind)).setDisplaySize(13, 13).setVisible(!stuck);
        work.bar.setColor(rush || stuck ? THEME.coral : TASK_COLORS[task.kind].deep);
      }
      // 특별한 카드는 말풍선 귀퉁이에 그림을 달고, 버그가 나오면 말풍선 한가운데에 크게 띄운다.
      work.badge.setVisible(special !== '');
      if (task?.special) {
        const size = stuck ? BUG_SIZE : BADGE;
        work.badge
          .setTexture(SC[task.special])
          .setDisplaySize(size, size)
          .setPosition(stuck ? view.bubbleX : view.bubbleX - 9, view.y + (stuck ? 13 : 4))
          .setAngle(0);
      }
      work.tag.setText(timesText(fit)).setVisible(match);
      if (view.body && staffDef(desk.staff).look) view.body.setTexture(staffTexture(desk.staff, cheered ? 'cheer' : 'idle'));
      // 쉬러 간 친구는 자리가 흐려지고 쉬는 그림이 뜬다.
      view.body?.setAlpha(resting ? 0.35 : 1);
      work.nap.setVisible(resting);
    }

    if (breakOpen(state)) {
      const length = work.energyBack.displayWidth;
      const filled = Math.round(length * Phaser.Math.Clamp(desk.energy, 0, 1));
      const shown = `${filled}|${resting}`;
      if (shown !== work.energyShown) {
        work.energyShown = shown;
        work.energyBack.setVisible(true);
        // 남은 기운은 금빛, 쉬면서 채우는 기운은 풀빛이다.
        work.energy
          .setVisible(filled >= 3)
          .setColor(resting ? THEME.mintDeep : THEME.gold)
          .setLength(filled);
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
      const length = work.barBack.displayWidth;
      const share = Phaser.Math.Clamp(1 - task.left / task.total, 0, 1);
      work.bar.setVisible(share > 0).setLength(Math.max(6, length * share));
    }
    // 버그는 잡을 때까지 좌우로 꿈틀거린다.
    if (stuck) work.badge.setAngle(Math.sin(this.clock * 14) * 14);
    // 일하는 동안에는 몸이 살짝 들썩인다. 버그에 막히면 멈춘다.
    if (view.body) {
      const bob = task && !stuck ? Math.sin(this.clock * (cheered ? 18 : 9) + view.index * 1.7) * (cheered ? 1.5 : 0.8) : 0;
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
      // 버그가 나온 자리는 눌러서 잡는다. 잡으면 잎사귀를 받고, 응원도 함께 받는다.
      const reward = squash(state, index);
      cheer(state, index);
      vibrate(reward > 0 ? 12 : 6);
      if (reward > 0) {
        this.play('squash');
        const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
        floatText(this, view.x + view.width / 2, view.y + 22, `잡았다 +${formatLeaves(reward)}`, THEME_CSS.good, bounds, DEPTH.fx);
        this.burst(view.bubbleX, view.y + 13, 6, 24);
        this.save();
        this.refreshNow();
        return;
      }
      this.play('cheer');
      this.burst(view.x + view.width / 3, view.deskTop - 22, 3, 18);
      // 응원단장을 응원하면 옆자리에도 반짝이가 튄다.
      for (const at of cheerReach(state, index)) {
        const near = this.desks[at];
        if (near) this.burst(near.x + near.width / 3, near.deskTop - 22, 3, 18);
      }
      return;
    }
    if (state.inbox.length > 0) {
      const card = Math.min(this.selected, state.inbox.length - 1);
      if (assign(state, card, index)) {
        this.play('assign');
        vibrate(8);
        if (skillAt(state, index) === 'dash') this.say(view, '재빨리!', THEME_CSS.accent);
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
        this.popCare(view.x + view.width / 2, view.y + 30, event.care);
      }
      this.play(!event.rush && isReady(this.state) ? 'ready' : 'done');
    } else if (event.type === 'idea') {
      // 아이디어가 번뜩이면 일하는 자리마다 반짝이가 튄다.
      this.play('idea');
      showBanner(this, centerY, '번뜩! 모두 응원', THEME_CSS.accent, 900, DEPTH.banner);
      this.state.desks.forEach((desk, index) => {
        const at = this.desks[index];
        if (desk.task && at) this.burst(at.x + at.width / 3, at.deskTop - 22, 3, 18);
      });
    } else if (event.type === 'bug') {
      this.play('bug');
      vibrate(10);
      const view = this.desks[event.desk];
      if (view) floatText(this, view.x + view.width / 2, view.y + 22, '버그!', THEME_CSS.accent, bounds, DEPTH.fx);
    } else if (event.type === 'bugGone') {
      const view = this.desks[event.desk];
      if (view) floatText(this, view.x + view.width / 2, view.y + 22, '놓쳤어요', THEME_CSS.sub, bounds, DEPTH.fx);
    } else if (event.type === 'bugCaught') {
      // 버그 사냥을 하는 친구가 스스로 잡았다.
      this.play('squash');
      const view = this.desks[event.desk];
      if (view) {
        this.say(view, `잡았다 +${formatLeaves(event.reward)}`, THEME_CSS.good);
        this.burst(view.bubbleX, view.y + 13, 6, 24);
      }
    } else if (event.type === 'trade') {
      // 장사꾼이 받은 잎사귀는 "끝" 글자 아래에 작게 띄운다.
      const view = this.desks[event.desk];
      if (view) floatText(this, view.x + view.width / 2, view.y + 36, `+${formatLeaves(event.reward)}`, THEME_CSS.good, bounds, DEPTH.fx);
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

  /** 책상 위에 짧은 말을 띄운다. */
  private say(view: DeskView, text: string, color: string): void {
    const bounds = new Phaser.Geom.Rectangle(0, 0, W, this.scale.height);
    floatText(this, view.x + view.width / 2, view.y + 22, text, color, bounds, DEPTH.fx);
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
    const cards = state.inbox.slice(0, shown).map((task) => `${task.kind}${task.rush ? '!' : ''}${task.special ?? ''}`);
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
      // 고른 카드는 짙은 테를 두르고, 급한 의뢰의 카드는 아랫단과 테두리가 붉다.
      const parts: Phaser.GameObjects.Image[] = [];
      if (picked) parts.push(addRoundRect(this, x - 2, y - 2, CARD.width + 4, CARD.height + 4, 7, THEME.inkDeep));
      parts.push(addRoundRect(this, x, y + 3, CARD.width, CARD.height - 3, 5, task.rush ? THEME.coral : colors.deep));
      const face = addRoundRect(this, x, y, CARD.width, CARD.height - 3, 5, colors.face);
      parts.push(face);
      const edge = task.rush
        ? this.add.image(x, y, roundStroke(this, CARD.width, CARD.height - 3, 4, 2, 1)).setOrigin(0, 0).setTint(THEME.coral)
        : null;
      if (edge) parts.push(edge);
      const icon = this.add.image(x + CARD.width / 2, y + 13, taskTexture(kind)).setDisplaySize(15, 15);
      // 특별한 카드는 오른쪽 위 귀퉁이에 그림을 단다.
      const badge = task.special
        ? this.add.image(x + CARD.width - 4, y + 3, SC[task.special]).setDisplaySize(BADGE, BADGE)
        : null;
      const draw = (pressed: boolean): void => {
        const offset = pressed ? 2 : 0;
        face.setY(y + offset);
        edge?.setY(y + offset);
        icon.setY(y + 13 + offset);
        badge?.setY(y + 3 + offset);
      };
      const zone = addTapZone(this, x - (step - CARD.width) / 2, top, step, INBOX_HEIGHT - 2, draw, () => {
        if (this.selected === index) return;
        this.selected = index;
        sfx.tick();
        this.refreshNow();
      });
      inbox.add(badge ? [...parts, icon, badge, zone] : [...parts, icon, zone]);
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
        const frame = addRoundRect(this, MARGIN, top, INNER, height, 10, THEME.white);
        const edge = this.add.image(MARGIN, top, roundStroke(this, INNER, height, 9, 2, 1)).setOrigin(0, 0).setTint(THEME.coral);
        // 띠를 눌렀을 때 뒤의 책상이 눌리지 않게 한다.
        const blocker = this.add.zone(MARGIN, top, INNER, height).setOrigin(0, 0).setInteractive();
        const bar = addPlainRect(this, MARGIN + 30, top + 23.5, 2, 2, THEME.coral).setAlpha(0.8);
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
          edge,
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
      this.offerBar.setVisible(share > 0).setDisplaySize(Math.max(2, (INNER - 30 - 62) * share), 2);
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
    const bugged = state.desks.some((_, index) => isStuck(state, index));
    // 고른 카드가 특별한 카드면 그 카드가 무엇을 하는지 적는다.
    const picked = state.inbox[this.selected]?.special;
    if (rush) text = `급한 의뢰 ${rush.done}/${rush.total}  남은 시간 ${Math.max(0, Math.ceil(rush.left))}초`;
    else if (bugged) text = '버그가 나왔어요! 그 자리를 눌러 잡아요';
    else if (picked && idle) text = SPECIALS[picked].description;
    else if (isReady(state)) text = '다 만들었어요! 출시하기를 눌러요';
    else if (!state.project) text = state.releases === 0 ? '게임 고르기를 눌러 첫 게임을 만들어요' : '다음에 만들 게임을 골라요';
    else if (state.inbox.length > 0 && idle) {
      const first = state.lead > 0 ? '팀장이 곧 맡겨요. 직접 맡기면 더 빨라요' : '쉬는 친구를 눌러 카드를 맡겨요';
      text = Math.floor(this.clock / 4) % 2 === 0 ? first : '카드와 같은 그림을 단 친구는 두 배 빨라요';
    } else if (moveBlock(state) === null) text = '사무실 버튼에서 더 큰 곳으로 이사할 수 있어요';
    else if (state.queue.length > 0) text = `다 만들면 저절로 출시해요. 다음은 ${PROJECTS[state.queue[0]].title}`;
    else if (foundBlock(state) === null && Math.floor(this.clock / 4) % 2 === 1) {
      text = `자회사를 세우면 열매 ${fruitFor(state.reputation)}개를 받아요`;
    } else if (state.project && state.releases > 0 && Math.floor(this.clock / 4) % 2 === 1) {
      text = '맞는 친구가 응원받으며 하면 꽃이 피어요';
    } else text = '일하는 친구를 누르면 응원으로 빨라져요';
    if (this.hint.text !== text) this.hint.setText(text);
    const color = rush || bugged ? THEME_CSS.accent : THEME_CSS.sub;
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
      this.buttonRects[kind] = new Phaser.Geom.Rectangle(x, top, width, BUTTON_HEIGHT);
      const dot = this.add.image(x + width - 5, top + 4, dotTexture(this)).setVisible(false);
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
    const face = height - 3;
    const radius = Math.min(11, face / 2);
    // 아랫단과 얼굴은 같은 둥근 네모에 색만 달리 입힌다.
    const lip = addRoundRect(this, x, y + 3, width, face, radius, BUTTONS[style].lip);
    const top = addRoundRect(this, x, y, width, face, radius, BUTTONS[style].face);
    const text = addText(this, 0, 0, label, { originX: 0.5, originY: 0.5, color: THEME_CSS.inkDeep });
    text.setScale(Math.min(1, (width - 6) / text.width));
    let enabled = true;
    let current = style;
    const draw = (pressed: boolean): void => {
      const colors = BUTTONS[current];
      const offset = pressed && enabled ? 2 : 0;
      lip.setTint(colors.lip);
      top.setTint(colors.face).setY(y + offset);
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
    parent.add([lip, top, text, zone]);
    return {
      setLabel: (next) => {
        text.setText(next).setScale(1);
        text.setScale(Math.min(1, (width - 6) / text.width));
      },
      setEnabled: (next) => {
        enabled = next;
        lip.setAlpha(next ? 1 : 0.45);
        top.setAlpha(next ? 1 : 0.45);
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
    this.syncGuide();
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
    else if (kind === 'depts') this.buildDeptsPanel(panel);
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

  /** 닫기를 눌렀을 때. 사무실 창에서 연 창은 사무실 창으로, 부서 하나의 창은 부서 목록으로 돌아간다. */
  private dismissPanel(): void {
    if (this.panelKind === 'depts' || this.panelKind === 'branch' || this.panelKind === 'decor') this.openPanel('office');
    else if (this.panelKind === 'dept') this.openPanel('depts');
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
    if (kind === 'depts') return `${page}|${departments.join(',')}`;
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
    panel.add(addPlainRect(this, left + 10, y, width - 20, 1, THEME.dim));
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
  /**
   * 줄의 아랫줄. pal이 있으면 끝에 하트와 그 단짝의 이름을 단다.
   * 자리가 모자라면 글자를 줄이고, 하트는 그대로 둔다.
   */
  private rowDetail(
    panel: Container,
    x: number,
    middle: number,
    right: number,
    text: string,
    pal: string | null = null,
    color: string = THEME_CSS.sub,
  ): void {
    const line = addText(this, x, middle + 2, text, { size: FONT_SIZE.small, color });
    panel.add(line);
    if (pal === null) {
      line.setScale(Math.min(1, (right - x) / line.width));
      return;
    }
    const heart = this.add.image(0, middle + 8, SC.heart);
    const name = addText(this, 0, middle + 2, pal, { size: FONT_SIZE.small, color: THEME_CSS.sub });
    const gap = 6;
    const scale = Math.min(1, (right - x - gap - heart.displayWidth - 2) / (line.width + name.width));
    line.setScale(scale);
    heart.setX(line.x + line.displayWidth + gap + heart.displayWidth / 2);
    name.setScale(scale).setX(heart.x + heart.displayWidth / 2 + 2);
    panel.add([heart, name]);
  }

  /** 이름 옆에 붙이는 작은 말(예: 잘하는 일, 덤으로 주는 효과). 자리가 모자라면 줄인다. */
  private rowNote(panel: Container, x: number, middle: number, right: number, text: string): void {
    const note = addText(this, x, middle - 13, text, { size: FONT_SIZE.small, color: THEME_CSS.faint });
    note.setScale(Math.min(1, (right - x) / note.width));
    panel.add(note);
  }

  private buildProjectPanel(panel: Container): void {
    const state = this.state;
    // 큰 게임이 위에 오도록 뒤에서부터 적는다.
    const ids = [...availableProjects(state)].reverse();
    // 예약 줄이 열린 사무실에서는, 만드는 게임이 있는 동안 다음 게임을 예약한다.
    const queueOpen = QUEUE.unlockOffice <= state.office;
    const bottom = this.listPanel(panel, 'project', '프로젝트', ids, 38, queueOpen ? 54 : 18, (id: ProjectId, middle, left, width) => {
      const def = PROJECTS[id];
      const version = versionOf(state, id) + 1;
      // 낸 적이 있는 게임은 그림 아래에 가장 좋았던 평가를 꽃으로 보여 준다.
      panel.add(this.add.image(left + 24, version > 1 ? middle - 3 : middle, def.icon).setDisplaySize(24, 24));
      if (version > 1) panel.add(this.flowerRow(left + 12, middle + 14, 6, 0, bestFlowers(state, id)));
      const title = addText(this, left + 42, middle - 14, def.title, { color: THEME_CSS.inkDeep });
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
        if (!startProject(state, id, Math.random)) return;
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
        const name = addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep });
        panel.add(name);
        // 잘하는 일은 그림으로, 덤으로 주는 효과는 이름 옆에, 교육하면 열리는 기술은 아랫줄에 적는다.
        panel.add(this.add.image(name.x + name.width + 9, middle - 8, taskTexture(def.specialty)).setDisplaySize(11, 11));
        this.rowNote(panel, name.x + name.width + 18, middle, right, effectText(def.trait));
        // 단짝이 이미 회사에 있으면 아랫줄 끝에 하트와 그 친구의 이름을 단다.
        const buddy = buddyOf(row.id);
        this.rowDetail(panel, left + 42, middle, right, SKILLS[def.skill].description, buddy && inCompany(buddy) ? staffDef(buddy).name : null);
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
      this.rowNote(panel, name.x + name.width + (paired ? 29 : 18), middle, right, effectText(def.trait));
      const block = trainBlock(state, row.desk);
      // 아랫줄: 기술이 열렸으면 그 기술이 하는 일을, 아직이면 교육으로 얻는 것과 기술이 열리는 레벨을 적는다.
      const skillName = SKILLS[def.skill].name;
      const detail =
        block === 'locked'
          ? `${OFFICES[TRAINING.unlockOffice].name}부터 교육할 수 있어요`
          : skillOpen(state, row.desk)
            ? `레벨 ${desk.level}  ${SKILLS[def.skill].description}`
            : desk.level > 0
              ? `레벨 ${desk.level}  레벨 ${SKILL_LEVEL}에 ${skillName}`
              : `일 속도 +${step}%  레벨 ${SKILL_LEVEL}에 ${skillName}`;
      // 사장은 잘하는 일 대신 별을 달았으니, 사장이라는 것을 아랫줄에 적는다. 기술을 적을 때는 자리가 모자라서 뺀다.
      const open = block !== 'locked' && skillOpen(state, row.desk);
      // 열린 기술은 눈에 띄게 다른 색으로 적는다.
      this.rowDetail(panel, left + 42, middle, right, specialty || open ? detail : `사장  ${detail}`, null, open ? THEME_CSS.good : THEME_CSS.sub);
      if (block === 'locked' || block === 'max') {
        this.rowState(panel, left, width, middle, block === 'locked' ? '잠김' : '최고');
        return;
      }
      this.costButton(panel, left + width - 66, middle - 13, trainCost(desk.level), block === null, () => {
        if (!train(state, row.desk)) return;
        // 기술이 열리는 레벨에 닿았으면 크게 알린다.
        if (desk.level === SKILL_LEVEL) {
          this.closePanel();
          this.play('hire');
          const centerY = (ROOM_TOP + this.roomBottom) / 2;
          showBanner(this, centerY, `${skillName}!`, THEME_CSS.good, 1800, DEPTH.banner);
          showBanner(this, centerY + 22, `${def.name}: ${SKILLS[def.skill].description}`, THEME_CSS.sub, 1800, DEPTH.banner, FONT_SIZE.normal);
          this.save();
          this.refreshNow();
          return;
        }
        this.play('upgrade');
        this.save();
        this.refreshNow();
      });
    });

    const message =
      candidates.length > 0
        ? `새 친구를 뽑거나 교육해요. 레벨 ${SKILL_LEVEL}에 기술이 열려요`
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
    // 부서는 한 줄로 묶어 두고, 눌러서 부서 목록을 연다.
    const deptRows = deptOpen ? 1 : 0;
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
      const y = top + officeRows * rowHeight;
      this.rowLine(panel, left, y, width);
      this.buildDeptsRow(panel, y + rowHeight / 2, left, width);
    }
    if (branchOpen) {
      const y = top + (officeRows + deptRows) * rowHeight;
      this.rowLine(panel, left, y, width);
      this.buildBranchRow(panel, y + rowHeight / 2, left, width);
    }
    const note = deptOpen
      ? '부서를 세워 직원을 묶어요'
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
    const look = departmentLook(id);
    panel.add(this.add.graphics().fillStyle(look.deep, 1).fillCircle(x, y + 1.5, 12).fillStyle(look.face, 1).fillCircle(x, y, 12).setAlpha(dim ? 0.5 : 1));
    panel.add(this.add.image(x, y, look.texture).setDisplaySize(14, 14).setAlpha(dim ? 0.5 : 1));
  }

  /** 부서가 하는 일을 한 줄로 적는다: 일하는 부서는 그 업무의 속도, 돕는 부서는 회사에 보태는 몫 */
  private deptGain(id: DepartmentId, level: number, members: number): string {
    const def: DepartmentDef = DEPARTMENTS[id];
    if (def.effect) return supportText(def.effect, level * members);
    return `${def.kind ? TASKS[def.kind].name : ''} 일 +${Math.round(departmentBoost(level) * 100)}%`;
  }

  /** 사무실 창의 부서 한 줄. 눌러서 부서 목록을 연다. */
  private buildDeptsRow(panel: Container, middle: number, left: number, width: number): void {
    const state = this.state;
    const founded = DEPARTMENT_ORDER.filter((id) => departmentLevel(state, id) > 0);
    // 세운 부서 가운데 셋까지의 그림을 겹쳐서 보여 준다. 아직 없으면 첫 부서의 그림을 흐리게 둔다.
    const shown = founded.length > 0 ? founded.slice(0, 3) : [DEPARTMENT_ORDER[0]];
    const icons = this.add.graphics();
    panel.add(icons);
    shown.forEach((id, index) => {
      const look = departmentLook(id);
      const x = left + 24 + (index - (shown.length - 1) / 2) * 9;
      icons.fillStyle(THEME.white, 1).fillCircle(x, middle, 8.5).fillStyle(look.face, founded.length > 0 ? 1 : 0.5).fillCircle(x, middle, 7.5);
    });
    const name = addText(this, left + 42, middle - 15, '부서', { color: THEME_CSS.inkDeep });
    panel.add(name);
    if (founded.length > 0) {
      panel.add(addText(this, name.x + name.width + 4, middle - 13, `${founded.length}곳`, { size: FONT_SIZE.small, color: THEME_CSS.lilacDeep }));
    }
    const members = state.desks.filter((desk) => desk.staff && desk.dept).length;
    const rest = DEPARTMENT_ORDER.length - founded.length;
    const detail =
      founded.length === 0 ? '일하는 부서 넷, 돕는 부서 셋' : rest > 0 ? `부서원 ${members}명  아직 없는 부서 ${rest}곳` : `부서원 ${members}명`;
    this.rowDetail(panel, left + 42, middle, left + width - 70, detail);
    // 세우거나 올릴 수 있는 부서가 있으면 버튼의 색으로 알린다.
    const canGrow = DEPARTMENT_ORDER.some((id) => departmentBlock(state, id) === null);
    this.button(panel, left + width - 66, middle - 13, 56, 26, '열기', canGrow ? 'green' : 'neutral', () => {
      this.pages.depts = 0;
      this.openPanel('depts');
    });
  }

  /** 부서 목록 창: 일하는 부서와 돕는 부서를 차례로 적는다. */
  private buildDeptsPanel(panel: Container): void {
    const bottom = this.listPanel(panel, 'depts', '부서', DEPARTMENT_ORDER, 42, 18, (id, middle, left, width) =>
      this.buildDeptRow(panel, id, middle, left, width),
    );
    panel.add(
      addText(this, W / 2, bottom + 3, '한 사람은 한 부서에만 들 수 있어요', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }),
    );
  }

  /** 부서 목록의 한 줄. 아직 없는 부서는 여기서 세우고, 세운 부서는 눌러서 부서 창을 연다. */
  private buildDeptRow(panel: Container, id: DepartmentId, middle: number, left: number, width: number): void {
    const state = this.state;
    const def: DepartmentDef = DEPARTMENTS[id];
    const level = departmentLevel(state, id);
    this.deptIcon(panel, left + 24, middle, id, level === 0);
    const name = addText(this, left + 42, middle - 15, def.name, { color: THEME_CSS.inkDeep });
    panel.add(name);
    if (level > 0) {
      panel.add(addText(this, name.x + name.width + 4, middle - 13, `${level}단계`, { size: FONT_SIZE.small, color: THEME_CSS.lilacDeep }));
    }
    const count = departmentMembers(state, id).length;
    let detail: string;
    if (level > 0) detail = `부서원 ${count}/${departmentSeats(level)}명  ${this.deptGain(id, level, count)}`;
    else if (def.effect) detail = `세우면 한 명마다 ${supportText(def.effect, 1)}`;
    else detail = `세우면 부서원의 ${this.deptGain(id, 1, 1)}`;
    this.rowDetail(panel, left + 42, middle, left + width - 70, detail);
    if (level === 0) {
      this.costButton(panel, left + width - 66, middle - 13, departmentCost(0), departmentBlock(state, id) === null, () => {
        if (!upgradeDepartment(state, id)) return;
        this.play('hire');
        vibrate([12, 50, 12]);
        this.save();
        this.buildRoom();
        this.pill(`새 부서 ${def.name}`, 1600).setDepth(DEPTH.banner);
        // 모두 다른 부서에 들어 있어서 아무도 들지 못했으면, 누구를 넣을지 바로 고르게 한다.
        if (departmentMembers(state, id).length === 0) {
          this.deptShown = id;
          this.pages.dept = 0;
          this.openPanel('dept');
        }
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
    const def: DepartmentDef = DEPARTMENTS[id];
    const kind = def.kind;
    const effect = def.effect;
    const level = departmentLevel(state, id);
    const seats = departmentSeats(level);
    const team = 1 + departmentBoost(level);
    /** 이 부서에 들었을 때 이 친구가 부서의 업무를 하는 배수 */
    const fitOf = (staff: StaffId): number => (specialtyOf(state, staff) === kind ? SPECIALTY_BOOST : 1) * team;
    /** 이 친구가 이 부서에 들면 얻는 것: 일하는 부서는 그 업무의 배수, 돕는 부서는 한 명이 회사에 보태는 몫(무엇의 몫인지는 위에 적혀 있다) */
    const gainOf = (staff: StaffId): string =>
      effect ? `+${Math.round(effect.amount * level * 100)}%` : `${kind ? TASKS[kind].name : ''} 일 ${timesText(fitOf(staff))}`;
    const rows: number[] = [];
    state.desks.forEach((desk, index) => {
      if (desk.staff) rows.push(index);
    });
    // 부서원이 먼저다. 그다음은 일하는 부서면 이 부서의 일을 잘할 친구부터,
    // 돕는 부서면 아직 부서가 없는 친구와 특기가 없는 사장부터 적는다.
    const rank = (index: number): number => {
      const desk = state.desks[index];
      const staff = desk.staff as StaffId;
      const fit = effect ? (desk.dept === null ? 2 : 0) + (specialtyOf(state, staff) === null ? 1 : 0) : fitOf(staff);
      return (desk.dept === id ? 100 : 0) + fit;
    };
    rows.sort((a, b) => rank(b) - rank(a) || a - b);

    const header = {
      height: 44,
      draw: (top: number, left: number, width: number): void => {
        const count = departmentMembers(state, id).length;
        this.deptIcon(panel, left + 24, top + 18, id);
        const summary = addText(this, left + 42, top + 3, `부서원 ${count}/${seats}명  ${this.deptGain(id, level, count)}`, {
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
        const next = effect ? `한 명마다 +${Math.round(effect.amount * (level + 1) * 100)}%` : `+${Math.round(departmentBoost(level + 1) * 100)}%`;
        this.rowDetail(panel, left + 42, top + 18, left + width - 70, `다음 단계: ${next}${more}`);
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
        const times = gainOf(staff);
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
    const note = effect ? '부서원이 많을수록 회사에 더 보태요' : '한 사람은 한 부서에만 들 수 있어요';
    panel.add(addText(this, W / 2, bottom + 3, note, { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 0.5 }));
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
    // 길잡이가 짚어 주는 동안에는 한 줄 안내를 미뤄 둔다.
    if (this.tipView || this.panel || guideStep(this.state)) return;
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

  // ───────── 길잡이 ─────────

  /** 길잡이가 짚는 곳의 네모. 지금 화면에 없으면 null */
  private guideRect(target: GuideTarget): Phaser.Geom.Rectangle | null {
    if (target.kind === 'pick') return new Phaser.Geom.Rectangle(MARGIN + INNER - 92, STRIP.top + 5, 86, 28);
    if (target.kind === 'release') return new Phaser.Geom.Rectangle(MARGIN + INNER - 82, STRIP.top + 5, 76, 28);
    if (target.kind === 'button') return this.buttonRects[target.panel] ?? null;
    const view = this.desks[target.index];
    return view ? new Phaser.Geom.Rectangle(view.x, view.y, view.width, view.height) : null;
  }

  /**
   * 처음 하는 사람에게 지금 누를 곳을 짚어 준다: 그곳에 테를 두르고 말풍선을 붙인다.
   * 창이 떠 있는 동안에는 숨기고, 하라는 일을 하면 다음 걸음으로 넘어간다.
   */
  private syncGuide(): void {
    const state = this.state;
    if (guideStep(state)) {
      const passed = advanceGuide(state);
      if (passed.length > 0) {
        this.save();
        if (!guideStep(state)) {
          this.play('tip');
          this.pill(GUIDE_DONE, 3200).setDepth(DEPTH.banner);
        }
      }
    }
    const view = this.panel ? null : guideView(state, this.selected);
    const rect = view ? this.guideRect(view.target) : null;
    const signature = view && rect ? `${view.title}|${view.detail}|${rect.x}|${rect.y}|${rect.width}|${rect.height}` : '';
    if (signature === this.guideSignature) return;
    this.guideSignature = signature;
    const layer = this.guideLayer;
    layer.removeAll(true);
    this.guideRing.clear().setVisible(false);
    if (!view || !rect) return;

    this.guideRing
      .setVisible(true)
      .lineStyle(3, THEME.coral, 1)
      .strokeRoundedRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 12);

    const title = addText(this, 0, 0, view.title, { color: THEME_CSS.white });
    const detail = addText(this, 0, 0, view.detail, { size: FONT_SIZE.small, color: THEME_CSS.butter });
    const close = 18;
    const width = Math.min(INNER - 4, Math.ceil(Math.max(title.width, detail.width)) + 20 + close);
    const height = 36;
    // 짚는 곳이 위쪽이면 말풍선을 아래에, 아래쪽이면 위에 붙인다.
    const below = rect.centerY < this.scale.height * 0.4;
    const left = Phaser.Math.Clamp(Math.round(rect.centerX - width / 2), MARGIN + 2, W - MARGIN - 2 - width);
    const top = Math.round(below ? rect.bottom + 9 : rect.y - 9 - height);
    const tipX = Phaser.Math.Clamp(rect.centerX, left + 12, left + width - 12);
    const back = this.add.graphics();
    back.fillStyle(THEME.inkDeep, 0.94).fillRoundedRect(left, top, width, height, 10);
    if (below) back.fillTriangle(tipX - 6, top + 1, tipX + 6, top + 1, tipX, top - 6);
    else back.fillTriangle(tipX - 6, top + height - 1, tipX + 6, top + height - 1, tipX, top + height + 6);
    title.setPosition(left + 10, top + 5);
    detail.setPosition(left + 10, top + 20);
    const cross = addText(this, left + width - 11, top + 10, '×', { color: THEME_CSS.faint, originX: 0.5, originY: 0.5 });
    layer.add([back, title, detail, cross]);
    // 말풍선의 ×를 누르면 길잡이를 그만 본다.
    layer.add(
      addTapZone(
        this,
        left + width - 24,
        top,
        24,
        24,
        () => undefined,
        () => {
          sfx.click();
          skipGuide(state);
          this.save();
          this.syncGuide();
        },
      ),
    );
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
