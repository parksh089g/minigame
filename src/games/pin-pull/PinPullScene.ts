import Phaser from 'phaser';
import { TEXTURE } from '../../art/sprites';
import { GAME_WIDTH, MAX_GAME_HEIGHT, MIN_GAME_HEIGHT, SCENE } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addBackdrop, addText } from '../../core/ui';
import { floatText, GameHud, HUD_HEIGHT, showBanner } from '../../scenes/GameHud';
import { MiniGameScene } from '../../scenes/MiniGameScene';
import {
  CHAMBER_WIDTH,
  drawDoorPin,
  drawHearts,
  drawHero,
  drawHollows,
  drawLava,
  drawMonster,
  drawPin,
  drawRock,
  drawStone,
  drawTreasure,
  drawWater,
  FIGURE_HEIGHT,
  HANDLE_RADIUS,
  LIQUID_UNIT,
  LOOK,
  PIN_THICKNESS,
  STONE_HEIGHT,
  TREASURE_HEIGHT,
  type Hollow,
} from './art';
import {
  generatePuzzle,
  MAX_SHAFTS,
  MAX_STACK,
  pinsOf,
  pull,
  puzzleSeconds,
  START_HEARTS,
  startPuzzle,
  winPoints,
  type Contents,
  type LossCause,
  type Pin,
  type PullResult,
  type Puzzle,
  type PuzzleState,
} from './rules';

/**
 * dealing: 새 판이 나오는 중, idle: 핀을 고르는 중(이때만 시간이 흐른다),
 * busy: 뽑은 것이 떨어지는 중, settled: 판의 결과를 보여 주는 중, over: 목숨이 다해서 끝남
 */
type Phase = 'dealing' | 'idle' | 'busy' | 'settled' | 'over';

/** 목숨을 잃는 까닭. 판에서 진 경우에 시간 초과를 더했다. */
type Setback = LossCause | 'timeout';

interface PinView {
  pin: Pin;
  view: Phaser.GameObjects.Graphics;
  /** 손잡이의 가운데 */
  handle: { x: number; y: number };
  /** 누르면 이 핀이 뽑히는 영역: 손잡이와 막대, 그리고 그 핀이 받치는 방 */
  zone: Phaser.Geom.Rectangle;
  /** 막대의 가운데. 영역이 겹치는 자리에서는 여기에 가까운 핀을 고른다. */
  x: number;
  y: number;
}

/** 구덩이 바닥에 놓인 것. 떨어진 통로 바로 아래에 쌓인다. */
interface PitProp {
  kind: 'treasure' | 'stone';
  x: number;
}

interface Layout {
  rock: Phaser.Geom.Rectangle;
  chamberHeight: number;
  /** 윗줄 방의 천장 높이 */
  top: number;
  pit: Phaser.Geom.Rectangle;
  /** 용사가 기다리는 옆방 */
  room: Phaser.Geom.Rectangle;
}

/** 바위와 화면 가장자리 사이의 여백 */
const ROCK_MARGIN = 6;
/** 바위 위쪽에 목숨과 도움말을 두는 자리의 높이. 동굴은 적어도 이만큼 아래에서 시작한다. */
const HEADER_HEIGHT = 62;
/** 알림 한 줄이 동굴 꼭대기에서 떠 있는 높이. 도움말 두 줄은 그 위에 한 줄을 더 얹는다. */
const NOTE_RISE = 30;
/** 바위 가장자리에서 동굴까지의 두께 */
const WALL = 5;
/** 구덩이 아래에 남겨 두는 바위의 두께 */
const FLOOR = 10;
const ROOM = { width: 26, height: 36 } as const;
/** 옆방과 구덩이 사이, 문 핀이 서 있는 벽의 두께 */
const DOOR_WALL = 8;
/** 문 핀이 옆방 천장 위로 솟은 길이. 그 끝에 손잡이가 달린다. */
const DOOR_RISE = 13;
/** 구덩이에서 통로 아래가 아닌 왼쪽 끝의 폭. 용사가 들어와 서는 자리다. */
const LANDING = 17;
/** 통로 사이의 벽. 핀 손잡이가 여기에 놓인다. */
const SHAFT_GAP = 13;
const SHAFT_PITCH = CHAMBER_WIDTH + SHAFT_GAP;
/** 가로 핀의 막대가 왼쪽 벽 속으로 들어간 길이 */
const PIN_TUCK = 3;
/** 방의 높이. 화면이 길수록 조금 커진다(가장 짧은 화면, 가장 긴 화면). */
const CHAMBER_HEIGHT = { short: 50, tall: 62 } as const;
/** 구덩이는 방보다 이만큼 높다 */
const PIT_EXTRA = 18;
/** 용사와 괴물을 그림보다 이만큼 키워서 놓는다 */
const FIGURE_SCALE = 1.2;
/** 물 위에 뜬 보물이 물에 잠기는 깊이 */
const FLOAT_SINK = 4;
/** 구덩이에 고인 물이나 용암의 높이: 처음 한 덩이와 그 뒤로 한 덩이마다 */
const POOL = { first: 11, step: 5 } as const;

