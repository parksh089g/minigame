import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { reducedMotion } from '../../core/motion-guard';
import { sfx, tone } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat, type ResultStrip } from '../../scenes/MiniGameScene';
import type { SharedStart, ShareOverride } from '../../share/link';
import {
  COIN_ICON,
  coinTexture,
  CHARM_BOX,
  charmChipTexture,
  charmTexture,
  drawBulbs,
  drawFelt,
  drawHoldFrame,
  drawLock,
  drawMachine,
  emptySlotTexture,
  LOOK,
  MINI_BOX,
  miniSymbolTexture,
  SYMBOL_BOX,
  symbolColor,
  symbolTexture,
} from './art';
import { wholePercents } from './percent';
import {
  addDailyRun,
  DAILY_LABEL,
  DAILY_OFF_RECORD,
  dailyDayOf,
  dailyInfo,
  dailySeed,
  dailyShare,
  dailyToday,
  dailyVerdict,
  dayIndexOf,
  friendNotice,
  friendScoreOf,
  friendVerdict,
  SHARED_DAY_PASSED,
} from './daily';
import { slotDailyStore } from './daily-store';
import { noteDayScore, syncScores } from '../../online/online';
import { boardDayOf } from './rank';
import { addRankPill, openRankView } from './rank-view';
import {
  buy,
  buyBlock,
  canHold,
  CELLS,
  charmOf,
  clearedRounds,
  discard,
  holdsOf,
  layoutFor,
  LINES,
  MACHINE_FRAME,
  newRun,
  nextRound,
  oddsOf,
  randomOf,
  OFFERS,
  reroll,
  scoreOf,
  settleRound,
  SHOP_HEAD,
  SHOP_ROW,
  SIZE,
  slotsOf,
  spin,
  spinsOf,
  SYMBOLS,
  targetFor,
  valuesOf,
  WILD,
  type Box,
  type Boost,
  type Layout,
  type LineWin,
  type RunState,
  type SpinOutcome,
} from './rules';
import { store } from '../../core/store';
import { unknownCharmTexture } from './art';
import {
  COLLECTION_SIZE,
  COLLECTION_TEXT,
  collectionEntries,
  collectionLabel,
  entryText,
  foundCount,
  type CollectionEntry,
} from './collection';
import { RESUME_TEXT, resumeCaption, savedRunOf, withFound, withPerk, withPieces, withRelic, withRun } from './save';
import {
  holdHowText,
  holdUsedText,
  PERK_TEXT,
  piecesFor,
  piecesVerdict,
  rerollLabel,
  slotsNote,
  unlockBlock,
} from './perks';
import { keepLabel, keepNote, raiseBlock } from './relics';
import {
  addPerkButton,
  addPerkNote,
  openPerkPanel,
  PERK_BUTTON_PAD,
  PERK_NOTE_HEIGHT,
  showPieceGain,
  textWidth,
  type PerkButton,
  type PerkNote,
} from './perk-views';
import { UPGRADE_MARK_BOX, upgradeMarkTexture, upgradeReadyTexture } from './art';
import { nextSpinTimes, upgrade } from './rules';
import {
  BUBBLE_TEXT,
  bubbleKindOf,
  bubbleLayout,
  bubbleShop,
  CHIP,
  chipPlace,
  SHOP_HINT,
  upgradableSlots,
  upgradeMarks,
  offerChip,
  REFUND_SIGN,
  spinLabel,
  type ChipTone,
  type PreviewChip,
} from './shop-text';

// ───────── 움직임 ─────────

/** 돌아가는 칸의 그림이 바뀌는 간격(ms). 움직임을 줄인 기기에서는 천천히 바뀐다. */
const FLICK_MS = 55;
const FLICK_CALM_MS = 180;
/** 첫 열이 멈출 때까지의 시간과, 그 뒤로 열마다 늦게 멈추는 시간(ms) */
const STOP_FIRST_MS = 360;
const STOP_STEP_MS = 190;
/** 몸통의 전구가 켜진 것과 꺼진 것을 바꾸는 간격 */
const BULB_MS = 480;
/** 맞은 줄을 하나씩 보여 주는 간격(ms). 줄이 많으면 다 보여 주는 데 LINES_MAX_MS를 넘지 않게 좁힌다. */
const LINE_STEP_MS = 280;
const LINES_MAX_MS = 960;
/** 맞았을 때 전구가 빨라지는 간격과 그렇게 깜빡이는 시간(ms): 작게 맞았을 때, 크게 맞았을 때 */
const BULB_QUICK_MS = 150;
const BULB_QUICK_FOR_MS = 700;
const BULB_PARTY_MS = 70;
const BULB_PARTY_FOR_MS = 1700;
/** 크게 맞았을 때 금화가 솟는 횟수와 그 간격(ms) */
const PARTY_BURSTS = 5;
const PARTY_BURST_MS = 280;
/** 크게 축하하려면 적어도 이만큼은 받아야 한다. 첫 라운드는 목표가 작아서, 비율만 보면 거의 모든 줄이 크게 맞은 것이 된다. */
const BIG_WIN_MIN = 8;
/** 결과가 저절로 다 보인 뒤 이 시간(ms) 안에 기계를 누른 것은 건너뛰려던 것으로 보고 열을 잠그지 않는다. */
const HOLD_GRACE_MS = 300;
/** 열을 잠그는 법을 처음 알리는 글이 떠 있는 시간(ms) */
const HOLD_TIP_MS = 2600;
/** 잠그는 법과 다 썼을 때의 글은 잠글 수 있는 횟수에 따라 달라서 perks.ts(holdHowText, holdUsedText)가 만든다. */
const HOLD_NOTES = {
  first: '한 번 돌린 뒤에 잠글 수 있어요',
} as const;
/** 곱해진 상금을 알리는 글이 떠 있는 시간(ms) */
const BOOST_MS = 620;
/** 꽝을 보여 준 뒤 다음 스핀을 받을 때까지(ms) */
const MISS_MS = 260;
/** 마지막 스핀의 결과를 보여 준 뒤 라운드를 맺을 때까지(ms) */
const SETTLE_DELAY_MS = 420;
/** 목표를 채웠다고 알린 뒤 가게가 열릴 때까지(ms) */
const SHOP_DELAY_MS = 900;
/** 가게가 열리기 전에 미리 보기를 한 장씩 셈해 두는 간격(ms). 세 장이 SHOP_DELAY_MS 안에 끝난다. */
const PREVIEW_WARM_MS = 120;
/** 가게가 열리고 이만큼은 아래 버튼(다시 뽑기, 다음 라운드)의 누름을 받지 않는다(ms). */
const SHOP_GUARD_MS = 400;
/** 판이 끝난 뒤 결과 화면이 뜰 때까지(ms) */
const OVER_RESULT_MS = 1600;
/** 한 번에 이만큼 넘게 받으면 크게 축하한다(그 라운드의 목표에 견준 비율). */
const BIG_WIN_RATIO = 0.5;

/** 가게의 창이 길 때 부적 한 줄이 더 커질 수 있는 높이와, 줄 아래에 안내를 적으려면 남아야 하는 높이 */
const SHOP_ROW_GROW = 8;
const SHOP_FOOT_MIN = 20;

/** 지금 강화할 수 있다는 표시가 부적의 아래 끝에서 내려와 놓이는 거리와, 오르내리는 폭 */
const READY_MARK_DROP = 2;
const READY_MARK_BOB = 1.5;

/** 가게의 줄에서 값이 적힌 알약의 왼쪽 끝이 줄의 오른쪽 끝에서 떨어진 거리(drawOfferRow가 그리는 자리와 같다) */
const OFFER_PILL_INSET = 45;

/** 판을 시작할 때 보여 주는 그림. 맞은 줄이 없는 판이다. */
const START_GRID: readonly number[] = [0, 1, 2, 3, 4, 5, 1, 2, 0];

/** 이 라운드까지는 돌리기 전에 상금을 따지는 여덟 줄을 흐리게 그어 보여 준다. */
const GUIDE_ROUNDS = 1;
const HINTS = ['돌리기를 눌러요', '같은 그림 셋이 한 줄이면 금화!'] as const;

/** 두고 간 판을 이어 할지 묻는 카드. 처음의 도움말이 놓이던 자리(기계 한가운데)에 같은 높이에서 시작한다. */
const RESUME_CARD = { width: 204, height: 58, top: -23 } as const;
/** 시작 화면의 도감 버튼: 그 위의 카드(도움말이나 이어 하기)와의 틈과 버튼의 높이 */
const BOOK_BUTTON = { gap: 6, height: 24 } as const;
/** 부적 도감의 창이 놓이는 층. 가게와 알림 글자까지, 이 게임의 모든 것 위에 덮인다. */
const BOOK_DEPTH = 50;
/** 도감의 창: 한 줄에 놓는 부적의 수, 칸 하나가 차지하는 한 변(그림 30에 틈 4), 창의 폭, 머리글과 설명 칸과 닫기 버튼의 높이 */
const BOOK = { cols: 6, pitch: 34, width: 224, head: 32, detail: 42, close: 32 } as const;
/**
 * 씬을 열 때 넘겨받는 것. daily는 결과 화면의 "다시 하기"가 오늘의 판을 다시 열 때 넘긴다.
 * 오늘의 판을 공유한 주소로 들어오면 그날(sharedDay)과 보낸 사람의 점수(sharedScore)가 온다.
 */
interface SlotStart extends SharedStart {
  daily?: boolean;
}

/** 시작 화면에서 여느 판과 오늘의 판을 오가는 버튼. 도움말 카드에서 gap만큼 띄워 그 바로 위에 놓는다. */
const DAILY_SWITCH = { width: 96, height: 24, gap: 6 } as const;
/** 오늘의 판을 골랐을 때 버튼 위에 적는 한 줄(오늘의 기록)의 높이와, 버튼과의 틈 */
const DAILY_INFO = { height: 16, gap: 4 } as const;
/** 오늘의 판을 하는 동안 점수 아래에 띄워 두는 표시의 한가운데 높이와 그 높이 */
const DAILY_BADGE = { y: 46, height: 14 } as const;
/**
 * 오늘의 판을 골랐을 때 판을 바꾸는 버튼의 오른쪽에 놓는 랭킹 버튼: 그 버튼과의 틈, 폭과 높이.
 * 두 버튼을 한 덩어리로 가운데에 놓으려고, 판을 바꾸는 버튼은 shift만큼 왼쪽으로 비켜 놓는다.
 */
const RANK_PILL = { gap: 6, width: 42, height: 22, shift: 24 } as const;

const DEPTH = {
  machine: 1,
  glow: 2,
  /** 첫 라운드에 보여 주는 여덟 줄의 길잡이. 맞은 칸의 빛 위, 맞은 줄의 선 아래에 깔린다. */
  guide: 2.2,
  /** 맞은 줄을 긋는 선. 그림 밑에 깔려서, 선이 지나가도 무슨 그림인지 그대로 보인다. */
  line: 2.5,
  cell: 3,
  /** 잠근 열을 두르는 금테와 자물쇠. 그림 위에 놓인다. */
  hold: 3.5,
  panel: 8,
  effect: 20,
  hud: 30,
  hint: 32,
  shop: 34,
  bubble: 38,
  banner: 40,
} as const;

type Image = Phaser.GameObjects.Image;
type Text = Phaser.GameObjects.Text;
type Graphics = Phaser.GameObjects.Graphics;

// ───────── 버튼 ─────────

const BUTTON_TONES = {
  /** 돌리기와 다음 라운드: 카지노의 금빛 버튼 */
  gold: { face: 0xffcf4a, lip: 0xc98f1a },
  mint: { face: THEME.mint, lip: THEME.mintDeep },
  coral: { face: THEME.coral, lip: THEME.coralDeep },
  plain: { face: THEME.card, lip: THEME.shadow },
} as const;

type ButtonTone = keyof typeof BUTTON_TONES;

/** 버튼의 글이 양 끝에서 떨어져 있어야 하는 거리. 글이 이보다 길면 줄인다. */
const BUTTON_PAD = 5;

/**
 * 눌리는 느낌이 나는 둥근 버튼. 공용 버튼(core/ui.ts의 PixelButton)과 같은 모양이지만,
 * 가게 창 위에 놓을 수 있게 층을 정할 수 있고, 다 쓰면 치울 수 있고, 글 옆에 금화 값을 적을 수 있다.
 */
class SoftButton {
  private readonly graphics: Graphics;
  private readonly label: Text;
  private readonly coin: Image;
  private readonly amount: Text;
  /** 누르는 자리. 버튼을 누른 것인지 가려야 하는 쪽에서 읽는다. */
  readonly zone: Phaser.GameObjects.Zone;
  private pressed = false;
  private enabled = true;
  private price: number | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly box: Box,
    private readonly tone: ButtonTone,
    depth: number,
    text: string,
    onTap: () => void,
  ) {
    this.graphics = scene.add.graphics().setDepth(depth);
    this.label = addText(scene, 0, 0, text, { color: LOOK.text.ink, originY: 0.5 }).setDepth(depth);
    this.coin = scene.add.image(0, 0, coinTexture(scene)).setDepth(depth).setVisible(false);
    this.amount = addText(scene, 0, 0, '', { color: LOOK.text.ink, originY: 0.5 }).setDepth(depth).setVisible(false);
    this.zone = addTapZone(
      scene,
      box.x,
      box.y,
      box.width,
      box.height,
      (pressed) => {
        this.pressed = pressed && this.enabled;
        this.draw();
      },
      () => {
        if (!this.enabled) return;
        sfx.click();
        vibrate(8);
        onTap();
      },
    ).setDepth(depth);
    this.draw();
  }

  setLabel(text: string): this {
    this.label.setText(text);
    this.draw();
    return this;
  }

  /** 글 옆에 금화 그림과 값을 적는다. null이면 지운다. sign을 주면 값 앞에 붙인다(돌려받는 금화의 "+"). */
  setPrice(price: number | null, sign = ''): this {
    this.price = price;
    this.coin.setVisible(price !== null && this.graphics.visible);
    this.amount.setVisible(price !== null && this.graphics.visible).setText(price === null ? '' : `${sign}${price}`);
    this.draw();
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.pressed = false;
    const alpha = enabled ? 1 : 0.45;
    for (const part of [this.graphics, this.label, this.coin, this.amount]) part.setAlpha(alpha);
    this.draw();
    return this;
  }

  setVisible(visible: boolean): this {
    this.graphics.setVisible(visible);
    this.label.setVisible(visible);
    this.coin.setVisible(visible && this.price !== null);
    this.amount.setVisible(visible && this.price !== null);
    if (visible) this.zone.setInteractive();
    else this.zone.disableInteractive();
    return this;
  }

  destroy(): void {
    for (const part of [this.graphics, this.label, this.coin, this.amount, this.zone]) part.destroy();
  }

  private draw(): void {
    const { x, y, width, height } = this.box;
    const colors = BUTTON_TONES[this.tone];
    const lip = 3;
    const offset = this.pressed ? 2 : 0;
    const face = height - lip;
    const radius = Math.min(12, face / 2, width / 2);
    const g = this.graphics;
    g.clear();
    g.fillStyle(colors.lip, 1);
    g.fillRoundedRect(x, y + lip, width, face, radius);
    g.fillStyle(colors.face, 1);
    g.fillRoundedRect(x, y + offset, width, face, radius);

    // 글과 금화 값을 한 덩어리로 가운데에 놓는다. 값이 네 자리쯤 되어 버튼보다 길어지면 덩어리를 통째로 줄인다.
    const centerY = Math.round(y + offset + face / 2);
    const extra = this.price === null ? 0 : 4 + COIN_ICON.width + 2 + Math.ceil(this.amount.width);
    const fit = Math.min(1, (width - BUTTON_PAD * 2) / Math.max(1, Math.ceil(this.label.width) + extra));
    for (const part of [this.label, this.coin, this.amount]) part.setScale(fit);
    let left = Math.round(x + (width - (Math.ceil(this.label.width) + extra) * fit) / 2);
    this.label.setPosition(left, centerY);
    left += (Math.ceil(this.label.width) + 4) * fit;
    this.coin.setPosition(left + (COIN_ICON.width / 2) * fit, centerY);
    this.amount.setPosition(left + (COIN_ICON.width + 2) * fit, centerY);
  }
}

