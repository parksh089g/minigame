import Phaser from 'phaser';
import { COLOR, CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel, fadeToScene } from '../../core/ui';
import { showBanner } from '../../scenes/GameHud';
import { MiniGameScene, type ResultStat } from '../../scenes/MiniGameScene';
import { registerLanternTextures } from './art';
import { ENEMIES, LANTERN_GAME_ID, LANTERN_SCENE, RUN_SECONDS } from './data';
import { Joystick } from './joystick';
import { levelUpHeader, showChoices, TICKET_HEADER } from './levelup';
import { buildLobby } from './lobby';
import { applyRun, metaStore } from './meta';
import { buildSummary, embersFor, formatClock, scoreFor, xpToNext } from './rules';
import { createRun, Sim, type Enemy } from './sim';
import { RunView } from './view';

/** 씬을 시작할 때 넘기는 값. 없으면 준비 화면부터 연다. */
interface StartData {
  mode?: 'new' | 'resume';
}

type Phase = 'loading' | 'lobby' | 'run' | 'choosing' | 'over';

const STEP = 1 / 60;
/** 한 프레임에 따라잡는 가장 긴 시간(초). 탭이 멈췄다 돌아와도 한꺼번에 몰아서 돌리지 않는다. */
const MAX_FRAME = 0.1;
const HUD_HEIGHT = 50;
const BAR = { x: 42, width: GAME_WIDTH - 50, height: 8 } as const;
/** 진행 중인 판을 저장하는 간격(초) */
const SAVE_EVERY = 20;
/** 중간 보스가 쓰러지는 모습을 보여 준 뒤에 강화권 화면을 연다(ms). */
const TICKET_DELAY_MS = 550;
const DEPTH = { hud: 20, banner: 30, stick: 25, panel: 40 } as const;

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
  private shownClock = '';
  private shownKills = -1;
  private shownLevel = -1;

  private bars!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private bossText!: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super(LANTERN_SCENE);
  }

  create(data: StartData = {}): void {
    const mode = data.mode;
    // Phaser는 값 없이 다시 시작하면 지난번 값을 그대로 넘긴다. "다시 하기"가 준비 화면으로 가도록 비워 둔다.
    this.sys.settings.data = {};
    this.beginMiniGame();
    registerLanternTextures(this);
    this.phase = 'loading';
    this.pending = 0;
    this.sinceSave = 0;
    this.seconds = 0;
    this.shownClock = '';
    this.shownKills = -1;
    this.shownLevel = -1;
    this.hint = undefined;

    void metaStore.load().then(() => {
      // 불러오는 사이에 씬을 떠났으면 아무것도 하지 않는다.
      if (!this.sys.isActive() || this.phase !== 'loading') return;
      if (mode === 'new') this.startRun(false);
      else if (mode === 'resume' && metaStore.run) this.startRun(true);
      else this.openLobby();
    });
  }

  // ------------------------------------------------------------ 준비 화면

  private openLobby(): void {
    this.phase = 'lobby';
    buildLobby(this, {
      getMeta: () => metaStore.data,
      setMeta: (meta) => metaStore.set(meta),
      savedRun: metaStore.run,
      onStart: () => this.restartWith('new'),
      onResume: () => this.restartWith('resume'),
      onBack: () => fadeToScene(this, SCENE.hub),
    });
  }

  private restartWith(mode: StartData['mode']): void {
    fadeToScene(this, this.scene.key, { mode } satisfies StartData);
  }

  // ------------------------------------------------------------ 한 판

  private startRun(resume: boolean): void {
    const { height } = this.scale;
    // HUD에 가려지는 만큼 플레이어를 가운데보다 조금 아래에 둔다.
    const centerY = Math.round(height / 2) + 12;
    const view = { viewW: GAME_WIDTH, viewH: height + 24 };

    const saved = resume ? metaStore.run : null;
    const state = saved
      ? { ...structuredClone(saved), ...view }
      : createRun({ ...view, meta: metaStore.data.upgrades });
    if (!saved) metaStore.setRun(null);
    this.sim = new Sim(state, Math.random);

    this.view = new RunView(this, centerY);
    this.addHud();
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
    const s = this.sim.state;
    showChoices(
      this,
      levelUpHeader(s.player.level),
      this.sim.options(),
      DEPTH.panel,
      (upgrade) => {
        this.sim.applyUpgrade(upgrade);
        this.afterPick();
      },
      buildSummary(s.weapons),
    );
  }

  /** 무기 강화권: 가진 무기 가운데 하나를 골라 한 레벨 올린다. */
  private openTicket(delayed: boolean): void {
    this.phase = 'choosing';
    this.stick.enabled = false;
    this.stick.reset();
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
        buildSummary(this.sim.state.weapons),
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
    const embers = embersFor(summary);
    metaStore.setRun(null);
    metaStore.set(applyRun(metaStore.data, embers, summary.seconds, summary.cleared));

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
    this.finishMiniGame(scoreFor(summary), stats);
  }

  // ------------------------------------------------------------ HUD

  private addHud(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, HUD_HEIGHT, COLOR.ink, 0.6).setOrigin(0, 0).setDepth(DEPTH.hud);

    // 일시정지 버튼. 공용 버튼은 깊이를 정할 수 없어 어둠 덮개에 가려지므로 HUD 위에 따로 그린다.
    const button = this.add.graphics().setDepth(DEPTH.hud);
    const drawButton = (pressed: boolean): void => {
      button.clear();
      drawPanel(button, 8, 8, 26, 26, { fill: pressed ? COLOR.navy : COLOR.slate, shadow: COLOR.ink, radius: 8 });
    };
    drawButton(false);
    this.add.image(21, 21, 'icon-pause').setDepth(DEPTH.hud);
    addTapZone(this, 0, 0, 40, 40, drawButton, () => {
      sfx.click();
      this.pauseGame();
    });
    this.bars = this.add.graphics().setDepth(DEPTH.hud);
    this.levelText = addText(this, BAR.x, 33, '', { color: CSS.cyan }).setDepth(DEPTH.hud);
    this.clockText = addText(this, BAR.x + BAR.width / 2, 33, '', {
      bold: true,
      color: CSS.white,
      originX: 0.5,
    }).setDepth(DEPTH.hud);
    this.killText = addText(this, BAR.x + BAR.width, 33, '', { color: CSS.silver, originX: 1 }).setDepth(DEPTH.hud);
    this.bossText = addText(this, GAME_WIDTH / 2, HUD_HEIGHT + 4, '', {
      color: CSS.red,
      bold: true,
      originX: 0.5,
      shadow: CSS.ink,
    }).setDepth(DEPTH.hud);
  }

  private drawHud(): void {
    const sim = this.sim;
    const s = sim.state;
    const p = s.player;

    const g = this.bars;
    g.clear();
    const bar = (y: number, ratio: number, color: number): void => {
      drawPanel(g, BAR.x, y, BAR.width, BAR.height, { fill: COLOR.ink, border: COLOR.slate, shadow: null, radius: 4 });
      g.fillStyle(color, 1);
      g.fillRect(BAR.x + 2, y + 2, Math.round((BAR.width - 4) * Phaser.Math.Clamp(ratio, 0, 1)), BAR.height - 4);
    };
    const hpRatio = p.hp / sim.maxHp;
    bar(9, hpRatio, hpRatio <= 0.3 ? COLOR.red : COLOR.green);
    bar(20, p.xp / xpToNext(p.level), COLOR.sky);

    const boss = this.findBoss();
    if (boss) {
      const y = HUD_HEIGHT + 20;
      const width = 120;
      const x = Math.round((GAME_WIDTH - width) / 2);
      drawPanel(g, x, y, width, 6, { fill: COLOR.ink, shadow: null, radius: 3 });
      g.fillStyle(COLOR.red, 1);
      g.fillRect(x + 1, y + 1, Math.round((width - 2) * Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1)), 4);
      this.bossText.setText(ENEMIES[boss.kind].name);
    } else if (this.bossText.text !== '') {
      this.bossText.setText('');
    }

    const clock = formatClock(Math.min(s.t, RUN_SECONDS));
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clockText.setText(clock).setColor(s.t >= RUN_SECONDS ? CSS.red : CSS.white);
    }
    if (s.kills !== this.shownKills) {
      this.shownKills = s.kills;
      this.killText.setText(`처치 ${s.kills}`);
    }
    if (p.level !== this.shownLevel) {
      this.shownLevel = p.level;
      this.levelText.setText(`Lv ${p.level}`);
    }
  }

  private findBoss(): Enemy | null {
    let found: Enemy | null = null;
    for (const enemy of this.sim.state.enemies) {
      if (ENEMIES[enemy.kind].boss && enemy.hp > 0) found = enemy;
    }
    return found;
  }
}
