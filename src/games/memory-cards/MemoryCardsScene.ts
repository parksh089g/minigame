import Phaser from 'phaser';
import { CARD_SYMBOLS, TEXTURE } from '../../art/sprites';
import { CARD_HEIGHT, CARD_WIDTH } from '../../art/textures';
import { COLOR, CSS, GAME_WIDTH, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { store } from '../../core/store';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  boardSize,
  buildDeck,
  cardCenters,
  clearBonus,
  matchPoints,
  MISMATCH_SHOW_MS,
  pairCount,
  previewMs,
  ROUND_SECONDS,
} from './rules';

interface Card {
  /** 그림 번호. CARD_SYMBOLS의 순서 */
  symbol: number;
  /** 카드 중심 좌표 */
  x: number;
  y: number;
  faceUp: boolean;
  matched: boolean;
  container: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Image;
  front: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
}

const CARD_GAP = 8;
const BOARD_MARGIN = 12;
/** 카드 가장자리 바깥으로 이만큼까지는 그 카드를 누른 것으로 친다. 간격의 절반보다 작아야 한다. */
const HIT_FORGIVENESS = 3;
/** 카드가 반쯤 뒤집히는 데 걸리는 시간(ms). 뒤집기 한 번은 이것의 두 배. */
const FLIP_HALF_MS = 70;
/** 카드를 나눠 줄 때 한 장마다 늦추는 시간(ms) */
const DEAL_STAGGER_MS = 18;
/** 판을 깬 뒤 다음 판이 나오기까지(ms) */
const NEXT_BOARD_MS = 800;

const DEPTH = { card: 10, effect: 20, hud: 30, banner: 40 } as const;

/**
 * 기억 카드: 60초 동안 같은 그림의 카드 두 장을 찾아 뒤집는다.
 * 판이 시작될 때 카드를 잠깐 보여 주고, 판을 모두 맞추면 더 큰 판이 나온다.
 * 실수 없이 연속으로 맞히면 보너스가 붙는다.
 */
export class MemoryCardsScene extends MiniGameScene {
  protected readonly gameId = 'memory-cards';

  private area!: Phaser.Geom.Rectangle;
  /** 모든 카드를 담는 층. 일시정지 중에 통째로 가린다. */
  private board!: Phaser.GameObjects.Container;
  private cards: Card[] = [];
  /** 먼저 뒤집어 놓고 짝을 기다리는 카드 */
  private first: Card | null = null;
  /** 짝이 맞지 않아 잠깐 보여 주고 있는 두 장 */
  private mismatch: { cards: [Card, Card]; timer: Phaser.Time.TimerEvent } | null = null;
  private boardIndex = 0;
  private elapsed = 0;
  private score = 0;
  private streak = 0;
  private maxStreak = 0;
  private pairsFound = 0;
  private boardsCleared = 0;
  private lastTickSecond = 0;
  private hud!: GameHud;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super(SCENE.memoryCards);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    const { height } = this.scale;
    const top = HUD_HEIGHT + 4;
    this.area = new Phaser.Geom.Rectangle(
      BOARD_MARGIN,
      top,
      GAME_WIDTH - BOARD_MARGIN * 2,
      height - top - 8,
    );

