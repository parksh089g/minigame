import { CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addText, fadeToScene } from '../../core/ui';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { registerLanternTextures } from './art';
import { ENEMIES, LANTERN_GAME_ID, LANTERN_SCENE } from './data';
import { HUD_HEIGHT, RunHud } from './hud';
import { Joystick } from './joystick';
import { levelUpHeader, showChoices, TICKET_HEADER } from './levelup';
import { buildLobby, type LobbyPage } from './lobby';
import { applyRun, metaStore, newUnlocks } from './meta';
import { embersFor, formatClock, scoreFor } from './rules';
import { createRun, Sim } from './sim';
import { RunView } from './view';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
interface StartData {
  mode?: 'new' | 'resume';
  /** 준비 화면의 어느 쪽을 열지 */
  page?: LobbyPage;
}

type Phase = 'loading' | 'lobby' | 'run' | 'choosing' | 'over';

const STEP = 1 / 60;
/** 한 프레임에 따라잡는 가장 긴 시간(초). 탭이 멈췄다 돌아와도 한꺼번에 몰아서 돌리지 않는다. */
const MAX_FRAME = 0.1;
/** HUD에 가려지는 만큼 캐릭터를 화면 가운데보다 이만큼 아래에 둔다. */
const PLAYER_DROP = 18;
/** 진행 중인 판을 저장하는 간격(초) */
const SAVE_EVERY = 20;
/** 중간 보스가 쓰러지는 모습을 보여 준 뒤에 강화권 화면을 연다(ms). */
const TICKET_DELAY_MS = 550;
/** HUD는 선택 화면(panel)보다 위에 있어서, 고르는 동안에도 체력과 든 무기가 보인다. */
const DEPTH = { field: 20, stick: 25, banner: 30, panel: 40, hud: 50 } as const;

/**
 * 등불지기: 몰려오는 그림자 무리 사이를 움직이며 버티는 서바이벌.
 * 공격은 저절로 나가고, 빛 조각을 모아 레벨이 오를 때마다 강화를 하나 고른다.
 * 규칙과 진행은 sim.ts가 맡고, 이 씬은 입력을 넘기고 결과를 그린다.
 */
export class LanternKeeperScene extends MiniGameScene {
  protected readonly gameId = LANTERN_GAME_ID;

