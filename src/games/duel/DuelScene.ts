import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, drawPanel, fadeToScene, type PixelButton } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import { LOOK, registerDuelTextures } from './art';
import { HalfView } from './HalfView';
import {
  centerLine,
  halfLayout,
  PAUSE_BUTTON,
  SCORE_PLATE,
  sideOf,
  toLocal,
  toScreen,
  type HalfLayout,
} from './layout';
import {
  frameEvents,
  lockLeft,
  newMatch,
  opponentOf,
  PLAYERS,
  stepMatch,
  tieBreakOf,
  TUG_GOAL_STEPS,
  tugTimeLeft,
  WINS_TO_TAKE_MATCH,
  type Contest,
  type Effect,
  type Match,
  type MatchEvent,
  type Outcome,
  type Player,
  type RawTouch,
} from './rules';

/**
 * 두 사람이 동시에, 때로는 손가락 두 개씩으로 연타한다. 손가락이 이보다 많이 닿으면 넘치는 것은 무시되므로
 * 게임 설정의 기본값(3)보다 넉넉하게 둔다.
 */
const TOUCH_POINTERS = 6;
/** 한 프레임에 흐르는 시간의 상한(ms). 화면이 가려졌다 돌아와도 시계가 한꺼번에 흐르지 않는다. */
const MAX_FRAME_MS = 100;

/** 판이 끝난 뒤 결과 글자가 뜨기까지(ms). 줄다리기 표시가 끝에 닿고, 맞힌 그림이 밝혀지는 것을 볼 틈이다. */
const RESULT_DELAY_MS: Record<Contest, number> = { reaction: 0, tug: 420, symbol: 480 };
/** 경기가 끝난 뒤 버튼이 나오기까지(ms). 연타하던 손가락이 버튼을 누르지 않게 조금 기다린다. */
const END_BUTTONS_MS = 1100;

/** 줄다리기의 길: 가운데 세로줄의 절반 폭, 표시의 반지름, 표시가 제자리를 따라가는 빠르기(ms) */
const TUG = { rail: 13, border: 3, knob: 15, core: 9, followMs: 45 } as const;
/** 점수 표시: 점의 반지름과 간격 */
const PIP = { radius: 4.5, gap: 13, row: 6.5 } as const;

const DEPTH = { plate: 5, tug: 10, ripple: 20, confetti: 30 } as const;

/**
 * 둘이서 대결: 휴대폰 하나를 사이에 두고 마주 앉은 두 사람이 위아래 반쪽을 하나씩 맡아 겨룬다.
 * 번쩍 반응, 연타 줄다리기, 같은 그림 찾기 가운데 하나로 짧은 판을 겨루고, 먼저 세 판을 이기면 경기를 이긴다.
 *
 * 규칙은 rules.ts의 상태 기계에 있고, 이 씬은 터치를 모아 넘기고 돌아온 알림을 화면과 소리로 옮긴다.
 * 터치는 손가락을 뗄 때가 아니라 닿는 순간에 받는다. 한 프레임 동안 닿은 것을 모았다가 누른 시각 순서로
 * 넣기 때문에, 두 사람이 거의 동시에 눌러도 먼저 누른 한 사람만 이긴다.
 * 점수가 없는 게임이라 공용 결과 화면 대신 이 화면에서 승패와 "다시 하기", "나가기"를 보여 준다.
 */
export class DuelScene extends MiniGameScene {
  protected readonly gameId = 'duel';

  private match: Match = newMatch();
  /** 규칙이 쓰는 시계(ms). update()가 넘겨주는 시간만 더하므로 일시정지한 동안에는 멈춘다. */
  private clock = 0;
  /** 이번 프레임에 닿은 터치. 다음 update()에서 한꺼번에 넣는다. */
  private pending: RawTouch[] = [];

  private layout!: HalfLayout;
  private mid = 0;
  private halves!: [HalfView, HalfView];
  private pips: Phaser.GameObjects.Arc[][] = [];
  private pauseButton!: PixelButton;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;