    addBackdrop(this);
    this.board = this.add.container(0, 0).setDepth(DEPTH.card);
    this.sparks = this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 40, max: 110 },
        lifespan: { min: 200, max: 380 },
        alpha: { start: 1, end: 0 },
        tint: [COLOR.yellow, COLOR.lime, COLOR.white],
        emitting: false,
      })
      .setDepth(DEPTH.effect);

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);
    this.hud.setTime(ROUND_SECONDS, ROUND_SECONDS);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);

    // 일시정지한 동안 카드를 외워 둘 수 없게 판을 가린다. 결과 화면이 뜰 때도 같은 길로 가려진다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.hideBoard, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.showBoard, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, this.hideBoard, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.showBoard, this);
    });

    this.dealBoard();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing) return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    this.elapsed += dt;

    if (this.elapsed >= ROUND_SECONDS) {
      this.elapsed = ROUND_SECONDS;
      this.hud.setTime(0, ROUND_SECONDS);
      this.endRound();
      return;
    }

    this.hud.setTime(ROUND_SECONDS - this.elapsed, ROUND_SECONDS);
    const remaining = Math.ceil(ROUND_SECONDS - this.elapsed);
    if (remaining <= 5 && remaining !== this.lastTickSecond) {
      this.lastTickSecond = remaining;
      sfx.tick();
    }
  }

  private resetState(): void {
    this.cards = [];
    this.first = null;
    this.mismatch = null;
    this.boardIndex = 0;
    this.elapsed = 0;
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.pairsFound = 0;
    this.boardsCleared = 0;
    this.lastTickSecond = 0;
  }

  private hideBoard(): void {
    this.board.setVisible(false);
  }

  private showBoard(): void {
    this.board.setVisible(true);
  }

  // ───────── 판 ─────────

  /** 새 판을 깔고, 카드를 잠깐 보여 준 뒤 덮고 시작한다. */
  private dealBoard(): void {
    const size = boardSize(this.boardIndex);
    const pairs = pairCount(size);
    const deck = buildDeck(pairs, CARD_SYMBOLS.length, Math.random);
    const centers = cardCenters(size, this.area, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      gap: CARD_GAP,
    });

    this.first = null;
    this.cards = deck.map((symbol, index) => this.createCard(symbol, centers[index], index));
    sfx.flip();

    const isFirstBoard = this.boardIndex === 0;
    const hint = isFirstBoard
      ? addText(this, GAME_WIDTH / 2, centers[0].y - CARD_HEIGHT / 2 - 8, '카드를 잘 기억해 두세요!', {
          color: CSS.silver,
          originX: 0.5,
          originY: 1,
          shadow: CSS.ink,
        }).setDepth(DEPTH.banner)
      : null;

    const dealMs = this.cards.length * DEAL_STAGGER_MS + 120;
    this.time.delayedCall(dealMs + previewMs(pairs), () => {
      hint?.destroy();
      for (const card of this.cards) this.setFace(card, false);
      sfx.go();
      if (isFirstBoard) showBanner(this, this.area.centerY, '시작!', CSS.lime, 520, DEPTH.banner);
      // 카드가 다 덮인 뒤부터 누를 수 있고 시간이 흐른다.
      this.time.delayedCall(FLIP_HALF_MS * 2, () => {
        this.playing = true;
      });
    });
  }

  private createCard(symbol: number, center: { x: number; y: number }, index: number): Card {
    const back = this.add.image(0, 0, store.data.cosmetics.equipped.cardBack).setVisible(false);
    const front = this.add.image(0, 0, TEXTURE.cardFront);
    const icon = this.add.image(0, -1, CARD_SYMBOLS[symbol]).setScale(2);
    const container = this.add.container(center.x, center.y, [back, front, icon]).setScale(0);
    this.board.add(container);

    // 한 장씩 차례로 나타난다.
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 120,
      delay: index * DEAL_STAGGER_MS,
      ease: 'Back.Out',
    });

    return {
      symbol,
      x: center.x,
      y: center.y,
      faceUp: true,
      matched: false,
      container,
      back,
      front,
      icon,
    };
  }

  /** 카드를 뒤집는다. 가로로 접혔다 펴지는 사이에 앞뒷면을 바꾼다. */
  private setFace(card: Card, faceUp: boolean, animate = true): void {
    card.faceUp = faceUp;
    if (!animate) {
      this.settle(card);
      return;
    }
    this.tweens.killTweensOf(card.container);
    card.container.scaleY = 1;
    this.tweens.add({
      targets: card.container,
      scaleX: 0,
      duration: FLIP_HALF_MS,
      ease: 'Quad.In',
      onComplete: () => {
        this.showFace(card);
        this.tweens.add({
          targets: card.container,
          scaleX: 1,
          duration: FLIP_HALF_MS,
          ease: 'Quad.Out',
        });
      },
    });
  }

  private showFace(card: Card): void {
    card.back.setVisible(!card.faceUp);
    card.front.setVisible(card.faceUp);
    card.icon.setVisible(card.faceUp);
  }

  /** 진행 중인 움직임을 끝내고 카드를 제 크기, 제 면으로 맞춘다. */
  private settle(card: Card): void {
    this.tweens.killTweensOf(card.container);
    this.showFace(card);
    card.container.setScale(1);
  }

  private cardAt(x: number, y: number): Card | null {
    const reachX = CARD_WIDTH / 2 + HIT_FORGIVENESS;
    const reachY = CARD_HEIGHT / 2 + HIT_FORGIVENESS;
    return (
      this.cards.find((card) => Math.abs(x - card.x) <= reachX && Math.abs(y - card.y) <= reachY) ??
      null
    );
  }

  // ───────── 입력과 점수 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.playing) return;
    const card = this.cardAt(pointer.x, pointer.y);
    if (!card || card.matched) return;

    // 틀린 두 장이 아직 보이는 중이면 기다리지 않고 바로 덮는다. 빠른 손을 막지 않기 위해서다.
    if (this.mismatch) this.hideMismatch(false);
    if (card.faceUp) return;

    this.setFace(card, true);
    sfx.flip();

    if (!this.first) {
      this.first = card;
      return;
    }
    const first = this.first;
    this.first = null;
    if (first.symbol === card.symbol) this.onMatch(first, card);
    else this.onMismatch(first, card);
  }

  private onMatch(a: Card, b: Card): void {
    const points = matchPoints(this.streak);
    this.streak += 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.pairsFound += 1;
    this.score += points;
    this.hud.setScore(this.score);
    this.hud.setSide(this.streak >= 2 ? `연속 ${this.streak}` : '', true);

    a.matched = true;
    b.matched = true;
    // 방금 누른 카드가 다 뒤집힌 다음에 맞았다는 표시를 한다.
    this.time.delayedCall(FLIP_HALF_MS * 2, () => {
      sfx.hit(this.streak);
      vibrate(12);
      for (const card of [a, b]) {
        // 뒤집기가 한두 프레임 늦게 끝나도 커졌다 돌아오는 기준이 항상 제 크기가 되게 한다.
        this.settle(card);
        this.sparks.explode(8, card.x, card.y);
        this.tweens.add({
          targets: card.container,
          scale: 1.12,
          duration: 90,
          yoyo: true,
          ease: 'Quad.Out',
          onComplete: () => card.container.setAlpha(0.55),
        });
      }
      floatText(this, b.x, b.y - CARD_HEIGHT / 2 + 4, `+${points}`, CSS.yellow, this.area, DEPTH.effect);
    });

    if (this.cards.every((card) => card.matched)) this.onBoardCleared();
  }

  private onMismatch(a: Card, b: Card): void {
    this.streak = 0;
    this.hud.setSide('');
    this.time.delayedCall(FLIP_HALF_MS * 2, () => {
      sfx.miss();
      vibrate(15);
    });
    this.mismatch = {
      cards: [a, b],
      timer: this.time.delayedCall(MISMATCH_SHOW_MS, () => this.hideMismatch(true)),
    };
  }

  /** 틀린 두 장을 다시 덮는다. */
  private hideMismatch(animate: boolean): void {
    if (!this.mismatch) return;
    this.mismatch.timer.remove();
    for (const card of this.mismatch.cards) this.setFace(card, false, animate);
    this.mismatch = null;
  }

  private onBoardCleared(): void {
    // 다음 판이 깔릴 때까지 시간이 멈춘다.
    this.playing = false;
    const bonus = clearBonus(pairCount(boardSize(this.boardIndex)));
    this.score += bonus;
    this.boardsCleared += 1;
    this.hud.setScore(this.score);

    this.time.delayedCall(FLIP_HALF_MS * 2 + 200, () => {
      sfx.gold();
      vibrate([15, 30, 15]);
      showBanner(this, this.area.centerY, '클리어!', CSS.lime, NEXT_BOARD_MS - 200, DEPTH.banner);
      floatText(this, GAME_WIDTH / 2, this.area.centerY + 40, `+${bonus}`, CSS.yellow, this.area, DEPTH.banner);
    });

    this.time.delayedCall(NEXT_BOARD_MS, () => {
      const cleared = this.cards;
      this.cards = [];
      for (const card of cleared) {
        this.tweens.killTweensOf(card.container);
        this.tweens.add({
          targets: card.container,
          scale: 0,
          duration: 140,
          ease: 'Quad.In',
          onComplete: () => card.container.destroy(),
        });
      }
      this.boardIndex += 1;
      this.time.delayedCall(180, () => this.dealBoard());
    });
  }

  private endRound(): void {
    if (this.mismatch) {
      this.mismatch.timer.remove();
      this.mismatch = null;
    }
    this.first = null;
    // 결과 화면으로 넘어가기 전에, 남은 카드를 모두 펼쳐서 어디에 무엇이 있었는지 보여 준다.
    for (const card of this.cards) {
      if (!card.faceUp) this.setFace(card, true);
    }
    showBanner(this, this.area.centerY, '끝!', CSS.yellow, 900, DEPTH.banner);
    this.finishMiniGame(this.score, [
      ['맞춘 짝', `${this.pairsFound}쌍`],
      ['깬 판', `${this.boardsCleared}판`],
      ['최대 연속', String(this.maxStreak)],
    ]);
  }
}