  private phase: Phase = 'loading';
  private sim!: Sim;
  private view!: RunView;
  private stick!: Joystick;
  private pending = 0;
  private sinceSave = 0;
  private seconds = 0;
  private lastKillSound = 0;
  private lastGemSound = 0;
  private lastVolleySound = 0;
  private hud!: RunHud;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super(LANTERN_SCENE);
  }

  create(data: StartData = {}): void {
    const mode = data.mode;
    const page = data.page ?? 'main';
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "다시 하기"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerLanternTextures(this);
    this.phase = 'loading';
    this.pending = 0;
    this.sinceSave = 0;
    this.seconds = 0;
    this.hint = undefined;

    void metaStore.load().then(() => {
      // 불러오는 사이에 씬을 떠났으면 아무것도 하지 않는다.
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      if (mode === 'new') this.startRun(false);
      else if (mode === 'resume' && metaStore.run) this.startRun(true);
      else this.openLobby(page);
    });
  }

  // ------------------------------------------------------------ 준비 화면

  private openLobby(page: LobbyPage): void {
    this.phase = 'lobby';
    buildLobby(
      this,
      {
        getMeta: () => metaStore.data,
        setMeta: (meta) => metaStore.set(meta),
        savedRun: metaStore.run,
        onStart: () => this.restartWith('new'),
        onResume: () => this.restartWith('resume'),
        onBack: () => fadeToScene(this, SCENE.hub),
        // 쪽을 넘길 때는 기다림 없이 바로 다시 그린다.
        onPage: (next) => this.scene.restart({ page: next } satisfies StartData),
      },
      page,
    );
  }

  private restartWith(mode: StartData['mode']): void {
    fadeToScene(this, this.scene.key, { mode } satisfies StartData);
  }

  // ------------------------------------------------------------ 한 판

  private startRun(resume: boolean): void {
    const { height } = this.scale;
    const centerY = Math.round(height / 2) + PLAYER_DROP;
    // 캐릭터가 아래로 내려간 만큼 위쪽이 더 넓게 보이므로, 그 넓은 쪽에 맞춰 적이 화면 밖에서 나오게 한다.
    const view = { viewW: GAME_WIDTH, viewH: height + PLAYER_DROP * 2 };

    const saved = resume ? metaStore.run : null;
    const state = saved
      ? { ...structuredClone(saved), ...view }
      : createRun({
          ...view,
          meta: metaStore.data.upgrades,
          hero: metaStore.data.hero,
          stage: metaStore.data.stage,
          seed: Math.floor(Math.random() * 0x7fffffff),
        });
    if (!saved) metaStore.setRun(null);
    this.sim = new Sim(state, Math.random);

    this.view = new RunView(this, centerY, this.sim);
    this.hud = new RunHud(this, { top: DEPTH.hud, field: DEPTH.field }, GAME_WIDTH / 2, this.view.centerY, () => {
      sfx.click();
      this.pauseGame();
    });
    this.stick = new Joystick(this, HUD_HEIGHT, DEPTH.stick);
    this.view.sync(this.sim, 0, 0);
    this.drawHud();

    if (!saved) {
      this.hint = addText(this, GAME_WIDTH / 2, height - 54, '화면을 누른 채 끌면 움직여요', {
        color: CSS.white,
        originX: 0.5,
        shadow: CSS.ink,
      }).setDepth(DEPTH.banner);
      sfx.go();
    }

    this.playing = true;
    this.openNext();
  }

  /** 기다리는 선택이 있으면 그 화면을 열고, 없으면 판을 이어 간다. 강화권이 레벨업보다 먼저다. */
  private openNext(delayTicket = false): void {
    const s = this.sim.state;
    if (s.pendingTickets > 0) this.openTicket(delayTicket);
    else if (s.pendingLevelUps > 0) this.openLevelUp();
    else this.resumeRun();
  }

  private resumeRun(): void {
    this.phase = 'run';
    this.stick.enabled = true;
    this.stick.reset();
    this.drawHud();
  }

  override update(_time: number, delta: number): void {
    if (this.phase !== 'run') return;
    const frame = Math.min(delta / 1000, MAX_FRAME);
    this.seconds += frame;
    this.pending += frame;
    this.stick.update();
    if (this.hint && (this.stick.x !== 0 || this.stick.y !== 0)) this.fadeHint();

    const sim = this.sim;
    while (this.pending >= STEP && this.phase === 'run') {
      this.pending -= STEP;
      sim.step(STEP, this.stick.x, this.stick.y);
      this.handleEvents();
      if (sim.state.over) this.endRun();
      else if (sim.state.pendingTickets > 0 || sim.state.pendingLevelUps > 0) this.openNext(true);
    }

    this.view.sync(sim, this.seconds, frame);
    this.drawHud();

    this.sinceSave += frame;
    if (this.sinceSave >= SAVE_EVERY && this.phase === 'run') this.saveRun();
  }

  private handleEvents(): void {
    const sim = this.sim;
    const now = this.time.now;
    for (const event of sim.events) {
      switch (event.type) {
        case 'kill':
          this.view.burst(sim, event.x, event.y, event.boss ? 40 : 4);
          if (event.boss) {
            sfx.fanfare();
            vibrate([30, 40, 30]);
            this.cameras.main.shake(260, 0.012);
          } else if (now - this.lastKillSound > 90) {
            this.lastKillSound = now;
            sfx.expire();
          }
          break;
        case 'hurt':
          this.hud.hurt(this.seconds);
          sfx.miss();
          vibrate(35);
          this.cameras.main.shake(110, 0.01);
          break;
        case 'gem':
          if (now - this.lastGemSound > 70) {
            this.lastGemSound = now;
            sfx.tick();
          }
          break;
        case 'heal':
          sfx.coin();
          break;
        case 'strike':
          this.view.ring(event.x, event.y, event.radius);
          break;
        case 'bolt':
          this.view.bolt(event.points, event.evolved);
          // 번개가 닿은 자리마다 불티가 튄다.
          for (let i = 2; i < event.points.length; i += 2) {
            this.view.burst(sim, event.points[i], event.points[i + 1], 2);
          }
          break;
        case 'boss':
          showBanner(this, this.scale.height * 0.3, ENEMIES[event.kind].name, CSS.red, 1800, DEPTH.banner);
          sfx.deny();
          vibrate([40, 60, 40]);
          break;
        case 'surge':
          showBanner(this, this.scale.height * 0.3, '그림자 밀물!', CSS.orange, 1400, DEPTH.banner);
          sfx.count();
          break;
        case 'revive':
          showBanner(this, this.scale.height * 0.3, '등불이 다시 켜졌다!', CSS.yellow, 1600, DEPTH.banner);
          this.view.burst(sim, sim.state.player.x, sim.state.player.y, 30);
          sfx.fanfare();
          vibrate([20, 30, 60]);
          break;
        case 'volley':
          if (now - this.lastVolleySound > 200) {
            this.lastVolleySound = now;
            sfx.count();
          }
          break;
        case 'levelup':
        case 'ticket':
        case 'shoot':
          break;
      }
    }
  }

  private fadeHint(): void {
    const hint = this.hint;
    if (!hint) return;
    this.hint = undefined;
    this.tweens.add({ targets: hint, alpha: 0, delay: 600, duration: 400, onComplete: () => hint.destroy() });
  }

  // ------------------------------------------------------------ 레벨업

  private openLevelUp(): void {
    this.phase = 'choosing';
    this.stick.enabled = false;
    this.stick.reset();
    sfx.gold();
    vibrate(15);
    this.drawHud();
    showChoices(
      this,
      levelUpHeader(this.sim.state.player.level),
      this.sim.options(),
      DEPTH.panel,
      (upgrade) => {
        this.sim.applyUpgrade(upgrade);
        this.afterPick();
      },
      HUD_HEIGHT,
    );
  }

  /** 무기 강화권: 가진 무기 가운데 하나를 골라 한 레벨 올린다. */
  private openTicket(delayed: boolean): void {
    this.phase = 'choosing';
    this.stick.enabled = false;
    this.stick.reset();
    this.drawHud();
    const show = (): void => {
      // 기다리는 사이에 씬을 떠났으면 열지 않는다.
      if (!this.sys.isActive() || this.phase !== 'choosing') return;
      sfx.gold();
      vibrate(15);
      showChoices(
        this,
        TICKET_HEADER,
        this.sim.ticketChoices(),
        DEPTH.panel,
        (upgrade) => {
          this.sim.useTicket(upgrade);
          this.afterPick();
        },
        HUD_HEIGHT,
      );
    };
    if (delayed) this.time.delayedCall(TICKET_DELAY_MS, show);
    else show();
  }

  private afterPick(): void {
    this.drawHud();
    const s = this.sim.state;
    // 고를 것이 남아 있지 않을 때만 저장한다. 다음 화면은 곧바로 연다.
    if (s.pendingTickets === 0 && s.pendingLevelUps === 0) this.saveRun();
    this.openNext();
  }

  // ------------------------------------------------------------ 저장과 끝

  private saveRun(): void {
    this.sinceSave = 0;
    if (!this.sim.state.over) metaStore.setRun(this.sim.state);
  }

  protected override pauseGame(): void {
    // 준비 화면에서는 멈출 것이 없다.
    if (this.phase !== 'run' && this.phase !== 'choosing') return;
    // 앱이 가려진 채로 닫혀도 이어서 할 수 있게 먼저 저장한다.
    this.saveRun();
    super.pauseGame();
  }

  private endRun(): void {
    this.phase = 'over';
    this.stick.enabled = false;
    this.stick.reset();

    const summary = this.sim.summary();
    const embers = embersFor(summary, metaStore.data.upgrades.lucky);
    const bestBefore = metaStore.data.bestSeconds;
    metaStore.setRun(null);
    metaStore.set(applyRun(metaStore.data, embers, summary.seconds, summary.cleared));
    const opened = newUnlocks(bestBefore, metaStore.data.bestSeconds);

    showBanner(
      this,
      this.scale.height * 0.32,
      summary.cleared ? '새벽이 왔다!' : '등불이 꺼졌다',
      summary.cleared ? CSS.yellow : CSS.silver,
      1500,
      DEPTH.banner,
    );
    if (summary.cleared) vibrate([20, 40, 20, 40, 60]);
    else vibrate(120);

    const stats: ResultStat[] = [
      ['버틴 시간', formatClock(summary.seconds)],
      ['쓰러뜨린 그림자', String(summary.kills)],
      ['레벨', String(summary.level)],
      ['얻은 불씨', `+${embers}`],
    ];
    // 이번 기록으로 캐릭터나 스테이지가 열렸으면 알려 준다.
    if (opened.length > 0) {
      stats.push(['새로 열림', opened.length <= 2 ? opened.join(' · ') : `${opened[0]} 외 ${opened.length - 1}`]);
    }
    this.finishMiniGame(scoreFor(summary), stats);
  }

  // ------------------------------------------------------------ HUD

  private drawHud(): void {
    this.hud.draw(this.sim, this.seconds, this.phase === 'choosing');
  }
}