/** 핀이 빠져나가는 거리와 시간 */
const PIN_SLIDE = { distance: 30, ms: 150 } as const;
/** 핀이 빠지기 시작한 뒤 든 것이 떨어지기까지(ms) */
const FALL_DELAY_MS = 50;
/** 떨어지는 시간: 기본에 거리(px)마다 조금씩 더한다(ms) */
const FALL_MS = { base: 110, perPx: 0.5 } as const;
/** 용사가 구덩이로 걸어 들어가는 시간(ms) */
const WALK_MS = 180;
/** 이겼을 때 용사가 보물 곁으로 달려가는 시간(ms)과, 보물 가운데에서 떨어져 서는 거리 */
const CHEER_RUN_MS = 170;
const HERO_REACH = 21;
/** 닿은 뒤 다음 핀을 누를 수 있을 때까지(ms). 반응을 볼 틈이다. */
const REACT_MS = 100;
/** 판을 깬 뒤, 목숨을 잃은 뒤 다음 판이 나오기까지(ms) */
const WIN_PAUSE_MS = 900;
const LOSE_PAUSE_MS = 1150;
/** 마지막 목숨을 잃은 뒤 끝을 알리기까지(ms). 결과 화면은 그 뒤에 공통 바탕이 띄운다. */
const END_PAUSE_MS = 600;
/** 새 판이 나타나는 시간(ms). 이동안은 눌러도 뽑히지 않는다. */
const DEAL_MS = 180;
/** 일시정지에서 돌아온 뒤 시간이 다시 흐르기까지의 여유(초). 가려 두었던 판을 다시 볼 틈이다. */
const RESUME_GRACE_SECONDS = 0.8;
/** 남은 시간이 이 아래로 내려가면 1초마다 소리로 알린다 */
const TICK_FROM_SECONDS = 3;
/** 처음에 보여 주는 도움말이 사라지기 시작하는 때(ms) */
const HINT_MS = 5500;

const SETBACK_NOTES: Record<Setback, string> = {
  burnt: '보물이 타 버렸어요',
  lava: '앗, 뜨거워요!',
  monster: '괴물에게 잡혔어요',
  timeout: '시간이 다 됐어요',
};

const DEPTH = { rock: 1, board: 5, effect: 20, hud: 30, banner: 40 } as const;

function layoutFor(height: number): Layout {
  const rockTop = HUD_HEIGHT + 4;
  const rock = new Phaser.Geom.Rectangle(
    ROCK_MARGIN,
    rockTop,
    GAME_WIDTH - ROCK_MARGIN * 2,
    height - rockTop - 9,
  );
  const stretch = Phaser.Math.Clamp(
    (height - MIN_GAME_HEIGHT) / (MAX_GAME_HEIGHT - MIN_GAME_HEIGHT),
    0,
    1,
  );
  const chamberHeight = Math.round(
    CHAMBER_HEIGHT.short + (CHAMBER_HEIGHT.tall - CHAMBER_HEIGHT.short) * stretch,
  );
  const pitHeight = chamberHeight + PIT_EXTRA;
  const rows = MAX_STACK * (chamberHeight + PIN_THICKNESS);

  // 방과 구덩이는 도움말 아래에 남은 자리의 한가운데에 놓는다.
  const areaTop = rock.top + HEADER_HEIGHT;
  const spare = rock.bottom - FLOOR - areaTop - rows - pitHeight;
  const top = Math.round(areaTop + spare / 2);

  const roomLeft = rock.left + WALL;
  const pitLeft = roomLeft + ROOM.width + DOOR_WALL;
  const pit = new Phaser.Geom.Rectangle(pitLeft, top + rows, rock.right - WALL - pitLeft, pitHeight);
  const room = new Phaser.Geom.Rectangle(roomLeft, pit.bottom - ROOM.height, ROOM.width, ROOM.height);
  return { rock, chamberHeight, top, pit, room };
}

/** 방에 든 것이 바닥에서부터 쌓인 높이. 위에서 떨어진 것이 그 위에 내려앉는다. */
function restHeight(contents: Contents): number {
  const liquid = (contents.lava + contents.water) * LIQUID_UNIT;
  if (contents.treasure > 0) return Math.max(0, liquid - FLOAT_SINK) + TREASURE_HEIGHT;
  return Math.max(liquid, contents.stone > 0 ? STONE_HEIGHT : 0);
}

function poolHeight(contents: Contents): number {
  const units = contents.lava + contents.water;
  return units > 0 ? POOL.first + POOL.step * (units - 1) : 0;
}