// ───────── 씬 ─────────

/** 돌아가고 있는 스핀 */
interface Reel {
  outcome: SpinOutcome;
  /** 돌기 시작한 뒤로 흐른 시간(ms) */
  elapsed: number;
  /** 그림을 마지막으로 바꾼 뒤로 흐른 시간(ms) */
  sinceFlick: number;
  /** 멈춘 열의 수 */
  stopped: number;
}

/** 결과를 보여 주고 있는 스핀. 건너뛸 때 어디까지 보여 줬는지 알아야 해서 적어 둔다. */
interface Showing {
  outcome: SpinOutcome;
  /** 이미 그은 맞은 줄의 수 */
  lines: number;
  /** 곱해진 상금을 알렸는지 */
  boosted: boolean;
  /** 기계가 축하했는지 */
  cheered: boolean;
}

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** "도감 7/24"가 적힌 작은 버튼 */
interface BookButton extends Disposable {
  /** 찾은 부적의 수를 다시 적는다. bounce면 글이 톡 튄다(새 부적을 찾았을 때). */
  refresh(bounce?: boolean): void;
  /** 흐려지며 사라진다. */
  fade(): void;
}

/** 가게에 놓인 부적 한 줄 */
interface OfferRow {
  box: Box;
  back: Graphics;
  icon: Image;
  name: Text;
  description: Text;
  priceBack: Graphics;
  coin: Image;
  price: Text;
  pressed: boolean;
}

/**
 * 행운 슬롯: 3×3 칸의 그림을 돌려 같은 그림 셋이 놓인 줄마다 금화를 받고, 라운드마다 오르는 목표만큼 금화를 낸다.
 * 남은 금화로는 가게에서 부적을 사서 그림이 나올 확률과 줄의 상금을 바꾼다.
 * 규칙은 rules.ts에 있고, 이 씬은 입력과 그리기만 맡는다.
 */
export class CandySlotScene extends MiniGameScene {
  protected readonly gameId = 'candy-slot';

  /** 지금 판의 상태. 자동 플레이 검사에서도 읽는다. */
  run!: RunState;
  /** 화면에 놓인 것들의 자리. 자동 플레이 검사에서도 읽는다. */
  layout!: Layout;
  /** 스핀의 결과를 보여 주고 있거나 라운드를 맺는 중이면 true. 그동안에는 돌리기와 가게를 받지 않는다. */
  busy = false;

  private hud!: GameHud;
  private cells: Image[] = [];
  private glow!: Graphics;
  private lineFx!: Graphics;
  private guideFx!: Graphics;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private goalBack!: Graphics;
  private goalLabel!: Text;
  private goalText!: Text;
  private spinsText!: Text;
  private slotImages: Image[] = [];
  /** 부적 자리마다의, 지금 강화할 수 있다는 표시. 가게에서 강화할 수 있는 부적의 아래에만 보인다. */
  private readyMarks: Image[] = [];
  /** 가게의 맨 아래에 적힌 한 줄. 가게의 창이 짧아서 자리가 없으면 null이다. */
  private shopFoot: Text | null = null;
  private oddsTexts: Array<{ value: Text; chance: Text }> = [];
  /** 확률 줄에 지금 적혀 있는 값. 바뀐 칸만 톡 튀게 하려고 기억해 둔다. */
  private shownOdds: number[] = [];
  private shownValues: number[] = [];
  private spinButton!: SoftButton;
  private reel: Reel | null = null;
  /** 결과를 보여 주고 있는 스핀과, 그것을 차례로 보여 주려고 걸어 둔 일들. 건너뛰면 남은 일을 거둔다. */
  private showing: Showing | null = null;
  private showTimers: Phaser.Time.TimerEvent[] = [];
  /** 다음 스핀에서 잠그려고 골라 둔 열과, 지금 돌고 있는 스핀에서 잠가 둔 열. 없으면 null이다. */
  private holdCol: number | null = null;
  private heldNow: number | null = null;
  private holdFx!: Graphics;
  private holdChip!: Graphics;
  private holdCount!: Text;
  /** 열을 잠그는 법을 이미 알렸는지 */
  private holdTold = false;
  /** 결과가 저절로 다 보여서 다음 스핀을 받기 시작한 때(씬의 시계) */
  private idleAt = 0;
  private bulbs!: Graphics;
  private bulbPhase = 0;
  /** 전구가 돌아가며 켜지는 중인지(크게 맞았을 때) */
  private bulbChase = false;
  private bulbTimer: Phaser.Time.TimerEvent | null = null;
  private bulbCalm: Phaser.Time.TimerEvent | null = null;
  /** 크게 맞았을 때 솟는 금화. 처음 쓸 때 만든다. */
  private coins: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /** 받았지만 아직 화면의 수에 넣지 않은 금화. 맞은 줄을 하나씩 보여 주는 동안 줄어든다. */
  private pending = 0;
  private hints: Array<Text | Graphics> = [];
  /** 가게가 열려 있는 동안 떠 있는 것들 */
  private shopViews: Disposable[] = [];
  private offerRows: Array<OfferRow | null> = [];
  private rerollButton: SoftButton | null = null;
  private shopGuardUntil = 0;
  /** 붙인 부적을 눌렀을 때 뜨는 설명 */
  private bubble: { views: Disposable[]; zones: Phaser.GameObjects.GameObject[] } | null = null;
  /** 두고 간 판을 이어 할지 묻는 카드에 놓인 것들. 묻고 있지 않으면 비어 있다. */
  private resumeViews: Disposable[] = [];
  /** 시작 화면의 도감 버튼과, 가게의 머리글에 놓인 도감 버튼 */
  private startBook: BookButton | null = null;
  private shopBook: BookButton | null = null;
  /** 열려 있는 도감에 놓인 것들. 닫혀 있으면 null이다. */
  private book: Disposable[] | null = null;
  /** 판이 끝났는지. 끝난 뒤에는 도감을 열지 않는다(곧 결과 화면이 뜬다). */
  private ended = false;
  /** 부적 자리의 줄에 놓인 것들(그림과 누르는 자리). 자리의 수가 달라지면 치우고 다시 놓는다. */
  private slotViews: Disposable[] = [];
  /** 시작 화면의 해금 버튼 */
  private startPerks: PerkButton | null = null;
  /** 해금 버튼 아래에 켜진 해금을 알리는 한 줄이 놓일 자리(top)와, 지금 적혀 있는 글과 그것을 그린 것. 적을 것이 없으면 view가 null이다. */
  private perkNote: { top: number; label: string; view: PerkNote | null } | null = null;
  /** 열려 있는 해금 창에 놓인 것들. 닫혀 있으면 null이다. */
  private perkPanel: Disposable[] | null = null;
  /** 씬을 열 때 넘겨받은 것. init이 적어 두고 setUpDaily가 쓴다. */
  private dailyStart: SlotStart = {};
  /** 시작 화면에서 여느 판과 오늘의 판을 오가는 버튼. 첫 스핀에 도움말과 함께 사라진다. */
  private dailySwitch: SoftButton | null = null;
  /** 오늘의 판을 골랐을 때 그 버튼 위에 적는 한 줄 */
  private dailyNote: { back: Graphics; text: Text } | null = null;
  /** 오늘의 판을 골랐을 때 그 버튼 옆에 놓는 랭킹 버튼 */
  private rankPill: Disposable | null = null;
  /** 오늘의 판을 하는 동안 점수 아래에 떠 있는 표시 */
  private dailyBadge: { back: Graphics; text: Text } | null = null;
  /** 공유받은 주소로 들어왔는데 그날이 이미 지났으면 true. 시작 화면에 한 줄로 알린다. */
  private sharedDayPassed = false;
  /** 공유받은 주소에 실려 온 친구의 오늘 점수. 없으면 null */
  private friendScore: number | null = null;

