import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, addText, drawPanel, PixelButton } from '../../core/ui';
import { GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  answerTiles,
  CHIP_HEIGHT,
  clearSlot,
  elapse,
  isOver,
  MAX_LENGTH,
  newRun,
  nextQuestion,
  placeTile,
  POOL_SPECS,
  poolSpec,
  quizLayout,
  SKIP_BUTTON,
  SKIP_PENALTY_SECONDS,
  skipQuestion,
  slotSpots,
  START_SECONDS,
  TILE_LIP,
  tileSpots,
  WRONG_PENALTY_SECONDS,
  type PlaceOutcome,
  type QuizLayout,
  type RunState,
  type Spot,
} from './rules';

// ───────── 움직임 ─────────

/** 문제 하나가 끝난 뒤의 짧은 연출 시간(ms). 이동안은 조각이 눌리지 않고 시계도 멈춘다. */
const BEAT_MS = {
  /** 맞힌 낱말을 보여 주는 시간 */
  correct: 420,
  /** 틀린 낱말이 흔들리는 시간 */
  wrong: 380,
  /** 건너뛴 문제의 답을 보여 주는 시간 */
  reveal: 1000,
} as const;
/** 새 조각이 톡 튀어나오는 시간과 조각마다 늦어지는 시간(ms), 그리고 튀어나오기 전의 크기 */
const DEAL_MS = 140;
const DEAL_STEP_MS = 12;
const DEAL_SCALE = 0.5;
const POP_MS = 110;
/** 아무것도 누르지 않아도 이 시간이 지나면 시계가 가기 시작한다(초). */
const AUTO_START_SECONDS = 4;
/** 일시정지에서 돌아온 뒤 다시 시간이 흐르기까지의 여유(초). 가려져 있던 문제를 다시 볼 틈을 준다. */
const RESUME_GRACE_SECONDS = 0.6;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 5;
/** 한 줄 알림이 떠 있다가 사라지기 시작할 때까지와 사라지는 시간(ms) */
const NOTE_HOLD_MS = 1100;
const NOTE_FADE_MS = 300;
/** 판이 끝난 뒤 답을 볼 수 있게 결과 화면을 조금 늦게 띄운다(ms). */
const RESULT_DELAY_MS = 1300;

// ───────── 자리 ─────────

/** 큰 초성 글자 사이의 거리 */
const PATTERN_STEP = 40;
/** 조각 사이의 틈을 누른 것도 가까운 조각을 누른 것으로 보도록 누르는 자리를 사방으로 넓힌다(px). */
const TAP_PADDING = 3;
const TILE_RADIUS = 10;
/** 분류 칸에서 글자 좌우의 여백 */
const CHIP_PADDING = 11;
/** 지난 판들에 나온 낱말을 이만큼까지 기억해 두고 새 판에서는 뒤로 미룬다. */
const RECENT_LIMIT = 150;

interface TileLook {
  face: number;
  lip: number;
}

/**
 * 이 씬이 쓰는 색. 모양을 바꿀 때는 여기와 TileView, SlotView만 손보면 된다.
 * 조각은 문제마다 색이 바뀐다. 초록과 빨강은 맞고 틀림을 알리는 데 쓰므로 조각 색에서는 뺐다.
 */
const LOOK = {
  tiles: [
    { face: THEME.butter, lip: THEME.butterDeep },
    { face: THEME.sky, lip: THEME.skyDeep },
    { face: THEME.lilac, lip: THEME.lilacDeep },
  ] as readonly TileLook[],
  good: { face: THEME.mint, lip: THEME.mintDeep } as TileLook,
  bad: { face: THEME.coral, lip: THEME.coralDeep } as TileLook,
  /** 건너뛰었거나 시간이 다 되어 보여 주는 답 */
  reveal: { face: THEME.dim, lip: THEME.shadow } as TileLook,
  /** 쓴 조각이 빠져나간 자리와 빈 답 칸 */
  socket: THEME.dim,
  socketRim: THEME.shadow,
  shine: THEME.white,
  text: {
    tile: THEME_CSS.inkDeep,
    spent: THEME_CSS.faint,
    hint: THEME_CSS.faint,
    pattern: THEME_CSS.inkDeep,
    chip: THEME_CSS.inkDeep,
    note: THEME_CSS.sub,
    good: THEME_CSS.good,
    bad: THEME_CSS.bad,
    reveal: THEME_CSS.sub,
    outline: THEME_CSS.white,
    start: THEME_CSS.good,
    over: THEME_CSS.bad,
    ready: THEME_CSS.accent,
  },
} as const;