/**
 * 핀 뽑기: 동굴의 방마다 보물, 용암, 물이 핀에 받쳐져 있다.
 * 핀을 누르면 뽑히고 든 것이 아래로 떨어진다. 순서를 잘 골라 용사가 보물을 얻게 한다.
 * 판마다 시간이 정해져 있고, 지거나 시간이 다 되면 목숨이 하나 줄어든다.
 */
export class PinPullScene extends MiniGameScene {
  protected readonly gameId = 'pin-pull';

  private stage = 1;
  /** HUD에 적혀 있는 단계. 단계가 오른 판에서만 글자를 튀게 하려고 기억한다. */
  private shownStage = 0;
  private hearts = START_HEARTS;
  private score = 0;
  private cleared = 0;
  private pulls = 0;
  /** 판을 깰 때마다 남긴 시간을 모은 것(초) */
  private savedSeconds = 0;
  private puzzle: Puzzle | null = null;
  private state: PuzzleState | null = null;
  private phase: Phase = 'dealing';
  private timeLimit = 0;
  private timeLeft = 0;
  /** 0보다 크면 시간이 잠깐 멈춰 있는 중 */
  private grace = 0;
  private lastTickSecond = 0;
  /** 이번 판(런)에서 괴물을 본 적이 있는지. 처음 볼 때 한 번 알려 준다. */
  private monsterSeen = false;

  private layout!: Layout;
  private hud!: GameHud;
  /** 판마다 새로 그리는 것(동굴, 든 것, 핀, 용사)을 모두 담는 그릇. 일시정지 중에 통째로 가린다. */
  private board!: Phaser.GameObjects.Container;
  private heartsView!: Phaser.GameObjects.Graphics;
  private poolView!: Phaser.GameObjects.Graphics;
  private propsView!: Phaser.GameObjects.Graphics;
  private heroView!: Phaser.GameObjects.Graphics;
  private monsterView: Phaser.GameObjects.Graphics | null = null;
  /** 방에 든 것의 그림. state.shafts와 같은 모양이고, 빈 방은 null이다. */
  private cellViews: (Phaser.GameObjects.Graphics | null)[][] = [];
  private pinViews: PinView[] = [];
  private props: PitProp[] = [];
  /** 첫 판에서 손잡이를 알려 주는 물결 */
  private rings: Phaser.GameObjects.Arc[] = [];
  private hints: Phaser.GameObjects.Text[] = [];
  private note: Phaser.GameObjects.Text | null = null;
  private sparks!: Record<keyof typeof LOOK.sparks, Phaser.GameObjects.Particles.ParticleEmitter>;

  constructor() {
    super(SCENE.pinPull);
  }

