import { homeScene } from '../../core/home';
import { fadeToScene } from '../../core/ui';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { PX_CSS, registerTowerTextures } from './art';
import { BattleView } from './battle-view';
import { drawSky } from './bits';
import { DIFFICULTY_TEXT, difficultyOf } from './difficulty';
import { TOWER_GAME_ID, TOWER_SCENE } from './data';
import {
  abandon,
  actOf,
  createRun,
  floorsCleared,
  runScore,
  settleRun,
  shardsFor,
  type RunState,
} from './run';
import {
  buildChest,
  buildEvent,
  buildLobby,
  buildPicker,
  buildRest,
  buildReward,
  buildShop,
  eventPicker,
  removePicker,
  upgradePicker,
  type LobbyTab,
  type ScreenHooks,
} from './screens';
import { buildMap } from './tower-map';
import { buildCodex, type CodexTab } from './codex-view';
import { towerStore } from './store';

/** 판 안에서 덱을 고르는 화면처럼, 판의 화면 위에 잠깐 여는 것 */
export type Overlay = 'deck' | 'upgrade' | 'remove' | 'event';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
export interface TowerStart {
  /** run이면 하던 판(없으면 새 판)의 지금 화면을, codex면 도감을 연다. */
  mode?: 'run' | 'codex';
  /** 도감에서 연 쪽 */
  codexTab?: CodexTab;
  /** 준비 화면에서 연 쪽(강화, 유물) */
  lobbyTab?: LobbyTab;
  overlay?: Overlay;
  /** 수상한 길에서 카드를 골라야 하는 고르기의 번호 */
  choice?: number;
  /** 가게 목록의 쪽 */
  shopPage?: number;
}

type Phase = 'loading' | 'lobby' | 'codex' | 'run' | 'over';

/**
 * 구름 탑 모험: 카드로 싸우며 구름 탑을 오르는 덱 빌딩 게임.
 * 싸워서 얻은 카드로 덱을 키우고, 갈림길에서 길을 골라 21층 꼭대기까지 간다. 쓰러지면 판이 끝나지만
 * 오른 만큼 구름 조각을 받아 영구 강화를 산다. 판은 화면을 넘길 때마다 저장돼서 언제 닫아도 이어 한다.
 * 규칙은 battle.ts와 run.ts가 맡고, 이 씬은 판의 stage에 맞는 화면을 연다. 화면을 넘길 때는 씬을 다시 시작한다.
 */
export class CloudTowerScene extends MiniGameScene {
  protected readonly gameId = TOWER_GAME_ID;

  private phase: Phase = 'loading';
  /** 하고 있는 판. 자동 점검이 들여다본다. */
  run: RunState | null = null;
  battleView: BattleView | null = null;

  constructor() {
    super(TOWER_SCENE);
  }

  create(data: TowerStart = {}): void {
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "다시 하기"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerTowerTextures(this);
    this.phase = 'loading';
    this.run = null;
    this.battleView = null;
    this.cameras.main.setBackgroundColor(PX_CSS.dark);

    void towerStore.refresh().then(() => {
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      if (data.mode === 'run') this.openRun(data);
      else if (data.mode === 'codex') this.openCodex(data.codexTab ?? 0);
      else this.openLobby(data.lobbyTab ?? 0);
    });
  }

  // ───────── 준비 화면 ─────────

  private openLobby(tab: LobbyTab = 0): void {
    this.phase = 'lobby';
    buildLobby(this, {
      getMeta: () => towerStore.data,
      setMeta: (meta) => towerStore.set(meta),
      onStart: () => {
        const meta = towerStore.data;
        const run = createRun({
          seed: Math.floor(Math.random() * 0x7fffffff),
          levels: meta.levels,
          relics: meta.relics,
          difficulty: meta.difficulty,
        });
        towerStore.set({ ...meta, run });
        this.go();
      },
      onResume: () => this.go(),
      onGiveUp: () => {
        const run = towerStore.data.run;
        if (!run) return;
        abandon(run);
        this.go();
      },
      onBack: () => fadeToScene(this, homeScene()),
      onCodex: () => this.scene.restart({ mode: 'codex' } satisfies TowerStart),
      onTab: (next) => this.scene.restart({ lobbyTab: next } satisfies TowerStart),
    }, tab);
  }

  private openCodex(tab: CodexTab): void {
    this.phase = 'codex';
    buildCodex(this, {
      getMeta: () => towerStore.data,
      setMeta: (meta) => towerStore.set(meta),
      onTab: (next) => this.scene.restart({ mode: 'codex', codexTab: next } satisfies TowerStart),
      onBack: () => this.scene.restart({} satisfies TowerStart),
    }, tab);
  }

