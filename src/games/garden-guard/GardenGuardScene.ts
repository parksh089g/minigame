import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { sfx, tone } from '../../core/sfx';
import { addText, fadeToScene, PixelButton } from '../../core/ui';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type PauseExtra, type ResultStat } from '../../scenes/MiniGameScene';
import { LOOK, registerGardenTextures, TEX } from './art';
import { BOONS, ENEMIES, GARDEN_GAME_ID, GARDEN_SCENE, type EnemyKind } from './data';
import { buildLobby } from './lobby';
import { openPickPanel, pickedInfo, type ClearedNote, type PickPanel } from './picks';
import { applyRun, bankSeeds, bossKind, clampStartDay, isBossDay, openedStart, raiseBest, type GardenMeta } from './rules';
import { settleSavedRun } from './saved-run';
import { createRun, runScore, step, stormReady, type Input, type RunState, type SimEvent } from './sim';
import { gardenStore } from './store';
import { FieldView, layoutField, toSim, type FieldLayout } from './view';

/**
 * 이 판에서 새로 열린 출발점(물리친 대장의 다음 날). 다음에 준비 화면을 열 때 한 번 알려 주고 지운다.
 * 판이 끝나면 결과 화면을 거쳐 씬이 새로 시작되므로 씬 밖에 둔다.
 */
let freshStart: number | null = null;

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
interface StartData {
  /** run이면 준비 화면을 거치지 않고 바로 새 판을 시작하고, resume이면 두고 간 판을 이어 한다. */
  mode?: 'run' | 'resume';
}

type Phase = 'loading' | 'lobby' | 'run' | 'over';

const STEP = 1 / 60;
/** 한 프레임에 따라잡는 가장 긴 시간(초). 탭이 멈췄다 돌아와도 한꺼번에 몰아서 돌리지 않는다. */
const MAX_FRAME = 0.1;
/** 위쪽 HUD의 높이. 이 아래부터 판이다. */
const HUD_HEIGHT = 46;
/**
 * 버튼(일시정지, 물벼락)은 층을 따로 정할 수 없어서 0층에 놓인다. 판은 그보다 아래에, HUD의 글자와 알림은 위에 둔다.
 * hudBack은 HUD 뒤를 덮는 바탕으로, 판보다는 위이고 버튼보다는 아래다.
 */
const DEPTH = { field: -20, aim: -12, hudBack: -2, hud: 1, banner: 10, picks: 20 } as const;
/** 그날 쫓아낸 벌레의 비율을 보여 주는 막대 */
const DAY_BAR = { x: 70, y: 31, width: 100, height: 6 } as const;
/** 울타리 체력 막대. 화면 맨 아래에 놓인다. */
const FENCE_BAR = { x: 10, height: 12, bottom: 8 } as const;
/** 물벼락 버튼 */
const STORM_BUTTON = { size: 36, right: 6, bottom: 24 } as const;
/** 판이 끝난 뒤 결과 화면이 뜨기까지 무너진 장면을 보여 주는 시간(ms) */
const ENDING_MS = 1500;
/** 판을 시작할 때 화면 아래에 뜨는 조작 안내가 보이는 시간(초)과, 이만큼 해 본 사람에게는 띄우지 않는 판 수 */
const HINT = { seconds: 7, untilRuns: 3 } as const;
/** 새 벌레의 안내는 그 벌레가 나오기 시작한 날에서 이만큼 더 간 사람에게는 띄우지 않는다. */
const BUG_TIP_DAYS = 4;
/** 하던 판을 저장하는 간격(판 안의 초). 멈출 때와 날을 넘길 때도 저장하므로, 이것은 앱이 갑자기 꺼질 때를 위한 것이다. */
const SAVE_EVERY = 10;
/** 이어 할 때 벌레가 움직이기 전에 숨을 고르는 시간(초) */
const RESUME_HOLD = 1.2;
/** 날을 지킨 뒤 강화를 고르는 창이 뜨기까지의 시간(초). 마지막 벌레가 쫓겨나는 것을 보여 주고 띄운다. */
const PICK_DELAY = 0.6;