  create(): void {
    this.beginMiniGame();
    this.resetState();

    this.layout = layoutFor(this.scale.height);
    const { rock } = this.layout;

    addBackdrop(this);
    const rockView = this.add.graphics().setDepth(DEPTH.rock);
    drawRock(rockView, rock.x, rock.y, rock.width, rock.height);
    this.board = this.add.container(0, 0).setDepth(DEPTH.board);
    this.heartsView = this.add.graphics().setDepth(DEPTH.board);
    this.drawHeartsView();
    this.sparks = {
      win: this.createSparks(LOOK.sparks.win),
      burn: this.createSparks(LOOK.sparks.burn),
      water: this.createSparks(LOOK.sparks.water),
    };

    this.addPauseButton();
    this.hud = new GameHud(this, DEPTH.hud);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    // 일시정지한 동안 시간 걱정 없이 풀이를 궁리할 수 없게 판을 가린다.
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
    });

    this.showHints();
    this.deal();
    sfx.go();
    this.playing = true;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.playing || this.phase !== 'idle') return;
    // 탭이 가려졌다 돌아와도 시간이 한꺼번에 흐르지 않게 한 프레임의 길이를 제한한다.
    const dt = Math.min(deltaMs, 100) / 1000;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.hud.setTime(this.timeLeft, this.timeLimit);
    if (this.timeLeft <= 0) {
      sfx.expire();
      this.loseHeart('timeout');
      return;
    }
    const second = Math.ceil(this.timeLeft);
    if (second <= TICK_FROM_SECONDS && second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      sfx.tick();
    }
  }

  private resetState(): void {
    this.stage = 1;
    this.shownStage = 0;
    this.hearts = START_HEARTS;
    this.score = 0;
    this.cleared = 0;
    this.pulls = 0;
    this.savedSeconds = 0;
    this.puzzle = null;
    this.state = null;
    this.phase = 'dealing';
    this.timeLimit = 0;
    this.timeLeft = 0;
    this.grace = 0;
    this.lastTickSecond = 0;
    this.monsterSeen = false;
    this.monsterView = null;
    this.cellViews = [];
    this.pinViews = [];
    this.props = [];
    this.rings = [];
    this.hints = [];
    this.note = null;
  }

  private createSparks(colors: readonly number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add
      .particles(0, 0, TEXTURE.spark, {
        speed: { min: 30, max: 90 },
        lifespan: { min: 220, max: 420 },
        alpha: { start: 1, end: 0 },
        tint: [...colors],
        emitting: false,
      })
      .setDepth(DEPTH.effect);
  }

  // ───────── 자리 ─────────

  /** index번째 통로의 왼쪽 벽. 통로가 적으면 구덩이 위 가운데로 모은다. */
  private shaftLeft(index: number): number {
    const count = this.puzzle?.shafts.length ?? MAX_SHAFTS;
    const inset = ((MAX_SHAFTS - count) * SHAFT_PITCH) / 2;
    return this.layout.pit.left + LANDING + inset + index * SHAFT_PITCH;
  }

  /** 그 방의 바닥(받치는 핀의 윗면) 높이. 방이 하나뿐인 통로는 아랫줄에 놓인다. */
  private floorY(shaft: number, level: number): number {
    const { top, chamberHeight } = this.layout;
    const row = MAX_STACK - (this.puzzle?.shafts[shaft].length ?? MAX_STACK) + level;
    return top + row * (chamberHeight + PIN_THICKNESS) + chamberHeight;
  }

  private get doorX(): number {
    return this.layout.room.right + DOOR_WALL / 2;
  }

  /** 용사가 서는 자리(발밑): 옆방 안, 구덩이에 들어온 뒤 */
  private heroSpot(where: 'room' | 'pit'): { x: number; y: number } {
    const { room, pit } = this.layout;
    return where === 'room'
      ? { x: room.centerX, y: room.bottom - 2 }
      : { x: pit.left + 10, y: pit.bottom - 2 };
  }

  private get monsterSpot(): { x: number; y: number } {
    const { pit } = this.layout;
    return { x: pit.right - 12, y: pit.bottom - 2 };
  }

  // ───────── 입력 ─────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // 위쪽 HUD(일시정지 버튼)를 누른 것은 핀을 고른 것이 아니다.
    if (!this.playing || this.phase !== 'idle' || pointer.worldY < HUD_HEIGHT) return;
    const target = this.pinAt(pointer.worldX, pointer.worldY);
    if (target) this.pullPin(target);
  }

  /** (x, y)를 눌렀을 때 뽑힐 핀. 영역이 겹치면 막대에 더 가까운 쪽이다. */
  private pinAt(x: number, y: number): PinView | null {
    let best: PinView | null = null;
    let bestDistance = Infinity;
    for (const candidate of this.pinViews) {
      if (!candidate.zone.contains(x, y)) continue;
      const distance = Math.hypot(x - candidate.x, y - candidate.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  private onPause(): void {
    if (this.playing) this.board.setVisible(false);
  }

  private onResume(): void {
    this.board.setVisible(true);
    if (this.playing) this.grace = RESUME_GRACE_SECONDS;
  }

  // ───────── 도움말 ─────────

  private showHints(): void {
    const top = this.layout.top - NOTE_RISE - 16;
    this.hints = [
      addText(this, GAME_WIDTH / 2, top, '핀을 눌러서 뽑아요', {
        color: LOOK.text.hint,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
      addText(this, GAME_WIDTH / 2, top + 16, '용암은 물로 식히고 보물을 받아요', {
        color: LOOK.text.hintSub,
        originX: 0.5,
        stroke: LOOK.text.outline,
      }),
    ];
    for (const line of this.hints) line.setDepth(DEPTH.hud);
    this.tweens.add({
      targets: this.hints,
      alpha: 0,
      delay: HINT_MS,
      duration: 500,
      onComplete: () => this.clearHints(),
    });
  }

  private clearHints(): void {
    for (const line of this.hints) {
      this.tweens.killTweensOf(line);
      line.destroy();
    }
    this.hints = [];
  }

  /** 도움말 자리에 한 줄을 잠깐 띄운다. 처음의 도움말이 아직 있으면 치운다. */
  private showNote(label: string, color: string, durationMs: number): void {
    this.clearHints();
    if (this.note) {
      this.tweens.killTweensOf(this.note);
      this.note.destroy();
    }
    const note = addText(this, GAME_WIDTH / 2, this.layout.top - NOTE_RISE, label, {
      color,
      originX: 0.5,
      stroke: LOOK.text.outline,
    }).setDepth(DEPTH.hud);
    this.note = note;
    this.tweens.add({
      targets: note,
      alpha: 0,
      delay: durationMs * 0.75,
      duration: durationMs * 0.25,
      onComplete: () => {
        note.destroy();
        if (this.note === note) this.note = null;
      },
    });
  }

  private drawHeartsView(): void {
    const { rock } = this.layout;
    drawHearts(this.heartsView, rock.left + 8, rock.top + 7, this.hearts, START_HEARTS);
  }

  // ───────── 판 깔기 ─────────

  /** 지금 단계의 새 판을 낸다. 같은 단계를 다시 할 때는 방금 그 판과 다른 판이 나온다. */
  private deal(): void {
    const puzzle = generatePuzzle(this.stage, Math.random, this.puzzle ?? undefined);
    this.puzzle = puzzle;
    this.state = startPuzzle(puzzle);
    this.timeLimit = puzzleSeconds(this.stage);
    this.timeLeft = this.timeLimit;
    this.lastTickSecond = 0;
    this.grace = 0;
    this.props = [];

    this.buildBoard(puzzle);
    this.hud.setSide(`${this.stage}단계`, this.stage !== this.shownStage);
    this.shownStage = this.stage;
    this.hud.setTime(this.timeLeft, this.timeLimit);
    if (puzzle.monster && !this.monsterSeen) {
      this.monsterSeen = true;
      this.showNote('괴물은 용암으로 물리쳐요', LOOK.text.hint, 4000);
    }

    this.phase = 'dealing';
    this.board.setAlpha(0);
    this.tweens.add({
      targets: this.board,
      alpha: 1,
      duration: DEAL_MS,
      onComplete: () => {
        if (this.phase === 'dealing') this.phase = 'idle';
      },
    });
  }

  private buildBoard(puzzle: Puzzle): void {
    for (const child of this.board.list) this.tweens.killTweensOf(child);
    this.board.removeAll(true);

    const hollows = this.add.graphics();
    drawHollows(hollows, this.hollowsOf(puzzle));
    this.poolView = this.add.graphics();
    this.propsView = this.add.graphics();
    this.board.add([hollows, this.poolView, this.propsView]);

    this.cellViews = puzzle.shafts.map((chambers, shaft) =>
      chambers.map((item, level) =>
        this.addCell(shaft, level, { treasure: 0, lava: 0, water: 0, stone: 0, [item]: 1 }),
      ),
    );

    this.monsterView = null;
    if (puzzle.monster) {
      const { x, y } = this.monsterSpot;
      this.monsterView = this.add.graphics().setPosition(x, y).setScale(FIGURE_SCALE);
      drawMonster(this.monsterView);
      this.board.add(this.monsterView);
    }
    const spot = this.heroSpot('room');
    this.heroView = this.add.graphics().setPosition(spot.x, spot.y).setScale(FIGURE_SCALE);
    drawHero(this.heroView, 'calm');
    this.board.add(this.heroView);

    this.pinViews = pinsOf(puzzle).map((pin) => this.addPin(pin));
    // 첫 판에서는 손잡이가 누르는 곳이라는 것을 둥근 물결로 알려 준다.
    this.rings = [];
    if (this.pulls === 0) this.pulseHandles();
  }

  /** 바위에 파인 자리: 구덩이, 옆방과 그 사이의 문간, 통로들 */
  private hollowsOf(puzzle: Puzzle): Hollow[] {
    const { pit, room, chamberHeight } = this.layout;
    const hollows: Hollow[] = [
      { x: pit.x, y: pit.y, width: pit.width, height: pit.height, radius: 8 },
      { x: room.x, y: room.y, width: room.width, height: room.height, radius: 8 },
      { x: room.right - 4, y: room.y + 6, width: DOOR_WALL + 8, height: room.height - 6, radius: 3 },
    ];
    puzzle.shafts.forEach((_, shaft) => {
      const top = this.floorY(shaft, 0) - chamberHeight;
      hollows.push({
        x: this.shaftLeft(shaft),
        y: top,
        width: CHAMBER_WIDTH,
        // 구덩이와 한 덩어리로 보이게 조금 겹친다.
        height: pit.top - top + 10,
        radius: 8,
      });
    });
    return hollows;
  }

  /** 방에 든 것을 그려서 놓는다. 원점은 방 바닥의 왼쪽 끝이라서, 떨어뜨릴 때는 y만 옮기면 된다. */
  private addCell(shaft: number, level: number, contents: Contents): Phaser.GameObjects.Graphics {
    const view = this.add.graphics().setPosition(this.shaftLeft(shaft), this.floorY(shaft, level));
    const liquid = (contents.lava + contents.water) * LIQUID_UNIT;
    if (contents.lava > 0) drawLava(view, 0, 0, CHAMBER_WIDTH, liquid);
    else if (contents.water > 0) drawWater(view, 0, 0, CHAMBER_WIDTH, liquid);
    if (contents.stone > 0) drawStone(view, CHAMBER_WIDTH / 2, 0);
    // 물과 함께 있는 보물은 물 위에 살짝 잠겨 떠 있어서 둘 다 보인다.
    if (contents.treasure > 0) drawTreasure(view, CHAMBER_WIDTH / 2, -Math.max(0, liquid - FLOAT_SINK));
    this.board.add(view);
    return view;
  }

  private addPin(pin: Pin): PinView {
    const view = this.add.graphics();
    this.board.add(view);

    if (pin.kind === 'door') {
      const { room } = this.layout;
      const length = room.height + DOOR_RISE;
      view.setPosition(this.doorX, room.bottom - 1);
      drawDoorPin(view, length);
      const zoneTop = room.bottom - 1 - length - HANDLE_RADIUS - 8;
      return {
        pin,
        view,
        handle: { x: this.doorX, y: room.bottom - 1 - length },
        // 손잡이와 막대뿐 아니라 옆방의 용사를 눌러도 문이 열린다.
        zone: new Phaser.Geom.Rectangle(
          room.left,
          zoneTop,
          this.doorX + 17 - room.left,
          room.bottom - zoneTop,
        ),
        x: this.doorX,
        y: room.centerY,
      };
    }

    const left = this.shaftLeft(pin.shaft);
    const floor = this.floorY(pin.shaft, pin.level);
    // 막대는 왼쪽 벽에 살짝 박혀 있고, 손잡이는 오른쪽 벽의 한가운데에 놓인다.
    const length = PIN_TUCK + CHAMBER_WIDTH + SHAFT_GAP / 2;
    const y = floor + PIN_THICKNESS / 2;
    view.setPosition(left - PIN_TUCK, y);
    drawPin(view, length);
    const zoneTop = floor - this.layout.chamberHeight + 4;
    return {
      pin,
      view,
      handle: { x: left - PIN_TUCK + length, y },
      // 방의 왼쪽 벽에서 손잡이의 오른쪽 끝까지. 옆 통로의 영역과 맞닿되 겹치지 않는다.
      zone: new Phaser.Geom.Rectangle(left, zoneTop, SHAFT_PITCH, floor + PIN_THICKNESS + 8 - zoneTop),
      x: left + SHAFT_PITCH / 2,
      y,
    };
  }

  /** 손잡이마다 둥근 물결이 몇 번 퍼진다. 위쪽 핀부터 차례로 퍼져서 눈길이 위에서 아래로 내려온다. */
  private pulseHandles(): void {
    const highest = Math.min(...this.pinViews.map(({ handle }) => handle.y));
    for (const { handle } of this.pinViews) {
      const ring = this.add.circle(handle.x, handle.y, HANDLE_RADIUS + 1).setStrokeStyle(1.5, LOOK.glint);
      this.board.add(ring);
      this.rings.push(ring);
      this.tweens.add({
        targets: ring,
        scale: 2,
        alpha: { from: 1, to: 0 },
        duration: 700,
        delay: 300 + (handle.y - highest) * 2,
        repeat: 3,
        repeatDelay: 300,
      });
    }
  }

  /** 핀을 뽑기 시작하면 물결은 할 일을 다했다. */
  private clearRings(): void {
    for (const ring of this.rings) {
      this.tweens.killTweensOf(ring);
      ring.destroy();
    }
    this.rings = [];
  }

  // ───────── 핀 뽑기 ─────────

  private pullPin(target: PinView): void {
    const before = this.state;
    if (!before) return;
    const result = pull(before, target.pin);
    if (!result.pulled) return;

    this.state = result.state;
    this.pulls += 1;
    this.phase = 'busy';
    this.pinViews = this.pinViews.filter((candidate) => candidate !== target);
    this.clearRings();
    this.slideOut(target);
    sfx.pull();
    vibrate(8);

    this.time.delayedCall(FALL_DELAY_MS, () => {
      if (target.pin.kind === 'door') this.walkIn();
      else this.dropFrom(target.pin.shaft, target.pin.level, before, result);
    });
  }

  /** 핀이 손잡이 쪽으로 빠져나가며 사라진다. */
  private slideOut({ pin, view }: PinView): void {
    const door = pin.kind === 'door';
    this.tweens.add({
      targets: view,
      x: door ? view.x : view.x + PIN_SLIDE.distance,
      y: door ? view.y - PIN_SLIDE.distance : view.y,
      alpha: 0,
      duration: PIN_SLIDE.ms,
      ease: 'Quad.Out',
      onComplete: () => view.destroy(),
    });
  }

  /** 방에 든 것이 아래 칸으로 떨어진다. 닿으면 그 칸을 새 상태대로 다시 그린다. */
  private dropFrom(shaft: number, level: number, before: PuzzleState, result: PullResult): void {
    const view = this.cellViews[shaft][level];
    const fall = result.fall;
    if (!view || !fall) {
      this.settle();
      return;
    }
    this.cellViews[shaft][level] = null;

    const { pit } = this.layout;
    const landing =
      fall.to.kind === 'pit'
        ? pit.bottom - 1 - poolHeight(before.pit)
        : this.floorY(shaft, fall.to.level) -
          restHeight(before.shafts[shaft][fall.to.level].contents);
    this.tweens.add({
      targets: view,
      y: landing,
      duration: FALL_MS.base + FALL_MS.perPx * (landing - view.y),
      ease: 'Quad.In',
      onComplete: () => {
        view.destroy();
        this.land(shaft, before, result);
      },
    });
  }

  /** 떨어진 것이 닿았을 때: 닿은 칸을 다시 그리고, 거기서 일어난 일을 보여 준다. */
  private land(shaft: number, before: PuzzleState, result: PullResult): void {
    const state = result.state;
    const fall = result.fall;
    if (!fall) return;
    const x = this.shaftLeft(shaft) + CHAMBER_WIDTH / 2;
    const burnt = state.lossCause === 'burnt';
    let y: number;
    let burnX = x;

    if (fall.to.kind === 'chamber') {
      const { level } = fall.to;
      this.cellViews[shaft][level]?.destroy();
      this.cellViews[shaft][level] = this.addCell(shaft, level, state.shafts[shaft][level].contents);
      y = this.floorY(shaft, level) - LIQUID_UNIT / 2;
    } else {
      const resting = this.props.find((prop) => prop.kind === 'treasure');
      if (burnt && resting) burnX = resting.x;
      if (burnt) this.props = this.props.filter((prop) => prop.kind !== 'treasure');
      for (let i = before.pit.stone; i < state.pit.stone; i += 1) this.props.push({ kind: 'stone', x });
      if (state.pit.treasure > before.pit.treasure) this.props.push({ kind: 'treasure', x });
      this.drawPit(state);
      y = this.layout.pit.bottom - 8;
    }

    if (fall.contents.lava + fall.contents.water > 0) sfx.pour();
    else sfx.land();
    if (result.cooled > 0) this.steamAt(x, y);
    if (result.slain) this.vanishMonster();
    if (burnt) this.burnAt(burnX, y);
    this.settle();
  }

  /** 문이 열리고 용사가 구덩이로 걸어 들어간다. */
  private walkIn(): void {
    const spot = this.heroSpot('pit');
    sfx.whoosh();
    this.tweens.add({
      targets: this.heroView,
      x: spot.x,
      duration: WALK_MS,
      ease: 'Sine.Out',
      onComplete: () => this.settle(),
    });
    // 걸음마다 살짝 통통 튄다.
    this.tweens.add({
      targets: this.heroView,
      y: spot.y - 4,
      duration: WALK_MS / 4,
      yoyo: true,
      repeat: 1,
    });
  }

  /** 반응을 잠깐 보여 준 뒤 판의 결과를 따진다. 끝나지 않았으면 다시 핀을 고를 수 있다. */
  private settle(): void {
    this.time.delayedCall(REACT_MS, () => {
      const status = this.state?.status;
      if (status === 'won') this.winPuzzle();
      else if (status === 'lost') this.loseHeart(this.state?.lossCause ?? 'burnt');
      else this.phase = 'idle';
    });
  }

  // ───────── 구덩이 ─────────

  /** 구덩이에 고인 것과 바닥에 놓인 것을 상태대로 다시 그린다. */
  private drawPit(state: PuzzleState): void {
    const { pit } = this.layout;
    const floor = pit.bottom - 1;
    const level = poolHeight(state.pit);
    this.poolView.clear();
    if (state.pit.lava > 0) drawLava(this.poolView, pit.left + 1, floor, pit.width - 2, level);
    else if (state.pit.water > 0) drawWater(this.poolView, pit.left + 1, floor, pit.width - 2, level);

    this.propsView.clear();
    // 같은 통로에서 떨어진 것은 먼저 온 것 위에 쌓인다.
    const heights = new Map<number, number>();
    for (const prop of this.props) {
      const base = heights.get(prop.x) ?? 0;
      if (prop.kind === 'stone') drawStone(this.propsView, prop.x, floor - base);
      else drawTreasure(this.propsView, prop.x, floor - base);
      heights.set(prop.x, base + (prop.kind === 'stone' ? STONE_HEIGHT : TREASURE_HEIGHT) - 2);
    }
  }

  // ───────── 반응 ─────────

  /** 용암이 물을 만나 식을 때: 치익 소리와 함께 흰 김이 피어오른다. */
  private steamAt(x: number, y: number): void {
    sfx.sizzle();
    this.sparks.water.explode(6, x, y);
    this.puffs(x, y, LOOK.steam, 0.9, 0);
  }

  /** 보물이 용암에 탈 때: 번쩍이고 불티가 튄 뒤 연기가 오른다. */
  private burnAt(x: number, y: number): void {
    sfx.sizzle();
    this.sparks.burn.explode(14, x, y - 4);
    const flash = this.add.circle(x, y - 4, 10, LOOK.burn.flash, 0.95).setDepth(DEPTH.effect);
    this.tweens.add({
      targets: flash,
      scale: 2.6,
      alpha: 0,
      duration: 320,
      ease: 'Quad.Out',
      onComplete: () => flash.destroy(),
    });
    this.puffs(x, y - 4, LOOK.burn.smoke, 0.5, 140);
  }

  /** 작은 뭉게구름 셋이 차례로 떠오르며 흩어진다. 김과 연기에 쓴다. */
  private puffs(x: number, y: number, color: number, alpha: number, delay: number): void {
    for (const [dx, wait] of [
      [-6, 0],
      [5, 60],
      [0, 120],
    ] as const) {
      const puff = this.add.circle(x + dx, y, 4, color, alpha).setDepth(DEPTH.effect).setVisible(false);
      this.tweens.add({
        targets: puff,
        y: y - 22,
        scale: 1.8,
        alpha: 0,
        delay: delay + wait,
        duration: 420,
        ease: 'Quad.Out',
        onStart: () => puff.setVisible(true),
        onComplete: () => puff.destroy(),
      });
    }
  }

  /** 괴물이 용암에 닿아 사라진다. */
  private vanishMonster(): void {
    const monster = this.monsterView;
    if (!monster) return;
    this.monsterView = null;
    sfx.pop();
    this.sparks.burn.explode(8, monster.x, monster.y - FIGURE_HEIGHT / 2);
    this.tweens.add({
      targets: monster,
      scale: 0,
      angle: 40,
      alpha: 0,
      duration: 260,
      ease: 'Back.In',
      onComplete: () => monster.destroy(),
    });
  }

  // ───────── 판의 결과 ─────────

  private winPuzzle(): void {
    this.phase = 'settled';
    const points = winPoints(this.stage, this.timeLeft);
    this.score += points;
    this.cleared += 1;
    this.savedSeconds += this.timeLeft;
    this.hud.setScore(this.score);

    // 용사가 보물 곁으로 달려가 폴짝 뛴다.
    const hero = this.heroView;
    const treasure = this.props.find((prop) => prop.kind === 'treasure');
    const goal = treasure ? Math.max(hero.x, treasure.x - HERO_REACH) : hero.x;
    drawHero(hero, 'happy');
    this.tweens.add({ targets: hero, x: goal, duration: CHEER_RUN_MS, ease: 'Sine.Out' });
    this.tweens.add({
      targets: hero,
      y: hero.y - 9,
      delay: CHEER_RUN_MS,
      duration: 130,
      yoyo: true,
      repeat: 1,
      ease: 'Quad.Out',
    });
    this.sparks.win.explode(14, treasure?.x ?? hero.x, this.layout.pit.bottom - 12);
    floatText(
      this,
      goal,
      hero.y - FIGURE_HEIGHT * FIGURE_SCALE - 8,
      `+${points}`,
      LOOK.text.points,
      this.layout.rock,
      DEPTH.effect,
    );
    sfx.gold();
    vibrate([12, 20, 12]);
    this.clearHints();

    this.time.delayedCall(WIN_PAUSE_MS, () => {
      this.stage += 1;
      this.deal();
    });
  }

  /** 판에서 졌거나 시간이 다 됐을 때: 목숨이 하나 줄고, 남아 있으면 같은 단계의 새 판이 나온다. */
  private loseHeart(cause: Setback): void {
    this.phase = 'settled';
    this.hearts -= 1;
    this.drawHeartsView();
    this.showNote(SETBACK_NOTES[cause], LOOK.text.bad, LOSE_PAUSE_MS);
    if (cause === 'lava' || cause === 'monster') this.knockOutHero(cause);

    sfx.miss();
    vibrate([30, 30, 60]);
    this.cameras.main.shake(160, 0.008);

    if (this.hearts > 0) this.time.delayedCall(LOSE_PAUSE_MS, () => this.deal());
    else this.time.delayedCall(END_PAUSE_MS, () => this.endRun());
  }

  /** 용사가 쓰러진다. 괴물에게 잡힌 경우에는 괴물이 먼저 달려든다. */
  private knockOutHero(cause: 'lava' | 'monster'): void {
    const hero = this.heroView;
    drawHero(hero, 'dizzy');
    if (cause === 'monster' && this.monsterView) {
      this.tweens.add({ targets: this.monsterView, x: hero.x + 16, duration: 180, ease: 'Quad.In' });
    } else {
      this.sparks.burn.explode(8, hero.x, hero.y - FIGURE_HEIGHT / 2);
    }
    this.tweens.add({
      targets: hero,
      y: hero.y - 14,
      angle: -60,
      alpha: 0,
      delay: 200,
      duration: 500,
      ease: 'Quad.Out',
    });
  }

  private endRun(): void {
    this.phase = 'over';
    showBanner(this, this.layout.rock.top + 110, '끝!', LOOK.text.over, 900, DEPTH.banner);
    this.finishMiniGame(this.score, [
      ['깬 단계', `${this.cleared}단계`],
      ['뽑은 핀', `${this.pulls}개`],
      ['남긴 시간', `${Math.floor(this.savedSeconds)}초`],
    ]);
  }
}
