import Phaser from 'phaser';
import { SCENE } from '../config';
import type { Achievement } from '../core/achievements';
import { APP_EVENT, type BackAware } from '../core/app-events';
import type { PlayResult } from '../core/save';
import { sfx } from '../core/sfx';
import { isUnlocked, nextLevel, stageRandom, STAGE_LEVELS } from '../core/stages';
import { store } from '../core/store';
import { holdToasts } from '../core/toast';
import { fadeIn, PixelButton } from '../core/ui';
import { getGame, thisWeek, todaysChallenge } from '../games/registry';
import { floatText } from './GameHud';
import { syncScores } from '../online/online';

/** 결과 화면에 덧붙여 보여 줄 한 줄. 예: ['최대 콤보', '12'] */
export type ResultStat = readonly [label: string, value: string];

export interface ResultData {
  /** 결과 화면 맨 위에 보이는 게임 이름 */
  title: string;
  /** 이 게임을 실행한 씬 이름. "다시 하기"에 쓴다. */
  sceneKey: string;
  /** registry.ts에 등록한 게임 id. 온라인 랭킹을 보여 줄 때 쓴다. */
  gameId: string;
  /** 이미 세이브에 반영된 이번 판의 결과 */
  result: PlayResult;
  stats: readonly ResultStat[];
  /** 기록 아래에 덧붙이는 아이콘 한 줄. 화면이 짧아 자리가 없으면 보이지 않는다. */
  strip?: ResultStrip;
}

/** 결과 화면의 기록 아래에 덧붙이는 아이콘 한 줄. 예: 무기마다 준 피해의 비중 */
export interface ResultStrip {
  /** 이 줄이 무엇인지 알려 주는 작은 글씨 */
  caption: string;
  /** 왼쪽부터 차례로 놓인다. texture는 이미 만들어 둔 텍스처의 이름(한 변 18px 안팎) */
  chips: ReadonlyArray<{ texture: string; label: string }>;
}

/** 게임 씬을 단계 모드로 열 때 넘기는 것. 넘기지 않으면 여느 때의 점수 도전이다. */
export interface StageStart {
  /** 열 단계(1부터). 아직 열리지 않은 단계면 점수 도전으로 열린다. */
  stageLevel?: number;
}

/** 단계 모드에서 한 단계가 끝났을 때 결과 화면(StageResultScene)에 넘기는 것 */
export interface StageResultData {
  title: string;
  /** 이 게임을 실행한 씬 이름. "다음 단계"와 "다시 하기"에 쓴다. */
  sceneKey: string;
  gameId: string;
  level: number;
  /** 깼는지. false면 기회를 다 썼거나 막혀서 끝난 것이다. */
  cleared: boolean;
  /** 이 단계를 처음 깼는지 */
  first: boolean;
  /** 처음 깨서 받은 코인 */
  coins: number;
  /** 이어서 할 다음 단계. 마지막 단계를 깼으면 null */
  next: number | null;
  /** 이번 단계로 다 채운 주간 미션의 수 */
  missions: number;
  /** 이번 단계로 새로 달성한 업적. 보상은 업적 화면에서 받는다. */
  achievements: readonly Achievement[];
  stats: readonly ResultStat[];
}

export interface PauseData {
  sceneKey: string;
  /** 단계 모드로 하고 있던 단계. "처음부터 다시"가 같은 단계를 다시 열고, "그만하기"가 단계 화면으로 돌아간다. */
  stageLevel?: number;
  /** registry.ts에 등록한 게임 id. 그 게임의 방법(games/how-to.ts)이 있으면 "방법 보기" 버튼이 생긴다. */
  gameId?: string;
  /** 게임이 일시정지 화면에 덧붙여 보여 주는 것. 제목과 버튼 사이에 자리를 내준다. */
  extra?: PauseExtra;
  /**
   * "그만하기"로 나가면 잃는 것을 알리는 한 줄. 있으면 나가기 전에 이 줄을 보이며 한 번 더 묻는다.
   * 없으면 묻지 않고 나간다.
   */
  quitWarning?: string;
  /** 지금까지의 점수를 기록하고 판을 끝낼 수 있으면 true. "기록하고 끝내기" 버튼이 생긴다. */
  canFinish?: boolean;
  /** 처음에 보여 줄 쪽. 적지 않으면 버튼이 있는 첫 쪽이다. 'quit'은 그만둘지 한 번 더 묻는 쪽이다. */
  page?: 'menu' | 'howTo' | 'quit';
}

/** 일시정지 화면에 게임이 덧붙이는 것. 예: 지금까지 고른 강화 */
export interface PauseExtra {
  /** 카드의 너비. 기본 너비보다 넓어야 할 때만 적는다. */
  width?: number;
  height: number;
  /** 일시정지 씬의 (left, top)에서 시작하는 width × height 자리에 그린다. */
  draw: (scene: Phaser.Scene, left: number, top: number, width: number) => void;
}

