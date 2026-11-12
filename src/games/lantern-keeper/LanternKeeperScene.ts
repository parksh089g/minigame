import { CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx, tone } from '../../core/sfx';
import { addText, fadeToScene } from '../../core/ui';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type PauseExtra, type ResultStat } from '../../scenes/MiniGameScene';
import { registerLanternTextures } from './art';
import { damageRanking } from './build';
import { newlyDone } from './challenges';
import { ENEMIES, LANTERN_GAME_ID, LANTERN_SCENE, WEAPONS } from './data';
import { RunEffects } from './effects';
import { BOSS_BAR_HEIGHT, HP_DANGER, HUD_HEIGHT, RunHud } from './hud';
import { iconKey } from './icons';
import { Joystick } from './joystick';
import { levelUpHeader, showChoices, TICKET_HEADER } from './levelup';
import { buildLobby, type LobbyPage } from './lobby';
import { applyRun, metaStore, newDepth, newUnlocks } from './meta';
import { pauseInfo } from './pauseinfo';
import {
  depthName,
  depthRules,
  embersFor,
  formatClock,
  formatTimes,
  isEvolved,
  ownedWeapons,
  scoreFor,
  type Upgrade,
} from './rules';
import { createRun, Sim } from './sim';
import { SoundBoard, type Note } from './sound';
import { RunView } from './view';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
interface StartData {
  mode?: 'new' | 'resume';
  /** 준비 화면의 어느 쪽을 열지 */
  page?: LobbyPage;
  /** 그 쪽의 목록이 여러 묶음으로 나뉘었을 때 보일 묶음(0부터) */
  list?: number;
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
/** 체력이 위험할 때 심장 소리가 뛰는 간격(초). 거의 다 닳으면 더 빨라진다. */
const HEARTBEAT = { slow: 1.05, fast: 0.72, fastBelow: 0.15 } as const;
/** 판이 끝난 뒤 결과 화면이 뜨기까지 끝나는 장면을 보여 주는 시간(ms) */
const ENDING_MS = { cleared: 2100, dead: 1800 } as const;
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

  constructor() {
    super(LANTERN_SCENE);
  }

  create(data: StartData = {}): void {
    const mode = data.mode;
    const page = data.page ?? 'main';
    const list = data.list;
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

    void metaStore.load().then(() => {
      // 불러오는 사이에 씬을 떠났으면 아무것도 하지 않는다.
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      if (mode === 'new') this.startRun(false);
      else if (mode === 'resume' && metaStore.run) this.startRun(true);
      else this.openLobby(page, list);
    });
  }

  // ------------------------------------------------------------ 준비 화면

