import Phaser from 'phaser';
import { CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { homeScene } from '../../core/home';
import { music } from '../../core/music';
import { sfx, tone } from '../../core/sfx';
import { addText, fadeToScene } from '../../core/ui';
import { noteDayScore } from '../../online/online';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type PauseExtra, type ResultStat } from '../../scenes/MiniGameScene';
import type { SharedStart } from '../../share/link';
import { LOOK, registerLanternTextures } from './art';
import { damageRanking } from './build';
import { newlyDone } from './challenges';
import { CHEST, ENEMIES, FEAST, FEAST_LEVELS, LANTERN_GAME_ID, LANTERN_SCENE, STAGES, WEAPONS } from './data';
import { FEAST_COLOR } from './feastpick';
import { RunEffects } from './effects';
import { BOSS_BAR_HEIGHT, HP_DANGER, HUD_HEIGHT, RunHud } from './hud';
import { iconKey } from './icons';
import { Joystick } from './joystick';
import { BOON_HEADER, levelUpHeader, showChoices, TICKET_HEADER } from './levelup';
import { buildLobby, parentPage, type LobbyPage } from './lobby';
import {
  DAILY_REWARD,
  dailyPlan,
  dailyShare,
  dailyToday,
  dayIndexOf,
  friendNotice,
  friendToday,
  friendVerdict,
  SHARED_DAY_PASSED,
} from './daily';
import { showDawnChoice } from './dawn';
import {
  announceNews,
  applyRun,
  feastOpen,
  hasNews,
  learnTip,
  meetFriend,
  metaStore,
  newDepth,
  newsLine,
  newUnlocks,
  unknownNews,
  type StoreChange,
} from './meta';
import { BOSS_SONG, FINAL_SONG, LOBBY_SONG, STAGE_SONGS } from './music';
import { pauseInfo } from './pauseinfo';
import {
  depthName,
  depthRules,
  embersFor,
  feastNote,
  formatClock,
  formatTimes,
  isEvolved,
  isFeast,
  ownedWeapons,
  scoreFor,
  seededRandom,
  upgradeTitle,
  type Upgrade,
} from './rules';
import { createRun, runDawned, Sim, type RunState, type SimEvent } from './sim';
import { SoundBoard, type Note } from './sound';
import { TIP_IDS, tipFor, TIPS, type TipId } from './tips';
import { RunView } from './view';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
interface StartData extends SharedStart {
  /** daily는 오늘의 판을 새로 시작한다. settle은 저장해 둔 판을 그 자리에서 마치고 결과를 받는다. */
  mode?: 'new' | 'resume' | 'daily' | 'settle';
  /** 준비 화면의 어느 쪽을 열지 */
  page?: LobbyPage;
  /** 그 쪽의 목록이 여러 묶음으로 나뉘었을 때 보일 묶음(0부터) */
  list?: number;
  /** 준비 화면에 잠깐 띄울 한 줄 */
  notice?: string;
}

type Phase = 'loading' | 'lobby' | 'run' | 'choosing' | 'over';

/** 저장된 판이 어느 판인지 가리는 글. 같은 판을 이어 저장한 것이면 같고, 판이 없으면 빈 글이다. */
function runKey(run: RunState | null): string {
  return run ? `${run.seed}:${run.hero}:${run.stage}:${run.depth}:${run.daily ?? ''}` : '';
}

const STEP = 1 / 60;
/** 한 프레임에 따라잡는 가장 긴 시간(초). 탭이 멈췄다 돌아와도 한꺼번에 몰아서 돌리지 않는다. */
const MAX_FRAME = 0.1;
/** HUD에 가려지는 만큼 캐릭터를 화면 가운데보다 이만큼 아래에 둔다. */
const PLAYER_DROP = 18;
/** 진행 중인 판을 저장하는 간격(초) */
const SAVE_EVERY = 20;
/** 다른 곳이 판을 가져가서(이어 하거나, 새로 시작하거나, 마쳐서) 이 곳의 판을 놓았을 때 준비 화면에 띄우는 말 */
const TAKEN_NOTICE = '다른 곳에서 이 판을 가져갔어요';
/** 준비 화면에 잠깐 띄우는 한 줄의 위쪽 끝. 불씨와 기록이 적힌 칸(lobby.ts, 40~64) 바로 아래다. */
const NOTICE_TOP = 67;
/** 중간 보스가 쓰러지는 모습을 보여 준 뒤에 강화권 화면을 연다(ms). */
const TICKET_DELAY_MS = 550;
/** 마지막 보스를 쓰러뜨린 뒤 새벽의 선택이 뜨기까지(ms) */
const DAWN_DELAY_MS = 900;
/** 체력이 위험할 때 심장 소리가 뛰는 간격(초). 거의 다 닳으면 더 빨라진다. */
const HEARTBEAT = { slow: 1.05, fast: 0.72, fastBelow: 0.15 } as const;
/** 판이 끝난 뒤 결과 화면이 뜨기까지 끝나는 장면을 보여 주는 시간(ms) */
const ENDING_MS = { cleared: 2100, dead: 1800 } as const;
/** 화면 아래의 한 줄 안내가 떠 있는 시간(초)과, 그 끝에서 흐려지는 시간(초) */
const TIP = { seconds: 4, fade: 0.5 } as const;
/**
 * 판을 시작할 때 알림이 셋(잔치의 밤, 난이도, 깊은 밤) 쌓이면 묶음을 이만큼 올린다.
 * 그대로 두면 가장 작은 화면(320×568)에서 맨 아래 줄이 화면 가운데의 캐릭터 머리에 닿는다.
 */
const STACKED_BANNER_LIFT = 24;
/**
 * 화면 전체 연출(fx)은 싸움 화면보다 위, 조작 표시보다 아래.
 * HUD는 선택 화면(panel)보다 위에 있어서, 고르는 동안에도 체력과 든 무기가 보인다.
 */
const DEPTH = { fx: 12, field: 20, stick: 25, banner: 30, panel: 40, hud: 50 } as const;

/** 효과음의 음 하나를 실제 소리로 낸다. */
function playNote(note: Note): void {
  tone(note.f, note.d, { type: note.type, volume: note.v ?? 0.3, slideTo: note.to, delay: note.at });
}