/**
 * 모든 미니게임 씬의 공통 바탕.
 * 일시정지(버튼, 앱이 가려졌을 때)와 결과 화면 연결을 맡아서, 각 게임은 규칙에만 집중하면 된다.
 */
export abstract class MiniGameScene extends Phaser.Scene implements BackAware {
  /** registry.ts에 등록한 게임 id */
  protected abstract readonly gameId: string;

  /** 점수가 오가는 진행 중인 상태인지. 카운트다운이나 종료 연출 중에는 false. */
  protected playing = false;
  private finished = false;
  /**
   * 단계 모드로 열렸으면 그 단계(1부터), 여느 때의 점수 도전이면 null.
   * beginMiniGame()이 정하므로 그 뒤에 읽는다. 단계 모드를 아는 게임(registry의 stageMode)만 값이 들어온다.
   */
  protected stageLevel: number | null = null;

  /** 하위 씬의 create() 첫머리에서 부른다. */
  protected beginMiniGame(): void {
    this.playing = false;
    this.finished = false;
    this.stageLevel = this.takeStageLevel();

    // 전화가 오거나 다른 앱으로 넘어가면, 또는 화면을 가로로 눕히면 자동으로 일시정지한다.
    const onHidden = (): void => this.pauseGame();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.game.events.on(APP_EVENT.pauseRequest, onHidden);
    // 안내 문구는 화면 아래쪽을 덮고 터치를 가져가므로, 플레이하는 동안에는 띄우지 않는다.
    holdToasts(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.game.events.off(APP_EVENT.pauseRequest, onHidden);
      holdToasts(false);
    });