/** 화면에 적는 글. 글꼴에 들어 있는 글자만 쓰는지 테스트가 확인한다. */
export const TEXT = {
  hint: '화면을 누르고 있으면\n그쪽으로 더 빨리 쏴요',
  /** 대장의 날에 뜨는 이름(대장의 이름 뒤에 느낌표)과, 그 대장을 처음 만나는 날에 뜨는 안내 */
  boss: (name: string) => `${name}!`,
  bossTips: {
    mole: '두더지는 부하를 불러요. 먼저 쫓아내요!',
    rhino: '웅크리면 곧 돌진해요. 찬물로 늦춰요!',
  } as Partial<Record<EnemyKind, string>>,
  /** 새 벌레가 처음 나올 무렵에 뜨는 안내 */
  bugTips: {
    beetle: '풍뎅이는 단단해요. 크게 맞혀야 통해요',
    mosquito: '모기는 떼로 와요. 물보라가 잘 들어요',
    digger: '땅강아지는 땅속에 숨어요. 나오면 쏴요!',
  } as Partial<Record<EnemyKind, string>>,
  record: '새 기록!',
  over: '울타리가 무너졌어요',
  fence: '울타리',
  backToLobby: '준비 화면으로',
  resumed: (day: number) => `${day}일째 이어서!`,
  /** 대장을 처음 물리친 날에 띄운다. 다음 판은 그다음 날부터 시작한다. */
  nextStart: (day: number) => `다음 판은 ${day}일째부터!`,
} as const;

/** 새 출발점이 열린 뒤 처음 여는 준비 화면의 설명 칸에 적는다. */
export function lobbyNotice(day: number): string {
  return `${day}일째가 열려서 거기부터 시작해요.\n더 앞에서 하려면 왼쪽 칸에서 골라요.`;
}

/**
 * 텃밭 지키기: 몰려오는 벌레 떼가 울타리를 넘지 못하게 물총으로 쫓아내는 방어 게임.
 * 물총은 저절로 쏘고, 화면을 누르고 있으면 그쪽을 겨눠 더 빨리 쏜다. 울타리가 무너지면 판이 끝나지만
 * 모은 씨앗과 그것으로 산 강화는 남아서, 다음 판에는 더 멀리 간다.
 * 규칙과 진행은 sim.ts가 맡고, 이 씬은 입력을 넘기고 결과를 그린다.
 */
export class GardenGuardScene extends MiniGameScene {
  protected readonly gameId = GARDEN_GAME_ID;

  private phase: Phase = 'loading';
  /** 하고 있는 판. 준비 화면에서는 null이다. 자동 점검이 들여다본다. */
  run: RunState | null = null;
  private view!: FieldView;
  private layout!: FieldLayout;
  private pending = 0;
  /** 이 판에서 번 씨앗 가운데 이미 저장해 둔 양. 날을 넘길 때마다 넣어 둔다. */
  private banked = 0;
  /** 판의 기록(판 수, 쫓아낸 벌레)을 이미 넣었는지 */
  private settled = false;
  /** 하던 판을 마지막으로 저장한 때(판 안의 초) */
  private savedT = 0;
  /** 이어 할 때 벌레가 움직이기 전까지 남은 시간(초) */
  private hold = 0;
  /** 겨누고 있는 손가락과 그 자리(화면 좌표) */
  private aimPointer: number | null = null;
  private aimAt = { x: 0, y: 0 };
  private stormAsked = false;
  /** 강화를 고르는 창과, 거기서 고른 자리. 고른 것은 다음 걸음에 시뮬레이션으로 넘긴다. */
  private picks: PickPanel | null = null;
  private pickAsked: number | null = null;
  /** 내놓은 강화를 고르는 창을 띄울 때(판 안의 초). 이어 한 판은 0이라 바로 뜬다. */
  private picksAt = 0;
  /** 방금 지킨 날의 알림. 강화를 고를 날에는 가운데에 띄우는 대신 고르는 창의 맨 위에 적는다. */
  private cleared: ClearedNote | null = null;
  /** 강화를 고른 뒤에 띄울 "다음 판은 N일째부터!". 고르는 창에 가리지 않게 미뤄 둔다. */
  private nextStartNote: string | null = null;
  private readonly seen = new Set<string>();