/**
 * 등불지기: 몰려오는 그림자 무리 사이를 움직이며 버티는 서바이벌.
 * 공격은 저절로 나가고, 빛 조각을 모아 레벨이 오를 때마다 강화를 하나 고른다.
 * 규칙과 진행은 sim.ts가 맡고, 이 씬은 입력을 넘기고 결과를 그린다.
 */
export class LanternKeeperScene extends MiniGameScene {
  protected readonly gameId = LANTERN_GAME_ID;

  private phase: Phase = 'loading';
  /** 준비 화면에서 지금 열려 있는 쪽 */
  private lobbyPage: LobbyPage = 'main';
  private lobbyList?: number;
  /** 준비 화면을 그릴 때 저장되어 있던 판이 어느 판인지(runKey). 다른 곳이 같은 판을 이어 저장할 때마다 다시 그리지 않으려고 적어 둔다. */
  private lobbyRun = '';
  /**
   * 같은 기기의 다른 곳(설치한 앱이나 다른 탭)이 하던 판을 저장하거나 지웠다. 판은 기기에 하나만 남으므로
   * 이 곳은 들고 있던 판을 놓고 준비 화면으로 간다. 멈춰 있는 동안이었으면 다시 이어 할 때 간다.
   */
  private taken = false;
  private sim!: Sim;
  private view!: RunView;
  private stick!: Joystick;
  private pending = 0;
  private sinceSave = 0;
  private seconds = 0;
  private effects!: RunEffects;
  private readonly board = new SoundBoard(playNote);
  /** 다음 심장 소리까지 남은 시간(초) */
  private beatIn = 0;
  private hud!: RunHud;
  private hint?: Phaser.GameObjects.Text;
  /** 새로 시작한 판이고 첫 안내를 아직 보여 주지 않았다 */
  private fresh = false;
  /** 지금 떠 있는 한 줄 안내와 남은 시간(초), 그 뒤에 이어서 띄울 안내 */
  private tip?: Phaser.GameObjects.Text;
  private tipLeft = 0;
  private readonly tipQueue: string[] = [];
  /** 아직 한 번도 보지 않은 안내. 비어 있으면 일어난 일을 살펴보지 않는다. */
  private readonly unseen = new Set<TipId>();

  constructor() {
    super(LANTERN_SCENE);
  }