const DEPTH = { hud: 30, banner: 40 } as const;

type Phase = 'answering' | keyof typeof BEAT_MS;
type SlotTone = 'tile' | 'good' | 'bad' | 'reveal';

function inside(spot: Spot, x: number, y: number): boolean {
  return (
    x >= spot.x - TAP_PADDING &&
    x <= spot.x + spot.size + TAP_PADDING &&
    y >= spot.y - TAP_PADDING &&
    y <= spot.y + spot.size + TAP_PADDING
  );
}

/** 도톰한 조각 하나를 (0, 0)을 한가운데로 해서 그린다. 옆면까지 합쳐 한 변이 size다. */
function drawTile(graphics: Phaser.GameObjects.Graphics, size: number, look: TileLook): void {
  const half = size / 2;
  graphics.clear();
  graphics.fillStyle(look.lip, 1);
  graphics.fillRoundedRect(-half, -half, size, size, TILE_RADIUS);
  graphics.fillStyle(look.face, 1);
  graphics.fillRoundedRect(-half, -half, size, size - TILE_LIP, TILE_RADIUS);
  graphics.fillStyle(LOOK.shine, 0.55);
  graphics.fillRoundedRect(-half + 6, -half + 4, 11, 3, 1.5);
}

/** 조각이 빠져나간 자리. 눌려 들어간 것처럼 옆면 없이 아래쪽에 붙여 그린다. */
function drawSocket(graphics: Phaser.GameObjects.Graphics, size: number, rim: boolean): void {
  const half = size / 2;
  const height = size - TILE_LIP;
  graphics.clear();
  if (rim) {
    graphics.fillStyle(LOOK.socketRim, 1);
    graphics.fillRoundedRect(-half, -half + TILE_LIP, size, height, TILE_RADIUS);
    graphics.fillStyle(LOOK.socket, 1);
    graphics.fillRoundedRect(-half + 2, -half + TILE_LIP + 2, size - 4, height - 4, TILE_RADIUS - 2);
    return;
  }
  graphics.fillStyle(LOOK.socket, 0.85);
  graphics.fillRoundedRect(-half, -half + TILE_LIP, size, height, TILE_RADIUS);
}

/** 글자 조각 하나. 답 칸에 올라가 있는 동안에는 빠져나간 자리만 흐리게 남는다. */
class TileView {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private size = 0;
  private look: TileLook = LOOK.tiles[0];
  private used = false;

  constructor(scene: Phaser.Scene) {
    this.body = scene.add.graphics();
    this.label = addText(scene, 0, 0, '', {
      size: FONT_SIZE.large,
      color: LOOK.text.tile,
      originX: 0.5,
      originY: 0.5,
    });
    this.container = scene.add.container(0, 0, [this.body, this.label]).setVisible(false);
  }

  show(spot: Spot, syllable: string, look: TileLook): void {
    this.size = spot.size;
    this.look = look;
    this.used = false;
    this.label.setText(syllable);
    this.container
      .setPosition(spot.x + spot.size / 2, spot.y + spot.size / 2)
      .setScale(1)
      .setVisible(true);
    this.draw();
  }

  setUsed(used: boolean): void {
    if (used === this.used) return;
    this.used = used;
    this.draw();
  }

