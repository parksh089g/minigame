import Phaser from 'phaser';
import { SCENE } from '../config';
import { APP_EVENT, type BackAware } from '../core/app-events';
import type { PlayResult } from '../core/save';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { holdToasts } from '../core/toast';
import { fadeIn, PixelButton } from '../core/ui';
import { getGame, thisWeek, todaysChallenge } from '../games/registry';
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

export interface PauseData {
  sceneKey: string;
  /** registry.ts에 등록한 게임 id. 그 게임의 방법(games/how-to.ts)이 있으면 "방법 보기" 버튼이 생긴다. */
  gameId?: string;
  /** 게임이 일시정지 화면에 덧붙여 보여 주는 것. 제목과 버튼 사이에 자리를 내준다. */
  extra?: PauseExtra;
  /** 처음에 보여 줄 쪽. 적지 않으면 버튼이 있는 첫 쪽이다. */
  page?: 'menu' | 'howTo';
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

  /** 하위 씬의 create() 첫머리에서 부른다. */
  protected beginMiniGame(): void {
    this.playing = false;
    this.finished = false;

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
      extra: this.pauseExtra(),
    } satisfies PauseData);
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
