import Phaser from 'phaser';
import { GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  CARD_H,
  CARD_W,
  MINI_H,
  MINI_W,
  PX,
  PX_CSS,
  rankSize,
  rankTexture,
  registerHighLowTextures,
  suitTexture,
  TEX,
} from './art';
import {
  accuracy,
  GAME_ID,
  isRed,
  LIVES,
  makeGuess,
  pointsFor,
  skipCard,
  startState,
  streakBonus,
  winChance,
  type Card,
  type Guess,
  type HighLowState,
  type Verdict,
} from './rules';

const MARGIN = 8;
/** 지나간 카드를 몇 장까지 보여 줄지 */
const HISTORY_MAX = 9;
const DEPTH = { back: -10, base: 0, card: 5, moving: 10, float: 20 } as const;

/** 지나간 카드 밑의 점 색: 맞힘, 같음, 틀림, 넘김 */
const OUTCOME_COLOR: Readonly<Record<Verdict | 'skip', number>> = {
  win: PX.lime,
  tie: PX.sky,
  lose: PX.red,
  skip: PX.edge,
};

interface GuessButton {
  guess: Guess;
  draw: (pressed: boolean) => void;
  title: Phaser.GameObjects.Text;
  points: Phaser.GameObjects.Text;
  chance: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  enabled: boolean;
}

/**
 * 하이로우: 펼친 카드를 보고 다음 카드가 높을지 낮을지 맞힌다.
 * 나오기 어려운 쪽을 맞힐수록 점수가 크고, 연속으로 맞히면 보너스가 붙는다. 하트 세 개를 다 잃으면 끝난다.
 * 화면은 등불지기, 구름 탑 모험과 같은 어두운 바탕의 픽셀 그림이다.
 */
export class HighLowScene extends MiniGameScene {
  protected readonly gameId = GAME_ID;

  private state!: HighLowState;
  /** 카드가 넘어가는 동안에는 누를 수 없다 */
  private busy = false;
  private history: Array<{ card: Card; outcome: Verdict | 'skip' }> = [];

  private currentX = 0;
  private deckX = 0;
  private cardY = 0;
  private historyY = 0;
  private currentCard!: Phaser.GameObjects.Container;