  private draw(): void {
    if (this.used) {
      drawSocket(this.body, this.size, false);
      this.label.setColor(LOOK.text.spent).setAlpha(0.4).setY(TILE_LIP / 2);
    } else {
      drawTile(this.body, this.size, this.look);
      this.label.setColor(LOOK.text.tile).setAlpha(1).setY(-TILE_LIP / 2);
    }
  }

  hide(): void {
    this.container.setVisible(false);
  }
}

/** 답 칸 하나. 비어 있으면 초성이 흐리게 보이고, 조각이 놓이면 그 글자가 보인다. */
class SlotView {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private size = 0;
  /** 흔들린 뒤에 돌아갈 가운데 자리 */
  homeX = 0;

  constructor(scene: Phaser.Scene) {
    this.body = scene.add.graphics();
    this.hint = addText(scene, 0, TILE_LIP / 2, '', {
      size: FONT_SIZE.large,
      color: LOOK.text.hint,
      originX: 0.5,
      originY: 0.5,
    }).setAlpha(0.5);
    this.label = addText(scene, 0, -TILE_LIP / 2, '', {
      size: FONT_SIZE.large,
      color: LOOK.text.tile,
      originX: 0.5,
      originY: 0.5,
    });
    this.container = scene.add.container(0, 0, [this.body, this.hint, this.label]).setVisible(false);
  }

  show(spot: Spot, chosung: string): void {
    this.size = spot.size;
    this.homeX = spot.x + spot.size / 2;
    this.hint.setText(chosung);
    this.container.setPosition(this.homeX, spot.y + spot.size / 2).setScale(1).setVisible(true);
    this.setEmpty();
  }

  setEmpty(): void {
    drawSocket(this.body, this.size, true);
    this.hint.setVisible(true);
    this.label.setVisible(false);
  }

  setFilled(syllable: string, look: TileLook, color: string): void {
    drawTile(this.body, this.size, look);
    this.hint.setVisible(false);
    this.label.setText(syllable).setColor(color).setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
  }
}

/**
 * 초성 퀴즈: 분류와 초성을 보고, 아래의 글자 조각을 차례로 눌러 낱말을 완성한다.
 * 60초로 시작해 맞히면 시간을 조금 돌려받고, 틀리거나 건너뛰면 시간이 깎인다. 시간이 다 되면 끝난다.
 * 규칙과 낱말은 rules.ts와 words.ts에 있고, 이 씬은 입력과 그리기만 맡는다.
 */
export class ChosungQuizScene extends MiniGameScene {
  protected readonly gameId = 'chosung-quiz';

  private run!: RunState;
  private layout!: QuizLayout;
  private hud!: GameHud;
  /** 문제에 딸린 것들(분류, 초성, 답 칸, 조각)을 담는 층. 일시정지 중에 통째로 가린다. */
  private questionLayer!: Phaser.GameObjects.Container;
  private chipBody!: Phaser.GameObjects.Graphics;
  private chipLabel!: Phaser.GameObjects.Text;
  private patternLabels: Phaser.GameObjects.Text[] = [];
  private slotViews: SlotView[] = [];
  private tileViews: TileView[] = [];
  private note!: Phaser.GameObjects.Text;
  /** 지금 문제의 조각과 답 칸이 놓인 자리. 누른 곳을 찾는 데 쓴다. */
  private tileRects: Spot[] = [];
  private slotRects: Spot[] = [];
  /** 건너뛰기 단추의 자리 */
  private skipRect = { x: 0, y: 0, width: 0, height: 0 };

  private phase: Phase = 'answering';
  /** 지금 연출이 끝날 때까지 남은 시간(ms) */
  private phaseLeft = 0;
  /** 시계가 가기 시작했는지. 처음 조각을 누를 때, 또는 조금 기다리면 시작한다. */
  private started = false;
  private waited = 0;
  /** 0보다 크면 일시정지에서 막 돌아와 잠깐 멈춰 있는 중 */
  private grace = 0;
  private lastTickSecond = 0;
  /** 지금까지 낸 문제 수. 조각 색을 돌려 쓰는 데 쓴다. */
  private dealt = 0;
  /** 지난 판들에 나온 낱말. 씬이 다시 시작되어도 남아서, 새 판에 같은 낱말이 바로 또 나오지 않게 한다. */
  private recent: string[] = [];