  private dayText!: Phaser.GameObjects.Text;
  private seedText!: Phaser.GameObjects.Text;
  private fenceText!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;
  private aimLine!: Phaser.GameObjects.Graphics;
  private stormButton?: PixelButton;
  private stormText?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;
  private tip?: Phaser.GameObjects.Text;
  /** 소리가 몰려 나지 않게, 종류마다 마지막으로 낸 때(ms) */
  private readonly lastSound: Record<string, number> = {};

  constructor() {
    super(GARDEN_SCENE);
  }

  create(data: StartData = {}): void {
    const mode = data.mode;
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "다시 하기"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerGardenTextures(this);
    this.phase = 'loading';
    this.run = null;
    this.pending = 0;
    this.banked = 0;
    this.settled = false;
    this.savedT = 0;
    this.hold = 0;
    this.aimPointer = null;
    this.stormAsked = false;
    this.picks = null;
    this.pickAsked = null;
    this.picksAt = 0;
    this.cleared = null;
    this.nextStartNote = null;
    this.seen.clear();
    this.stormButton = undefined;
    this.stormText = undefined;
    this.hint = undefined;
    this.tip = undefined;

    // 판을 하다가 나가면(그만하기, 준비 화면으로) 그때까지 번 씨앗을 넣고 판을 저장해 둔다. 준비 화면에서 이어 한다.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.keepRun());

    // 다른 곳에서 그사이 저장한 것이 있으면 그것을 읽어 와서 연다.
    void gardenStore.refresh().then(() => {
      // 불러오는 사이에 씬을 떠났으면 아무것도 하지 않는다.
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      if (mode === 'run' || mode === 'resume') this.startRun(mode === 'resume');
      else this.openLobby();
    });
  }

  // ------------------------------------------------------------ 준비 화면

  private openLobby(): void {
    this.phase = 'lobby';
    const saved = gardenStore.run;
    // 이어 할 판이 있으면 시작하는 날을 고르지 않으므로, 새 출발점의 알림은 그 판을 마친 뒤로 미룬다.
    const opened = saved ? null : freshStart;
    if (!saved) freshStart = null;
    buildLobby(this, {
      notice: opened !== null ? lobbyNotice(opened) : null,
      saved: saved ? { day: saved.state.day } : null,
      getMeta: () => gardenStore.data,
      setMeta: (meta) => gardenStore.set(meta),
      onStart: () => this.scene.restart({ mode: 'run' } satisfies StartData),
      onResume: () => this.scene.restart({ mode: 'resume' } satisfies StartData),
      onAbandon: () => {
        this.closeSaved();
        this.scene.restart({} satisfies StartData);
      },
      onBack: () => fadeToScene(this, homeScene()),
    });
  }

  /** 두고 간 판을 이어 하지 않고 마친다. 아직 넣지 않은 씨앗과 판의 기록을 넣고 저장을 지운다. */
  private closeSaved(): void {
    const saved = gardenStore.run;
    if (!saved) return;
    this.save(settleSavedRun(gardenStore.data, saved));
    gardenStore.setRun(null);
  }

  /** 준비 화면에서는 뒤로 가기가 허브로 나가고, 판을 하는 동안에는 일시정지한다. */
  override onBackRequest(): void {
    if (this.phase === 'lobby') fadeToScene(this, homeScene());
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    // 준비 화면에는 멈출 판이 없다.
    if (this.phase !== 'run') return;
    this.aimPointer = null;
    // 앱이 가려진 채로 닫혀도 이어 할 수 있게 먼저 저장한다.
    this.keepRun();
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return TEXT.backToLobby;
  }

  /** 멈춘 김에 이 판에서 고른 강화를 보여 준다. */
  protected override pauseExtra(): PauseExtra | undefined {
    return this.run ? pickedInfo(this.run.boons) : undefined;
  }