  /** 판의 지금 화면을 연다(씬을 다시 시작한다). */
  private go(extra: Omit<TowerStart, 'mode'> = {}): void {
    this.scene.restart({ mode: 'run', ...extra } satisfies TowerStart);
  }

  /** 준비 화면에서는 뒤로 가기가 허브로 나가고, 판을 하는 동안에는 일시정지한다. */
  override onBackRequest(): void {
    if (this.phase === 'lobby') fadeToScene(this, homeScene());
    else if (this.phase === 'codex') this.scene.restart({} satisfies TowerStart);
    else this.pauseGame();
  }

  protected override pauseGame(): void {
    if (this.phase !== 'run') return;
    super.pauseGame();
  }

  protected override restartLabel(): string | null {
    return '준비 화면으로';
  }

  // ───────── 판 ─────────

  private save(): void {
    const run = this.run;
    if (!run) return;
    towerStore.set({ ...towerStore.data, run });
  }

  private openRun(data: TowerStart): void {
    const run = towerStore.data.run;
    if (!run) {
      this.openLobby();
      return;
    }
    this.run = run;
    this.phase = 'run';
    this.playing = true;
    if (run.stage === 'over') {
      this.endRun(run);
      return;
    }
    this.addPauseButton();
    const hooks: ScreenHooks = {
      next: () => {
        this.save();
        this.go();
      },
      save: () => this.save(),
    };
    const back = (): void => this.go({ shopPage: data.shopPage });
    if (data.overlay === 'deck') {
      buildPicker(this, run, { title: `덱 ${run.deck.length}장`, cards: run.deck, onPick: null, onClose: back });
      return;
    }
    if (data.overlay === 'upgrade' && run.stage === 'rest') {
      buildPicker(this, run, upgradePicker(run, hooks, back));
      return;
    }
    if (data.overlay === 'remove' && run.stage === 'shop') {
      buildPicker(this, run, removePicker(run, () => {
        this.save();
        back();
      }));
      return;
    }
    if (data.overlay === 'event' && run.stage === 'event' && data.choice !== undefined) {
      buildPicker(this, run, eventPicker(run, data.choice, hooks, back));
      return;
    }
    switch (run.stage) {
      case 'map':
        buildMap(this, run, { ...hooks, showDeck: () => this.go({ overlay: 'deck' }) });
        break;
      case 'battle':
        drawSky(this, actOf(run.floor));
        this.battleView = new BattleView(this, run, {
          save: () => this.save(),
          done: () => {
            this.save();
            this.go();
          },
        });
        break;
      case 'reward':
        buildReward(this, run, hooks);
        break;
      case 'rest':
        buildRest(this, run, { ...hooks, pickUpgrade: () => this.go({ overlay: 'upgrade' }) });
        break;
      case 'shop':
        buildShop(this, run, {
          next: () => {
            this.save();
            this.go({ shopPage: data.shopPage });
          },
          save: hooks.save,
          pickRemove: () => this.go({ overlay: 'remove', shopPage: data.shopPage }),
        }, data.shopPage ?? 0, (page) => {
          data.shopPage = page;
        });
        break;
      case 'chest':
        buildChest(this, run, hooks);
        break;
      case 'event':
        buildEvent(this, run, { ...hooks, pickCard: (choice) => this.go({ overlay: 'event', choice }) });
        break;
    }
  }

  /** 끝난 판의 기록을 넣고 결과 화면을 띄운다. */
  private endRun(run: RunState): void {
    this.phase = 'over';
    drawSky(this, actOf(Math.max(1, run.floor)));
    const shards = shardsFor(run);
    const before = towerStore.data.unlocked;
    const settled = settleRun(towerStore.data, run);
    towerStore.set(settled);
    const cleared = floorsCleared(run);
    const stats: ResultStat[] = [
      ['오른 층', run.result === 'win' ? '꼭대기!' : `${cleared}층`],
      ['물리친 대장', `${run.stats.bosses}마리`],
      ['받은 구름 조각', `${shards}개`],
    ];
    const level = difficultyOf(run);
    if (level > 0) stats.unshift(['난이도', DIFFICULTY_TEXT.name(level)]);
    if (settled.unlocked > before) stats.push(['새로 열림', DIFFICULTY_TEXT.name(settled.unlocked)]);
    this.finishMiniGame(runScore(run), stats, 300);
  }
}