  constructor() {
    super(SCENE.chosungQuiz);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    this.layout = quizLayout({
      x: 0,
      y: HUD_HEIGHT,
      width: GAME_WIDTH,
      height: this.scale.height - HUD_HEIGHT,
    });

    addBackdrop(this);
    this.createQuestionViews();
    this.createSkipButton();

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(this.run.timeLeft, START_SECONDS);

    this.bindInput();
    this.showQuestion();
    this.showNote('초성에 맞는 글자를 차례로 눌러요', LOOK.text.note, true);
    showBanner(this, this.gridMiddle, '시작!', LOOK.text.start, 600, DEPTH.banner);
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const elapsedMs = Math.min(deltaMs, 100);
    if (this.grace > 0) {
      this.grace -= elapsedMs / 1000;
      return;
    }
    if (this.phase !== 'answering') {
      this.phaseLeft -= elapsedMs;
      if (this.phaseLeft <= 0) this.endBeat();
      return;
    }
    if (!this.started) {
      this.waited += elapsedMs / 1000;
      if (this.waited >= AUTO_START_SECONDS) this.started = true;
      return;
    }

    this.run = elapse(this.run, elapsedMs / 1000);
    this.hud.setTime(this.run.timeLeft, START_SECONDS);
    if (isOver(this.run)) {
      sfx.expire();
      this.endRun();
      return;
    }
    this.tickLastSeconds();
  }

  private resetState(): void {
    this.run = newRun(Math.random, this.recent);
    this.patternLabels = [];
    this.slotViews = [];
    this.tileViews = [];
    this.tileRects = [];
    this.slotRects = [];
    this.phase = 'answering';
    this.phaseLeft = 0;
    this.started = false;
    this.waited = 0;
    this.grace = 0;
    this.lastTickSecond = 0;
    this.dealt = 0;
  }

  // ───────── 화면 구성 ─────────

  /** 조각이 놓이는 자리의 한가운데 높이. 큰 글자를 띄울 때 답 칸을 가리지 않게 여기에 띄운다. */
  private get gridMiddle(): number {
    return this.layout.gridTop + this.layout.gridHeight / 2;
  }

  /** 문제 카드와, 문제마다 내용만 바꿔 쓰는 그림들을 한 번 만들어 둔다. */
  private createQuestionViews(): void {
    const { card, chipY, patternY, noteY } = this.layout;
    const panel = this.add.graphics();
    drawPanel(panel, card.x, card.y, card.width, card.height, { radius: 14 });

    this.chipBody = this.add.graphics();
    this.chipLabel = addText(this, GAME_WIDTH / 2, chipY, '', {
      color: LOOK.text.chip,
      originX: 0.5,
      originY: 0.5,
    });
    for (let index = 0; index < MAX_LENGTH; index += 1) {
      this.patternLabels.push(
        addText(this, 0, patternY, '', {
          size: FONT_SIZE.huge,
          color: LOOK.text.pattern,
          originX: 0.5,
          originY: 0.5,
        }),
      );
      this.slotViews.push(new SlotView(this));
    }
    const most = Math.max(...Object.values(POOL_SPECS).map((spec) => spec.tiles));
    for (let index = 0; index < most; index += 1) this.tileViews.push(new TileView(this));

    this.questionLayer = this.add.container(0, 0, [
      this.chipBody,
      this.chipLabel,
      ...this.patternLabels,
      ...this.slotViews.map((view) => view.container),
      ...this.tileViews.map((view) => view.container),
    ]);
    this.note = addText(this, GAME_WIDTH / 2, noteY, '', {
      color: LOOK.text.note,
      originX: 0.5,
      originY: 0.5,
    });
  }