  private tug!: Phaser.GameObjects.Graphics;
  private tugVisible = false;
  /** 줄다리기 표시의 자리와, 화면에 그려진 자리. 그려진 자리가 조금 늦게 따라가며 부드럽게 움직인다. */
  private tugPosition = 0;
  private tugShown = 0;
  /** 마지막으로 째깍 소리를 낸 초 */
  private lastTugSecond = 0;

  /** 늦게 띄우는 결과 화면이 이미 지난 판의 것이면 버리기 위한 번호 */
  private screenToken = 0;
  /** 경기가 끝나고 받은 코인. 기록되지 않았으면 null이다. */
  private coins: number | null = null;

  constructor() {
    super(SCENE.duel);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();
    registerDuelTextures(this);

    const missing = TOUCH_POINTERS - this.input.manager.pointersTotal;
    if (missing > 0) this.input.addPointer(missing);

    const { height } = this.scale;
    this.layout = halfLayout(height);
    this.mid = centerLine(height);

    addBackdrop(this);
    const center = { x: GAME_WIDTH / 2, y: this.mid };
    const again = (): void => fadeToScene(this, SCENE.duel);
    const leave = (): void => fadeToScene(this, SCENE.hub);
    this.halves = [
      new HalfView(this, 0, this.layout, center, height, again, leave),
      new HalfView(this, 1, this.layout, center, height, again, leave),
    ];

    this.drawStrip();
    this.tug = this.add.graphics().setDepth(DEPTH.tug);
    this.pauseButton = this.addPauseButton(PAUSE_BUTTON.x, this.mid - PAUSE_BUTTON.size / 2);
    this.confetti = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 60, max: 170 },
        gravityY: 220,
        lifespan: { min: 500, max: 900 },
        scale: { min: 0.8, max: 1.5 },
        alpha: { start: 1, end: 0 },
        tint: [...LOOK.confetti],
        emitting: false,
      })
      .setDepth(DEPTH.confetti);

    this.bindInput();
    this.showLobby();
  }

  override update(_time: number, deltaMs: number): void {
    const from = this.clock;
    this.clock += Math.min(deltaMs, MAX_FRAME_MS);
    const touches = this.pending;
    this.pending = [];
    for (const event of frameEvents(touches, from, this.clock, tieBreakOf(this.match))) this.apply(event);
    this.refresh(deltaMs);
  }

  /** 경기가 끝난 화면에서는 뒤로 가기로 허브에 돌아간다. 그 전에는 다른 게임처럼 일시정지한다. */
  override onBackRequest(): void {
    if (this.match.phase.kind === 'over') fadeToScene(this, SCENE.hub);
    else super.onBackRequest();
  }

  /** 승패가 갈리는 게임이라 끝맺음 소리는 이긴 사람을 위한 팡파르다. */
  protected override playFinishSound(): void {
    sfx.fanfare();
  }

  private resetState(): void {
    this.match = newMatch();
    this.clock = 0;
    this.pending = [];
    this.pips = [];
    this.tugVisible = false;
    this.tugPosition = 0;
    this.tugShown = 0;
    this.lastTugSecond = 0;
    this.screenToken = 0;
    this.coins = null;
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    const onDown = (pointer: Phaser.Input.Pointer): void => this.onPointerDown(pointer);
    // 일시정지에서 돌아오면 쌓여 있던 터치는 버리고, 하던 판을 공평하게 다시 준비시킨다.
    const onResume = (): void => {
      this.pending = [];
      this.apply({ type: 'resume', at: this.clock });
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.events.off(Phaser.Scenes.Events.RESUME, onResume);
    });
  }

  /** 손가락이 닿는 순간. 화면의 어느 반쪽인지로 누가 눌렀는지 정하고, 버튼이면 그 번호도 함께 적어 둔다. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const phase = this.match.phase;
    if (phase.kind === 'over') return;
    const { worldX, worldY } = pointer;
    const player = sideOf(worldX, worldY, this.scale.height);
    if (player === null) return;

    const local = toLocal(player, worldX, worldY, this.scale.height);
    const option = this.halves[player].optionAt(local.x, local.y);
    this.pending.push(
      option === undefined
        ? { player, stamp: pointer.downTime }
        : { player, stamp: pointer.downTime, option },
    );
    // 아무 데나 눌러도 되는 종목에서는 누른 자리에 물결을 띄워 눌린 것을 알려 준다.
    if (phase.kind === 'play' && phase.round.contest !== 'symbol') this.ripple(player, worldX, worldY);
  }

  private apply(event: MatchEvent): void {
    const { match, effects } = stepMatch(this.match, event, Math.random);
    this.match = match;
    for (const effect of effects) this.react(effect);
  }

  // ───────── 알림을 화면과 소리로 ─────────

  private react(effect: Effect): void {
    switch (effect.type) {
      case 'ready':
        sfx.click();
        vibrate(8);
        this.showLobby();
        break;
      case 'allReady':
        sfx.go();
        this.playing = true;
        this.showLobby();
        break;
      case 'intro':
        sfx.count();
        this.screenToken += 1;
        this.tugVisible = false;
        for (const half of this.halves) half.showIntro(effect.roundNumber, effect.contest);
        break;
      case 'armed':
        this.showArmed(effect.contest, effect.again);
        break;
      case 'signal':
        sfx.go();
        vibrate(30);
        for (const half of this.halves) half.showReactionGo();
        break;
      case 'go':
        sfx.go();
        for (const half of this.halves) half.showTugLive();
        break;
      case 'reveal':
        this.showSymbols();
        break;
      case 'push':
        this.tugPosition = effect.position;
        // 누가 밀었는지 귀로도 알 수 있게 두 사람의 소리를 다르게 낸다.
        if (effect.player === 0) sfx.flip();
        else sfx.tick();
        break;
      case 'suddenDeath':
        sfx.count();
        vibrate(20);
        for (const half of this.halves) half.showTugSudden();
        break;
      case 'wrong':
        sfx.miss();
        vibrate(20);
        this.halves[effect.player].markWrong(effect.option);
        break;
      case 'roundWon':
        this.onRoundWon(effect.outcome);
        break;
      case 'matchWon':
        this.onMatchWon();
        break;
    }
  }

  private showLobby(): void {
    const phase = this.match.phase;
    if (phase.kind !== 'lobby') return;
    for (const player of PLAYERS) this.halves[player].showLobby(phase.ready[player], phase.startAt !== null);
  }

  /** 판이 시작되어 "기다려요"나 "준비"가 뜬다. again이면 일시정지에서 돌아와 다시 준비하는 것이다. */
  private showArmed(contest: Contest, again: boolean): void {
    this.screenToken += 1;
    if (contest === 'reaction') {
      for (const half of this.halves) half.showReactionWait(again);
    } else if (contest === 'tug') {
      if (!again) {
        this.tugPosition = 0;
        this.tugShown = 0;
      }
      this.tugVisible = true;
      this.lastTugSecond = 0;
      for (const half of this.halves) half.showTugReady(again);
    } else {
      for (const half of this.halves) half.showSymbolReady(again);
    }
  }

  private showSymbols(): void {
    const phase = this.match.phase;
    if (phase.kind !== 'play' || phase.round.contest !== 'symbol') return;
    sfx.pop();
    const { target, options } = phase.round;
    for (const player of PLAYERS) this.halves[player].showSymbols(target, options[player]);
  }

  private onRoundWon(outcome: Outcome): void {
    this.fillPips();
    if (outcome.contest === 'symbol') {
      for (const half of this.halves) half.setLock(0);
      this.halves[outcome.winner].markRight();
    }
    const decided = this.match.phase.kind === 'over';
    // 경기가 끝나는 판에서는 끝맺음 소리가 따로 난다.
    if (!decided) {
      if (outcome.reason === 'foul') {
        sfx.deny();
        vibrate([20, 40, 20]);
      } else {
        sfx.gold();
        vibrate(15);
      }
    }
    this.screenToken += 1;
    const token = this.screenToken;
    const delay = RESULT_DELAY_MS[outcome.contest];
    const show = (): void => {
      if (token === this.screenToken) this.showOutcome(outcome, decided);
    };
    if (delay > 0) this.time.delayedCall(delay, show);
    else show();
  }

  /** 누가 이겼는지 두 사람에게 저마다의 말로 보여 준다. 경기가 끝났으면 버튼도 조금 뒤에 내놓는다. */
  private showOutcome(outcome: Outcome, decided: boolean): void {
    this.tugVisible = false;
    const { winner } = outcome;
    for (const player of PLAYERS) {
      const won = player === winner;
      if (decided) {
        this.halves[player].showOver(won, outcome, this.match.wins[player], this.match.wins[opponentOf(player)]);
      } else {
        this.halves[player].showResult(won, outcome);
      }
    }
    const spot = toScreen(winner, 0, this.layout.panel.y + this.layout.panel.height * 0.4, this.scale.height);
    // 색종이는 이긴 사람 쪽에서 가운데 줄을 향해 터진다.
    this.confetti.setConfig({
      speed: { min: 60, max: 170 },
      angle: winner === 0 ? { min: 200, max: 340 } : { min: 20, max: 160 },
      gravityY: winner === 0 ? 220 : -220,
      lifespan: { min: 500, max: 900 },
      scale: { min: 0.8, max: 1.5 },
      alpha: { start: 1, end: 0 },
      tint: [...LOOK.confetti],
      emitting: false,
    });
    this.confetti.explode(decided ? 34 : 14, spot.x, spot.y);

    if (!decided) return;
    this.time.delayedCall(END_BUTTONS_MS, () => {
      this.halves[0].showEndButtons(this.coins);
      this.halves[1].showEndButtons(null);
      if (this.coins !== null && this.coins > 0) sfx.coin();
    });
  }

  /** 경기가 끝난 순간에 바로 기록한다. 결과 글자가 뜨기 전에 앱을 닫아도 한 판 한 것으로 남는다. */
  private onMatchWon(): void {
    const result = this.finishVersusMatch();
    this.coins = result ? result.coinsEarned : null;
    vibrate([20, 40, 20]);
    this.pauseButton.setVisible(false);
  }

  // ───────── 프레임마다 ─────────

  /** 시간에 따라 조금씩 바뀌는 것들: 줄다리기의 남은 시간과 표시, 틀려서 쉬는 막대 */
  private refresh(deltaMs: number): void {
    const phase = this.match.phase;
    if (phase.kind === 'play') {
      const { round } = phase;
      if (round.contest === 'tug') {
        const left = round.suddenDeath ? 0 : tugTimeLeft(round, this.clock);
        for (const half of this.halves) half.setTugTime(left);
        this.tickLastSeconds(round.live && !round.suddenDeath ? left : Infinity);
      } else if (round.contest === 'symbol' && round.revealed) {
        for (const player of PLAYERS) this.halves[player].setLock(lockLeft(round, player, this.clock));
      }
    }
    const follow = 1 - Math.exp(-Math.min(deltaMs, MAX_FRAME_MS) / TUG.followMs);
    this.tugShown += (this.tugPosition - this.tugShown) * follow;
    this.drawTug();
  }

  /** 줄다리기의 마지막 3초는 1초마다 째깍 소리로 알린다. */
  private tickLastSeconds(leftMs: number): void {
    const second = Math.ceil(leftMs / 1000);
    if (second > 3 || second <= 0 || second === this.lastTugSecond) return;
    this.lastTugSecond = second;
    sfx.count();
  }

  // ───────── 그리기 ─────────

  /** 가운데 줄: 점선과 오른쪽 끝의 점수 표시. 왼쪽 끝에는 일시정지 버튼이 놓인다. */
  private drawStrip(): void {
    const graphics = this.add.graphics().setDepth(DEPTH.plate);
    const left = SCORE_PLATE.right - SCORE_PLATE.width;
    const top = this.mid - SCORE_PLATE.height / 2;
    graphics.fillStyle(LOOK.plate.lip, 1);
    for (let x = PAUSE_BUTTON.x + PAUSE_BUTTON.size + 14; x <= left - 10; x += 10) {
      graphics.fillCircle(x, this.mid, 1.5);
    }
    drawPanel(graphics, left, top, SCORE_PLATE.width, SCORE_PLATE.height - 2, {
      fill: LOOK.plate.face,
      shadow: LOOK.plate.lip,
      radius: 10,
      depth: 2,
    });

    // 점은 저마다 자기 쪽 줄에 놓이고, 그 사람이 보는 왼쪽부터 채워진다.
    const centerX = left + SCORE_PLATE.width / 2;
    this.pips = PLAYERS.map((player) =>
      Array.from({ length: WINS_TO_TAKE_MATCH }, (_, index) => {
        const side = player === 0 ? 1 : -1;
        const x = centerX + side * (index - (WINS_TO_TAKE_MATCH - 1) / 2) * PIP.gap;
        return this.add
          .circle(x, this.mid - 1 + side * PIP.row, PIP.radius, LOOK.plate.empty)
          .setDepth(DEPTH.plate);
      }),
    );
  }

  /** 이긴 판 수만큼 점을 채운다. 새로 채워지는 점은 톡 튄다. */
  private fillPips(): void {
    for (const player of PLAYERS) {
      this.pips[player].forEach((pip, index) => {
        const filled = index < this.match.wins[player];
        const color = filled ? LOOK.players[player].lip : LOOK.plate.empty;
        if (pip.fillColor === color) return;
        pip.setFillStyle(color);
        if (!filled) return;
        this.tweens.add({ targets: pip, scale: { from: 1.9, to: 1 }, duration: 260, ease: 'Back.Out' });
      });
    }
  }

  /**
   * 줄다리기의 길과 표시. 길은 표시를 경계로 위는 하늘색, 아래는 분홍으로 칠해져서,
   * 길을 자기 색으로 다 채우면 이긴다는 것이 보인다.
   */
  private drawTug(): void {
    const g = this.tug;
    g.clear();
    if (!this.tugVisible) return;

    const x = GAME_WIDTH / 2;
    const { goal } = this.layout;
    const top = this.mid - goal;
    const bottom = this.mid + goal;
    const shown = Phaser.Math.Clamp(this.tugShown, -TUG_GOAL_STEPS, TUG_GOAL_STEPS);
    const knobY = this.mid - (shown / TUG_GOAL_STEPS) * goal;
    const outer = TUG.rail + TUG.border;

    g.fillStyle(LOOK.tug.railLip, 1);
    g.fillRoundedRect(x - outer, top - outer + 3, outer * 2, goal * 2 + outer * 2, outer);
    g.fillStyle(LOOK.tug.rail, 1);
    g.fillRoundedRect(x - outer, top - outer, outer * 2, goal * 2 + outer * 2, outer);

    g.fillStyle(LOOK.players[1].face, 1);
    g.fillCircle(x, top, TUG.rail);
    g.fillRect(x - TUG.rail, top, TUG.rail * 2, Math.max(0, knobY - top));
    g.fillStyle(LOOK.players[0].face, 1);
    g.fillCircle(x, bottom, TUG.rail);
    g.fillRect(x - TUG.rail, knobY, TUG.rail * 2, Math.max(0, bottom - knobY));

    g.fillStyle(LOOK.tug.knobLip, 0.3);
    g.fillCircle(x, knobY + 2, TUG.knob);
    g.fillStyle(LOOK.tug.knob, 1);
    g.fillCircle(x, knobY, TUG.knob);
    g.fillStyle(LOOK.players[1].lip, 1);
    g.slice(x, knobY, TUG.core, Math.PI, Math.PI * 2, false);
    g.fillPath();
    g.fillStyle(LOOK.players[0].lip, 1);
    g.slice(x, knobY, TUG.core, 0, Math.PI, false);
    g.fillPath();
  }

  /** 누른 자리에서 그 사람의 색으로 퍼지는 물결 */
  private ripple(player: Player, x: number, y: number): void {
    const ring = this.add.circle(x, y, 11, LOOK.players[player].lip, 0.4).setDepth(DEPTH.ripple);
    this.tweens.add({
      targets: ring,
      scale: 2.4,
      alpha: 0,
      duration: 240,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
  }
}