  private scoreText!: Phaser.GameObjects.Text;
  private streakText!: Phaser.GameObjects.Text;
  private deckText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private hearts: Phaser.GameObjects.Image[] = [];
  private historyLayer!: Phaser.GameObjects.Container;
  private buttons: GuessButton[] = [];
  private skipDraw!: (pressed: boolean) => void;
  private skipLabel!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.highLow);
  }

  create(): void {
    this.beginMiniGame();
    registerHighLowTextures(this);
    this.state = startState();
    this.busy = false;
    this.history = [];
    this.hearts = [];
    this.buttons = [];

    const { height } = this.scale;
    // 화면이 길면 남는 자리를 카드 둘레에 나눠 준다.
    const extra = Math.max(0, height - 400);
    this.cardY = Math.round(72 + extra * 0.3 + CARD_H / 2);
    this.currentX = Math.round(GAME_WIDTH / 2 - CARD_W / 2 - 10);
    this.deckX = Math.round(GAME_WIDTH / 2 + CARD_W / 2 + 10);
    // 지나간 카드 줄은 카드 이름 아래와 버튼 위의 안내 글 사이 한가운데에 둔다(drawControls와 같은 셈).
    const labelsBottom = this.cardY + CARD_H / 2 + 22;
    const promptTop = height - MARGIN - 3 - 30 - 10 - 74 - 22;
    this.historyY = Math.round((labelsBottom + promptTop) / 2 - 4);

    this.drawSky();
    this.drawTop();
    this.drawTable();
    this.drawControls();

    this.currentCard = this.makeFace(this.state.current, this.currentX, this.cardY).setDepth(DEPTH.card);
    this.refresh();

    this.addPauseButton();
    this.playing = true;
    // 처음 하는 사람에게는 규칙 안내서를 한 번 띄운다. 그 사이에 이미 골랐으면 띄우지 않는다.
    this.offerRuleBook(() => this.history.length === 0 && !this.busy);
  }

  // ───────── 화면 구성 ─────────

  /** 위는 짙은 남색, 아래로 갈수록 검게. 띠로 나눠 칠해서 픽셀 느낌의 계단 그러데이션을 만든다. */
  private drawSky(): void {
    const { height } = this.scale;
    const g = this.add.graphics().setDepth(DEPTH.back);
    const bands = 8;
    const from = Phaser.Display.Color.ValueToColor(0x29366f);
    const to = Phaser.Display.Color.ValueToColor(0x1a1c2c);
    for (let i = 0; i < bands; i += 1) {
      const mixed = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(mixed.r, mixed.g, mixed.b), 1);
      g.fillRect(0, Math.floor((height * i) / bands), GAME_WIDTH, Math.ceil(height / bands) + 1);
    }
    const stars: readonly (readonly [number, number, number])[] = [
      [18, 52, PX.white],
      [70, 40, PX.silver],
      [214, 58, PX.yellow],
      [128, 66, PX.silver],
      [226, 196, PX.white],
      [10, 230, PX.silver],
      [118, 250, 0x73eff7],
      [200, 300, PX.silver],
    ];
    for (const [x, y, color] of stars) {
      g.fillStyle(color, 0.7);
      g.fillRect(x, y, 2, 2);
    }
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, fill: number = PX.panel, border: number = PX.edge): void {
    drawPanel(g, x, y, width, height, { fill, border, shadow: PX.ink, radius: 3, depth: 3 });
  }

  private drawTop(): void {
    addText(this, 40, 9, '하이로우', { size: 14, color: PX_CSS.text });
    const best = store.data.games[GAME_ID]?.best ?? 0;
    addText(this, 40, 27, best > 0 ? `최고 ${best}점` : '높을까 낮을까', { size: 9, color: PX_CSS.faint });

    const width = 74;
    const left = GAME_WIDTH - MARGIN - width;
    this.panel(this.add.graphics(), left, 8, width, 24);
    addText(this, left + 8, 20, '점수', { size: 9, color: PX_CSS.sub, originY: 0.5 });
    this.scoreText = addText(this, left + width - 8, 20, '0', { size: 14, color: PX_CSS.accent, originX: 1, originY: 0.5 });

    for (let i = 0; i < LIVES; i += 1) {
      this.hearts.push(this.add.image(MARGIN + 7 + i * 17, 50, TEX.heart));
    }
    this.streakText = addText(this, GAME_WIDTH - MARGIN, 50, '', { size: 11, color: PX_CSS.text, originX: 1, originY: 0.5 });
  }

  private drawTable(): void {
    // 카드가 놓이는 자리: 펼친 카드 자리와 카드 묶음
    const g = this.add.graphics().setDepth(DEPTH.base);
    g.fillStyle(PX.ink, 0.45);
    g.fillRect(this.currentX - CARD_W / 2 - 4, this.cardY - CARD_H / 2 - 4, CARD_W + 8, CARD_H + 8);
    g.fillRect(this.deckX - CARD_W / 2 - 4, this.cardY - CARD_H / 2 - 4, CARD_W + 8, CARD_H + 8);
    // 묶음은 몇 장 겹친 것처럼 보이게 아래로 두 장을 깐다.
    this.add.image(this.deckX + 3, this.cardY + 3, TEX.back).setDepth(DEPTH.base).setTint(0x8892a8);
    this.add.image(this.deckX + 1.5, this.cardY + 1.5, TEX.back).setDepth(DEPTH.base).setTint(0xb8c0d0);
    this.add.image(this.deckX, this.cardY, TEX.back).setDepth(DEPTH.base);

    const labelY = this.cardY + CARD_H / 2 + 8;
    addText(this, this.currentX, labelY, '지금 카드', { size: 9, color: PX_CSS.faint, originX: 0.5 });
    this.deckText = addText(this, this.deckX, labelY, '', { size: 9, color: PX_CSS.faint, originX: 0.5 });

    this.historyLayer = this.add.container(0, 0).setDepth(DEPTH.base);
  }

  private drawControls(): void {
    const { height } = this.scale;
    const skipHeight = 30;
    const skipY = height - MARGIN - 3 - skipHeight;
    const buttonHeight = 74;
    const buttonY = skipY - 10 - buttonHeight;
    const buttonWidth = (GAME_WIDTH - MARGIN * 2 - 8) / 2;

    this.promptText = addText(this, GAME_WIDTH / 2, buttonY - 12, '', {
      size: 11,
      color: PX_CSS.sub,
      originX: 0.5,
      originY: 0.5,
    });

    const specs: ReadonlyArray<{ guess: Guess; x: number; label: string; icon: string; face: number; lip: number }> = [
      { guess: 'high', x: MARGIN, label: '높다', icon: TEX.up, face: PX.green, lip: PX.teal },
      { guess: 'low', x: MARGIN + buttonWidth + 8, label: '낮다', icon: TEX.down, face: PX.red, lip: PX.plum },
    ];
    for (const spec of specs) {
      const g = this.add.graphics();
      const icon = this.add.image(0, 0, spec.icon);
      const title = addText(this, 0, 0, spec.label, { size: 16, color: PX_CSS.text, originY: 0.5, shadow: PX_CSS.dark });
      const points = addText(this, 0, 0, '', { size: 13, color: PX_CSS.accent, originX: 0.5, originY: 0.5, shadow: PX_CSS.dark });
      const chance = addText(this, 0, 0, '', { size: 9, color: PX_CSS.text, originX: 0.5, originY: 0.5 });
      const button: GuessButton = {
        guess: spec.guess,
        title,
        points,
        chance,
        icon,
        enabled: true,
        draw: (pressed) => {
          const enabled = button.enabled;
          const offset = pressed && enabled ? 3 : 0;
          g.clear();
          g.fillStyle(PX.ink, 1);
          g.fillRect(spec.x, buttonY + 3, buttonWidth, buttonHeight);
          g.fillStyle(enabled ? spec.lip : PX.panel, 1);
          g.fillRect(spec.x, buttonY + offset, buttonWidth, buttonHeight);
          g.fillStyle(PX.ink, 1);
          g.fillRect(spec.x, buttonY + offset, buttonWidth, buttonHeight - 3);
          g.fillStyle(enabled ? spec.face : PX.panel, 1);
          g.fillRect(spec.x + 2, buttonY + offset + 2, buttonWidth - 4, buttonHeight - 7);
          // 왼쪽 위의 밝은 줄
          g.fillStyle(PX.white, enabled ? 0.25 : 0.08);
          g.fillRect(spec.x + 4, buttonY + offset + 4, buttonWidth - 8, 2);
          const center = spec.x + buttonWidth / 2;
          const titleWidth = title.width + 18;
          icon.setPosition(Math.round(center - titleWidth / 2 + 7), buttonY + offset + 18).setAlpha(enabled ? 1 : 0.4);
          title.setPosition(Math.round(center - titleWidth / 2 + 18), buttonY + offset + 18).setAlpha(enabled ? 1 : 0.4);
          points.setPosition(center, buttonY + offset + 40).setAlpha(enabled ? 1 : 0.5);
          chance.setPosition(center, buttonY + offset + 57).setAlpha(enabled ? 0.85 : 0.5);
        },
      };
      addTapZone(this, spec.x, buttonY, buttonWidth, buttonHeight, (pressed) => button.draw(pressed), () => this.guess(spec.guess));
      button.draw(false);
      this.buttons.push(button);
    }

    const skipG = this.add.graphics();
    const skipIcon = this.add.image(0, 0, TEX.skip);
    this.skipLabel = addText(this, 0, 0, '', { size: 11, color: PX_CSS.text, originY: 0.5 });
    const skipWidth = GAME_WIDTH - MARGIN * 2;
    this.skipDraw = (pressed) => {
      const enabled = this.state.skips > 0;
      const offset = pressed && enabled ? 2 : 0;
      skipG.clear();
      this.panel(skipG, MARGIN, skipY + offset, skipWidth, skipHeight - offset, enabled ? PX.navy : PX.panel);
      const total = this.skipLabel.width + 20;
      const left = GAME_WIDTH / 2 - total / 2;
      skipIcon.setPosition(Math.round(left + 7), skipY + offset + skipHeight / 2 - 1).setAlpha(enabled ? 1 : 0.4);
      this.skipLabel.setPosition(Math.round(left + 20), skipY + offset + skipHeight / 2 - 1).setAlpha(enabled ? 1 : 0.5);
    };
    addTapZone(this, MARGIN, skipY, skipWidth, skipHeight, this.skipDraw, () => this.skip());
  }

  // ───────── 카드 ─────────

  /** 앞면 카드 하나. 왼쪽 위와 오른쪽 아래(거꾸로)에 숫자와 무늬, 가운데에 큰 무늬 */
  private makeFace(card: Card, x: number, y: number): Phaser.GameObjects.Container {
    const red = isRed(card.suit);
    const rank = rankTexture(card.rank, red);
    const size = rankSize(card.rank);
    const left = -CARD_W / 2 + 6;
    const top = -CARD_H / 2 + 6;
    const cornerX = left + Math.max(size.width, 14) / 2;
    const parts: Phaser.GameObjects.GameObject[] = [
      this.add.image(0, 0, TEX.face),
      this.add.image(cornerX, top + size.height / 2, rank),
      this.add.image(cornerX, top + size.height + 10, suitTexture(card.suit, 'small')),
      this.add.image(-cornerX, -top - size.height / 2, rank).setAngle(180),
      this.add.image(-cornerX, -top - size.height - 10, suitTexture(card.suit, 'small')).setAngle(180),
      this.add.image(0, 0, suitTexture(card.suit, 'big')),
    ];
    return this.add.container(x, y, parts);
  }

  private makeMini(card: Card, x: number, y: number, outcome: Verdict | 'skip'): Phaser.GameObjects.GameObject[] {
    const dot = this.add.graphics();
    dot.fillStyle(OUTCOME_COLOR[outcome], 1);
    dot.fillRect(x - 3, y + MINI_H / 2 + 4, 6, 4);
    return [
      this.add.image(x, y, TEX.miniFace),
      this.add.image(x, y - 3, rankTexture(card.rank, isRed(card.suit))).setScale(card.rank === 10 ? 0.7 : 0.8),
      this.add.image(x, y + 8, suitTexture(card.suit, 'small')).setScale(0.5),
      dot,
    ];
  }

  private drawHistory(): void {
    this.historyLayer.removeAll(true);
    const shown = this.history.slice(-HISTORY_MAX);
    if (shown.length === 0) {
      this.historyLayer.add(
        addText(this, GAME_WIDTH / 2, this.historyY, '맞힌 카드가 여기에 쌓여요', { size: 9, color: PX_CSS.faint, originX: 0.5, originY: 0.5 }),
      );
      return;
    }
    const gap = MINI_W + 4;
    const left = GAME_WIDTH / 2 - ((shown.length - 1) * gap) / 2;
    shown.forEach((entry, index) => {
      this.historyLayer.add(this.makeMini(entry.card, left + index * gap, this.historyY, entry.outcome));
    });
  }

  // ───────── 상태 보여 주기 ─────────

  private refresh(): void {
    const { state } = this;
    this.scoreText.setText(String(state.score));
    this.hearts.forEach((heart, index) => heart.setTexture(index < state.lives ? TEX.heart : TEX.heartEmpty));
    const bonus = streakBonus(state.streak);
    this.streakText.setText(state.streak > 0 ? `연속 ${state.streak}${bonus > 0 ? `  보너스 +${bonus}` : ''}` : '');
    this.streakText.setColor(bonus > 0 ? PX_CSS.accent : PX_CSS.text);
    this.deckText.setText(`남은 카드 ${state.deck.length}장`);
    if (!this.promptText.text || this.promptText.getData('sticky') !== true) {
      this.promptText.setText('다음 카드는 높을까, 낮을까?').setColor(PX_CSS.sub);
    }
    this.promptText.setData('sticky', false);

    for (const button of this.buttons) {
      const points = pointsFor(button.guess, state.current.rank, state.deck);
      button.enabled = points > 0;
      const total = points > 0 ? points + bonus : 0;
      button.points.setText(points > 0 ? `+${total}점` : '나올 카드 없음');
      button.points.setFontSize(points > 0 ? 13 : 10);
      button.chance.setText(points > 0 ? `맞힐 확률 ${Math.round(winChance(button.guess, state.current.rank, state.deck) * 100)}%` : '');
      button.draw(false);
    }
    this.skipLabel.setText(state.skips > 0 ? `넘기기 (${state.skips}번 남음)` : '넘기기를 다 썼어요');
    this.skipDraw(false);
    this.drawHistory();
  }

  private say(label: string, color: string): void {
    this.promptText.setText(label).setColor(color).setData('sticky', true);
    this.tweens.killTweensOf(this.promptText);
    this.promptText.setScale(1.25);
    this.tweens.add({ targets: this.promptText, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  private float(label: string, color: string): void {
    const text = addText(this, this.currentX, this.cardY - CARD_H / 2 - 4, label, {
      size: 16,
      color,
      originX: 0.5,
      originY: 1,
      stroke: PX_CSS.dark,
    }).setDepth(DEPTH.float);
    this.tweens.add({ targets: text, y: text.y - 18, alpha: 0, duration: 750, ease: 'Cubic.Out', onComplete: () => text.destroy() });
  }

  // ───────── 고르기 ─────────

  private guess(guess: Guess): void {
    if (!this.playing || this.busy) return;
    const previous = this.state.current;
    const outcome = makeGuess(this.state, guess);
    if (!outcome) {
      sfx.deny();
      return;
    }
    this.reveal(outcome.card, () => {
      this.history.push({ card: previous, outcome: outcome.verdict });
      if (outcome.verdict === 'win') {
        sfx.hit(this.state.streak);
        vibrate(10);
        this.float(`+${outcome.points}`, PX_CSS.good);
        this.say(outcome.bonus > 0 ? `맞혔어요! 연속 보너스 +${outcome.bonus}` : '맞혔어요!', PX_CSS.good);
      } else if (outcome.verdict === 'tie') {
        sfx.click();
        this.float('같은 숫자', PX_CSS.sky);
        this.say('같은 숫자라서 비겼어요', PX_CSS.sky);
      } else {
        sfx.miss();
        vibrate(30);
        this.cameras.main.shake(110, 0.008);
        this.float('틀렸어요', PX_CSS.bad);
        this.say(outcome.over ? '하트를 다 잃었어요' : '틀렸어요. 하트 하나를 잃었어요', PX_CSS.bad);
        const heart = this.hearts[this.state.lives];
        if (heart) this.tweens.add({ targets: heart, scale: 1.6, duration: 90, yoyo: true });
      }
      if (outcome.reshuffled && !outcome.over) this.time.delayedCall(600, () => this.say('카드를 다 써서 새로 섞었어요', PX_CSS.accent));
      this.refresh();
      if (outcome.over) this.finish();
    });
  }

  private skip(): void {
    if (!this.playing || this.busy) return;
    const previous = this.state.current;
    const drawn = skipCard(this.state);
    if (!drawn) {
      sfx.deny();
      return;
    }
    this.reveal(drawn.card, () => {
      this.history.push({ card: previous, outcome: 'skip' });
      this.say(drawn.reshuffled ? '카드를 다 써서 새로 섞었어요' : '카드를 넘겼어요', PX_CSS.sub);
      this.refresh();
    });
  }

  /** 묶음 맨 위의 카드를 뒤집어 펼친 카드 자리로 옮긴다. 다 옮기면 done을 부른다. */
  private reveal(card: Card, done: () => void): void {
    this.busy = true;
    sfx.flip();
    const back = this.add.image(this.deckX, this.cardY, TEX.back).setDepth(DEPTH.moving);
    const face = this.makeFace(card, this.deckX, this.cardY).setDepth(DEPTH.moving).setScale(0, 1);
    this.tweens.add({
      targets: back,
      scaleX: 0,
      duration: 90,
      onComplete: () => {
        back.destroy();
        this.tweens.add({
          targets: face,
          scaleX: 1,
          duration: 90,
          onComplete: () => {
            this.tweens.add({
              targets: face,
              x: this.currentX,
              duration: 170,
              ease: 'Cubic.Out',
              onComplete: () => {
                this.currentCard.destroy();
                this.currentCard = face.setDepth(DEPTH.card);
                this.busy = false;
                done();
              },
            });
          },
        });
      },
    });
  }

  private finish(): void {
    const { state } = this;
    this.finishMiniGame(
      state.score,
      [
        ['최고 연속', `${state.bestStreak}번`],
        ['맞힌 카드', `${state.wins}장`],
        ['정확도', `${accuracy(state.wins, state.losses)}%`],
      ],
      1100,
    );
  }
}