  private createSkipButton(): void {
    this.skipRect = {
      x: Math.round((GAME_WIDTH - SKIP_BUTTON.width) / 2),
      y: this.layout.skipTop,
      width: SKIP_BUTTON.width,
      height: SKIP_BUTTON.height,
    };
    new PixelButton(this, {
      ...this.skipRect,
      label: `건너뛰기 -${SKIP_PENALTY_SECONDS}초`,
      hitPadding: 4,
      onTap: () => this.skip(),
    });
  }

  /** 지금 문제를 화면에 낸다: 분류, 초성, 빈 답 칸, 새 조각들. */
  private showQuestion(): void {
    const { question } = this.run;
    const look = LOOK.tiles[this.dealt % LOOK.tiles.length];
    this.dealt += 1;
    const length = question.pattern.length;

    this.chipLabel.setText(question.category);
    const chipWidth = Math.ceil(this.chipLabel.width) + CHIP_PADDING * 2;
    this.chipBody.clear();
    this.chipBody.fillStyle(look.face, 1);
    this.chipBody.fillRoundedRect(
      Math.round((GAME_WIDTH - chipWidth) / 2),
      this.layout.chipY - CHIP_HEIGHT / 2,
      chipWidth,
      CHIP_HEIGHT,
      CHIP_HEIGHT / 2,
    );

    this.slotRects = slotSpots(this.layout, length);
    const patternLeft = GAME_WIDTH / 2 - ((length - 1) * PATTERN_STEP) / 2;
    for (let index = 0; index < MAX_LENGTH; index += 1) {
      const label = this.patternLabels[index];
      const slot = this.slotViews[index];
      this.tweens.killTweensOf(slot.container);
      if (index >= length) {
        label.setVisible(false);
        slot.hide();
        continue;
      }
      label.setText(question.pattern[index]).setX(Math.round(patternLeft + index * PATTERN_STEP)).setVisible(true);
      slot.show(this.slotRects[index], question.pattern[index]);
    }

    this.tileRects = tileSpots(this.layout, question.tiles.length, poolSpec(length).columns);
    this.tileViews.forEach((view, index) => {
      this.tweens.killTweensOf(view.container);
      if (index >= question.tiles.length) {
        view.hide();
        return;
      }
      view.show(this.tileRects[index], question.tiles[index], look);
      // 차례를 기다리는 동안에도 작은 채로 있도록 먼저 줄여 놓는다.
      view.container.setScale(DEAL_SCALE);
      this.tweens.add({
        targets: view.container,
        scale: 1,
        duration: DEAL_MS,
        delay: index * DEAL_STEP_MS,
        ease: 'Back.Out',
      });
    });
  }

  /** 답 칸과 조각을 지금 상태대로 다시 그린다. */
  private refreshSlots(tone: SlotTone = 'tile'): void {
    const { question, slots } = this.run;
    const look = tone === 'tile' ? LOOK.tiles[(this.dealt - 1) % LOOK.tiles.length] : LOOK[tone];
    const color = tone === 'reveal' ? LOOK.text.reveal : LOOK.text.tile;
    slots.forEach((tile, index) => {
      const view = this.slotViews[index];
      if (tile === null) view.setEmpty();
      else view.setFilled(question.tiles[tile], look, color);
    });
    question.tiles.forEach((_, index) => this.tileViews[index].setUsed(slots.includes(index)));
  }

  /** 답 칸 아래의 한 줄 알림. stay를 주면 다음 알림이 올 때까지 떠 있는다. */
  private showNote(label: string, color: string, stay = false): void {
    this.tweens.killTweensOf(this.note);
    this.note.setText(label).setColor(color).setAlpha(1);
    if (stay) return;
    this.tweens.add({ targets: this.note, alpha: 0, delay: NOTE_HOLD_MS, duration: NOTE_FADE_MS });
  }