  private openLobby(page: LobbyPage, list?: number): void {
    this.phase = 'lobby';
    this.lobbyPage = page;
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
        onPage: (next, nextList) => this.scene.restart({ page: next, list: nextList } satisfies StartData),
      },
      page,
      list,
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
          depth: metaStore.data.depth,
          seed: Math.floor(Math.random() * 0x7fffffff),
        });
    if (!saved) metaStore.setRun(null);
    this.sim = new Sim(state, Math.random);

    this.view = new RunView(this, centerY, this.sim, { top: HUD_HEIGHT, bar: BOSS_BAR_HEIGHT });
    this.effects = new RunEffects(this, DEPTH.fx, HUD_HEIGHT);
    this.hud = new RunHud(this, { top: DEPTH.hud, field: DEPTH.field }, GAME_WIDTH / 2, this.view.centerY, () => {
      sfx.click();
      this.pauseGame();
    });
    this.stick = new Joystick(this, HUD_HEIGHT, DEPTH.stick);
    this.view.sync(this.sim, 0, 0);
    this.drawHud();

    if (!saved) {
      this.fresh = true;
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
    if (depth) showBanner(this, height * 0.3, depthName(depth), CSS.sky, 1600, DEPTH.banner);
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
      if (sim.state.over) break;
      if (sim.state.pendingTickets > 0 || sim.state.pendingLevelUps > 0) this.openNext(true);
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
      switch (event.type) {
        case 'kill':
          this.view.burst(sim, event.x, event.y, event.boss ? 40 : 4);
          if (event.boss) {
            // 마지막 보스를 쓰러뜨렸으면 밝은 소리는 뒤따르는 새벽 소리가 맡는다.
            board.play(sim.state.over === 'cleared' ? 'bossFall' : 'bossKill', now);
            this.effects.flash(0.45, 320);
            vibrate([30, 40, 30]);
            this.effects.shake(260, 0.018);
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
          // 이 판의 첫 기둥이면 쓰는 법을 한 줄로 알려 준다.
          if (event.first) this.showTip('등불 기둥에 닿으면 빛이 그림자를 태워요');
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
        case 'boss':
          showBanner(this, this.scale.height * 0.3, ENEMIES[event.kind].name, CSS.red, 1800, DEPTH.banner);
          board.play('boss', now);
          // 가장자리가 두 번 붉게 뛴다.
          this.effects.beat();
          this.time.delayedCall(420, () => this.effects.beat());
          vibrate([40, 60, 40]);
          this.effects.shake(180, 0.008);
          break;
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
          break;
      }
    }
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

  /** 화면 아래쪽에 한 줄 안내를 잠깐 띄운다. 움직이는 법 안내가 아직 떠 있으면 그 자리를 넘겨받는다. */
  private showTip(label: string): void {
    this.hint?.destroy();
    this.hint = undefined;
    const tip = addText(this, GAME_WIDTH / 2, this.scale.height - 54, label, {
      color: CSS.white,
      originX: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.banner);
    this.tweens.add({ targets: tip, alpha: 0, delay: 3600, duration: 500, onComplete: () => tip.destroy() });
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

  /** 무기 강화권: 가진 무기 가운데 하나를 골라 한 레벨 올린다. */
  private openTicket(delayed: boolean): void {
    this.phase = 'choosing';
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
        TICKET_HEADER,
        this.sim.ticketChoices(),
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
    if (s.pendingTickets === 0 && s.pendingLevelUps === 0) this.saveRun();
    this.openNext();
  }

  // ------------------------------------------------------------ 저장과 끝

  private saveRun(): void {
    this.sinceSave = 0;
    if (!this.sim.state.over) metaStore.setRun(this.sim.state);
  }

  /** 뒤로 가기: 준비 화면에서는 한 걸음 뒤로(강화나 도전 과제 쪽 → 고르는 쪽 → 허브), 판 중에는 일시정지 */
  override onBackRequest(): void {
    if (this.phase !== 'lobby') {
      super.onBackRequest();
      return;
    }
    if (this.lobbyPage !== 'main') this.scene.restart({ page: 'main' } satisfies StartData);
    else fadeToScene(this, SCENE.hub);
  }

  protected override pauseGame(): void {
    // 준비 화면에서는 멈출 것이 없다.
    if (this.phase !== 'run' && this.phase !== 'choosing') return;
    // 앱이 가려진 채로 닫혀도 이어서 할 수 있게 먼저 저장한다.
    this.saveRun();
    super.pauseGame();
  }

  /** 멈춘 김에 지금 빌드(무기와 패시브의 이름과 레벨, 무기마다 준 피해)를 볼 수 있게 한다. */
  protected override pauseExtra(): PauseExtra {
    return pauseInfo(this.sim.state);
  }

  private endRun(): void {
    this.phase = 'over';
    this.stick.enabled = false;
    this.stick.reset();

    const summary = this.sim.summary();
    const embers = embersFor(summary, metaStore.data.upgrades.lucky);
    const before = metaStore.data;
    const state = this.sim.state;
    const stage = state.stage;
    metaStore.setRun(null);
    metaStore.set(
      applyRun(before, {
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
      }),
    );
    const opened = newUnlocks(before.bestSeconds, metaStore.data.bestSeconds);
    // 완주해서 이 스테이지의 다음 깊은 밤이 열렸으면 함께 알린다.
    const deeper = newDepth(before, metaStore.data, stage);
    if (deeper) opened.push(deeper);

    // 끝나는 장면: 새벽이 오면 어둠이 걷히며 남은 그림자가 흩어지고, 쓰러지면 등불이 꺼지듯 어두워진다.
    const ending = summary.cleared ? ENDING_MS.cleared : ENDING_MS.dead;
    const now = this.time.now;
    if (summary.cleared) {
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
      summary.cleared ? '새벽이 왔다!' : '등불이 꺼졌다',
      summary.cleared ? CSS.yellow : CSS.silver,
      // 결과 화면이 뜰 때까지 남아 있게 한다.
      ending * 1.6,
      DEPTH.banner,
    );

    const stats: ResultStat[] = [
      ['버틴 시간', formatClock(summary.seconds)],
      ['쓰러뜨린 그림자', String(summary.kills)],
      ['레벨', String(summary.level)],
      ['얻은 불씨', `+${embers}`],
    ];
    // 이번 판으로 이룬 도전 과제가 있으면 알려 준다. 보상은 준비 화면에서 받는다.
    const feats = newlyDone(before, metaStore.data);
    if (feats.length > 0) {
      stats.push(['도전 과제 달성', feats.length === 1 ? feats[0].title : `${feats[0].title} 외 ${feats.length - 1}`]);
    }
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
    this.finishMiniGame(scoreFor(summary), stats, ending, strip);
  }

  /** 끝맺음 소리는 endRun에서 새벽 소리나 꺼지는 소리로 따로 낸다. */
  protected override playFinishSound(): void {}

  // ------------------------------------------------------------ HUD

  private drawHud(): void {
    this.hud.draw(this.sim, this.seconds, this.phase === 'choosing');
  }
}