  protected override canFinishEarly(): boolean {
    return this.phase === 'run';
  }

  protected override finishEarly(): void {
    this.endRun();
  }

  // ------------------------------------------------------------ 판

  /** resume이면 두고 간 판을 이어 하고, 아니면(또는 이어 할 판이 없으면) 새 판을 시작한다. */
  private startRun(resume: boolean): void {
    const { height } = this.scale;
    const saved = resume ? gardenStore.run : null;
    let state: RunState;
    let events: SimEvent[] = [];
    if (saved) {
      state = structuredClone(saved.state);
      this.banked = saved.banked;
    } else {
      // 두고 간 판이 남아 있으면 마치고 새로 시작한다.
      this.closeSaved();
      const meta = gardenStore.data;
      ({ state, events } = createRun({
        seed: Math.floor(Math.random() * 0x7fffffff),
        startDay: clampStartDay(meta.startDay, meta.best),
        levels: meta.levels,
        bestBefore: meta.best,
        fields: meta.fields,
      }));
    }
    this.run = state;
    this.layout = layoutField(height, HUD_HEIGHT);
    this.view = new FieldView(this, this.layout, DEPTH.field, state.stats.helpers);
    this.aimLine = this.add.graphics().setDepth(DEPTH.aim);
    this.buildHud(state);
    this.listenForAim();
    this.phase = 'run';
    this.playing = true;
    // 시작하자마자 저장해 두어서, 첫 저장 전에 앱이 꺼져도 이 판을 이어 할 수 있게 한다.
    this.saveRun();
    if (saved) {
      this.hold = RESUME_HOLD;
      const fieldMiddle = (this.layout.top + this.layout.fenceY) / 2;
      showBanner(this, fieldMiddle - 30, TEXT.resumed(state.day), THEME_CSS.good, 1400, DEPTH.banner, FONT_SIZE.large);
      this.view.sync(state, 0);
    } else if (gardenStore.data.runs < HINT.untilRuns) {
      this.hint = addText(this, GAME_WIDTH / 2, this.layout.fenceY - 46, TEXT.hint, {
        color: THEME_CSS.ink,
        originX: 0.5,
        originY: 0.5,
        align: 'center',
        stroke: THEME_CSS.white,
      }).setDepth(DEPTH.banner);
    }
    this.react(events);
    this.refreshHud();
  }

  private buildHud(state: RunState): void {
    const { height } = this.scale;
    // HUD 뒤를 바탕색으로 덮어서, 위에서 나타나는 벌레가 HUD 밑에서 걸어 나오게 한다.
    this.add.rectangle(0, 0, GAME_WIDTH, HUD_HEIGHT, THEME.bg).setOrigin(0, 0).setDepth(DEPTH.hudBack);
    this.addPauseButton();
    this.bars = this.add.graphics().setDepth(DEPTH.hud);
    this.dayText = addText(this, GAME_WIDTH / 2, 6, '', {
      size: 18,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    }).setDepth(DEPTH.hud);
    this.add
      .image(GAME_WIDTH - 10, 20, TEX.seed)
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.hud);
    this.seedText = addText(this, GAME_WIDTH - 27, 20, '0', {
      color: THEME_CSS.accent,
      originX: 1,
      originY: 0.5,
    }).setDepth(DEPTH.hud);
    this.fenceText = addText(this, GAME_WIDTH / 2, height - FENCE_BAR.bottom - FENCE_BAR.height / 2, '', {
      size: 10,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
      originY: 0.5,
      stroke: THEME_CSS.white,
    }).setDepth(DEPTH.hud);