  // ───────── 입력 ─────────

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 일시정지한 동안 시간을 들이지 않고 낱말을 궁리할 수 없게 문제를 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
      // 판을 끝까지 하지 않고 나가거나 다시 시작해도, 여기까지 나온 낱말은 기억해 둔다.
      this.recent = [...this.run.used].slice(-RECENT_LIMIT);
    });
  }

  private onPause(): void {
    // 끝난 뒤 결과 화면이 뜰 때는 답이 보이는 채로 둔다.
    if (this.playing) this.questionLayer.setVisible(false);
  }

  private onResume(): void {
    this.questionLayer.setVisible(true);
    if (!this.playing) return;
    this.grace = RESUME_GRACE_SECONDS;
    showBanner(this, this.gridMiddle, '준비!', LOOK.text.ready, RESUME_GRACE_SECONDS * 1000, DEPTH.banner);
  }

  /** 손가락이 닿는 순간에 바로 반응한다. 빨리 누르는 게임이라 손을 뗄 때까지 기다리지 않는다. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.playing || this.grace > 0 || this.phase !== 'answering') return;
    const x = pointer.worldX;
    const y = pointer.worldY;
    if (y < HUD_HEIGHT) return;

    const tile = this.tileRects.findIndex((spot) => inside(spot, x, y));
    if (tile >= 0) {
      this.started = true;
      // 이미 답 칸에 올라간 조각의 빈자리를 누르면 그 조각을 도로 내린다.
      const placedAt = this.run.slots.indexOf(tile);
      if (placedAt >= 0) this.takeBack(placedAt);
      else this.place(tile);
      return;
    }
    const slot = this.slotRects.findIndex((spot) => inside(spot, x, y));
    if (slot >= 0 && this.run.slots[slot] !== null) this.takeBack(slot);
  }

  // ───────── 한 수 ─────────

  private place(tile: number): void {
    const before = this.run.slots;
    const outcome = placeTile(this.run, tile);
    if (outcome.kind === 'ignored') return;
    this.run = outcome.run;

    if (outcome.kind === 'placed') {
      this.refreshSlots();
      this.pop(this.slotViews[outcome.slot].container);
      sfx.flip();
      return;
    }
    if (outcome.kind === 'correct') this.onCorrect(outcome);
    else this.onWrong(outcome, [...before.filter((placed) => placed !== null), tile]);
  }

  /** 답 칸의 조각을 무더기로 돌려보낸다. */
  private takeBack(slot: number): void {
    const tile = this.run.slots[slot];
    const next = clearSlot(this.run, slot);
    if (next === this.run || tile === null) return;
    this.run = next;
    this.refreshSlots();
    this.pop(this.tileViews[tile].container);
    sfx.land();
  }

  private onCorrect(outcome: Extract<PlaceOutcome, { kind: 'correct' }>): void {
    this.refreshSlots('good');
    for (const view of this.slotViews) this.pop(view.container, 1.14);
    this.hud.setScore(this.run.score);
    this.hud.setTime(this.run.timeLeft, START_SECONDS);
    this.showStreak(true);
    this.showNote(`정답! +${outcome.points}점 +${outcome.seconds}초`, LOOK.text.good);
    sfx.hit(this.run.streak);
    vibrate(12);
    this.beginBeat('correct');
  }

  /** tiles는 방금 틀린 낱말을 이룬 조각들이다. */
  private onWrong(outcome: Extract<PlaceOutcome, { kind: 'wrong' }>, tiles: readonly number[]): void {
    // 칸은 이미 비워졌지만, 방금 만든 낱말을 잠깐 붉게 보여 주고 흔든다. 그동안 조각들도 올라가 있는 것으로 보인다.
    for (const tile of tiles) this.tileViews[tile].setUsed(true);
    [...outcome.word].forEach((syllable, index) => {
      const view = this.slotViews[index];
      view.setFilled(syllable, LOOK.bad, LOOK.text.tile);
      this.tweens.killTweensOf(view.container);
      view.container.setScale(1);
      this.tweens.add({
        targets: view.container,
        x: { from: view.homeX - 4, to: view.homeX + 4 },
        duration: 55,
        yoyo: true,
        repeat: 2,
        onComplete: () => view.container.setX(view.homeX),
      });
    });
    this.hud.setTime(this.run.timeLeft, START_SECONDS);
    this.showStreak(false);
    this.showNote(`땡! -${WRONG_PENALTY_SECONDS}초`, LOOK.text.bad);
    sfx.miss();
    vibrate(40);
    if (isOver(this.run)) this.endRun();
    else this.beginBeat('wrong');
  }

  private skip(): void {
    if (!this.playing || this.grace > 0 || this.phase !== 'answering') return;
    const next = skipQuestion(this.run);
    if (next === this.run) return;
    this.started = true;
    this.run = next;
    this.refreshSlots('reveal');
    this.hud.setTime(this.run.timeLeft, START_SECONDS);
    this.showStreak(false);
    this.showNote(`정답은 ${this.run.question.answer}`, LOOK.text.reveal, true);
    sfx.whoosh();
    if (isOver(this.run)) this.endRun();
    else this.beginBeat('reveal');
  }

  private beginBeat(phase: keyof typeof BEAT_MS): void {
    this.phase = phase;
    this.phaseLeft = BEAT_MS[phase];
  }

  /** 연출이 끝났다. 틀린 뒤에는 같은 문제를 이어서 풀고, 맞혔거나 건너뛴 뒤에는 다음 문제가 나온다. */
  private endBeat(): void {
    const finished = this.phase;
    this.phase = 'answering';
    if (finished === 'wrong') {
      for (const view of this.slotViews) {
        this.tweens.killTweensOf(view.container);
        view.container.setX(view.homeX);
      }
      this.refreshSlots();
      return;
    }
    this.run = nextQuestion(this.run, Math.random);
    this.showQuestion();
    if (finished === 'reveal') this.showNote('', LOOK.text.note, true);
  }

  private showStreak(bounce: boolean): void {
    const { streak } = this.run;
    this.hud.setSide(streak >= 2 ? `연속 ${streak}` : '', bounce && streak >= 2);
  }

  /** 누른 것이 톡 튀어 보이게 한다. */
  private pop(target: Phaser.GameObjects.Container, scale = 1.1): void {
    this.tweens.killTweensOf(target);
    target.setScale(1);
    this.tweens.add({ targets: target, scale, duration: POP_MS / 2, yoyo: true, ease: 'Quad.Out' });
  }

  /** 마지막 5초는 1초마다 째깍 소리로 알린다. */
  private tickLastSeconds(): void {
    const second = Math.ceil(this.run.timeLeft);
    if (second > TICK_FROM_SECONDS) {
      // 시간을 돌려받아 5초 위로 올라갔으면 다시 내려올 때 처음부터 알린다.
      this.lastTickSecond = 0;
      return;
    }
    if (second === this.lastTickSecond || second <= 0) return;
    this.lastTickSecond = second;
    sfx.tick();
  }

  /** 시간이 다 됐다. 풀던 문제의 답을 보여 주고 결과 화면으로 넘어간다. */
  private endRun(): void {
    if (!this.playing) return;
    this.playing = false;
    const { question, solved, bestStreak, skipped, score } = this.run;

    for (const view of this.slotViews) {
      this.tweens.killTweensOf(view.container);
      view.container.setX(view.homeX).setScale(1);
    }
    answerTiles(question).forEach((tile, index) => {
      this.slotViews[index].setFilled(question.tiles[tile], LOOK.reveal, LOOK.text.reveal);
    });
    this.showNote(`정답은 ${question.answer}`, LOOK.text.reveal, true);
    this.hud.setTime(0, START_SECONDS);
    showBanner(this, this.gridMiddle, '시간 끝!', LOOK.text.over, 1000, DEPTH.banner);
    vibrate([20, 40, 20]);
    this.finishMiniGame(
      score,
      [
        ['맞힌 낱말', `${solved}개`],
        ['최고 연속', `${bestStreak}번`],
        ['건너뛴 낱말', `${skipped}개`],
      ],
      RESULT_DELAY_MS,
    );
  }
}