    fadeIn(this);
  }

  /**
   * 씬을 열 때 넘겨받은 단계를 읽고 지운다. Phaser는 넘긴 것이 없으면 지난번에 넘긴 것을 그대로 두므로,
   * 지워 두지 않으면 단계 모드를 한 번 한 뒤에는 허브에서 열어도 단계 모드로 열린다.
   */
  private takeStageLevel(): number | null {
    const settings = this.scene.settings;
    const asked = (settings.data as StageStart | undefined)?.stageLevel;
    settings.data = {};
    if (typeof asked !== 'number' || getGame(this.gameId)?.stageMode !== true) return null;
    return isUnlocked(store.data.stages, this.gameId, asked) ? asked : null;
  }

  /** 지금 단계의 판을 만드는 난수. 같은 단계는 언제나 같은 판이 나온다. 단계 모드가 아니면 Math.random이다. */
  protected levelRandom(): () => number {
    return this.stageLevel === null ? Math.random : stageRandom(this.gameId, this.stageLevel);
  }

  /**
   * 방금 얻은 점수를 그 자리에 띄운다. 단계 모드는 점수를 세지 않으므로 아무것도 띄우지 않는다.
   * 점수가 아닌 것(깎인 시간, 줄어든 기회)은 floatText로 직접 띄운다.
   */
  protected floatPoints(
    x: number,
    y: number,
    points: number,
    color: string,
    bounds: Phaser.Geom.Rectangle,
    depth: number,
  ): void {
    if (this.stageLevel !== null) return;
    floatText(this, x, y, `+${points}`, color, bounds, depth);
  }

  protected addPauseButton(x = 8, y = 8): PixelButton {
    return new PixelButton(this, {
      x,
      y,
      width: 26,
      height: 26,
      icon: 'icon-pause',
      hitPadding: 6,
      onTap: () => this.pauseGame(),
    });
  }

  /** 뒤로 가기를 누르면 게임을 그만두는 대신 일시정지한다. */
  onBackRequest(): void {
    this.pauseGame();
  }

  protected pauseGame(): void {
    if (this.finished || !this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch(SCENE.pause, {
      sceneKey: this.scene.key,
      gameId: this.gameId,
      stageLevel: this.stageLevel ?? undefined,
      extra: this.pauseExtra(),
      quitWarning: this.quitWarning() ?? undefined,
      canFinish: this.canFinishEarly(),
    } satisfies PauseData);
  }

  /**
   * "그만하기"로 나가면 잃는 것을 알리는 한 줄. 일시정지 화면이 이 줄을 보이며 한 번 더 묻는다.
   * 기본은 묻지 않는다. 한 판이 길어서 실수로 버리면 아까운 게임이, 잃을 것이 있을 때만 글을 돌려준다.
   */
  protected quitWarning(): string | null {
    return null;
  }

  /**
   * 지금까지의 점수를 기록하고 판을 끝낼 수 있는지. true면 일시정지 화면에 "기록하고 끝내기"가 생기고,
   * 누르면 finishEarly()가 불린다. 스스로 끝낼 길이 없는 게임(시간 제한 없이 이어지는 게임)이 바꿔 쓴다.
   */
  protected canFinishEarly(): boolean {
    return false;
  }

  /** 지금까지의 점수로 판을 끝낸다. canFinishEarly()가 true인 게임이 finishMiniGame()까지 부르도록 바꿔 쓴다. */
  protected finishEarly(): void {}

  /** 일시정지 화면의 "기록하고 끝내기"가 게임을 다시 움직인 뒤에 부른다. */
  finishFromPause(): void {
    if (this.finished || !this.canFinishEarly()) return;
    this.finishEarly();
  }

  /** 일시정지 화면에 덧붙여 보여 줄 것. 없으면 기본 화면 그대로다. */
  protected pauseExtra(): PauseExtra | undefined {
    return undefined;
  }

  /** 판이 끝날 때 나는 소리. 끝맺음 소리가 따로 있는 게임은 이것을 바꿔 쓴다. */
  protected playFinishSound(): void {
    sfx.finish();
  }

  /**
   * 게임이 끝났을 때 부른다. 기록은 바로 저장하고, 잠깐 뒤에 결과 화면을 띄운다.
   * 저장을 먼저 해 두면 결과 화면이 뜨기 전에 앱을 닫아도 기록이 남는다.
   * 끝나는 장면을 더 길게 보여 줄 게임은 resultDelayMs를 늘린다.
   */
  protected finishMiniGame(
    score: number,
    stats: readonly ResultStat[] = [],
    resultDelayMs = 900,
    strip?: ResultStrip,
  ): void {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    this.playFinishSound();

    const game = getGame(this.gameId);
    const result = store.recordPlay(
      this.gameId,
      score,
      game?.coinsFor(score) ?? 0,
      todaysChallenge(),
      thisWeek(store.data.weekly),
    );
    // 랭킹에 참여하고 있으면 결과 화면이 뜨기 전에 기록을 올려 둔다. 인터넷이 없으면 다음에 올라간다.
    void syncScores();
    const data: ResultData = {
      title: game?.title ?? '결과',
      sceneKey: this.scene.key,
      gameId: this.gameId,
      result,
      stats,
      strip,
    };
    this.time.delayedCall(resultDelayMs, () => {
      this.scene.pause();
      this.scene.launch(SCENE.result, data);
    });
  }

  /**
   * 단계 모드에서 한 단계가 끝났을 때 부른다. 깼으면 기록하고(처음 깬 단계면 코인도 준다),
   * 잠깐 뒤에 단계 결과 화면을 띄운다. 깨지 못했으면 기록 없이 다시 하기를 권한다.
   * 깼을 때의 소리와 연출은 게임이 하고, 깨지 못했을 때의 끝맺음 소리만 여기서 낸다.
   */
  protected finishStage(cleared: boolean, stats: readonly ResultStat[] = [], resultDelayMs = 900): void {
    const level = this.stageLevel;
    if (this.finished || level === null) return;
    this.finished = true;
    this.playing = false;
    if (!cleared) this.playFinishSound();

    const game = getGame(this.gameId);
    const result = cleared ? store.clearStage(this.gameId, level, thisWeek(store.data.weekly)) : null;
    const data: StageResultData = {
      title: game?.title ?? '단계',
      sceneKey: this.scene.key,
      gameId: this.gameId,
      level,
      cleared,
      first: result?.first ?? false,
      coins: result?.coinsEarned ?? 0,
      next: cleared ? (level < STAGE_LEVELS ? level + 1 : null) : nextLevel(store.data.stages, this.gameId),
      missions: result?.newMissions.length ?? 0,
      achievements: result?.newAchievements ?? [],
      stats,
    };
    this.time.delayedCall(resultDelayMs, () => {
      this.scene.pause();
      this.scene.launch(SCENE.stageResult, data);
    });
  }

  /**
   * 점수 없이 승패로 끝나는 게임(registry의 versus)이 한 판을 마쳤을 때 부른다.
   * 한 판 한 것으로 기록하고 코인을 준 뒤 그 결과를 돌려준다. 공용 결과 화면은 띄우지 않으므로,
   * 누가 이겼는지와 "다시 하기", "나가기"는 그 게임이 자기 화면에서 보여 준다.
   * 두 번 불러도 한 번만 기록하고, 두 번째부터는 null을 돌려준다.
   */
  protected finishVersusMatch(): PlayResult | null {
    if (this.finished) return null;
    this.finished = true;
    this.playing = false;
    this.playFinishSound();
    const game = getGame(this.gameId);
    return store.recordPlay(this.gameId, 0, game?.coinsFor(0) ?? 0, null, thisWeek(store.data.weekly));
  }
}