  constructor() {
    super(SCENE.candySlot);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    // 여느 판은 열어 둔 영구 해금을 켜고 시작한다. 부적 자리의 수도 그 판을 따른다.
    this.run = this.freshRun();
    this.layout = layoutFor(this.playArea, slotsOf(this.run));

    this.addTable();
    this.addMachine();
    this.addGoal();
    this.addSlots();
    this.addOdds();
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 240, max: 460 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.sparks],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.spinButton = new SoftButton(this, this.layout.button, 'gold', DEPTH.panel, '돌리기', () => this.trySpin());

    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(false);
    this.bindInput();
    this.showHints();
    this.showGuide();
    this.setUpDaily();
    sfx.go();
    this.playing = true;
    this.offerResume();
  }

  override update(_time: number, deltaMs: number): void {
    const reel = this.reel;
    if (!reel) return;
    reel.elapsed += deltaMs;
    reel.sinceFlick += deltaMs;
    // 잠근 열은 돌지 않는다. 나머지 열만 왼쪽부터 차례로 멈춘다.
    const cols = this.spinningCols();
    while (reel.stopped < cols.length && reel.elapsed >= STOP_FIRST_MS + STOP_STEP_MS * reel.stopped) {
      this.stopColumn(cols[reel.stopped], reel.outcome.grid);
      reel.stopped += 1;
    }
    if (reel.stopped >= cols.length) {
      this.reel = null;
      this.showOutcome(reel.outcome);
      return;
    }
    if (reel.sinceFlick < (reducedMotion() ? FLICK_CALM_MS : FLICK_MS)) return;
    reel.sinceFlick = 0;
    const turning = cols.slice(reel.stopped);
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (!turning.includes(cell % SIZE)) continue;
      // 돌아가는 동안 스쳐 가는 그림은 보여 주기만 하는 것이라 결과와 상관없다.
      this.cells[cell].setTexture(symbolTexture(this, Math.floor(Math.random() * SYMBOLS.length)));
    }
  }

  private resetState(): void {
    this.busy = false;
    this.cells = [];
    this.slotImages = [];
    this.readyMarks = [];
    this.shopFoot = null;
    this.oddsTexts = [];
    this.shownOdds = [];
    this.shownValues = [];
    this.reel = null;
    this.showing = null;
    this.showTimers = [];
    this.holdCol = null;
    this.heldNow = null;
    this.holdTold = false;
    this.idleAt = 0;
    this.bulbPhase = 0;
    this.bulbChase = false;
    this.bulbTimer = null;
    this.bulbCalm = null;
    this.coins = null;
    this.pending = 0;
    this.hints = [];
    this.shopViews = [];
    this.offerRows = [];
    this.rerollButton = null;
    this.shopGuardUntil = 0;
    this.bubble = null;
    this.resetSaveViews();
  }

  // ───────── 놓기 ─────────

  private get cellScale(): number {
    return (this.layout.cell * 0.82) / SYMBOL_BOX;
  }

  /** 칸의 한가운데 */
  private centerOf(cell: number): { x: number; y: number } {
    const { cell: size, gridLeft, gridTop } = this.layout;
    return {
      x: gridLeft + ((cell % SIZE) + 0.5) * size,
      y: gridTop + (Math.floor(cell / SIZE) + 0.5) * size,
    };
  }

  /** 기계의 한가운데 높이. 알림 글자를 여기에 띄운다. */
  private get machineMiddle(): number {
    return this.layout.machine.y + this.layout.machine.height / 2;
  }

  /** 화면을 덮는 초록 천. 이 게임은 꾸미기 상점의 배경 대신 카지노 테이블 위에서 한다. */
  private addTable(): void {
    const { width, height } = this.scale;
    const { machine } = this.layout;
    const focus = { x: machine.x + machine.width / 2, y: machine.y + machine.height / 2 };
    drawFelt(this.add.graphics(), width, height, focus, machine.width * 0.78);
  }

  private addMachine(): void {
    const { machine, cell } = this.layout;
    const body = this.add.graphics().setDepth(DEPTH.machine);
    drawMachine(body, machine.x, machine.y, cell, MACHINE_FRAME);
    // 몸통의 전구는 하나 걸러 하나씩 번갈아 깜빡인다. 움직임을 줄인 기기에서는 깜빡이지 않는다.
    this.bulbs = this.add.graphics().setDepth(DEPTH.machine);
    this.blinkBulbs();
    this.paceBulbs(BULB_MS);
    this.glow = this.add.graphics().setDepth(DEPTH.glow);
    this.guideFx = this.add.graphics().setDepth(DEPTH.guide).setAlpha(0);
    this.drawGuide();
    this.lineFx = this.add.graphics().setDepth(DEPTH.line);
    for (let index = 0; index < CELLS; index += 1) {
      const { x, y } = this.centerOf(index);
      this.cells.push(
        this.add
          .image(x, y, symbolTexture(this, START_GRID[index]))
          .setScale(this.cellScale)
          .setDepth(DEPTH.cell),
      );
    }
    this.addHold();
  }

  private addGoal(): void {
    const { goal } = this.layout;
    const middle = goal.y + goal.height / 2;
    this.goalBack = this.add.graphics().setDepth(DEPTH.panel);
    this.goalLabel = addText(this, goal.x + 10, middle, '목표', { color: LOOK.text.sub, originY: 0.5 }).setDepth(
      DEPTH.panel,
    );
    this.goalText = addText(this, 0, middle, '', { color: LOOK.text.ink, originX: 0.5, originY: 0.5 }).setDepth(
      DEPTH.panel,
    );
    this.spinsText = addText(this, goal.x + goal.width - 10, middle, '', {
      color: LOOK.text.points,
      originX: 1,
      originY: 0.5,
    }).setDepth(DEPTH.panel);
  }

  private addSlots(): void {
    const { slots, slotSize } = this.layout;
    slots.forEach((slot, index) => {
      const image = this.add
        .image(slot.x + slotSize / 2, slot.y + slotSize / 2, emptySlotTexture(this))
        .setDepth(DEPTH.panel);
      this.slotImages.push(image);
      const zone = addTapZone(
        this,
        slot.x - 2,
        slot.y - 2,
        slotSize + 4,
        slotSize + 4,
        (pressed) => image.setScale(pressed && index < this.run.charms.length ? 0.92 : 1),
        () => this.onSlotTap(index),
      ).setDepth(DEPTH.panel);
      // 지금 강화할 수 있는 부적의 아래 끝에 걸리는 표시. 부적의 그림은 가리지 않는다.
      const ready = this.add
        .image(slot.x + slotSize / 2, slot.y + slotSize + READY_MARK_DROP, upgradeReadyTexture(this))
        .setDepth(DEPTH.panel)
        .setVisible(false);
      this.readyMarks.push(ready);
      this.slotViews.push(image, zone, ready);
    });
    // 표시가 가만히 오르내려서 눈에 띈다. 움직임을 줄인 기기에서는 가만히 있는다.
    if (!reducedMotion()) {
      this.tweens.add({ targets: this.readyMarks, y: `-=${READY_MARK_BOB}`, duration: 520, ease: 'Sine.InOut', yoyo: true, repeat: -1 });
    }
  }

  private addOdds(): void {
    const { box, cells, cellWidth } = this.layout.odds;
    const panel = this.add.graphics().setDepth(DEPTH.panel);
    drawPanel(panel, box.x, box.y, box.width, box.height, { radius: 10, depth: 2 });
    cells.forEach((left, symbol) => {
      // 위: 작은 그림과 그 줄의 상금. 아래: 한 칸에 나올 확률.
      const top = box.y + 3 + MINI_BOX / 2;
      this.add.image(left + 2 + MINI_BOX / 2, top, miniSymbolTexture(this, symbol)).setDepth(DEPTH.panel);
      const value = addText(this, left + 4 + MINI_BOX, top, '', { color: LOOK.text.points, originY: 0.5 }).setDepth(
        DEPTH.panel,
      );
      const chance = addText(this, left + cellWidth / 2, box.y + 2 + MINI_BOX, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.sub,
        originX: 0.5,
      }).setDepth(DEPTH.panel);
      this.oddsTexts.push({ value, chance });
    });
  }

  // ───────── 고쳐 그리기 ─────────

  /**
   * 가진 금화, 목표, 남은 스핀, 점수를 지금 상태대로 적는다. 아직 보여 주지 않은 금화(pending)은 뺀다.
   * 남은 잠그기와 돌리기 버튼의 글도 같이 맞춘다.
   */
  private refreshNumbers(): void {
    const { goal } = this.layout;
    const { run } = this;
    const shopping = run.phase === 'shop';
    const coin = Math.max(0, run.coin - this.pending);
    const target = targetFor(run, shopping ? run.round + 1 : run.round);
    const reached = coin >= target;

    this.hud.setScore(Math.max(0, scoreOf(run) - this.pending));
    this.hud.setSide(`라운드 ${run.round}`);
    this.goalLabel.setText(shopping ? '다음 목표' : '목표');
    this.spinsText.setText(`스핀 ${shopping ? spinsOf(run.charms) : run.spinsLeft}`);

    const barLeft = Math.ceil(this.goalLabel.x + this.goalLabel.width) + 6;
    const barRight = Math.floor(this.spinsText.x - this.spinsText.width) - 6;
    const bar = { x: barLeft, y: goal.y + 7, width: barRight - barLeft, height: goal.height - 14 };
    const g = this.goalBack;
    g.clear();
    drawPanel(g, goal.x, goal.y, goal.width, goal.height, { radius: 10, depth: 2 });
    g.fillStyle(LOOK.goalBar.back, 1);
    g.fillRoundedRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2);
    const ratio = Phaser.Math.Clamp(coin / target, 0, 1);
    if (ratio > 0) {
      g.fillStyle(reached ? LOOK.goalBar.full : LOOK.goalBar.fill, 1);
      g.fillRoundedRect(bar.x, bar.y, Math.max(bar.height, bar.width * ratio), bar.height, bar.height / 2);
    }
    this.goalText.setText(`${coin} / ${target}`).setX(Math.round(bar.x + bar.width / 2));
    this.refreshHold();
    this.refreshDailyBadge();
    this.refreshPerks();
  }

  private refreshSlots(): void {
    this.slotImages.forEach((image, index) => {
      const id = this.run.charms[index];
      image.setTexture(id ? charmTexture(this, id) : emptySlotTexture(this)).setScale(1);
    });
    this.refreshReadyMarks();
  }

  /** 가게에서 지금 강화할 수 있는 부적에만 표시를 단다. 금화나 부적이 바뀔 때마다 부른다. */
  private refreshReadyMarks(): void {
    const ready = this.ended ? [] : upgradableSlots(this.run);
    this.readyMarks.forEach((mark, slot) => mark.setVisible(ready.includes(slot)));
  }

  /** 가게의 맨 아래 한 줄: 붙인 부적이 있으면 눌러서 강화하거나 뗄 수 있다고, 없으면 몇 장까지 붙일 수 있는지를 적는다. */
  private refreshShopFoot(): void {
    this.shopFoot?.setText(this.run.charms.length > 0 ? SHOP_HINT : slotsNote(slotsOf(this.run)));
  }

  /** 그림마다의 상금과 확률을 적는다. bounce면 바뀐 칸이 톡 튄다(부적을 붙이거나 뗐을 때). */
  private refreshOdds(bounce: boolean): void {
    const odds = wholePercents(oddsOf(this.run.charms));
    const values = valuesOf(this.run.charms);
    this.oddsTexts.forEach((texts, symbol) => {
      const changed = [
        [texts.value, values[symbol], this.shownValues[symbol]] as const,
        [texts.chance, odds[symbol], this.shownOdds[symbol]] as const,
      ];
      texts.value.setText(String(values[symbol]));
      texts.chance.setText(`${odds[symbol]}%`);
      if (!bounce) return;
      for (const [text, now, before] of changed) {
        if (now === before) continue;
        // 올랐으면 초록, 내렸으면 빨강으로 잠깐 물든다.
        const rest = text === texts.value ? LOOK.text.points : LOOK.text.sub;
        text.setColor(now > before ? LOOK.text.good : LOOK.text.bad);
        this.tweens.killTweensOf(text);
        this.tweens.add({
          targets: text,
          scale: { from: 1.5, to: 1 },
          duration: 320,
          ease: 'Back.Out',
          onComplete: () => text.setColor(rest),
        });
      }
    });
    this.shownOdds = odds;
    this.shownValues = values;
  }

  /** 처음의 도움말. 그림 위에서도 잘 읽히게 흰 판에 얹어 기계 한가운데에 띄운다. */
  private showHints(): void {
    const middle = this.machineMiddle;
    const lines = [
      addText(this, GAME_WIDTH / 2, middle - 17, HINTS[0], { color: LOOK.text.ink, originX: 0.5 }),
      addText(this, GAME_WIDTH / 2, middle + 1, HINTS[1], { color: LOOK.text.sub, originX: 0.5 }),
    ];
    const width = Math.max(...lines.map((line) => line.width)) + 20;
    const back = this.add.graphics().setDepth(DEPTH.hint);
    const box = { x: Math.round(GAME_WIDTH / 2 - width / 2), y: middle - 23, width: Math.round(width), height: 44 };
    back.fillStyle(LOOK.machine.trimLip, 1);
    back.fillRoundedRect(box.x, box.y + 2, box.width, box.height, 10);
    back.fillStyle(LOOK.machine.trim, 1);
    back.fillRoundedRect(box.x, box.y, box.width, box.height, 10);
    back.fillStyle(THEME.white, 1);
    back.fillRoundedRect(box.x + 2, box.y + 2, box.width - 4, box.height - 4, 8);
    this.hints = [back, ...lines];
    // 글은 판보다 위에 놓는다.
    for (const line of lines) line.setDepth(DEPTH.hint + 0.5);
    this.showStartBook(box.y + box.height + BOOK_BUTTON.gap);
  }

  /** 처음의 도움말을 치운다. now면 흐려지는 움직임 없이 바로 치운다(그 위에 다른 것이 덮일 때). */
  private hideHints(now = false): void {
    this.hideStartBook(now);
    this.hideDailySwitch();
    if (this.hints.length === 0) return;
    const hints = this.hints;
    this.hints = [];
    if (now) {
      for (const hint of hints) hint.destroy();
      return;
    }
    this.tweens.add({
      targets: hints,
      alpha: 0,
      duration: 200,
      onComplete: () => hints.forEach((hint) => hint.destroy()),
    });
  }

  /** 기계 위에 작은 알림을 잠깐 띄운다. */
  private note(label: string, color: string, y = this.machineMiddle): void {
    showBanner(this, y, label, color, 1300, DEPTH.banner, FONT_SIZE.normal + 2);
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    // 설명이 떠 있을 때 다른 곳을 누르면 설명을 치운다. 설명 안의 버튼을 누른 것은 그대로 둔다.
    const onDown = (_pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void => {
      if (this.bubble && !over.some((item) => this.bubble?.zones.includes(item))) this.hideBubble();
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    // 키보드로도 돌릴 수 있다(컴퓨터에서 해 볼 때).
    const keyboard = this.input.keyboard;
    const onKey = (event: KeyboardEvent): void => {
      // 누르고 있어서 되풀이되는 것은 받지 않는다. 건너뛰기와 돌리기가 번갈아 쏟아지지 않게 한다.
      if (!event.repeat) this.trySpin();
    };
    keyboard?.on('keydown-SPACE', onKey);
    keyboard?.on('keydown-ENTER', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      keyboard?.off('keydown-SPACE', onKey);
      keyboard?.off('keydown-ENTER', onKey);
    });
  }

  // ───────── 스핀 ─────────

  private trySpin(): void {
    // 돌고 있거나 결과를 보여 주는 중에 누른 것은 건너뛰기다. 그 누름으로 다음 스핀까지 돌리지는 않는다.
    if (this.skipSpin()) return;
    if (!this.playing || this.busy || this.run.phase !== 'spin') return;
    const result = spin(this.run, randomOf(this.run, 'spin', Math.random), this.holdCol);
    if (!result) return;
    // 잠그기 횟수가 줄었으면 골라 둔 열이 잠긴 것이다.
    this.heldNow = result.run.holdsLeft < this.run.holdsLeft ? this.holdCol : null;
    this.holdCol = null;
    this.hideHints();
    this.hideGuide();
    this.hideBubble();
    this.clearWins();
    this.busy = true;
    this.run = result.run;
    this.keepRun();
    this.pending = result.outcome.total;
    this.reel = { outcome: result.outcome, elapsed: 0, sinceFlick: 0, stopped: 0 };
    this.refreshNumbers();
    for (const image of this.cells) {
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale * 0.92).setAlpha(0.8);
    }
    this.keepHeld();
    sfx.whoosh();
    vibrate(8);
  }

  /** 한 열을 멈춰 나온 그림을 보여 준다. */
  private stopColumn(col: number, grid: readonly number[]): void {
    for (let row = 0; row < SIZE; row += 1) {
      const cell = row * SIZE + col;
      const image = this.cells[cell];
      image.setTexture(symbolTexture(this, grid[cell])).setAlpha(1);
      this.tweens.add({
        targets: image,
        scale: { from: this.cellScale * 1.18, to: this.cellScale },
        duration: 200,
        ease: 'Back.Out',
      });
    }
    tone(330 + col * 70, 0.06, { type: 'triangle', volume: 0.35 });
    vibrate(5);
  }

  /** 상금을 따지는 여덟 줄을 흐리게 긋는다. 줄의 양 끝에는 점을 찍어서 어디에서 어디까지인지 보이게 한다. */
  private drawGuide(): void {
    const g = this.guideFx;
    const reach = this.layout.cell * 0.36;
    for (const line of LINES) {
      const from = this.centerOf(line.cells[0]);
      const to = this.centerOf(line.cells[2]);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      const a = { x: from.x - ux * reach, y: from.y - uy * reach };
      const b = { x: to.x + ux * reach, y: to.y + uy * reach };
      g.lineStyle(2, LOOK.guide, 0.5);
      g.lineBetween(a.x, a.y, b.x, b.y);
      g.fillStyle(LOOK.guide, 0.8);
      g.fillCircle(a.x, a.y, 2);
      g.fillCircle(b.x, b.y, 2);
    }
  }

  /** 첫 라운드에서 돌리기를 기다리는 동안 여덟 줄의 길잡이를 보여 준다. */
  private showGuide(): void {
    if (this.run.phase !== 'spin' || this.run.round > GUIDE_ROUNDS) return;
    this.tweens.killTweensOf(this.guideFx);
    this.tweens.add({ targets: this.guideFx, alpha: 1, duration: 220 });
  }

  private hideGuide(): void {
    this.tweens.killTweensOf(this.guideFx);
    this.guideFx.setAlpha(0);
  }

  private clearWins(): void {
    this.glow.clear();
    this.lineFx.clear();
  }

  /** 다 멈춘 판의 결과를 차례로 보여 준다: 맞은 줄을 하나씩, 그다음 곱해진 상금. */
  private showOutcome(outcome: SpinOutcome): void {
    const { wins } = outcome;
    this.showing = { outcome, lines: 0, boosted: false, cheered: false };
    if (wins.length === 0) {
      const { goal } = this.layout;
      sfx.expire();
      this.note('꽝', LOOK.text.sub);
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      this.later(MISS_MS, () => this.afterSpin(outcome));
      return;
    }
    const step = Math.min(LINE_STEP_MS, LINES_MAX_MS / wins.length);
    wins.forEach((win, index) => this.later(index * step, () => this.showWin(win, index)));
    const linesEnd = wins.length * step;
    const boosted = outcome.boosts.length > 0;
    if (boosted) this.later(linesEnd, () => this.showBoosts(outcome));
    this.later(linesEnd + (boosted ? BOOST_MS : 0), () => this.afterSpin(outcome));
  }

  /**
   * 맞은 줄 하나: 줄을 긋고, 세 칸이 튀고, 그 줄의 금화가 떠오른다.
   * quiet면 줄만 긋는다(건너뛸 때 남은 줄을 한꺼번에 그을 때).
   */
  private showWin(win: LineWin, order: number, quiet = false): void {
    const line = LINES[win.line];
    const centers = line.cells.map((cell) => this.centerOf(cell));
    const size = this.layout.cell;

    this.glow.fillStyle(LOOK.winGlow, 1);
    for (const center of centers) {
      this.glow.fillRoundedRect(center.x - size / 2 + 1, center.y - size / 2 + 1, size - 2, size - 2, 9);
    }
    const [from, , to] = centers;
    for (const [width, color] of [
      [8, LOOK.winLine.edge],
      [4, LOOK.winLine.core],
    ] as const) {
      this.lineFx.lineStyle(width, color, 1);
      this.lineFx.beginPath();
      this.lineFx.moveTo(from.x, from.y);
      this.lineFx.lineTo(to.x, to.y);
      this.lineFx.strokePath();
      this.lineFx.fillStyle(color, 1);
      this.lineFx.fillCircle(from.x, from.y, width / 2);
      this.lineFx.fillCircle(to.x, to.y, width / 2);
    }
    if (this.showing) this.showing.lines = order + 1;
    if (quiet) return;

    line.cells.forEach((cell, index) => {
      const image = this.cells[cell];
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale);
      this.tweens.add({
        targets: image,
        scale: this.cellScale * 1.2,
        duration: 110,
        yoyo: true,
        ease: 'Quad.Out',
      });
      this.sparks.setParticleTint(symbolColor(win.symbol));
      this.sparks.explode(3, centers[index].x, centers[index].y);
    });

    this.pending = Math.max(0, this.pending - win.amount);
    this.refreshNumbers();
    const middle = centers[1];
    const bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);
    floatText(this, middle.x, middle.y - size * 0.3, `+${win.amount}`, LOOK.text.points, bounds, DEPTH.effect);
    sfx.hit(order * 2);
    vibrate(10);
  }

  /** 상금이 곱해졌으면 까닭과 곱해진 값을 크게 알린다. */
  private showBoosts(outcome: SpinOutcome): void {
    const times = outcome.boosts.reduce((product, boost) => product * boost.times, 1);
    const label = this.boostLabel(outcome.boosts[0], outcome.wins.length);
    if (this.showing) this.showing.boosted = true;
    showBanner(this, this.machineMiddle, `${label} ${times}배`, LOOK.text.points, BOOST_MS + 200, DEPTH.banner, FONT_SIZE.large);
    sfx.gold();
    vibrate([15, 30, 15]);
    this.sparks.setParticleTint(THEME.gold);
    this.sparks.explode(14, GAME_WIDTH / 2, this.machineMiddle);
    this.cheer(outcome);
  }

  private boostLabel(boost: Boost, lines: number): string {
    switch (boost.kind) {
      case 'jackpot':
        return '대박!';
      case 'combo':
        return `${lines}줄!`;
      case 'last':
        return '막판 한 방!';
      case 'rebound':
        return '오뚝이!';
    }
  }

  /** 금화를 얼마 받았는지(또는 냈는지) 띄운다. */
  private floatCoin(x: number, y: number, amount: number): void {
    if (amount === 0) return;
    const bounds = new Phaser.Geom.Rectangle(0, HUD_HEIGHT, GAME_WIDTH, this.scale.height - HUD_HEIGHT);
    const color = amount > 0 ? LOOK.text.good : LOOK.text.bad;
    floatText(this, x, y + 14, amount > 0 ? `+${amount}` : String(amount), color, bounds, DEPTH.effect);
  }

  /** 스핀 하나의 결과를 다 보여 준 뒤: 수를 맞추고, 스핀이 남았으면 다음을 받고, 다 썼으면 라운드를 맺는다. */
  private afterSpin(outcome: SpinOutcome): void {
    if (!this.playing) return;
    this.pending = 0;
    // 크게 맞았으면 기계가 종을 울리므로 금화 소리는 겹쳐 내지 않는다.
    const big = this.cheer(outcome);
    this.showing = null;
    this.showTimers = [];
    this.heldNow = null;
    this.refreshNumbers();
    if (outcome.wins.length > 0) {
      const { goal } = this.layout;
      this.floatCoin(goal.x + goal.width / 2, goal.y + goal.height, outcome.total);
      if (!big && outcome.total >= targetFor(this.run, this.run.round) * BIG_WIN_RATIO && outcome.boosts.length === 0) sfx.coin();
    }
    if (this.run.spinsLeft > 0) {
      this.busy = false;
      this.idleAt = this.time.now;
      this.spinButton.setEnabled(true);
      // 맞은 줄을 보여 주는 동안에는 길잡이를 겹쳐 긋지 않는다.
      if (outcome.wins.length === 0) this.showGuide();
      this.tellHold();
      return;
    }
    // 라운드를 맺는 동안에는 건너뛸 것이 없다.
    this.spinButton.setEnabled(false);
    this.time.delayedCall(SETTLE_DELAY_MS, () => this.settle());
  }

  // ───────── 건너뛰기 ─────────

  /** 결과를 차례로 보여 주는 일을 걸어 둔다. 건너뛰면 아직 하지 않은 것은 거둔다. */
  private later(ms: number, task: () => void): void {
    this.showTimers.push(this.time.delayedCall(ms, task));
  }

  /**
   * 돌고 있는 스핀이나 보여 주고 있는 결과를 끝까지 건너뛴다: 모든 열을 멈추고, 남은 줄을 한꺼번에 긋고, 수를 맞춘다.
   * 건너뛴 것이 있으면 true를 돌려준다. 받은 금화는 돌릴 때 이미 run에 들어갔으므로, 건너뛰어도 잃거나 두 번 받지 않는다.
   */
  private skipSpin(): boolean {
    if (!this.playing) return false;
    const reel = this.reel;
    if (reel) {
      // 아직 돌고 있으면 다 멈춘 것으로 친다. 꽝은 여기서 바로 알린다.
      this.reel = null;
      this.showOutcome(reel.outcome);
    }
    const showing = this.showing;
    if (!showing) return false;
    for (const timer of this.showTimers) timer.remove();
    this.showTimers = [];

    const { outcome } = showing;
    this.cells.forEach((image, cell) => {
      this.tweens.killTweensOf(image);
      image.setTexture(symbolTexture(this, outcome.grid[cell])).setScale(this.cellScale).setAlpha(1);
    });
    const rest = outcome.wins.slice(showing.lines);
    rest.forEach((win, index) => this.showWin(win, showing.lines + index, true));
    if (rest.length > 0) {
      // 줄마다 따로 튀고 울리는 대신, 방금 그은 줄의 칸들이 한 번에 튄다. 받은 금화는 afterSpin이 한 번에 띄운다.
      this.sparks.setParticleTint(THEME.gold);
      for (const cell of new Set(rest.flatMap((win) => LINES[win.line].cells))) {
        const { x, y } = this.centerOf(cell);
        this.tweens.add({
          targets: this.cells[cell],
          scale: this.cellScale * 1.2,
          duration: 110,
          yoyo: true,
          ease: 'Quad.Out',
        });
        this.sparks.explode(2, x, y);
      }
      sfx.hit(outcome.wins.length * 2);
      vibrate(10);
    }
    if (outcome.boosts.length > 0 && !showing.boosted) this.showBoosts(outcome);
    this.afterSpin(outcome);
    // 건너뛴 뒤에는 기계를 바로 눌러 열을 잠글 수 있다.
    this.idleAt = 0;
    return true;
  }

  // ───────── 열 잠그기 ─────────

  /** 남은 잠그기를 적는 작은 표의 자리. 기계의 오른쪽 옆, 화면 가장자리와의 사이에 놓인다. */
  private get holdChipBox(): Box {
    const { machine } = this.layout;
    return { x: machine.x + machine.width + 3, y: machine.y + 4, width: 20, height: 34 };
  }

  /** 잠그기를 알리는 글이 뜨는 높이. 기계의 아래쪽 가장자리라서 그림과 길잡이를 거의 가리지 않는다. */
  private get holdNoteY(): number {
    return this.layout.machine.y + this.layout.machine.height - 3;
  }

  /** 잠근 열의 금테, 남은 잠그기를 적는 표, 열마다 누르는 자리를 놓는다. */
  private addHold(): void {
    const { machine, cell, gridLeft } = this.layout;
    const chip = this.holdChipBox;
    this.holdFx = this.add.graphics().setDepth(DEPTH.hold);
    this.holdChip = this.add.graphics().setDepth(DEPTH.panel);
    this.holdCount = addText(this, chip.x + chip.width / 2, chip.y + chip.height - 9, '', {
      originX: 0.5,
      originY: 0.5,
    }).setDepth(DEPTH.panel);
    addTapZone(
      this,
      chip.x - 3,
      chip.y - 3,
      chip.width + 6,
      chip.height + 6,
      () => undefined,
      () => this.explainHold(),
    );
    // 열마다 누르는 자리. 양 끝 열은 몸통의 테두리까지 넓힌다.
    for (let col = 0; col < SIZE; col += 1) {
      const left = col === 0 ? machine.x : gridLeft + col * cell;
      const right = col === SIZE - 1 ? machine.x + machine.width : gridLeft + (col + 1) * cell;
      // 부적의 설명이 떠 있을 때 누른 것은 설명을 치우는 것으로 끝낸다.
      let closing = false;
      addTapZone(
        this,
        left,
        machine.y,
        right - left,
        machine.height,
        (pressed) => {
          if (pressed) closing = this.bubble !== null;
        },
        () => {
          if (!closing) this.onColumnTap(col);
        },
      );
    }
  }

  /** 잠근 열의 금테, 남은 잠그기의 표, 돌리기 버튼의 글을 지금 상태대로 맞춘다. */
  private refreshHold(): void {
    const { run } = this;
    const { cell, gridLeft, gridTop } = this.layout;
    const able = canHold(run);
    // 잠글 수 없게 되면(잠그기를 썼거나 라운드가 끝났으면) 골라 둔 열도 풀린다.
    if (!able) this.holdCol = null;
    const col = this.heldNow ?? this.holdCol;
    this.holdFx.clear();
    if (col !== null) drawHoldFrame(this.holdFx, gridLeft + col * cell, gridTop, cell);

    // 표는 스핀을 돌리는 동안에만 보인다. 지금 잠글 수 있으면 금테를 두르고, 아니면 흐리게 둔다.
    const chip = this.holdChipBox;
    const shown = run.phase === 'spin';
    this.holdChip.clear().setVisible(shown);
    drawPanel(this.holdChip, chip.x, chip.y, chip.width, chip.height, {
      radius: 8,
      depth: 2,
      border: able ? LOOK.hold.frame : undefined,
    });
    drawLock(this.holdChip, chip.x + chip.width / 2, chip.y + 10, 5, able ? LOOK.hold.lock : LOOK.hold.off, THEME.card);
    this.holdCount
      .setVisible(shown)
      .setText(String(run.holdsLeft))
      .setColor(able ? LOOK.text.ink : LOOK.text.faint);

    const skippable = this.reel !== null || this.showing !== null;
    // 다음 스핀에 곱이 걸려 있으면(막판 한 방, 오뚝이) 돌리기 전에 버튼에 적어 둔다.
    this.spinButton.setLabel(spinLabel({ skippable, holding: this.holdCol !== null, times: nextSpinTimes(run) }));
  }

  /** 기계의 열을 눌렀을 때: 스핀을 보여 주는 중이면 건너뛰고, 기다리는 중이면 그 열을 잠그거나 푼다. */
  private onColumnTap(col: number): void {
    if (!this.playing || this.run.phase !== 'spin') return;
    if (this.busy) {
      this.skipSpin();
      return;
    }
    if (this.time.now - this.idleAt < HOLD_GRACE_MS) return;
    if (!canHold(this.run)) {
      this.explainHold();
      return;
    }
    // 고른 열을 다시 누르면 풀리고, 다른 열을 누르면 그 열로 옮겨 간다.
    const locked = this.holdCol !== col;
    this.holdCol = locked ? col : null;
    this.refreshHold();
    for (let row = 0; row < SIZE; row += 1) {
      const image = this.cells[row * SIZE + col];
      this.tweens.killTweensOf(image);
      image.setScale(this.cellScale);
      if (locked) {
        this.tweens.add({
          targets: image,
          scale: { from: this.cellScale * 1.12, to: this.cellScale },
          duration: 180,
          ease: 'Back.Out',
        });
      }
    }
    if (locked) {
      tone(392, 0.04, { volume: 0.3 });
      tone(784, 0.07, { type: 'triangle', volume: 0.35, delay: 0.04 });
    } else {
      tone(784, 0.07, { type: 'triangle', slideTo: 392, volume: 0.3 });
    }
    vibrate(8);
  }

  /** 지금 열을 잠글 수 있는지, 없으면 왜인지를 알린다. 처음의 도움말이 떠 있는 동안에는 말을 보태지 않는다. */
  private explainHold(): void {
    if (!this.playing || this.busy || this.run.phase !== 'spin' || this.hints.length > 0) return;
    if (canHold(this.run)) {
      this.holdNote(holdHowText(holdsOf(this.run), this.run.holdsLeft));
      return;
    }
    sfx.deny();
    this.holdNote(this.run.holdsLeft > 0 ? HOLD_NOTES.first : holdUsedText(holdsOf(this.run)));
  }

  /** 첫 라운드에서 열을 잠글 수 있게 된 첫 순간에 한 번, 잠그는 법을 알린다. */
  private tellHold(): void {
    if (this.holdTold || this.run.round > GUIDE_ROUNDS || !canHold(this.run)) return;
    this.holdTold = true;
    this.holdNote(holdHowText(holdsOf(this.run), this.run.holdsLeft), HOLD_TIP_MS);
  }

  private holdNote(label: string, ms = 1300): void {
    showBanner(this, this.holdNoteY, label, LOOK.text.points, ms, DEPTH.banner, FONT_SIZE.normal + 2);
  }

  /** 이번 스핀에서 도는 열들. 잠근 열은 빠진다. */
  private spinningCols(): number[] {
    return Array.from({ length: SIZE }, (_, col) => col).filter((col) => col !== this.heldNow);
  }

  /** 잠근 열의 세 칸은 돌지 않고 또렷하게 그대로 둔다. */
  private keepHeld(): void {
    const col = this.heldNow;
    if (col === null) return;
    for (let row = 0; row < SIZE; row += 1) this.cells[row * SIZE + col].setScale(this.cellScale).setAlpha(1);
    tone(523, 0.05, { type: 'triangle', volume: 0.3, delay: 0.03 });
  }

  // ───────── 축하 ─────────

  /** 전구를 지금 차례대로 그리고 차례를 넘긴다. */
  private blinkBulbs(): void {
    const { machine, cell } = this.layout;
    this.bulbs.clear();
    drawBulbs(this.bulbs, machine.x, machine.y, cell, MACHINE_FRAME, this.bulbPhase, this.bulbChase);
    // 번갈아 켤 때(둘)와 돌아가며 켤 때(셋)에 모두 맞게 여섯 차례로 돈다.
    this.bulbPhase = (this.bulbPhase + 1) % 6;
  }

  /** 전구가 깜빡이는 간격을 정한다. 움직임을 줄인 기기에서는 깜빡이지 않고 켜 둔 그대로 둔다. */
  private paceBulbs(ms: number, chase = false): void {
    this.bulbTimer?.remove();
    this.bulbTimer = null;
    this.bulbChase = chase;
    if (reducedMotion()) return;
    this.bulbTimer = this.time.addEvent({ delay: ms, loop: true, callback: () => this.blinkBulbs() });
  }

  /** 전구를 한동안 빠르게 깜빡이게 했다가 여느 빠르기로 돌린다. */
  private rushBulbs(ms: number, forMs: number, chase: boolean): void {
    // 크게 맞아 돌아가고 있는 전구를 작게 맞은 스핀이 끊지 않는다.
    if (reducedMotion() || (this.bulbChase && !chase)) return;
    this.bulbCalm?.remove();
    this.paceBulbs(ms, chase);
    this.blinkBulbs();
    this.bulbCalm = this.time.delayedCall(forMs, () => this.paceBulbs(BULB_MS));
  }

  /** 크게 축하할 스핀인지: 아홉 칸이 다 맞았거나, 진짜 7 셋이 한 줄에 놓였거나, 한 번에 많이 받았을 때 */
  private isBigWin(outcome: SpinOutcome): boolean {
    if (outcome.wins.length === 0) return false;
    if (outcome.jackpot || outcome.wins.some((win) => win.symbol === WILD)) return true;
    return outcome.total >= Math.max(BIG_WIN_MIN, targetFor(this.run, this.run.round) * BIG_WIN_RATIO);
  }

  /**
   * 맞은 스핀을 기계가 축하한다. 작게 맞으면 전구가 잠깐 빨라지고, 크게 맞으면 전구가 돌아가며 켜지고 금화가 솟고 종이 울린다.
   * 한 스핀에 한 번만 한다. 크게 맞은 스핀이면 true를 돌려준다.
   */
  private cheer(outcome: SpinOutcome): boolean {
    const big = this.isBigWin(outcome);
    const showing = this.showing;
    if (!showing || showing.cheered || outcome.wins.length === 0) return big;
    showing.cheered = true;
    if (!big) {
      this.rushBulbs(BULB_QUICK_MS, BULB_QUICK_FOR_MS, false);
      return false;
    }
    this.rushBulbs(BULB_PARTY_MS, BULB_PARTY_FOR_MS, true);
    // 종소리: 높은 두 음이 빠르게 번갈아 울리다가 한 음 올라가 맺는다. 줄과 곱의 소리가 지나간 뒤에 울린다.
    const bell = [1319, 1568, 1319, 1568, 1319, 1568, 2093];
    bell.forEach((note, index) =>
      tone(note, index === bell.length - 1 ? 0.32 : 0.08, { type: 'triangle', volume: 0.4, delay: 0.22 + index * 0.085 }),
    );
    vibrate([20, 40, 20, 40, 40]);
    this.burstCoins();
    // 움직임을 줄인 기기에서는 금화가 한 번만 솟는다.
    if (!reducedMotion()) {
      this.time.addEvent({ delay: PARTY_BURST_MS, repeat: PARTY_BURSTS - 2, callback: () => this.burstCoins() });
    }
    return true;
  }

  /** 기계 한가운데에서 금화가 솟았다가 떨어지고, 몸통의 테두리 어딘가에서 불꽃이 튄다. */
  private burstCoins(): void {
    const { machine } = this.layout;
    this.coins ??= this.add
      .particles(0, 0, coinTexture(this), {
        speedX: { min: -80, max: 80 },
        speedY: { min: -200, max: -90 },
        gravityY: 460,
        lifespan: { min: 700, max: 1000 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
        emitting: false,
      })
      .setDepth(DEPTH.effect);
    this.coins.explode(7, machine.x + machine.width / 2, this.machineMiddle);
    const side = Math.floor(Math.random() * 4);
    const along = Math.random();
    const x = side % 2 === 0 ? machine.x + along * machine.width : machine.x + (side === 1 ? machine.width : 0);
    const y = side % 2 === 1 ? machine.y + along * machine.height : machine.y + (side === 2 ? machine.height : 0);
    this.sparks.setParticleTint(THEME.gold);
    this.sparks.explode(8, x, y);
  }

  // ───────── 라운드 ─────────

  private settle(): void {
    if (!this.playing) return;
    const short = targetFor(this.run, this.run.round) - this.run.coin;
    const settlement = settleRound(this.run, randomOf(this.run, 'shop', Math.random));
    if (!settlement) return;
    this.run = settlement.run;
    if (!settlement.cleared) {
      this.endRun(`금화가 ${short}개 모자라요`);
      return;
    }
    this.keepRun();
    const { goal } = this.layout;
    showBanner(this, this.machineMiddle, '목표 달성!', LOOK.text.good, SHOP_DELAY_MS, DEPTH.banner, FONT_SIZE.large);
    sfx.coin();
    vibrate([15, 30, 15]);
    this.sparks.setParticleTint(THEME.mintDeep);
    this.sparks.explode(12, GAME_WIDTH / 2, this.machineMiddle);
    // 목표만큼 낸 것과 덤(저금통과 금화 항아리)을 따로 보여 준다.
    this.floatCoin(goal.x + goal.width / 2 - 24, goal.y + goal.height, -settlement.paid);
    const bonus = settlement.savings + settlement.interest;
    if (bonus > 0) {
      this.time.delayedCall(260, () => this.floatCoin(goal.x + goal.width / 2 + 24, goal.y + goal.height, bonus));
    }
    // 축하 글이 떠 있는 동안 가게의 미리 보기를 한 장씩 나눠 셈해 둔다. 셈한 것은 기억해 두므로, 느린 기기에서도
    // 가게가 열리는 프레임에 셈이 몰리지 않는다.
    (this.run.shop?.offers ?? []).forEach((id, index) => {
      if (id) this.time.delayedCall(PREVIEW_WARM_MS * (index + 1), () => offerChip(this.run.charms, id));
    });
    this.time.delayedCall(SHOP_DELAY_MS, () => this.openShop());
  }

  /** 판을 끝낸다. 목표를 채우지 못해 끝났을 때와 스스로 끝냈을 때 알리는 글이 다르다. */
  private endRun(notice: string): void {
    if (!this.playing) return;
    this.playing = false;
    this.busy = true;
    this.reel = null;
    this.hideHints();
    this.hideBubble();
    this.wrapUp();
    const pieces = this.payPieces();
    this.spinButton.setEnabled(false);
    this.rerollButton?.setEnabled(false);
    // 가게에서 끝내면 알림이 가게의 글 위에 겹치므로, 가게를 걷고 기계 위에 알린다.
    for (const view of this.shopViews) view.destroy();
    this.shopViews = [];
    this.shopFoot = null;
    this.offerRows = [];
    this.rerollButton = null;
    vibrate([20, 40, 20]);

    const banner = addText(this, GAME_WIDTH / 2, this.machineMiddle, notice, {
      size: 18,
      color: LOOK.text.bad,
      originX: 0.5,
      originY: 0.5,
      stroke: LOOK.text.outline,
      shadow: LOOK.text.shadow,
    }).setDepth(DEPTH.banner);
    this.tweens.add({ targets: banner, scale: { from: 0.7, to: 1 }, duration: 180, ease: 'Back.Out' });
    if (pieces.earned > 0) showPieceGain(this, GAME_WIDTH / 2, this.machineMiddle + 24, pieces.earned, DEPTH.banner);

    const { run } = this;
    const chips = run.charms.flatMap((id) => {
      const texture = charmChipTexture(this, id);
      return texture ? [{ texture, label: '' }] : [];
    });
    const strip: ResultStrip | undefined = chips.length > 0 ? { caption: '붙인 부적', chips } : undefined;
    const daily = this.recordDaily();
    this.finishMiniGame(
      scoreOf(run),
      [
        ...(daily?.stats ?? []),
        ['넘긴 라운드', `${clearedRounds(run)}번`],
        ['가장 큰 한 방', `금화 ${run.bestSpin}개`],
        [PERK_TEXT.piece, piecesVerdict(pieces.earned, pieces.total)],
      ],
      OVER_RESULT_MS,
      strip,
      daily?.share,
    );
  }

  /** 끝이 정해져 있지 않은 게임이라, 점수가 있으면 일시정지 화면에서 기록하고 끝낼 수 있다. */
  protected override canFinishEarly(): boolean {
    return this.playing && scoreOf(this.run) > 0;
  }

  protected override finishEarly(): void {
    // 돌고 있던 스핀은 결과까지 보여 주고 끝낸다.
    this.skipSpin();
    this.endRun('여기까지!');
  }

  /**
   * 하던 판은 저장되어 있어서 그만두어도 잃는 것이 없다. 그래도 한 번 더 물으면서, 다음에 이어 할 수 있다는 것을 알리고
   * 여기서 점수를 기록하고 끝낼 길도 함께 보여 준다.
   */
  protected override quitWarning(): string | null {
    return this.playing && store.data.slot.run !== null ? RESUME_TEXT.quit : null;
  }

  /** 하던 판이 남아 있으면 "처음부터 다시"는 판을 버리지 않고 시작 화면으로 가서, 이어 할지 새로 할지 묻게 된다. */
  protected override restartLabel(): string | null {
    return store.data.slot.run !== null ? RESUME_TEXT.restart : null;
  }

  /** 도감이 열려 있으면 뒤로 가기로는 도감만 닫는다. */
  override onBackRequest(): void {
    if (this.book) this.closeBook();
    else if (this.perkPanel) this.closePerks();
    else super.onBackRequest();
  }

  // ───────── 가게 ─────────

  private openShop(): void {
    if (!this.playing || this.run.phase !== 'shop') return;
    const { shop, button } = this.layout;
    this.clearWins();
    this.hideHints(true);
    this.busy = false;
    this.shopGuardUntil = this.time.now + SHOP_GUARD_MS;
    this.spinButton.setVisible(false);
    this.refreshNumbers();

    const panel = this.add.graphics().setDepth(DEPTH.shop);
    drawPanel(panel, shop.x, shop.y, shop.width, shop.height, { radius: 14 });
    // 가게 창을 누른 것이 그 밑으로 새지 않게 한다.
    const blocker = this.add
      .zone(shop.x, shop.y, shop.width, shop.height)
      .setOrigin(0, 0)
      .setInteractive()
      .setDepth(DEPTH.shop);
    const title = addText(this, shop.x + 12, shop.y + 6, '부적 가게', { color: LOOK.text.ink }).setDepth(DEPTH.shop);
    const guide = addText(this, shop.x + shop.width - 12, shop.y + 8, '눌러서 사요', {
      size: FONT_SIZE.small,
      color: LOOK.text.sub,
      originX: 1,
    }).setDepth(DEPTH.shop);
    this.shopViews.push(panel, blocker, title, guide);
    this.addShopBook(title, guide);

    // 창에 남는 자리가 있으면 먼저 맨 아래에 한 줄 안내를 적을 자리를 떼고, 그래도 남으면 줄을 조금 키운다.
    const spare = shop.height - SHOP_HEAD - OFFERS * SHOP_ROW - 4;
    const foot = spare >= SHOP_FOOT_MIN ? SHOP_FOOT_MIN : 0;
    const pitch = SHOP_ROW + Phaser.Math.Clamp(Math.floor((spare - foot) / OFFERS), 0, SHOP_ROW_GROW);
    const top = shop.y + SHOP_HEAD;
    this.offerRows = [];
    for (let offer = 0; offer < OFFERS; offer += 1) {
      this.offerRows.push(
        this.addOfferRow(offer, { x: shop.x + 6, y: top + offer * pitch, width: shop.width - 12, height: pitch - 4 }),
      );
    }
    const rowsBottom = top + OFFERS * pitch;
    const footRoom = shop.y + shop.height - rowsBottom;
    this.shopFoot = null;
    if (footRoom >= SHOP_FOOT_MIN) {
      this.shopFoot = addText(this, shop.x + shop.width / 2, rowsBottom + (footRoom - 4) / 2, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.faint,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.shop);
      this.shopViews.push(this.shopFoot);
    }

    const gap = 8;
    const half = (button.width - gap) / 2;
    this.rerollButton = new SoftButton(
      this,
      { ...button, width: half },
      'plain',
      DEPTH.panel,
      '다시 뽑기',
      () => this.tryReroll(),
    );
    const next = new SoftButton(
      this,
      { ...button, x: button.x + half + gap, width: half },
      'gold',
      DEPTH.panel,
      '다음 라운드',
      () => this.closeShop(),
    );
    this.shopViews.push(this.rerollButton, next);
    this.refreshShop();
    sfx.pop();
  }

  private addOfferRow(offer: number, box: Box): OfferRow {
    const depth = DEPTH.shop;
    const middle = box.y + box.height / 2;
    const textLeft = box.x + CHARM_BOX + 10;
    const pill = { width: 40, height: 22 };
    const row: OfferRow = {
      box,
      back: this.add.graphics().setDepth(depth),
      icon: this.add.image(box.x + 5 + CHARM_BOX / 2, middle, emptySlotTexture(this)).setDepth(depth),
      name: addText(this, textLeft, middle - 15, '', { color: LOOK.text.ink }).setDepth(depth),
      description: addText(this, textLeft, middle + 2, '', { size: FONT_SIZE.small, color: LOOK.text.sub }).setDepth(
        depth,
      ),
      priceBack: this.add.graphics().setDepth(depth),
      coin: this.add
        .image(box.x + box.width - pill.width - 5 + 4 + COIN_ICON.width / 2, middle, coinTexture(this))
        .setDepth(depth),
      price: addText(this, box.x + box.width - 5 - 6, middle, '', { originX: 1, originY: 0.5 }).setDepth(depth),
      pressed: false,
    };
    const zone = addTapZone(
      this,
      box.x,
      box.y,
      box.width,
      box.height,
      (pressed) => {
        row.pressed = pressed;
        this.drawOfferRow(offer);
      },
      () => this.tryBuy(offer),
    ).setDepth(depth);
    this.shopViews.push(row.back, row.icon, row.name, row.description, row.priceBack, row.coin, row.price, zone);
    return row;
  }

  /** 가게의 부적 한 줄을 지금 상태대로 그린다: 팔렸는지, 살 수 있는지, 눌려 있는지. */
  private drawOfferRow(offer: number): void {
    const row = this.offerRows[offer];
    if (!row) return;
    const { box } = row;
    const id = this.run.shop?.offers[offer] ?? null;
    const charm = id ? charmOf(id) : undefined;
    const block = buyBlock(this.run, offer);
    const middle = box.y + box.height / 2;

    row.back.clear();
    row.back.fillStyle(row.pressed && charm ? THEME.dim : THEME.bg, 1);
    row.back.fillRoundedRect(box.x, box.y, box.width, box.height, 10);
    row.priceBack.clear();

    const sold = !charm;
    for (const part of [row.icon, row.description, row.coin, row.price]) part.setVisible(!sold);
    if (!charm) {
      row.name.setText('붙였어요').setColor(LOOK.text.faint).setY(Math.round(middle - row.name.height / 2));
      return;
    }
    row.icon.setTexture(charmTexture(this, charm.id));
    row.name.setText(charm.name).setColor(LOOK.text.ink).setY(Math.round(middle - 15));
    row.description.setText(charm.description);
    // 좁은 줄에서 설명이 값에 닿지 않게, 넘치면 그만큼 줄인다.
    const room = box.x + box.width - 50 - row.description.x;
    row.description.setScale(Math.min(1, room / Math.max(1, row.description.width / row.description.scaleX)));

    const pill = { x: box.x + box.width - 45, y: middle - 11, width: 40, height: 22 };
    const afford = block !== 'coin';
    row.priceBack.fillStyle(afford ? THEME.butter : THEME.dim, 1);
    row.priceBack.fillRoundedRect(pill.x, pill.y, pill.width, pill.height, 11);
    row.price.setText(String(charm.price)).setColor(afford ? LOOK.text.ink : LOOK.text.bad);
    row.coin.setAlpha(afford ? 1 : 0.5);
  }

  private refreshShop(): void {
    for (let offer = 0; offer < OFFERS; offer += 1) this.drawOfferRow(offer);
    this.refreshOfferChips();
    this.refreshReadyMarks();
    this.refreshShopFoot();
    const cost = this.run.shop?.rerollCost ?? 0;
    // 공짜일 때는 금화 0개라고 적는 대신 공짜라고 적는다.
    this.rerollButton
      ?.setLabel(rerollLabel(cost))
      .setPrice(cost === 0 ? null : cost)
      .setEnabled(this.run.coin >= cost);
  }

  private tryBuy(offer: number): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop') return;
    this.hideBubble();
    const block = buyBlock(this.run, offer);
    if (block === 'sold' || block === 'closed') return;
    if (block !== null) {
      sfx.deny();
      const y = this.layout.slots[0].y - 14;
      if (block === 'full') this.note('자리가 없어요. 부적을 눌러 떼요', LOOK.text.bad, y);
      else this.note('금화가 모자라요', LOOK.text.bad, y);
      return;
    }
    this.run = buy(this.run, offer);
    this.keepRun(this.run.charms[this.run.charms.length - 1]);
    sfx.coin();
    vibrate(12);
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(true);
    this.refreshShop();
    // 방금 붙인 부적이 제자리에서 톡 튄다.
    const image = this.slotImages[this.run.charms.length - 1];
    this.tweens.add({ targets: image, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  /**
   * 가게가 막 열렸는가. 돌리기를 잇달아 누르던 손이 같은 자리에 놓인 "다시 뽑기"나
   * "다음 라운드"에 그대로 닿으므로, 열리고 잠깐은 아래 두 버튼의 누름을 받지 않는다.
   */
  private shopGuarded(): boolean {
    return this.time.now < this.shopGuardUntil;
  }

  private tryReroll(): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop' || this.shopGuarded()) return;
    this.hideBubble();
    const next = reroll(this.run, randomOf(this.run, 'shop', Math.random));
    if (next === this.run) {
      sfx.deny();
      return;
    }
    this.run = next;
    this.keepRun();
    sfx.flip();
    this.refreshNumbers();
    this.refreshShop();
    for (const row of this.offerRows) {
      if (!row) continue;
      this.tweens.add({ targets: row.icon, scale: { from: 0.4, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
  }

  private closeShop(): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop' || this.shopGuarded()) return;
    this.hideBubble();
    for (const view of this.shopViews) view.destroy();
    this.shopViews = [];
    this.shopFoot = null;
    this.offerRows = [];
    this.rerollButton = null;
    this.run = nextRound(this.run);
    this.keepRun();
    this.refreshReadyMarks();
    this.spinButton.setVisible(true).setEnabled(true);
    this.refreshNumbers();
    showBanner(this, this.machineMiddle, `라운드 ${this.run.round}`, LOOK.text.good, 700, DEPTH.banner, FONT_SIZE.large);
    sfx.go();
  }

  // ───────── 오늘의 판 ─────────

  /** 씬을 열 때마다 create보다 먼저 불린다. 넘겨받은 것을 적어 두고, 지난번에 만들어 둔 것은 잊는다. */
  init(data?: SlotStart): void {
    this.dailyStart = data ?? {};
    this.dailySwitch = null;
    this.dailyNote = null;
    this.rankPill = null;
    this.dailyBadge = null;
    this.sharedDayPassed = false;
    this.friendScore = null;
  }

  /** 지금 판이 오늘의 판이면 그 날(daily.ts의 dayIndexOf). 여느 판이면 null. */
  private get dailyDay(): number | null {
    return dailyDayOf(this.run.seed);
  }

  /** 여느 판과 오늘의 판을 바꿀 수 있는지: 아직 한 번도 돌리지 않은 판에서만 바꾼다. */
  private canSwitchMode(): boolean {
    const { run } = this;
    return !this.busy && run.phase === 'spin' && run.round === 1 && run.spinCount === 0;
  }

  /**
   * 판을 열 때 한 번 부른다. 오늘의 판으로 열어 달라고 했으면("다시 하기"나 공유받은 주소) 오늘의 판으로 바꾸고,
   * 시작 화면에 판을 바꾸는 버튼을 놓고, 기기에 저장해 둔 오늘의 기록을 읽어 온다.
   */
  private setUpDaily(): void {
    const start = this.dailyStart;
    const today = dayIndexOf(new Date());
    const shared = start.sharedDay !== undefined;
    if ((start.daily === true || shared) && this.dailyDay === null && this.canSwitchMode()) {
      this.run = newRun(dailySeed(today));
      this.refreshNumbers();
    }
    // 지난 날의 판은 다시 할 수 없어서 오늘의 판을 열고 그렇다고 알린다. 오늘의 것이면 친구의 점수를 넘어 볼 기록으로 보인다.
    this.sharedDayPassed = shared && start.sharedDay !== today;
    this.friendScore = friendScoreOf(start.sharedDay, start.sharedScore, today);
    this.showDailySwitch();

    let alive = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      alive = false;
    });
    void slotDailyStore.refresh().then(() => {
      if (alive) this.refreshDailyNote();
    });
  }

  /**
   * 시작 화면의 도움말 카드 바로 위에 판을 바꾸는 버튼을 놓는다. 여느 판에서는 오늘의 판으로,
   * 오늘의 판에서는 여느 판으로 돌아가는 버튼이고, 오늘의 판이면 그 위에 오늘의 기록을 한 줄 적는다.
   */
  private showDailySwitch(): void {
    this.hideDailySwitch();
    if (this.hints.length === 0 || !this.canSwitchMode()) return;
    const daily = this.dailyDay !== null;
    const { width, height, gap } = DAILY_SWITCH;
    // 도움말 카드의 위쪽 끝은 기계의 한가운데에서 23만큼 위다(showHints).
    const box = {
      x: Math.round(GAME_WIDTH / 2 - width / 2) - (daily ? RANK_PILL.shift : 0),
      y: Math.round(this.machineMiddle - 23 - gap - height),
      width,
      height,
    };
    const label = daily ? DAILY_LABEL.back : DAILY_LABEL.name;
    this.dailySwitch = new SoftButton(this, box, daily ? 'plain' : 'mint', DEPTH.hint, label, () => this.switchMode());
    if (!daily) return;
    const middle = box.y - DAILY_INFO.gap - DAILY_INFO.height / 2;
    this.dailyNote = {
      back: this.add.graphics().setDepth(DEPTH.hint),
      text: addText(this, GAME_WIDTH / 2, middle, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.ink,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.hint + 0.5),
    };
    this.refreshDailyNote();
    this.showRankPill(box);
  }

  /** 판을 바꾸는 버튼과 그 위의 한 줄을 치운다. 첫 스핀을 돌리면 도움말과 함께 사라진다. */
  private hideDailySwitch(): void {
    this.dailySwitch?.destroy();
    this.dailySwitch = null;
    this.dailyNote?.back.destroy();
    this.dailyNote?.text.destroy();
    this.dailyNote = null;
    this.hideRankPill();
  }

  /** 버튼 위의 한 줄을 지금의 기록대로 적는다: 지난 날의 주소로 왔다는 것, 넘어 볼 친구 기록, 아니면 오늘의 최고 기록. */
  private refreshDailyNote(): void {
    const note = this.dailyNote;
    if (!note) return;
    const today = dayIndexOf(new Date());
    const record = dailyToday(slotDailyStore.data, today);
    const friend = this.friendScore;
    const line = this.sharedDayPassed
      ? SHARED_DAY_PASSED
      : friend !== null && !(record.tries > 0 && record.best > friend)
        ? friendNotice(friend)
        : dailyInfo(record, today);
    // 화면보다 넓은 줄은 그만큼 줄인다.
    note.text.setScale(1).setText(line);
    note.text.setScale(Math.min(1, (GAME_WIDTH - 40) / note.text.width));
    const width = Math.ceil(note.text.displayWidth) + 16;
    const { height } = DAILY_INFO;
    const x = Math.round(GAME_WIDTH / 2 - width / 2);
    const y = Math.round(note.text.y - height / 2);
    note.back.clear();
    note.back.fillStyle(LOOK.machine.trimLip, 1);
    note.back.fillRoundedRect(x, y + 1, width, height, height / 2);
    note.back.fillStyle(LOOK.machine.slotAlt, 1);
    note.back.fillRoundedRect(x, y, width, height, height / 2);
  }

  /** 여느 판과 오늘의 판을 바꾼다. 아직 돌리지 않은 판이라 새 판으로 갈아 끼우기만 하면 된다. */
  private switchMode(): void {
    if (!this.playing || !this.canSwitchMode()) return;
    this.run = this.dailyDay === null ? newRun(dailySeed(dayIndexOf(new Date()))) : this.freshRun();
    this.refreshNumbers();
    this.showDailySwitch();
    // 오늘의 판으로 바꿨으면 점수 아래의 표시가 스르르 나타나 어디가 달라졌는지 알린다.
    const badge = this.dailyBadge;
    if (this.dailyDay === null || !badge) return;
    this.tweens.killTweensOf([badge.back, badge.text]);
    this.tweens.add({ targets: [badge.back, badge.text], alpha: { from: 0, to: 1 }, duration: 220 });
  }

  /** 오늘의 판을 하는 동안 점수 아래에 작은 표시를 띄워 둔다. 여느 판이면 감춘다. */
  private refreshDailyBadge(): void {
    // 날이 넘어간 뒤까지 이어 온 판은 그날의 기록에 남지 않으므로(recordDaily) 표시도 띄우지 않는다.
    const daily = this.dailyDay !== null && this.dailyDay === dayIndexOf(new Date());
    if (!this.dailyBadge) {
      if (!daily) return;
      const { y, height } = DAILY_BADGE;
      const text = addText(this, GAME_WIDTH / 2, y, DAILY_LABEL.name, {
        size: FONT_SIZE.small,
        color: LOOK.text.ink,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(DEPTH.hud);
      const width = Math.ceil(text.width) + 14;
      const left = Math.round(GAME_WIDTH / 2 - width / 2);
      const back = this.add.graphics().setDepth(DEPTH.hud - 0.5);
      back.fillStyle(LOOK.machine.trimLip, 1);
      back.fillRoundedRect(left, y - height / 2 + 2, width, height, height / 2);
      back.fillStyle(LOOK.machine.trim, 1);
      back.fillRoundedRect(left, y - height / 2, width, height, height / 2);
      this.dailyBadge = { back, text };
    }
    this.dailyBadge.back.setVisible(daily);
    this.dailyBadge.text.setVisible(daily);
  }

  /**
   * 끝난 판이 오늘의 판이면 그날의 기록에 보태고, 결과 화면에 적을 줄과 공유할 것을 돌려준다. 여느 판이면 null.
   * 오늘 시작한 오늘의 판만 그날의 기록에 남는다. 날이 넘어간 뒤에 끝낸 판은 그날의 기록에도, 최고 기록에도 남지 않는다(offRecordNote).
   */
  private recordDaily(): { stats: ResultStat[]; share: ShareOverride } | null {
    const today = dayIndexOf(new Date());
    if (this.dailyDay !== today) return null;
    const result = { score: scoreOf(this.run), rounds: clearedRounds(this.run) };
    const outcome = addDailyRun(slotDailyStore.data, today, result);
    slotDailyStore.set(outcome.record);
    this.noteDailyScore(result.score);
    const stats: ResultStat[] = [[DAILY_LABEL.name, dailyVerdict(outcome)]];
    if (this.friendScore !== null) stats.push([DAILY_LABEL.friend, friendVerdict(this.friendScore, result.score)]);
    return { stats, share: dailyShare(today, result, outcome.record.streak) };
  }

  /**
   * 운이 정해진 판(오늘의 판)은 최고 기록과 랭킹에 넣지 않는다. 같은 운으로 몇 번이든 다시 할 수 있어서 여느 판과 견줄 수 없다.
   * 두었다가 날이 넘어간 뒤에 마친 판도 운을 아는 판이기는 마찬가지라 넣지 않는다.
   */
  protected override offRecordNote(): string | null {
    const day = this.dailyDay;
    if (day === null) return null;
    return day === dayIndexOf(new Date()) ? DAILY_OFF_RECORD.today : DAILY_OFF_RECORD.past;
  }

  /** 오늘의 판을 마쳤으면 결과 화면의 "다시 하기"가 오늘의 판을 다시 연다. 넘어 볼 친구 기록도 이어서 넘긴다. */
  protected override retryData(): SlotStart | undefined {
    const day = this.dailyDay;
    if (day === null) return undefined;
    if (this.friendScore === null) return { daily: true };
    return { daily: true, sharedDay: day, sharedScore: this.friendScore };
  }

  // ───────── 오늘의 판 랭킹 ─────────

  /**
   * 방금 마친 오늘의 판의 점수를 그날의 랭킹에 올릴 기록으로 적어 둔다(닉네임을 정하기 전이어도 적어 둔다).
   * 오늘의 판은 최고 기록과 전체 랭킹에 들지 않아서(offRecordNote) 판을 마칠 때의 올리기가 없다. 그래서 여기서 바로 올린다.
   * 인터넷이 없으면 다음에 올라간다.
   * 어느 날의 랭킹인지는 판의 씨앗에 적힌 날에서 읽는다. 오늘의 판이 아니거나 그 날이 오늘이 아니면 적지 않는다.
   */
  private noteDailyScore(score: number): void {
    const day = boardDayOf(this.run.seed, Date.now());
    if (day === null) return;
    noteDayScore(this.gameId, score, day);
    void syncScores();
  }

  /** 시작 화면에서 오늘의 판을 골랐을 때, 판을 바꾸는 버튼(beside)의 오른쪽에 랭킹 버튼을 놓는다. */
  private showRankPill(beside: Box): void {
    this.hideRankPill();
    const { gap, width, height } = RANK_PILL;
    const box = { x: beside.x + beside.width + gap, y: beside.y, width, height };
    this.rankPill = addRankPill(this, box, DEPTH.hint, () => this.openRank());
  }

  /** 랭킹 버튼을 치운다. 판을 바꾸는 버튼과 함께 사라진다. */
  private hideRankPill(): void {
    this.rankPill?.destroy();
    this.rankPill = null;
  }

  /**
   * 오늘의 판 랭킹 창을 연다. 도감과 같은 자리(this.book)에 둔다: 창은 한 번에 하나만 뜨고,
   * 뒤로 가기로 닫히는 것과 판이 끝날 때 닫히는 것, 떠 있는 동안 키보드로 돌리지 못하는 것이 도감과 같다(closeBook).
   */
  private openRank(): void {
    if (this.book || this.perkPanel || this.ended) return;
    this.hideBubble();
    const view = openRankView(this, {
      depth: BOOK_DEPTH,
      today: dayIndexOf(new Date()),
      button: (box, tone, label, onTap) => new SoftButton(this, box, tone, BOOK_DEPTH, label, onTap),
      onClose: () => this.closeBook(),
    });
    this.book = [view];
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    sfx.pop();
  }

  // ───────── 붙인 부적 ─────────

  private onSlotTap(slot: number): void {
    if (!this.playing) return;
    const id = this.run.charms[slot];
    const charm = id ? charmOf(id) : undefined;
    if (!charm) {
      this.hideBubble();
      return;
    }
    sfx.click();
    this.showBubble(slot, charm.name, charm.description);
  }

  /**
   * 붙인 부적의 이름과 설명을 그 위에 띄운다. 강화한 부적은 이름 옆에 단계만큼 별이 붙는다.
   * 가게에서는 떼는 버튼(돌려받는 금화가 적힌다)과 강화 칸(강화하면 바뀌는 설명, 값, 버튼)이 같이 뜬다.
   */
  private showBubble(slot: number, name: string, description: string): void {
    this.hideBubble();
    const { slots, slotSize } = this.layout;
    const shop = this.busy ? null : bubbleShop(this.run, slot);
    const place = bubbleLayout(bubbleKindOf(shop), slots[0].y, GAME_WIDTH);
    const { box } = place;
    const depth = DEPTH.bubble;

    const back = this.add.graphics().setDepth(depth);
    drawPanel(back, box.x, box.y, box.width, box.height, { radius: 10, border: LOOK.machine.trim });
    // 어느 부적의 설명인지 가리키는 꼬리
    // 자리가 여섯이면 양 끝의 부적이 창의 둥근 모서리 밑에 온다. 꼬리가 모서리에서 떨어지지 않게 안쪽으로 당긴다.
    const tipX = Phaser.Math.Clamp(slots[slot].x + slotSize / 2, box.x + 16, box.x + box.width - 16);
    back.fillStyle(LOOK.machine.trim, 1);
    back.fillTriangle(tipX - 6, box.y + box.height - 1, tipX + 6, box.y + box.height - 1, tipX, box.y + box.height + 6);
    const title = addText(this, place.title.x, place.title.y, name, { color: LOOK.text.ink }).setDepth(depth);
    const small = (at: { x: number; y: number }, label: string, color: string): Text => {
      const text = addText(this, at.x, at.y, label, { size: FONT_SIZE.small, color }).setDepth(depth);
      // 버튼 옆의 좁은 자리에서 넘치면 그만큼 줄인다.
      return text.setScale(Math.min(1, place.textWidth / Math.max(1, text.width)));
    };
    const views: Disposable[] = [back, title, small(place.body, description, LOOK.text.sub)];
    for (let mark = 0; mark < upgradeMarks(this.run.charms[slot]); mark += 1) {
      const markX = title.x + Math.ceil(title.width) + 2 + UPGRADE_MARK_BOX / 2 + mark * (UPGRADE_MARK_BOX - 2);
      views.push(this.add.image(markX, title.y + title.height / 2, upgradeMarkTexture(this)).setDepth(depth));
    }
    const zones: Phaser.GameObjects.GameObject[] = [];
    if (shop && place.shop) {
      const offer = shop.upgrade;
      const remove = new SoftButton(this, place.shop.remove, 'coral', depth, BUBBLE_TEXT.remove, () => this.discardSlot(slot));
      if (shop.refund > 0) remove.setPrice(shop.refund, REFUND_SIGN);
      back.fillStyle(THEME.shadow, 1);
      back.fillRect(box.x + 8, place.shop.rule, box.width - 16, 1);
      const leadColor = offer.tight ? LOOK.text.bad : { ready: LOOK.text.points, poor: LOOK.text.bad, done: LOOK.text.faint }[offer.state];
      const lead = small(place.shop.lead, offer.lead, leadColor);
      views.push(remove, lead);
      zones.push(remove.zone);
      if (place.upgrade && offer.description !== null && offer.cost !== null) {
        const button = new SoftButton(this, place.upgrade.button, 'gold', depth, BUBBLE_TEXT.upgrade, () =>
          this.upgradeSlot(slot),
        );
        button.setPrice(offer.cost).setEnabled(offer.state === 'ready');
        views.push(button, small(place.upgrade.body, offer.description, LOOK.text.sub));
        zones.push(button.zone);
        if (offer.chip) {
          const left = lead.x + Math.ceil(lead.displayWidth) + 4;
          views.push(...this.addChip(offer.chip, left, place.title.x + place.textWidth, lead.y + lead.height / 2, 'left', depth));
        }
      }
      // 설명의 창이나 그 안의 버튼을 누른 것으로는 창을 닫지 않는다. 닫히면 버튼이 손을 떼기 전에 사라져 눌리지 않는다.
      const area = this.add.zone(box.x, box.y, box.width, box.height).setOrigin(0, 0).setInteractive().setDepth(depth - 1);
      views.push(area);
      zones.push(area);
    }
    this.bubble = { views, zones };
  }

  // ───────── 강화와 미리 보기 ─────────

  /** 가게의 줄마다 놓인, 사면 벌이(한 라운드에 받을 금화의 기댓값)가 어떻게 바뀌는지의 미리 보기 표. 가게를 열 때마다 새로 만든다. */
  private offerChips: Array<{ back: Graphics; text: Text } | undefined> = [];

  /**
   * 붙여 둔 slot번째 부적을 금화를 내고 강화한다. 부적이 제자리에서 튀며 별이 붙고, 설명 창은 강화한 설명으로 바뀐다.
   * 판은 부적을 샀을 때처럼 바로 저장한다.
   */
  private upgradeSlot(slot: number): void {
    if (!this.playing || this.busy || this.run.phase !== 'shop') return;
    const next = upgrade(this.run, slot);
    if (next === this.run) {
      sfx.deny();
      return;
    }
    this.run = next;
    const id = next.charms[slot];
    this.keepRun(id);
    sfx.gold();
    vibrate([10, 20, 10]);
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(true);
    this.refreshShop();
    this.bumpCoin(false);
    const image = this.slotImages[slot];
    this.tweens.killTweensOf(image);
    this.tweens.add({ targets: image, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
    // 움직임을 줄인 기기에서는 불꽃을 튀기지 않는다.
    if (!reducedMotion()) {
      this.sparks.setParticleTint(THEME.gold);
      this.sparks.explode(10, image.x, image.y);
    }
    const charm = charmOf(id);
    if (charm) this.showBubble(slot, charm.name, charm.description);
  }

  /** 금화의 수가 바뀐 것을 알린다: 목표 카드의 수가 톡 튀며, 늘었으면 초록으로 줄었으면 빨강으로 잠깐 물든다. */
  private bumpCoin(gained: boolean): void {
    const text = this.goalText;
    text.setColor(gained ? LOOK.text.good : LOOK.text.bad);
    this.tweens.killTweensOf(text);
    this.tweens.add({
      targets: text,
      scale: { from: 1.4, to: 1 },
      duration: 320,
      ease: 'Back.Out',
      onComplete: () => text.setColor(LOOK.text.ink),
    });
  }

  /**
   * 벌이가 어떻게 바뀌는지를 적은 작은 표를 놓는다. left와 right 사이에, middle을 한가운데 높이로 놓는다.
   * 오르면 초록, 내리면 빨강, 그대로면 흐린 빛깔이다. 놓은 것(바탕과 글)을 돌려준다.
   */
  private addChip(
    chip: PreviewChip,
    left: number,
    right: number,
    middle: number,
    align: 'left' | 'right',
    depth: number,
  ): [Graphics, Text] {
    const back = this.add.graphics().setDepth(depth);
    const text = addText(this, 0, 0, '', { size: FONT_SIZE.small, originY: 0.5 }).setDepth(depth);
    this.drawChip(back, text, chip, left, right, middle, align);
    return [back, text];
  }

  private drawChip(
    back: Graphics,
    text: Text,
    chip: PreviewChip,
    left: number,
    right: number,
    middle: number,
    align: 'left' | 'right',
  ): void {
    const tones: Record<ChipTone, { fill: number; ink: string }> = {
      good: { fill: THEME.mintSoft, ink: LOOK.text.good },
      bad: { fill: THEME.pinkSoft, ink: LOOK.text.bad },
      same: { fill: THEME.dim, ink: LOOK.text.sub },
    };
    const tone = tones[chip.tone];
    text.setScale(1).setText(chip.text).setColor(tone.ink).setVisible(true);
    const place = chipPlace(left, right, middle, text.width, align);
    text.setScale(place.scale).setPosition(Math.round(place.textX), Math.round(middle));
    back.clear();
    back.fillStyle(tone.fill, 1);
    back.fillRoundedRect(place.back.x, place.back.y, place.back.width, place.back.height, CHIP.height / 2);
  }

  /**
   * 가게에 나온 부적마다, 사서 붙이면 벌이(한 라운드에 받을 금화의 기댓값)가 지금 붙인 부적과 견주어 얼마나 바뀌는지를
   * 이름 옆의 작은 표에 적는다. 서로 다른 그림을 늘리는 부적을 겹치면 도로 줄기도 하는데, 사기 전에는 알 길이 없었다.
   * 저금통처럼 벌이로 셈할 수 없는 부적이나 팔린 줄의 표는 감춘다.
   */
  private refreshOfferChips(): void {
    this.offerRows.forEach((row, offer) => {
      if (!row) return;
      let views = this.offerChips[offer];
      // 지난 가게의 표는 가게와 함께 치워졌다.
      if (!views?.text.active) {
        views = {
          back: this.add.graphics().setDepth(DEPTH.shop),
          text: addText(this, 0, 0, '', { size: FONT_SIZE.small, originY: 0.5 }).setDepth(DEPTH.shop),
        };
        this.offerChips[offer] = views;
        this.shopViews.push(views.back, views.text);
      }
      const id = this.run.shop?.offers[offer] ?? null;
      const chip = id ? offerChip(this.run.charms, id) : null;
      if (!chip) {
        // 빈 글자도 상자는 남으므로 감춘다.
        views.back.clear();
        views.text.setText('').setVisible(false);
        return;
      }
      const { box } = row;
      const left = row.name.x + Math.ceil(row.name.width) + 4;
      const right = box.x + box.width - OFFER_PILL_INSET - 4;
      this.drawChip(views.back, views.text, chip, left, right, row.name.y + row.name.height / 2, 'right');
    });
  }

  private hideBubble(): void {
    if (!this.bubble) return;
    for (const view of this.bubble.views) view.destroy();
    this.bubble = null;
  }

  private discardSlot(slot: number): void {
    if (!this.playing || this.run.phase !== 'shop') return;
    const next = discard(this.run, slot);
    this.hideBubble();
    if (next === this.run) return;
    // 돌려받은 금화가 있으면 금화의 수가 튀어서 알린다.
    const refunded = next.coin > this.run.coin;
    this.run = next;
    this.keepRun();
    sfx.pull();
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(true);
    this.refreshShop();
    if (refunded) this.bumpCoin(true);
  }

  // ───────── 이어 하기 ─────────

  /** 씬을 다시 열 때 이어 하기와 도감에 딸린 것들을 처음 상태로 돌린다. 놓여 있던 것은 씬이 닫힐 때 이미 치워졌다. */
  private resetSaveViews(): void {
    this.resumeViews = [];
    this.startBook = null;
    this.shopBook = null;
    this.book = null;
    this.ended = false;
    this.resetPerkViews();
    // 도감을 연 채로 씬이 닫혔으면 키보드가 꺼진 채로 남아 있다.
    if (this.input.keyboard) this.input.keyboard.enabled = true;
  }

  /**
   * 지금 판을 세이브에 적는다. 판이 바뀔 때마다(스핀의 결과가 판에 들어간 바로 뒤, 라운드를 맺은 뒤, 가게에서 사고 떼고
   * 다시 뽑고 닫은 뒤) 불러서, 언제 앱이 꺼져도 그 자리에서 이어 할 수 있게 한다.
   * 아직 한 번도 돌리지 않은 판은 남기지 않는다. found를 주면 그 부적을 도감에도 넣는다.
   */
  private keepRun(found?: string): void {
    const before = store.data.slot;
    const slot = withRun(found ? withFound(before, found) : before, this.run);
    const isNew = slot.found !== before.found;
    // 적을 판도 지울 판도 없고 도감도 그대로면 저장할 것이 없다.
    if (slot.run === null && before.run === null && !isNew) return;
    store.update((save) => void (save.slot = slot));
    if (isNew) this.shopBook?.refresh(true);
  }

  /** 세이브에 남은 하던 판을 지운다(판이 끝났거나 새 판을 하기로 했다). */
  private dropRun(): void {
    if (store.data.slot.run === null) return;
    store.update((save) => void (save.slot = withRun(save.slot, null)));
  }

  /** 판이 끝났을 때: 도감을 닫고 다시 열리지 않게 하며, 세이브에 남은 하던 판을 지운다. */
  private wrapUp(): void {
    this.ended = true;
    this.closeBook();
    this.closePerks();
    this.dropRun();
  }

  /**
   * 두고 간 판이 있으면 처음의 도움말 대신 이어 할지 묻는 카드를 띄운다. 고를 때까지는 판이 시작되지 않은 것으로 둬서
   * 돌리기를 받지 않는다. 두고 간 판이 없으면 아무 일도 하지 않는다.
   */
  private offerResume(): void {
    const saved = savedRunOf(store.data.slot);
    if (!saved) return;
    this.playing = false;
    this.spinButton.setEnabled(false);
    this.hideHints(true);
    this.hideGuide();

    const box = {
      x: Math.round((GAME_WIDTH - RESUME_CARD.width) / 2),
      y: Math.round(this.machineMiddle + RESUME_CARD.top),
      width: RESUME_CARD.width,
      height: RESUME_CARD.height,
    };
    // 처음의 도움말과 같은, 금테를 두른 흰 판
    const back = this.add.graphics().setDepth(DEPTH.hint);
    back.fillStyle(LOOK.machine.trimLip, 1);
    back.fillRoundedRect(box.x, box.y + 2, box.width, box.height, 10);
    back.fillStyle(LOOK.machine.trim, 1);
    back.fillRoundedRect(box.x, box.y, box.width, box.height, 10);
    back.fillStyle(THEME.white, 1);
    back.fillRoundedRect(box.x + 2, box.y + 2, box.width - 4, box.height - 4, 8);
    const depth = DEPTH.hint + 0.5;
    // 두고 간 판이 오늘의 판이면 그렇다고 앞에 적는다. 길어진 줄은 카드에 맞게 줄인다.
    const savedDaily = dailyDayOf(saved.seed) === dayIndexOf(new Date());
    const captionText = savedDaily ? `${DAILY_LABEL.name} · ${resumeCaption(saved)}` : resumeCaption(saved);
    const caption = addText(this, GAME_WIDTH / 2, box.y + 6, captionText, {
      color: LOOK.text.ink,
      originX: 0.5,
    }).setDepth(depth);
    caption.setScale(Math.min(1, (box.width - 16) / caption.width));

    const pad = 7;
    const gap = 6;
    const row = { y: box.y + 23, height: 29 };
    const narrow = 66;
    const wide = box.width - pad * 2 - gap - narrow;
    const resume = new SoftButton(
      this,
      { x: box.x + pad, y: row.y, width: wide, height: row.height },
      'gold',
      depth,
      RESUME_TEXT.resume,
      () => this.resumeRun(saved),
    );
    const fresh = new SoftButton(
      this,
      { x: box.x + pad + wide + gap, y: row.y, width: narrow, height: row.height },
      'mint',
      depth,
      RESUME_TEXT.fresh,
      () => this.startFresh(),
    );
    this.resumeViews = [back, caption, resume, fresh];
    this.showStartBook(box.y + box.height + BOOK_BUTTON.gap);
  }

  private closeResumeCard(): void {
    for (const view of this.resumeViews) view.destroy();
    this.resumeViews = [];
    this.hideStartBook(true);
  }

  /**
   * 두고 간 판을 그 자리에서 이어 한다. 기계에는 마지막으로 나온 판을 보여 주고, 가게가 열려 있었으면 같은 부적으로
   * 가게를 다시 열고, 스핀을 다 쓴 채였으면(결과를 보다가 닫혔으면) 라운드를 맺는다.
   */
  private resumeRun(saved: RunState): void {
    if (this.resumeViews.length === 0) return;
    this.closeResumeCard();
    this.run = saved;
    this.playing = true;
    this.refreshNumbers();
    this.refreshSlots();
    this.refreshOdds(false);
    saved.lastGrid?.forEach((symbol, cell) => this.cells[cell]?.setTexture(symbolTexture(this, symbol)));
    if (saved.phase === 'shop') {
      this.openShop();
      return;
    }
    const bannerMs = 700;
    showBanner(this, this.machineMiddle, `라운드 ${saved.round}`, LOOK.text.good, bannerMs, DEPTH.banner, FONT_SIZE.large);
    if (saved.spinsLeft <= 0) {
      // 금화는 마지막 스핀을 돌릴 때 이미 받았으니, 라운드를 맺기만 하면 된다. 라운드를 알리는 글이 지나간 뒤에 맺는다.
      this.busy = true;
      this.time.delayedCall(bannerMs + SETTLE_DELAY_MS, () => this.settle());
      return;
    }
    this.spinButton.setEnabled(true);
    this.showGuide();
  }

  /** 두고 간 판을 버리고 새 판을 시작한다. */
  private startFresh(): void {
    if (this.resumeViews.length === 0) return;
    this.closeResumeCard();
    this.dropRun();
    this.playing = true;
    this.spinButton.setEnabled(true);
    this.showHints();
    this.showGuide();
    // 이어 할지 묻는 동안 치워 둔, 여느 판과 오늘의 판을 오가는 버튼을 도움말과 함께 다시 놓는다.
    this.showDailySwitch();
  }

  // ───────── 부적 도감 ─────────

  /**
   * "도감 7/24"처럼 찾은 부적의 수를 적은 작은 금빛 버튼을 놓는다. 누르면 도감이 열린다.
   * centerX는 버튼의 가운데, top은 위쪽 끝이다. 누르는 자리는 보이는 것보다 위아래로 reach만큼 넓다.
   */
  private addBookButton(
    centerX: number,
    top: number,
    height: number,
    depth: number,
    size: number = FONT_SIZE.normal,
    reach = 0,
  ): BookButton {
    const back = this.add.graphics().setDepth(depth);
    const label = addText(this, Math.round(centerX), Math.round(top + height / 2), '', {
      size,
      color: LOOK.text.ink,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(depth + 0.5);
    let pressed = false;
    let gone = false;
    let width = 0;
    const draw = (): void => {
      if (gone) return;
      const left = Math.round(centerX - width / 2);
      back.clear();
      back.fillStyle(LOOK.machine.trimLip, 1);
      back.fillRoundedRect(left, top, width, height, height / 2);
      back.fillStyle(pressed ? LOOK.machine.bulbOff : LOOK.machine.trim, 1);
      back.fillRoundedRect(left + 1.5, top + 1.5, width - 3, height - 3, (height - 3) / 2);
    };
    const write = (): void => {
      label.setText(collectionLabel(store.data.slot.found));
      width = Math.ceil(label.width) + 18;
      draw();
    };
    write();
    const zone = addTapZone(
      this,
      Math.round(centerX - width / 2) - 4,
      top - reach,
      width + 8,
      height + reach * 2,
      (down) => {
        pressed = down;
        draw();
      },
      () => {
        sfx.click();
        vibrate(8);
        this.openBook();
      },
    ).setDepth(depth + 0.5);
    const destroy = (): void => {
      if (gone) return;
      gone = true;
      this.tweens.killTweensOf([back, label]);
      for (const part of [back, label, zone]) part.destroy();
    };
    return {
      destroy,
      refresh: (bounce = false) => {
        if (gone) return;
        write();
        if (!bounce) return;
        this.tweens.killTweensOf(label);
        this.tweens.add({ targets: label, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
      },
      fade: () => {
        if (gone) return;
        zone.disableInteractive();
        this.tweens.add({ targets: [back, label], alpha: 0, duration: 200, onComplete: destroy });
      },
    };
  }

  /** 시작 화면의 도감 버튼을 카드 바로 밑에 놓는다. top은 버튼의 위쪽 끝이다. */
  private showStartBook(top: number): void {
    this.startBook?.destroy();
    // 도감 버튼의 오른쪽에 해금 버튼이 나란히 놓인다. 둘을 한 덩어리로 가운데에 맞춘다.
    const centerX = this.showStartPerks(Math.round(top));
    this.startBook = this.addBookButton(centerX, Math.round(top), BOOK_BUTTON.height, DEPTH.hint);
  }

  /** 시작 화면의 도감 버튼을 치운다. 처음의 도움말과 함께 사라진다. */
  private hideStartBook(now: boolean): void {
    this.hideStartPerks(now);
    const button = this.startBook;
    if (!button) return;
    this.startBook = null;
    if (now) button.destroy();
    else button.fade();
  }

  /** 가게의 머리글에, 가게의 이름과 오른쪽의 안내 사이 한가운데에 도감 버튼을 놓는다. */
  private addShopBook(title: Text, guide: Text): void {
    const { shop } = this.layout;
    const left = title.x + title.width;
    const right = guide.x - guide.width;
    const height = 18;
    this.shopBook = this.addBookButton(
      (left + right) / 2,
      shop.y + Math.round((SHOP_HEAD - height) / 2) + 1,
      height,
      DEPTH.shop,
      FONT_SIZE.small,
      3,
    );
    this.shopViews.push(this.shopBook);
  }

  /**
   * 도감을 연다. 화면을 덮는 창에 모든 부적을 칸칸이 늘어놓는다. 찾은 부적은 그림이 보이고 누르면 이름과 설명이 나오며,
   * 아직 찾지 못한 부적은 물음표가 적힌 흐린 칸으로만 보인다.
   */
  private openBook(): void {
    if (this.book || this.perkPanel || this.ended) return;
    this.hideBubble();
    const { width: screenWidth, height: screenHeight } = this.scale;
    const found = store.data.slot.found;
    const entries = collectionEntries(found);
    const rows = Math.ceil(entries.length / BOOK.cols);
    const gridHeight = rows * BOOK.pitch;
    const height = BOOK.head + gridHeight + 6 + BOOK.detail + 8 + BOOK.close + 10;
    const box: Box = {
      x: Math.round((GAME_WIDTH - BOOK.width) / 2),
      y: Math.max(4, Math.round((screenHeight - height) / 2)),
      width: BOOK.width,
      height,
    };
    const depth = BOOK_DEPTH;
    const views: Disposable[] = [];

    // 밑의 것이 눌리지 않게 화면을 덮는다. 창 밖을 누르면 닫히고, 창 안의 빈 곳은 눌러도 그대로다.
    const scrim = this.add.rectangle(0, 0, screenWidth, screenHeight, THEME.inkDeep, 0.6).setOrigin(0, 0).setDepth(depth);
    const outside = addTapZone(this, 0, 0, screenWidth, screenHeight, () => undefined, () => this.closeBook()).setDepth(depth);
    const panel = this.add.graphics().setDepth(depth);
    drawPanel(panel, box.x, box.y, box.width, box.height, { radius: 14 });
    const inside = this.add.zone(box.x, box.y, box.width, box.height).setOrigin(0, 0).setInteractive().setDepth(depth);
    const title = addText(this, box.x + 14, box.y + 9, COLLECTION_TEXT.title, { color: LOOK.text.ink }).setDepth(depth);
    const count = addText(this, box.x + box.width - 14, box.y + 9, `${foundCount(found)}/${COLLECTION_SIZE}`, {
      color: LOOK.text.points,
      originX: 1,
    }).setDepth(depth);
    views.push(scrim, outside, panel, inside, title, count);

    // 누른 부적의 이름과 설명이 놓이는 칸
    const detail: Box = { x: box.x + 10, y: box.y + BOOK.head + gridHeight + 6, width: box.width - 20, height: BOOK.detail };
    const detailBack = this.add.graphics().setDepth(depth);
    detailBack.fillStyle(THEME.bg, 1);
    detailBack.fillRoundedRect(detail.x, detail.y, detail.width, detail.height, 10);
    const name = addText(this, detail.x + 10, detail.y + 6, '', { color: LOOK.text.ink }).setDepth(depth);
    const description = addText(this, detail.x + 10, detail.y + 24, '', {
      size: FONT_SIZE.small,
      color: LOOK.text.sub,
    }).setDepth(depth);
    const ring = this.add.graphics().setDepth(depth);
    views.push(detailBack, name, description, ring);
    // 설명 칸에 글을 적는다. 설명이 없으면(아무 칸도 누르지 않았을 때의 안내) 한 줄을 칸의 가운데 높이에 놓는다.
    const write = (head: string, body: string, color: string): void => {
      name.setText(head).setColor(color);
      // 빈 설명도 글자 상자는 남아서 가운데에 놓인 한 줄과 겹치므로, 적을 것이 없으면 감춘다.
      description.setText(body).setVisible(body !== '');
      name.setY(body ? detail.y + 6 : Math.round(detail.y + (detail.height - name.height) / 2));
    };
    write(foundCount(found) > 0 ? COLLECTION_TEXT.hint : COLLECTION_TEXT.empty, '', LOOK.text.sub);

    const gridLeft = Math.round(box.x + (box.width - BOOK.cols * BOOK.pitch) / 2);
    const gridTop = box.y + BOOK.head;
    const select = (entry: CollectionEntry, x: number, y: number): void => {
      const text = entryText(entry);
      write(text.name, text.description, entry.found ? LOOK.text.ink : LOOK.text.faint);
      const half = BOOK.pitch / 2;
      ring.clear();
      ring.lineStyle(2, THEME.accent, 1);
      ring.strokeRoundedRect(x - half + 1, y - half + 1, BOOK.pitch - 2, BOOK.pitch - 2, 9);
    };
    entries.forEach((entry, index) => {
      const x = gridLeft + ((index % BOOK.cols) + 0.5) * BOOK.pitch;
      const y = gridTop + (Math.floor(index / BOOK.cols) + 0.5) * BOOK.pitch;
      const texture = entry.found ? charmTexture(this, entry.charm.id) : unknownCharmTexture(this);
      const tile = this.add.image(x, y, texture).setDepth(depth);
      views.push(tile);
      if (!entry.found) {
        views.push(
          addText(this, x, y, COLLECTION_TEXT.unknownMark, {
            size: 14,
            color: LOOK.text.faint,
            originX: 0.5,
            originY: 0.5,
          }).setDepth(depth),
        );
      }
      views.push(
        addTapZone(
          this,
          x - BOOK.pitch / 2,
          y - BOOK.pitch / 2,
          BOOK.pitch,
          BOOK.pitch,
          (pressed) => tile.setScale(pressed ? 0.9 : 1),
          () => {
            sfx.click();
            select(entry, x, y);
          },
        ).setDepth(depth),
      );
    });

    const closeWidth = 104;
    views.push(
      new SoftButton(
        this,
        {
          x: Math.round(box.x + (box.width - closeWidth) / 2),
          y: detail.y + detail.height + 8,
          width: closeWidth,
          height: BOOK.close,
        },
        'gold',
        depth,
        COLLECTION_TEXT.close,
        () => this.closeBook(),
      ),
    );
    this.book = views;
    // 도감이 떠 있는 동안에는 키보드로 돌리지 못하게 한다.
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    sfx.pop();
  }

  private closeBook(): void {
    if (!this.book) return;
    for (const view of this.book) view.destroy();
    this.book = null;
    if (this.input.keyboard) this.input.keyboard.enabled = true;
  }

  // ───────── 영구 해금 ─────────

  /** 씬을 다시 열 때 해금에 딸린 것들을 처음 상태로 돌린다. 놓여 있던 것은 씬이 닫힐 때 이미 치워졌다. */
  private resetPerkViews(): void {
    this.slotViews = [];
    this.startPerks = null;
    this.perkNote = null;
    this.perkPanel = null;
  }

  /** 게임 영역: HUD 아래의 자리 */
  private get playArea(): Box {
    return { x: 0, y: HUD_HEIGHT, width: GAME_WIDTH, height: this.scale.height - HUD_HEIGHT };
  }

  /** 열어 둔 영구 해금과 올린 유물을 켠 새 여느 판. 오늘의 판은 둘 다 없이 newRun(씨앗)으로 만든다. */
  private freshRun(): RunState {
    const { perks, relics } = store.data.slot;
    return newRun(null, perks, relics);
  }

  /**
   * 아직 한 번도 돌리지 않은 여느 판인지. 그런 판은 해금을 새로 열거나 유물을 올리면
   * 그 자리에서 그것을 켠 판으로 갈아 끼운다.
   */
  private isUnstartedNormal(): boolean {
    const { run } = this;
    return run.seed === null && run.phase === 'spin' && run.round === 1 && run.spinCount === 0 && !this.busy;
  }

  /**
   * 판이 바뀌었을 때(새 판, 이어 하기, 여느 판과 오늘의 판 바꾸기) 부적 자리의 수를 그 판에 맞춘다.
   * 자리의 수가 그대로면 아무것도 하지 않는다. 시작 화면의 한 줄도 지금 판에 맞게 다시 적는다.
   */
  private refreshPerks(): void {
    const count = slotsOf(this.run);
    if (count !== this.layout.slots.length) {
      this.hideBubble();
      this.layout = layoutFor(this.playArea, count);
      this.tweens.killTweensOf(this.readyMarks);
      for (const view of this.slotViews) view.destroy();
      this.slotViews = [];
      this.slotImages = [];
      this.readyMarks = [];
      this.addSlots();
      this.refreshSlots();
    }
    this.refreshPerkNote();
  }

  /**
   * 시작 화면의 카드 밑에 도감 버튼과 해금 버튼이 나란히 놓일 자리를 잡고, 해금 버튼과 그 아래의 한 줄을 놓는다.
   * 왼쪽에 놓일 도감 버튼의 가운데를 돌려준다. top은 버튼의 위쪽 끝이다.
   */
  private showStartPerks(top: number): number {
    this.hideStartPerks(true);
    const gap = 6;
    const bookWidth = textWidth(this, collectionLabel(store.data.slot.found)) + PERK_BUTTON_PAD;
    const perkWidth = textWidth(this, keepLabel(store.data.slot)) + PERK_BUTTON_PAD;
    const left = Math.round((GAME_WIDTH - bookWidth - gap - perkWidth) / 2);
    this.startPerks = addPerkButton(
      this,
      left + bookWidth + gap + perkWidth / 2,
      top,
      BOOK_BUTTON.height,
      DEPTH.hint,
      () => store.data.slot,
      () => this.openPerks(),
    );
    // 이어 할지 묻는 동안에는 한 줄을 적지 않는다. 이어 하는 판은 시작할 때의 해금을 따르기 때문이다.
    if (this.resumeViews.length === 0) {
      this.perkNote = { top: top + BOOK_BUTTON.height + 5, label: '', view: null };
      this.refreshPerkNote();
    }
    return left + bookWidth / 2;
  }

  /** 시작 화면의 해금 버튼과 그 아래의 한 줄을 치운다. 처음의 도움말과 함께 사라진다. */
  private hideStartPerks(now: boolean): void {
    const button = this.startPerks;
    const note = this.perkNote?.view;
    this.startPerks = null;
    this.perkNote = null;
    if (now) {
      button?.destroy();
      note?.destroy();
    } else {
      button?.fade();
      note?.fade();
    }
  }

  /**
   * 해금 버튼 아래의 한 줄을 지금 판에 맞게 적는다: 여느 판이면 켜진 해금의 수와 유물의 단계,
   * 오늘의 판이면 그것들 없이 한다는 것. 연 해금도 올린 유물도 없거나, 기계 밖으로 나갈 만큼 화면이 짧으면 적지 않는다.
   */
  private refreshPerkNote(): void {
    const note = this.perkNote;
    if (!note) return;
    const { machine } = this.layout;
    const fits = note.top + PERK_NOTE_HEIGHT <= machine.y + machine.height - MACHINE_FRAME;
    const label = fits ? (keepNote(store.data.slot, this.dailyDay !== null) ?? '') : '';
    if (label === note.label) return;
    note.view?.destroy();
    note.label = label;
    note.view = label === '' ? null : addPerkNote(this, note.top, DEPTH.hint, label);
  }

  /**
   * 해금과 유물의 창을 연다. 가진 조각과 해금 넷(다른 쪽에는 유물 넷)이 놓이고, 누르면 조각을 내고 열거나 올린다.
   */
  private openPerks(): void {
    if (this.perkPanel || this.book || this.ended) return;
    this.hideBubble();
    /** 조각을 쓴 뒤: 버튼의 글을 맞추고, 아직 돌리지 않은 여느 판이면 방금 산 것을 바로 켠다. 오늘의 판과 하던 판은 그대로다. */
    const spent = (): void => {
      this.startPerks?.refresh();
      if (this.isUnstartedNormal()) this.run = this.freshRun();
      this.refreshNumbers();
    };
    this.perkPanel = openPerkPanel(this, {
      depth: BOOK_DEPTH,
      state: () => store.data.slot,
      unlock: (id) => {
        const block = unlockBlock(store.data.slot, id);
        if (block !== null) return block;
        store.update((save) => void (save.slot = withPerk(save.slot, id)));
        spent();
        return null;
      },
      raise: (id) => {
        const block = raiseBlock(store.data.slot, id);
        if (block !== null) return block;
        store.update((save) => void (save.slot = withRelic(save.slot, id)));
        spent();
        return null;
      },
      addButton: (box, label, onTap) => new SoftButton(this, box, 'gold', BOOK_DEPTH, label, onTap),
      close: () => this.closePerks(),
    });
    // 창이 떠 있는 동안에는 키보드로 돌리지 못하게 한다.
    if (this.input.keyboard) this.input.keyboard.enabled = false;
  }

  private closePerks(): void {
    if (!this.perkPanel) return;
    for (const view of this.perkPanel) view.destroy();
    this.perkPanel = null;
    if (this.input.keyboard) this.input.keyboard.enabled = true;
  }

  /**
   * 끝난 판의 조각을 세이브에 넣고, 이번 판에 받은 조각과 받은 뒤에 가진 조각을 돌려준다.
   * endRun이 판마다 한 번만 부른다. 도중에 버린 판(새 판을 고른 판)은 여기를 거치지 않아서 조각을 받지 못한다.
   */
  private payPieces(): { earned: number; total: number } {
    const before = store.data.slot;
    const after = withPieces(before, piecesFor(this.run));
    if (after !== before) store.update((save) => void (save.slot = after));
    return { earned: after.pieces - before.pieces, total: after.pieces };
  }
}