    if (state.stats.stormCooldown > 0) {
      const { size, right, bottom } = STORM_BUTTON;
      const x = GAME_WIDTH - right - size;
      const y = height - bottom - size;
      this.stormButton = new PixelButton(this, {
        x,
        y,
        width: size,
        height: size,
        icon: TEX.storm,
        style: 'blue',
        hitPadding: 4,
        onTap: () => {
          this.stormAsked = true;
        },
      });
      this.stormText = addText(this, x + size / 2, y + size / 2 - 1, '', {
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
        stroke: THEME_CSS.white,
      }).setDepth(DEPTH.hud);
    }
  }

  /** 물벼락 버튼이 놓인 자리인지. 그 위를 누른 것은 겨누는 것으로 치지 않는다. */
  private onStormButton(x: number, y: number): boolean {
    if (!this.stormButton) return false;
    const { size, right, bottom } = STORM_BUTTON;
    const left = GAME_WIDTH - right - size - 4;
    const top = this.scale.height - bottom - size - 4;
    return x >= left && y >= top && y <= top + size + 8;
  }

  private listenForAim(): void {
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      // 강화를 고르는 동안에는 누른 것을 겨누는 것으로 치지 않는다.
      if (this.phase !== 'run' || this.aimPointer !== null || this.picks) return;
      if (pointer.worldY < HUD_HEIGHT || this.onStormButton(pointer.worldX, pointer.worldY)) return;
      this.aimPointer = pointer.id;
      this.aimAt = { x: pointer.worldX, y: pointer.worldY };
      this.dropHint();
    };
    const onMove = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id !== this.aimPointer) return;
      this.aimAt = { x: pointer.worldX, y: pointer.worldY };
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id === this.aimPointer) this.aimPointer = null;
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    });
  }

  private dropHint(): void {
    const hint = this.hint;
    if (!hint) return;
    this.hint = undefined;
    this.tweens.add({ targets: hint, alpha: 0, duration: 300, onComplete: () => hint.destroy() });
  }

  /** 화면 아래(울타리 바로 위)에 한 줄 안내를 잠깐 띄운다. 같은 안내는 한 판에 한 번만 뜬다. */
  private showTip(key: string, text: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.tip?.destroy();
    const tip = addText(this, GAME_WIDTH / 2, this.layout.fenceY - 22, text, {
      size: 10,
      color: THEME_CSS.ink,
      originX: 0.5,
      originY: 0.5,
      stroke: THEME_CSS.white,
    }).setDepth(DEPTH.banner);
    this.tip = tip;
    this.tweens.add({ targets: tip, alpha: 0, delay: 3600, duration: 500, onComplete: () => tip.destroy() });
  }

  override update(_time: number, deltaMs: number): void {
    const state = this.run;
    if (!state) return;
    const frame = Math.min(MAX_FRAME, deltaMs / 1000);
    if (this.phase === 'over') {
      // 판이 끝난 뒤에도 튀던 조각은 마저 사라지게 한다.
      this.view.sync(state, frame);
      return;
    }
    if (this.phase !== 'run') return;
    if (this.hold > 0) {
      // 이어 한 판은 잠깐 멈춘 채로 보여 주고 시작한다.
      this.hold -= frame;
      this.view.sync(state, frame);
      this.refreshHud();
      return;
    }
    this.pending += frame;
    if (this.hint && state.t > HINT.seconds) this.dropHint();

    const input: Input = {
      aim: this.aimPointer === null ? null : toSim(this.layout, this.aimAt.x, this.aimAt.y),
      storm: this.stormAsked,
      pick: this.pickAsked ?? undefined,
    };
    let stepped = false;
    while (this.pending >= STEP && state.phase !== 'over') {
      this.pending -= STEP;
      const events = step(state, STEP, input);
      stepped = true;
      // 물벼락과 고른 강화는 한 번만 넘긴다.
      input.storm = false;
      input.pick = undefined;
      if (events.length > 0) this.react(events);
    }
    // 화면이 빨리 바뀌는 기기에서는 한 프레임에 한 걸음도 못 갈 때가 있다. 그때 누른 것은 다음 프레임으로 넘긴다.
    if (stepped) {
      this.stormAsked = false;
      this.pickAsked = null;
    }
    if (state.offer.length > 0 && !this.picks && state.t >= this.picksAt) this.openPicks(state);
    this.view.sync(state, frame);
    this.drawAim(state);
    this.refreshHud();
    if (state.phase === 'over') this.endRun();
    else if (state.t - this.savedT >= SAVE_EVERY) this.saveRun();
  }

  /** 직접 겨누는 동안, 물총에서 누른 자리 쪽으로 옅은 점선을 그어 어디를 쏘는지 보여 준다. */
  private drawAim(state: RunState): void {
    const g = this.aimLine;
    g.clear();
    if (!state.manual) return;
    const from = this.view.muzzle;
    const angle = Math.atan2(Math.sin(state.aim) * this.layout.scaleY, Math.cos(state.aim));
    g.fillStyle(LOOK.drop, 0.45);
    for (let distance = 26; distance < 150; distance += 12) {
      const y = from.y + Math.sin(angle) * distance;
      if (y < HUD_HEIGHT + 4) break;
      g.fillCircle(from.x + Math.cos(angle) * distance, y, 1.6);
    }
  }

  private chirp(key: string, gapMs: number, play: () => void): void {
    const now = this.time.now;
    if (now - (this.lastSound[key] ?? -Infinity) < gapMs) return;
    this.lastSound[key] = now;
    play();
  }

  /** 시뮬레이션에서 일어난 일에 소리와 글자를 붙인다. 판 위의 효과는 view가 그린다. */
  private react(events: readonly SimEvent[]): void {
    this.view.handle(events);
    const fieldMiddle = (this.layout.top + this.layout.fenceY) / 2;
    for (const event of events) {
      switch (event.type) {
        case 'fire':
          if (!event.helper) this.chirp('fire', 110, () => tone(980, 0.03, { type: 'triangle', slideTo: 720, volume: 0.07 }));
          break;
        case 'hit':
          if (event.crit) this.chirp('crit', 90, () => tone(1320, 0.05, { type: 'triangle', volume: 0.16 }));
          else if (event.shell) this.chirp('shell', 160, () => tone(240, 0.04, { type: 'square', volume: 0.07 }));
          break;
        case 'kill':
          if (ENEMIES[event.kind].boss) {
            sfx.fanfare();
            vibrate([20, 40, 30]);
            this.cameras.main.shake(200, 0.008);
          } else {
            this.chirp('kill', 70, () => tone(620, 0.05, { slideTo: 1040, volume: 0.16 }));
          }
          break;
        case 'bite':
          this.chirp('bite', 220, () => {
            sfx.bump();
            vibrate(12);
          });
          break;
        case 'storm':
          sfx.whoosh();
          tone(1500, 0.3, { type: 'sawtooth', slideTo: 300, volume: 0.12, delay: 0.05 });
          this.cameras.main.flash(180, 191, 227, 255);
          break;
        case 'offer':
          this.picksAt = (this.run?.t ?? 0) + PICK_DELAY;
          break;
        case 'boon':
          this.closePicks();
          sfx.pop();
          showBanner(this, fieldMiddle - 8, `${BOONS[event.id].name}!`, THEME_CSS.good, 1100, DEPTH.banner, 16);
          if (this.nextStartNote) {
            showBanner(this, fieldMiddle + 16, this.nextStartNote, THEME_CSS.good, 2200, DEPTH.banner, FONT_SIZE.normal);
            this.nextStartNote = null;
          }
          // 고른 것이 저장에 남아야 이어 할 때 같은 것을 또 고르지 않는다.
          this.saveRun();
          break;
        case 'spawn': {
          const tip = TEXT.bugTips[event.kind];
          if (tip && gardenStore.data.best < ENEMIES[event.kind].fromDay + BUG_TIP_DAYS) this.showTip(event.kind, tip);
          break;
        }
        case 'dayStart': {
          this.bounce(this.dayText);
          const boss = event.boss ? bossKind(event.day) : null;
          if (boss) {
            showBanner(this, fieldMiddle - 30, TEXT.boss(ENEMIES[boss].name), THEME_CSS.bad, 1700, DEPTH.banner, FONT_SIZE.large);
            tone(196, 0.22, { type: 'sawtooth', volume: 0.2 });
            tone(147, 0.3, { type: 'sawtooth', volume: 0.2, delay: 0.24 });
            const tip = TEXT.bossTips[boss];
            if (tip && gardenStore.data.best < event.day) this.showTip('boss', tip);
          }
          break;
        }
        case 'dayClear': {
          sfx.gold();
          const title = `${event.day}일째 지킴!`;
          const bonus = `씨앗 +${Math.floor(event.seeds)}${event.record ? ` · ${TEXT.record}` : ''}`;
          // 대장을 처음 물리쳤으면 다음 판은 그다음 날부터라는 것을 알린다.
          const nextStart = event.record && isBossDay(event.day) ? TEXT.nextStart(event.day + 1) : null;
          if ((this.run?.offer.length ?? 0) > 0) {
            // 곧 강화를 고르는 창이 뜬다. 알림이 창에 가리지 않게, 창의 맨 위에 적고 나머지는 고른 뒤에 띄운다.
            this.cleared = { title, detail: bonus };
            this.nextStartNote = nextStart;
          } else {
            showBanner(this, fieldMiddle - 30, title, THEME_CSS.good, 1600, DEPTH.banner, FONT_SIZE.large);
            showBanner(this, fieldMiddle - 4, bonus, THEME_CSS.accent, 1600, DEPTH.banner, FONT_SIZE.normal);
            if (nextStart) showBanner(this, fieldMiddle + 16, nextStart, THEME_CSS.good, 2200, DEPTH.banner, FONT_SIZE.normal);
          }
          this.bounce(this.seedText);
          this.bankSoFar(event.day);
          // 넣어 둔 씨앗의 양이 바뀌었으니 판도 함께 저장한다. 둘이 어긋나면 이어 할 때 씨앗을 두 번 넣는다.
          this.saveRun();
          break;
        }
        default:
          break;
      }
    }
  }

  /** 내놓은 강화 셋을 고르는 창을 띄운다. 고르면 다음 걸음에 시뮬레이션이 그 강화를 붙이고 'boon'으로 알린다. */
  private openPicks(state: RunState): void {
    this.aimPointer = null;
    this.picks = openPickPanel(
      this,
      { top: this.layout.top, bottom: this.layout.fenceY },
      DEPTH.picks,
      state.offer,
      state.boons,
      this.cleared,
      (index) => {
        this.pickAsked = index;
      },
    );
    this.cleared = null;
  }

  private closePicks(): void {
    this.picks?.destroy();
    this.picks = null;
  }

  private bounce(text: Phaser.GameObjects.Text): void {
    this.tweens.killTweensOf(text);
    text.setScale(1);
    this.tweens.add({ targets: text, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.Out' });
  }

  private refreshHud(): void {
    const state = this.run;
    if (!state) return;
    const { height } = this.scale;
    this.dayText.setText(`${state.day}일째`);
    this.seedText.setText(String(Math.floor(state.seeds)));

    const g = this.bars;
    g.clear();
    // 그날 쫓아낸 만큼 차는 막대. 대장의 날에는 색이 다르다.
    const done = state.phase === 'rest' ? 1 : state.dayTotal > 0 ? state.dayKilled / state.dayTotal : 0;
    g.fillStyle(THEME.shadow, 1);
    g.fillRoundedRect(DAY_BAR.x, DAY_BAR.y, DAY_BAR.width, DAY_BAR.height, DAY_BAR.height / 2);
    if (done > 0) {
      g.fillStyle(isBossDay(state.day) ? THEME.coral : THEME.mintDeep, 1);
      g.fillRoundedRect(
        DAY_BAR.x,
        DAY_BAR.y,
        Math.max(DAY_BAR.height, DAY_BAR.width * done),
        DAY_BAR.height,
        DAY_BAR.height / 2,
      );
    }

    // 울타리 체력
    const ratio = Math.max(0, state.fence / state.stats.fenceMax);
    const top = height - FENCE_BAR.bottom - FENCE_BAR.height;
    const width = GAME_WIDTH - FENCE_BAR.x * 2;
    g.fillStyle(LOOK.barBack, 1);
    g.fillRoundedRect(FENCE_BAR.x, top, width, FENCE_BAR.height, FENCE_BAR.height / 2);
    if (ratio > 0) {
      g.fillStyle(ratio > 0.5 ? LOOK.barGood : ratio > 0.25 ? LOOK.barWarn : LOOK.barBad, 1);
      g.fillRoundedRect(
        FENCE_BAR.x,
        top,
        Math.max(FENCE_BAR.height, width * ratio),
        FENCE_BAR.height,
        FENCE_BAR.height / 2,
      );
    }
    this.fenceText.setText(`${TEXT.fence} ${Math.ceil(state.fence)} / ${state.stats.fenceMax}`);

    if (this.stormButton && this.stormText) {
      const ready = stormReady(state);
      const left = Math.ceil(state.stormIn);
      this.stormButton.setEnabled(ready);
      this.stormText.setText(state.stormIn > 0 ? String(left) : '');
    }
  }

  /** 지금까지 번 씨앗을 저장해 둔다. 날을 넘길 때마다 불러서, 판을 하다가 앱이 꺼져도 남게 한다. */
  private bankSoFar(clearedDay = 0): void {
    const state = this.run;
    if (!state) return;
    const whole = Math.floor(state.seeds);
    const meta = raiseBest(bankSeeds(gardenStore.data, whole - this.banked), clearedDay);
    this.banked = whole;
    this.save(meta);
  }

  /** 하던 판을 저장해 둔다. 끝난 판은 저장하지 않는다. */
  private saveRun(): void {
    const state = this.run;
    if (!state || this.phase !== 'run' || state.phase === 'over') return;
    this.savedT = state.t;
    gardenStore.setRun({ state, banked: this.banked });
  }

  /** 판을 두고 갈 때(멈출 때, 판을 하다가 나갈 때) 그때까지 번 씨앗을 넣고 판을 저장한다. */
  private keepRun(): void {
    if (this.phase !== 'run' || this.run?.phase === 'over') return;
    this.bankSoFar();
    this.saveRun();
  }

  /** 판이 끝났을 때 판의 기록(판 수, 쫓아낸 벌레, 남은 씨앗)을 한 번만 넣고, 저장해 둔 판을 지운다. */
  private settle(): void {
    const state = this.run;
    if (!state || this.settled) return;
    this.settled = true;
    this.bankSoFar();
    this.save(applyRun(gardenStore.data, state.lastCleared, state.kills));
    gardenStore.setRun(null);
  }

  /** 판 밖 진행을 저장한다. 새 출발점이 열렸으면 다음 준비 화면에서 알려 주도록 적어 둔다. */
  private save(meta: GardenMeta): void {
    if (meta === gardenStore.data) return;
    const opened = openedStart(gardenStore.data, meta);
    if (opened !== null) freshStart = opened;
    gardenStore.set(meta);
  }

  private endRun(): void {
    const state = this.run;
    if (!state || this.phase !== 'run') return;
    this.phase = 'over';
    this.aimPointer = null;
    this.aimLine.clear();
    // 강화를 고르다가 "기록하고 끝내기"로 끝낸 판이다.
    this.closePicks();
    this.settle();
    if (state.phase === 'over') {
      this.cameras.main.shake(260, 0.012);
      vibrate([30, 50, 60]);
      showBanner(
        this,
        (this.layout.top + this.layout.fenceY) / 2,
        TEXT.over,
        THEME_CSS.bad,
        ENDING_MS,
        DEPTH.banner,
        FONT_SIZE.large - 4,
      );
    }
    const stats: ResultStat[] = [
      ['지킨 날', state.lastCleared > 0 ? `${state.lastCleared}일째` : '없음'],
      ['쫓아낸 벌레', `${state.kills}마리`],
      ['받은 씨앗', `${Math.floor(state.seeds)}개`],
    ];
    this.finishMiniGame(runScore(state), stats, state.phase === 'over' ? ENDING_MS : 600);
  }
}