  create(data: StartData = {}): void {
    const mode = data.mode;
    // 오늘의 판을 공유한 주소로 들어왔으면 오늘의 판 쪽을 바로 연다. 그날이 지났으면 오늘의 판이라고 알린다.
    const shared = data.sharedDay !== undefined && mode === undefined;
    const page = shared ? 'daily' : (data.page ?? 'main');
    const list = data.list;
    const today = dayIndexOf(new Date());
    // 보낸 사람이 오늘의 판 점수를 실어 보냈으면 넘어 볼 친구 기록으로 적어 두고 알린다. 지난 날의 점수는 견줄 판이 없다.
    const friend = shared && data.sharedDay === today ? data.sharedScore : undefined;
    const notice =
      shared && data.sharedDay !== today
        ? SHARED_DAY_PASSED
        : friend !== undefined
          ? friendNotice(friend)
          : data.notice;
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "다시 하기"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerLanternTextures(this);
    this.phase = 'loading';
    this.pending = 0;
    this.sinceSave = 0;
    this.seconds = 0;
    this.beatIn = 0;
    this.hint = undefined;
    this.fresh = false;
    this.tip = undefined;
    this.tipLeft = 0;
    this.tipQueue.length = 0;
    this.unseen.clear();

    // 멈추거나 떠나면 음악도 잦아든다. 쪽을 넘기느라 씬을 다시 그릴 때는 끊기지 않는다.
    music.hush(false);
    const rest = (): void => music.rest();
    this.events.on(Phaser.Scenes.Events.PAUSE, rest);
    // 같은 기기의 다른 곳에서 진행이나 판을 저장하면 알려 온다.
    this.taken = false;
    const unwatch = metaStore.onChange((change) => this.onStoreChange(change));
    const leave = (): void => {
      if (this.taken) this.leaveTakenRun();
    };
    this.events.on(Phaser.Scenes.Events.RESUME, leave);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, rest);
      this.events.off(Phaser.Scenes.Events.RESUME, leave);
      unwatch();
      rest();
    });

    // 다른 곳에서 그사이 저장한 것이 있으면 그것을 읽어 와서 연다.
    void metaStore.refresh().then(() => {
      // 불러오는 사이에 씬을 떠났으면 아무것도 하지 않는다.
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      // 다른 곳에서 저장한 것까지 읽은 뒤에 적는다. 그래야 그 진행을 이 곳의 낡은 진행으로 덮지 않는다.
      if (friend !== undefined) {
        const met = meetFriend(metaStore.data, today, friend);
        if (met !== metaStore.data) metaStore.set(met);
      }
      if (mode === 'new') this.startRun(false);
      else if (mode === 'daily') this.startRun(false, true);
      else if (mode === 'resume' && metaStore.run) this.startRun(true);
      else if (mode === 'settle' && runDawned(metaStore.run)) this.startRun(true, false, true);
      else this.openLobby(page, list, notice);
    });
  }

  // ------------------------------------------------------------ 준비 화면

  private openLobby(page: LobbyPage, list?: number, notice?: string): void {
    this.phase = 'lobby';
    this.lobbyPage = page;
    this.lobbyList = list;
    // 업데이트로 새로 들어온 캐릭터와 무기가 있으면 첫 쪽에서 한 번 알린다. 다른 알림이 떠야 하면 다음에 첫 쪽을 열 때 알린다.
    // 알렸다고 적어 두면 새 캐릭터 카드에 "새"가 붙고 새 무기는 도감에 새 항목으로 뜬다.
    const news = unknownNews(metaStore.data);
    const announce = page === 'main' && notice === undefined && hasNews(news);
    if (announce) metaStore.set(announceNews(metaStore.data));
    this.lobbyRun = runKey(metaStore.run);
    music.play(LOBBY_SONG);
    buildLobby(
      this,
      {
        getMeta: () => metaStore.data,
        setMeta: (meta) => metaStore.set(meta),
        savedRun: metaStore.run,
        today: dayIndexOf(new Date()),
        onStart: () => this.restartWith('new'),
        onDaily: () => this.restartWith('daily'),
        onResume: () => this.restartWith('resume'),
        onBack: () => fadeToScene(this, homeScene()),
        // 쪽을 넘길 때는 기다림 없이 바로 다시 그린다.
        onPage: (next, nextList) => this.scene.restart({ page: next, list: nextList } satisfies StartData),
      },
      page,
      list,
    );
    const line = announce ? newsLine(news) : notice;
    if (line) this.showLobbyNotice(line);
  }

  /** 준비 화면 위에 한 줄을 잠깐 띄운다. 어두운 띠를 깔아서 뒤의 글자와 섞이지 않게 한다. */
  private showLobbyNotice(text: string): void {
    const label = addText(this, GAME_WIDTH / 2, 0, text, { color: CSS.white, originX: 0.5, originY: 0.5 }).setDepth(
      DEPTH.hud + 1,
    );
    // 띠보다 긴 줄(새로 들어온 것이 여럿일 때)은 띠에 맞춰 줄인다.
    const room = GAME_WIDTH - 8 - 20;
    if (label.width > room) label.setScale(room / label.width);
    const width = Math.min(GAME_WIDTH - 8, label.displayWidth + 20);
    const height = label.height + 12;
    // 불씨와 기록이 적힌 칸 바로 아래에 띄운다. 짧은 화면에서도 캐릭터 카드(새로 왔다고 알리는 것)를 가리지 않는다.
    const y = NOTICE_TOP + Math.round(height / 2);
    label.setY(y);
    const back = this.add
      .rectangle(GAME_WIDTH / 2, y, width, height, LOOK.noticeFill, 0.94)
      .setStrokeStyle(1, LOOK.noticeEdge)
      .setDepth(DEPTH.hud);
    this.tweens.add({
      targets: [label, back],
      alpha: 0,
      delay: 2400,
      duration: 500,
      onComplete: () => {
        label.destroy();
        back.destroy();
      },
    });
  }

  /**
   * 같은 기기의 다른 곳에서 진행(불씨, 강화)이나 하던 판을 저장했다. 준비 화면이면 새 진행으로 다시 그리고,
   * 판을 하던 중에 다른 곳이 판을 저장하거나 지웠으면 이 곳의 판을 놓는다. 불씨와 강화는 판이 끝날 때 새것에 더한다.
   */
  private onStoreChange(change: StoreChange): void {
    if (this.phase === 'lobby') {
      // 다른 곳이 하던 판을 이어 저장하기만 했으면(20초마다) 그대로 둔다. 이어 할 때는 어차피 가장 새로 저장된 판을 연다.
      if (!change.meta && runKey(metaStore.run) === this.lobbyRun) return;
      this.scene.restart({ page: this.lobbyPage, list: this.lobbyList } satisfies StartData);
      return;
    }
    if (!change.run || (this.phase !== 'run' && this.phase !== 'choosing')) return;
    this.taken = true;
    // 멈춰 있으면(일시정지 화면이 떠 있으면) 다시 이어 하려 할 때 준비 화면으로 간다.
    if (!this.scene.isPaused()) this.leaveTakenRun();
  }

  /** 다른 곳이 가져간 판을 놓고 준비 화면으로 간다. 이 곳의 낡은 판은 저장하지 않는다. */
  private leaveTakenRun(): void {
    this.taken = false;
    this.phase = 'loading';
    this.scene.restart({ notice: TAKEN_NOTICE } satisfies StartData);
  }

  /**
   * 새벽을 맞은 판(끝없는 밤 포함)을 저장해 둔 채로 새 판을 시작하려 하면, 버리지 않고 그 판을 마쳐서 결과부터 받는다.
   * 그냥 버리면 새벽을 맞은 기록과 점수가 사라지기 때문이다.
   */
  private restartWith(mode: StartData['mode']): void {
    const settle = (mode === 'new' || mode === 'daily') && runDawned(metaStore.run);
    fadeToScene(this, this.scene.key, { mode: settle ? 'settle' : mode } satisfies StartData);
  }

  // ------------------------------------------------------------ 한 판

  /**
   * daily면 오늘의 판: 캐릭터와 스테이지, 씨앗이 그날로 정해지고 영구 강화 없이 시작한다.
   * settle이면 저장해 둔 판을 이어서 하지 않고 그 자리에서 마친다.
   */
  private startRun(resume: boolean, daily = false, settle = false): void {
    const { height } = this.scale;
    const centerY = Math.round(height / 2) + PLAYER_DROP;
    // 캐릭터가 아래로 내려간 만큼 위쪽이 더 넓게 보이므로, 그 넓은 쪽에 맞춰 적이 화면 밖에서 나오게 한다.
    const view = { viewW: GAME_WIDTH, viewH: height + PLAYER_DROP * 2 };

    const saved = resume ? metaStore.run : null;
    const plan = daily ? dailyPlan(dayIndexOf(new Date())) : null;
    const state = saved
      ? { ...structuredClone(saved), ...view }
      : plan
        ? createRun({
            ...view,
            meta: {},
            hero: plan.hero,
            stage: plan.stage,
            depth: 0,
            seed: plan.seed,
            daily: plan.day,
            endless: true,
          })
        : createRun({
            ...view,
            endless: true,
            meta: metaStore.data.upgrades,
            hero: metaStore.data.hero,
            stage: metaStore.data.stage,
            depth: metaStore.data.depth,
            seed: Math.floor(Math.random() * 0x7fffffff),
            feast: feastOpen(metaStore.data) ? metaStore.data.feast : null,
          });
    if (!saved) metaStore.setRun(null);
    // 오늘의 판은 적이 나오는 차례와 강화 선택지도 씨앗을 따른다. 이어서 할 때는 멈춘 시각을 섞어 새로 뽑는다.
    this.sim = new Sim(
      state,
      state.daily === undefined ? Math.random : seededRandom(state.seed + Math.floor(state.t) * 7919),
    );
    // 이어 할 때도 바로 저장해서 다른 곳에 알린다. 같은 판을 하던 다른 곳(나란히 띄운 창)은 그 판을 놓으므로,
    // 마지막으로 이어 하기를 누른 곳이 판을 맡는다. 새로 시작할 때 위에서 판을 지워 알리는 것과 같다.
    if (saved && !settle) this.saveRun();
    this.pickSong();
    for (const id of TIP_IDS) if (!metaStore.data.tips.includes(id)) this.unseen.add(id);

    this.view = new RunView(this, centerY, this.sim, { top: HUD_HEIGHT, bar: BOSS_BAR_HEIGHT });
    this.effects = new RunEffects(this, DEPTH.fx, HUD_HEIGHT);
    this.hud = new RunHud(
      this,
      { top: DEPTH.hud, field: DEPTH.field },
      GAME_WIDTH / 2,
      this.view.centerY,
      () => {
        sfx.click();
        this.pauseGame();
      },
      this.sim.slots,
    );
    this.stick = new Joystick(this, HUD_HEIGHT, DEPTH.stick);
    this.view.sync(this.sim, 0, 0);
    this.drawHud();

    if (!saved) {
      this.fresh = true;
      sfx.go();
    }

    this.playing = true;
    if (settle) {
      this.sim.settle();
      this.endRun();
    } else {
      this.openNext();
    }
  }

  /** 기다리는 선택이 있으면 그 화면을 열고, 없으면 판을 이어 간다. 새벽의 선택이 가장 먼저고, 강화권이 레벨업보다 먼저다. */
  private openNext(delayTicket = false): void {
    const s = this.sim.state;
    if (s.pendingDawn) this.openDawn(delayTicket);
    else if (this.sim.pendingBoons > 0) this.openBoon(delayTicket);
    else if (s.pendingTickets > 0) this.openTicket(delayTicket);
    else if (s.pendingLevelUps > 0) this.openLevelUp();
    else this.resumeRun();
  }

  private resumeRun(): void {
    this.phase = 'run';
    music.hush(false);
    this.stick.enabled = true;
    this.stick.reset();
    this.drawHud();
    if (this.fresh) this.showIntro();
  }

  /**
   * 새 판의 첫 안내: 움직이는 법과, 깊은 밤이면 어느 단계에 들어왔는지.
   * "밝은 출발"로 강화를 먼저 고를 때는 그 화면에 가려지지 않도록 화면이 닫힌 뒤에 보여 준다.
   */
  private showIntro(): void {
    this.fresh = false;
    const height = this.scale.height;
    this.hint = addText(this, GAME_WIDTH / 2, height - 54, '화면을 누른 채 끌면 움직여요', {
      color: CSS.white,
      originX: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.banner);
    const depth = this.sim.state.depth;
    if (this.sim.state.daily !== undefined) showBanner(this, height * 0.3, '오늘의 판', CSS.yellow, 1600, DEPTH.banner);
    else {
      // 잔치의 밤이면 그 이름과 난이도를 먼저, 깊은 밤이면 그 단계를 아래에 띄운다.
      // 셋이 쌓이면 맨 아래 줄이 캐릭터의 머리에 닿지 않게 묶음을 조금 올린다.
      const feast = this.sim.state.feast;
      let y = height * 0.3 - (isFeast(feast) && depth ? STACKED_BANNER_LIFT : 0);
      if (isFeast(feast)) {
        showBanner(this, y, FEAST.name, CSS.orange, 1600, DEPTH.banner);
        showBanner(this, y + 38, FEAST_LEVELS[feast].name, FEAST_COLOR[feast], 1600, DEPTH.banner, FONT_SIZE.large);
        y += 80;
      }
      if (depth) showBanner(this, y, depthName(depth), CSS.sky, 1600, DEPTH.banner);
    }
  }

  override update(_time: number, delta: number): void {
    music.tick();
    if (this.phase !== 'run') return;
    const frame = Math.min(delta / 1000, MAX_FRAME);
    this.seconds += frame;
    this.pending += frame;
    this.stick.update();
    if (this.hint && (this.stick.x !== 0 || this.stick.y !== 0)) this.fadeHint();
    this.tickTip(frame);

    const sim = this.sim;
    while (this.pending >= STEP && this.phase === 'run') {
      this.pending -= STEP;
      sim.step(STEP, this.stick.x, this.stick.y);
      this.handleEvents();
      if (sim.state.over) break;
      if (sim.state.pendingDawn || sim.pendingBoons > 0 || sim.state.pendingTickets > 0 || sim.state.pendingLevelUps > 0) {
        this.openNext(true);
      }
    }

    this.view.sync(sim, this.seconds, frame);
    this.drawHud();
    // 끝나는 장면은 마지막 모습을 그린 뒤에 시작한다.
    if (sim.state.over) {
      this.endRun();
      return;
    }
    this.heartbeat(frame);

    this.sinceSave += frame;
    if (this.sinceSave >= SAVE_EVERY && this.phase === 'run') this.saveRun();
  }

  private handleEvents(): void {
    const sim = this.sim;
    const board = this.board;
    const now = this.time.now;
    for (const event of sim.events) {
      if (this.unseen.size > 0) this.offerTip(event);
      switch (event.type) {
        case 'kill':
          this.view.burst(sim, event.x, event.y, event.boss ? 40 : 4);
          if (event.boss) {
            // 마지막 보스를 쓰러뜨렸으면 밝은 소리는 뒤따르는 새벽 소리가 맡는다.
            board.play(sim.state.over === 'cleared' || sim.state.pendingDawn ? 'bossFall' : 'bossKill', now);
            this.effects.flash(0.45, 320);
            vibrate([30, 40, 30]);
            this.effects.shake(260, 0.018);
            this.pickSong();
          } else {
            board.play('kill', now);
          }
          break;
        case 'hurt':
          this.hud.hurt(this.seconds);
          this.effects.hurt();
          board.play('hurt', now);
          vibrate(35);
          this.effects.shake(110, 0.014);
          break;
        case 'gem':
          board.gem(now);
          break;
        case 'heal':
          board.play('heal', now);
          break;
        case 'pull':
          board.play('pull', now);
          break;
        case 'blast':
          board.play('blast', now);
          this.effects.flash(0.4, 260);
          this.effects.shake(200, 0.014);
          vibrate([20, 30, 40]);
          break;
        case 'block':
          this.view.burst(sim, sim.state.player.x, sim.state.player.y, 14);
          board.play('block', now);
          vibrate(15);
          break;
        case 'spit':
          board.play('spit', now);
          break;
        case 'post':
          this.view.beacon(sim, event.x, event.y);
          board.play('post', now);
          break;
        case 'light':
          this.view.burst(sim, event.x, event.y, 16);
          board.play('light', now);
          this.effects.flash(0.18, 220);
          vibrate(20);
          break;
        case 'dim':
          board.play('dim', now);
          break;
        case 'burst':
          this.view.pop(event.x, event.y, event.radius);
          this.view.burst(sim, event.x, event.y, 10);
          board.play('burst', now);
          break;
        case 'strike':
          this.view.ring(event.x, event.y, event.radius);
          board.play('strike', now);
          break;
        case 'bolt':
          this.view.bolt(event.points, event.evolved);
          // 번개가 닿은 자리마다 불티가 튄다.
          for (let i = 2; i < event.points.length; i += 2) {
            this.view.burst(sim, event.points[i], event.points[i + 1], 2);
          }
          board.play('bolt', now);
          break;
        case 'swing':
          this.view.swing(event.angle, event.arc, event.reach, event.count, event.evolved);
          board.play('swing', now);
          break;
        case 'lamp':
          board.play('lamp', now);
          break;
        case 'bell':
          board.play('bell', now);
          // 새벽 종은 두 번 울린다.
          if (event.evolved) board.play('bell', now, 0.3);
          break;
        case 'vent':
          board.play('vent', now);
          break;
        case 'gust':
          // 일기 시작할 때 한 번 운다. 세게 불기 시작하면 화면이 살짝 흔들린다.
          if (event.phase === 'warn') board.play('gust', now);
          else this.effects.shake(140, 0.004);
          break;
        case 'chill':
          board.play('chill', now);
          break;
        case 'leap':
          board.play('leap', now);
          break;
        case 'land':
          // 내려앉은 자리에 흙먼지 고리가 퍼진다.
          this.view.ring(event.x, event.y, 22);
          board.play('land', now);
          break;
        case 'stomp':
          this.view.burst(sim, event.x, event.y, 3);
          board.play('stomp', now);
          break;
        case 'sprout':
          board.play('sprout', now);
          break;
        case 'quake':
          board.play('quake', now);
          this.effects.shake(220, 0.006);
          break;
        case 'pounce':
          board.play('pounce', now);
          break;
        case 'thud':
          this.view.pop(event.x, event.y, event.radius);
          board.play('thud', now);
          this.effects.shake(120, 0.004);
          break;
        case 'spark':
          this.view.flint(sim, event.x, event.y, event.radius);
          board.play('flint', now);
          break;
        case 'boss':
          showBanner(this, this.scale.height * 0.3, ENEMIES[event.kind].name, CSS.red, 1800, DEPTH.banner);
          board.play('boss', now);
          // 가장자리가 두 번 붉게 뛴다.
          this.effects.beat();
          this.time.delayedCall(420, () => this.effects.beat());
          vibrate([40, 60, 40]);
          this.effects.shake(180, 0.008);
          this.pickSong();
          break;
        case 'elite':
          showBanner(this, this.scale.height * 0.3, '정예 그림자!', CSS.yellow, 1400, DEPTH.banner);
          board.play('elite', now);
          this.effects.beat();
          break;
        case 'chest': {
          const p = sim.state.player;
          const up = event.upgrade;
          showBanner(this, this.scale.height * 0.3, '보물 상자!', CSS.yellow, 1800, DEPTH.banner);
          // 무엇이 올랐는지는 그 아래에 한 줄로 알린다.
          this.showGain(up && 'level' in up ? `${upgradeTitle(up)} ${up.level}레벨` : `불씨 +${CHEST.embers}`);
          this.view.burst(sim, p.x, p.y, 18);
          this.effects.flash(0.3, 260);
          board.play('chest', now);
          vibrate(20);
          break;
        }
        case 'surge':
          showBanner(this, this.scale.height * 0.3, '그림자 밀물!', CSS.orange, 1400, DEPTH.banner);
          board.play('surge', now);
          this.effects.beat();
          break;
        case 'revive':
          showBanner(this, this.scale.height * 0.3, '등불이 다시 켜졌다!', CSS.yellow, 1600, DEPTH.banner);
          this.view.burst(sim, sim.state.player.x, sim.state.player.y, 30);
          this.effects.flash(0.5, 420);
          board.play('revive', now, 0.15);
          vibrate([20, 30, 60]);
          break;
        case 'windup':
          board.play('windup', now);
          break;
        case 'dash':
          board.play('dash', now);
          this.effects.shake(90, 0.006);
          break;
        case 'charge':
          board.play('charge', now);
          break;
        case 'volley':
          board.play('volley', now);
          break;
        case 'levelup':
        case 'ticket':
        case 'shoot':
        case 'swell':
          break;
      }
    }
  }

  /**
   * 지금 틀 곡을 고른다. 보스가 살아 있으면 보스의 곡(마지막 보스는 더 빠른 곡), 아니면 스테이지의 곡.
   * 보스가 쓰러져 스테이지의 곡으로 돌아올 때는 떠났던 마디에서 이어 간다.
   */
  private pickSong(): void {
    const s = this.sim.state;
    if (s.over) return;
    const boss = s.enemies.find((enemy) => ENEMIES[enemy.kind].boss && enemy.hp > 0);
    // 끝없는 밤에서는 마지막 보스의 곡이 줄곧 흐른다.
    if (s.endless) music.play(FINAL_SONG);
    else if (!boss) music.play(STAGE_SONGS[s.stage], { resume: true });
    else music.play(boss.kind === STAGES[s.stage].finalBoss ? FINAL_SONG : BOSS_SONG);
  }

  /** 체력이 위험하면 심장 소리가 뛰고, 그때마다 화면 가장자리가 붉게 뛴다. */
  private heartbeat(frame: number): void {
    const ratio = this.sim.state.player.hp / this.sim.maxHp;
    const low = ratio <= HP_DANGER;
    this.effects.setLow(low);
    if (!low) {
      this.beatIn = 0;
      return;
    }
    this.beatIn -= frame;
    if (this.beatIn > 0) return;
    this.beatIn = ratio <= HEARTBEAT.fastBelow ? HEARTBEAT.fast : HEARTBEAT.slow;
    this.board.play('heartbeat', this.time.now);
    this.effects.beat();
  }

  /** 큰 알림 글자 아래에 뜨는 한 줄. 보물 상자가 무엇을 올려 줬는지 알린다. 길면 화면 폭에 맞춰 줄인다. */
  private showGain(label: string): void {
    const line = addText(this, GAME_WIDTH / 2, Math.round(this.scale.height * 0.3) + 30, label, {
      size: FONT_SIZE.large,
      color: CSS.white,
      originX: 0.5,
      originY: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.banner);
    const room = GAME_WIDTH - 24;
    if (line.width > room) line.setScale(room / line.width);
    this.tweens.add({ targets: line, alpha: 0, delay: 1300, duration: 500, onComplete: () => line.destroy() });
  }

  /** 처음 겪는 일이면 그 일의 안내를 띄우고, 봤다고 적어 둔다. 한 번 본 안내는 다시 뜨지 않는다. */
  private offerTip(event: SimEvent): void {
    const id = tipFor(event);
    if (!id || !this.unseen.has(id)) return;
    this.unseen.delete(id);
    metaStore.set(learnTip(metaStore.data, id));
    this.tipQueue.push(TIPS[id]);
  }

  /**
   * 화면 아래쪽의 한 줄 안내를 차례로 띄운다. 하나가 사라진 뒤에 다음 것이 뜬다.
   * 판이 흐르는 동안에만 시간이 가므로, 강화를 고르는 화면에 가려진 채로 사라지지 않는다.
   */
  private tickTip(frame: number): void {
    if (this.tip) {
      this.tipLeft -= frame;
      this.tip.setAlpha(Math.max(0, Math.min(1, this.tipLeft / TIP.fade)));
      if (this.tipLeft > 0) return;
      this.tip.destroy();
      this.tip = undefined;
    }
    const label = this.tipQueue.shift();
    if (label === undefined) return;
    // 움직이는 법 안내가 아직 떠 있으면 그 자리를 넘겨받는다.
    this.hint?.destroy();
    this.hint = undefined;
    this.tip = addText(this, GAME_WIDTH / 2, this.scale.height - 54, label, {
      color: CSS.white,
      originX: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.banner);
    this.tipLeft = TIP.seconds;
  }

  /** 떠 있는 안내(움직이는 법 안내까지)와 기다리는 안내를 모두 치운다. */
  private clearTips(): void {
    this.hint?.destroy();
    this.hint = undefined;
    this.tip?.destroy();
    this.tip = undefined;
    this.tipQueue.length = 0;
  }

  private fadeHint(): void {
    const hint = this.hint;
    if (!hint) return;
    this.hint = undefined;
    this.tweens.add({ targets: hint, alpha: 0, delay: 600, duration: 400, onComplete: () => hint.destroy() });
  }

  // ------------------------------------------------------------ 레벨업

  /** again은 다시 뽑아서 같은 레벨업 화면을 새로 여는 것. 레벨업 소리를 또 내지 않는다. */
  private openLevelUp(again = false): void {
    this.phase = 'choosing';
    music.hush(true);
    this.stick.enabled = false;
    this.stick.reset();
    if (!again) {
      this.board.play('levelUp', this.time.now);
      vibrate(15);
    }
    this.drawHud();
    const rerolls = this.sim.rerolls;
    showChoices(
      this,
      levelUpHeader(this.sim.state.player.level),
      this.sim.options(),
      DEPTH.panel,
      (upgrade) => {
        this.sim.applyUpgrade(upgrade);
        this.afterPick(upgrade);
      },
      HUD_HEIGHT,
      // 영구 강화 "다시 뽑기"를 샀고 이번 판에 아직 남아 있으면 선택지를 새로 뽑을 수 있다.
      rerolls > 0
        ? {
            label: `다시 뽑기 (${rerolls}번 남음)`,
            onTap: () => {
              this.sim.reroll();
              this.openLevelUp(true);
            },
          }
        : undefined,
    );
  }

  /**
   * 새벽: 여기서 마칠지, 끝없는 밤으로 이어 갈지 고른다.
   * 고르기 전에 저장해 두므로, 이 화면에서 앱을 닫아도 다음에 같은 선택이 다시 나온다.
   */
  private openDawn(delayed: boolean): void {
    this.phase = 'choosing';
    music.hush(true);
    this.stick.enabled = false;
    this.stick.reset();
    this.drawHud();
    this.saveRun();
    const show = (): void => {
      // 기다리는 사이에 씬을 떠났으면 열지 않는다.
      if (!this.sys.isActive() || this.phase !== 'choosing') return;
      this.board.play('clear', this.time.now, 0.3);
      vibrate([20, 40, 20, 40, 60]);
      showDawnChoice(this, DEPTH.panel, scoreFor(this.sim.summary()), (goOn) => {
        this.sim.chooseDawn(goOn);
        if (!goOn) {
          this.endRun();
          return;
        }
        showBanner(this, this.scale.height * 0.3, '끝없는 밤', CSS.sky, 1800, DEPTH.banner);
        this.board.play('boss', this.time.now);
        this.pickSong();
        this.saveRun();
        // 들어서는 자리에서 밤의 축복을 하나 고른다. 알림이 잠깐 보이도록 조금 뒤에 연다.
        this.openNext(true);
      });
    };
    // 마지막 보스가 쓰러지는 모습을 보고 나서 연다.
    if (delayed) this.time.delayedCall(DAWN_DELAY_MS, show);
    else show();
  }

  /** 밤의 축복: 끝없는 밤에서 그림자가 세질 때마다 셋 가운데 하나를 고른다. */
  private openBoon(delayed: boolean): void {
    this.phase = 'choosing';
    music.hush(true);
    this.stick.enabled = false;
    this.stick.reset();
    this.drawHud();
    const show = (): void => {
      // 기다리는 사이에 씬을 떠났으면 열지 않는다.
      if (!this.sys.isActive() || this.phase !== 'choosing') return;
      this.board.play('ticket', this.time.now);
      vibrate(15);
      showChoices(
        this,
        BOON_HEADER,
        this.sim.boonChoices(),
        DEPTH.panel,
        (upgrade) => {
          this.sim.takeBoon(upgrade);
          this.afterPick(upgrade);
        },
        HUD_HEIGHT,
      );
    };
    if (delayed) this.time.delayedCall(TICKET_DELAY_MS, show);
    else show();
  }

  /** 무기 강화권: 가진 무기 가운데 하나를 골라 한 레벨 올린다. */
  private openTicket(delayed: boolean): void {
    this.phase = 'choosing';
    music.hush(true);
    this.stick.enabled = false;
    this.stick.reset();
    this.drawHud();
    const show = (): void => {
      // 기다리는 사이에 씬을 떠났으면 열지 않는다.
      if (!this.sys.isActive() || this.phase !== 'choosing') return;
      this.board.play('ticket', this.time.now);
      vibrate(15);
      // 끝없는 밤에서 더 올릴 무기가 없으면 강화권으로 밤의 축복을 고른다.
      const choices = this.sim.ticketChoices();
      showChoices(
        this,
        choices.every((upgrade) => upgrade.type === 'boon') ? BOON_HEADER : TICKET_HEADER,
        choices,
        DEPTH.panel,
        (upgrade) => {
          this.sim.useTicket(upgrade);
          this.afterPick(upgrade);
        },
        HUD_HEIGHT,
      );
    };
    if (delayed) this.time.delayedCall(TICKET_DELAY_MS, show);
    else show();
  }

  /** 고른 강화가 몸에 붙는 순간. 무기가 최종 진화하면 크게 알린다. */
  private celebrate(upgrade: Upgrade): void {
    const sim = this.sim;
    const p = sim.state.player;
    if (upgrade.type !== 'weapon' || !isEvolved(upgrade.level)) {
      this.view.burst(sim, p.x, p.y, 8);
      return;
    }
    const y = Math.round(this.scale.height * 0.3);
    const lead = addText(this, GAME_WIDTH / 2, y - 29, '최종 진화', {
      color: CSS.white,
      originX: 0.5,
      originY: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.banner);
    this.tweens.add({ targets: lead, alpha: 0, delay: 1200, duration: 800, onComplete: () => lead.destroy() });
    showBanner(this, y, `${WEAPONS[upgrade.id].evolved.name}!`, CSS.yellow, 2000, DEPTH.banner);
    this.view.burst(sim, p.x, p.y, 60);
    this.view.ring(p.x, p.y, 72);
    this.effects.flash(0.5, 420);
    this.board.play('evolve', this.time.now);
    vibrate([20, 30, 20, 30, 80]);
    this.effects.shake(220, 0.012);
  }

  private afterPick(upgrade: Upgrade): void {
    this.celebrate(upgrade);
    this.drawHud();
    const s = this.sim.state;
    // 고를 것이 남아 있지 않을 때만 저장한다. 다음 화면은 곧바로 연다.
    if (this.sim.pendingBoons === 0 && s.pendingTickets === 0 && s.pendingLevelUps === 0) this.saveRun();
    this.openNext();
  }

  // ------------------------------------------------------------ 저장과 끝

  private saveRun(): void {
    this.sinceSave = 0;
    // 다른 곳이 가져간 판이면 저장하지 않는다. 그 곳의 새 판을 이 곳의 낡은 판으로 덮지 않도록.
    if (!this.sim.state.over && !this.taken) metaStore.setRun(this.sim.state);
  }

  /** 뒤로 가기: 준비 화면에서는 한 걸음 뒤로(오늘의 랭킹 → 오늘의 판 → 고르는 쪽 → 허브), 판 중에는 일시정지 */
  override onBackRequest(): void {
    if (this.phase !== 'lobby') {
      super.onBackRequest();
      return;
    }
    const parent = parentPage(this.lobbyPage);
    if (parent !== null) this.scene.restart({ page: parent } satisfies StartData);
    else fadeToScene(this, homeScene());
  }

  protected override pauseGame(): void {
    // 준비 화면에서는 멈출 것이 없다.
    if (this.phase !== 'run' && this.phase !== 'choosing') return;
    // 앱이 가려진 채로 닫혀도 이어서 할 수 있게 먼저 저장한다.
    this.saveRun();
    super.pauseGame();
  }

  /**
   * 일시정지의 가운데 버튼은 이 게임에서 판을 버리지 않는다. 멈출 때 저장해 둔 판을 남긴 채 준비 화면으로 가서,
   * 거기서 이어 하거나 새로 시작할 수 있다. 그래서 버튼에도 그렇게 적는다.
   */
  protected override restartLabel(): string {
    return '준비 화면으로';
  }

  /** 오늘의 판을 마쳤으면 결과 화면의 "다시 하기"가 준비 화면의 오늘의 판 쪽을 연다. 거기서 바로 다시 도전한다. */
  protected override retryData(): StartData | undefined {
    return this.sim.state.daily !== undefined ? { page: 'daily' } : undefined;
  }

  /** 멈춘 김에 지금 빌드(무기와 패시브의 이름과 레벨, 무기마다 준 피해)를 볼 수 있게 한다. */
  protected override pauseExtra(): PauseExtra {
    return pauseInfo(this.sim.state, this.scale.height);
  }

  private endRun(): void {
    this.phase = 'over';
    // 음악이 잦아든 자리에 새벽 소리나 꺼지는 소리가 들어온다.
    music.stop();
    this.stick.enabled = false;
    this.stick.reset();
    this.clearTips();

    const summary = this.sim.summary();
    const embers = embersFor(summary, metaStore.data.upgrades.lucky);
    const before = metaStore.data;
    const state = this.sim.state;
    const stage = state.stage;
    // 오늘 시작한 오늘의 판만 그날의 기록에 남는다. 날이 넘어간 뒤에 이어서 끝낸 판은 보통 판으로 친다.
    const today = dayIndexOf(new Date());
    const daily = state.daily === today ? { day: today, score: scoreFor(summary) } : undefined;
    // 오늘의 랭킹에 올릴 기록으로 적어 둔다. 아래에서 판을 마칠 때 다른 기록과 함께 서버에 올라간다.
    if (daily) noteDayScore(LANTERN_GAME_ID, daily.score, daily.day);
    metaStore.setRun(null);
    metaStore.set(
      applyRun(before, {
        daily,
        embers,
        seconds: summary.seconds,
        cleared: summary.cleared,
        hero: state.hero,
        stage,
        depth: summary.depth,
        kills: summary.countedKills,
        bossKills: summary.bossKills,
        level: summary.level,
        evolved: ownedWeapons(state.weapons).filter((id) => isEvolved(state.weapons[id] ?? 0)),
        seen: state.seen,
        endlessSeconds: summary.endlessSeconds,
        chests: state.chests ?? 0,
      }),
    );
    const opened = newUnlocks(before.bestSeconds, metaStore.data.bestSeconds);
    // 완주해서 이 스테이지의 다음 깊은 밤이 열렸으면 함께 알린다.
    const deeper = newDepth(before, metaStore.data, stage);
    if (deeper) opened.push(deeper);
    // 처음 새벽을 맞으면 잔치의 밤도 열린다.
    if (!feastOpen(before) && feastOpen(metaStore.data)) opened.push(FEAST.name);

    // 끝나는 장면: 새벽이 오면 어둠이 걷히며 남은 그림자가 흩어지고, 쓰러지면 등불이 꺼지듯 어두워진다.
    // 끝없는 밤에서 쓰러졌으면 새벽을 맞은 기록은 남지만 장면은 등불이 꺼지는 쪽이다.
    const fell = state.over === 'dead';
    const ending = fell ? ENDING_MS.dead : ENDING_MS.cleared;
    const now = this.time.now;
    if (!fell) {
      this.view.dawn(this.sim, ending * 0.6);
      this.effects.dawn(ending * 0.6);
      this.board.play('clear', now, 0.3);
      vibrate([20, 40, 20, 40, 60]);
    } else {
      this.view.dusk(ending * 0.6);
      this.effects.dusk(ending * 0.7);
      this.board.play('death', now, 0.2);
      vibrate(120);
    }
    showBanner(
      this,
      this.scale.height * 0.32,
      fell ? '등불이 꺼졌다' : '새벽이 왔다!',
      fell ? CSS.silver : CSS.yellow,
      // 결과 화면이 뜰 때까지 남아 있게 한다.
      ending * 1.6,
      DEPTH.banner,
    );

    const was = dailyToday(before.daily, today);
    const firstDaily = daily !== undefined && was.tries === 0;
    const stats: ResultStat[] = [
      ['버틴 시간', formatClock(summary.seconds)],
      ['쓰러뜨린 그림자', String(summary.kills)],
      ['레벨', String(summary.level)],
      ['얻은 불씨', `+${embers + (firstDaily ? DAILY_REWARD : 0)}`],
    ];
    // 끝없는 밤으로 이어 갔으면 버틴 시간을 새벽 뒤로 얼마나 더 버텼는지로 적는다.
    if (state.endless) {
      stats[0] = ['버틴 시간', `새벽 + ${formatClock(summary.endlessSeconds)}`];
    }
    // 오늘의 판: 오늘 처음이면 보너스와 이어 온 날 수를, 아니면 오늘의 최고 기록과 견준 결과를 보여 준다.
    // 공유받은 친구 기록이 있으면 그것과 견준 결과를 바로 아래에 둔다.
    if (daily) {
      const now = metaStore.data.daily;
      const friend = friendToday(metaStore.data.friend, daily.day);
      if (friend !== null) stats.unshift(['친구 기록', friendVerdict(friend, daily.score)]);
      stats.unshift([
        '오늘의 판',
        firstDaily
          ? `${now.streak}일째 · 보너스 +${DAILY_REWARD}`
          : daily.score > was.best
            ? '오늘의 최고 기록!'
            : `오늘 최고 ${was.best}점`,
      ]);
    }
    // 이번 판으로 이룬 도전 과제가 있으면 알려 준다. 보상은 준비 화면에서 받는다.
    const feats = newlyDone(before, metaStore.data);
    if (feats.length > 0) {
      stats.push(['도전 과제 달성', feats.length === 1 ? feats[0].title : `${feats[0].title} 외 ${feats.length - 1}`]);
    }
    // 잔치의 밤이었으면 난이도와, 점수와 불씨에 붙은 배율을 보여 준다.
    if (isFeast(summary.feast)) stats.unshift([FEAST.name, feastNote(summary.feast)]);
    // 깊은 밤에서는 점수에 배율이 붙었다는 것을 보여 준다.
    if (summary.depth > 0) {
      const rules = depthRules(summary.depth);
      stats.unshift([
        depthName(summary.depth),
        `점수 ${formatTimes(rules.score)} · 불씨 ${formatTimes(rules.embers)}`,
      ]);
    }
    // 이번 기록으로 캐릭터나 스테이지가 열렸으면 알려 준다.
    if (opened.length > 0) {
      stats.push(['새로 열림', opened.length <= 2 ? opened.join(' · ') : `${opened[0]} 외 ${opened.length - 1}`]);
    }
    // 어느 무기가 일을 했는지: 무기마다 준 피해의 비중을 많이 준 순서대로 보여 준다.
    const ranking = damageRanking(state.weapons, state.dealt);
    const strip =
      ranking.length > 0
        ? {
            caption: '무기별 피해 (%)',
            chips: ranking.map((row) => ({ texture: iconKey(row.icon), label: String(Math.round(row.share * 100)) })),
          }
        : undefined;
    // 오늘의 판이면 그날의 판이라는 것과 캐릭터, 스테이지, 이어 온 날 수를 적은 카드를 보내고, 주소도 오늘의 판을 바로 연다.
    const share = daily ? dailyShare(daily.day, daily.score, metaStore.data.daily.streak) : undefined;
    this.finishMiniGame(scoreFor(summary), stats, ending, strip, share);
  }

  /** 끝맺음 소리는 endRun에서 새벽 소리나 꺼지는 소리로 따로 낸다. */
  protected override playFinishSound(): void {}

  // ------------------------------------------------------------ HUD

  private drawHud(): void {
    this.hud.draw(this.sim, this.seconds, this.phase === 'choosing');
  }
}
