import Phaser from 'phaser';
import { SCENE } from '../config';
import type { PlayResult } from '../core/save';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { fadeIn, PixelButton } from '../core/ui';
import { getGame } from '../games/registry';

/** 결과 화면에 덧붙여 보여 줄 한 줄. 예: ['최대 콤보', '12'] */
export type ResultStat = readonly [label: string, value: string];

export interface ResultData {
  /** 결과 화면 맨 위에 보이는 게임 이름 */
  title: string;
  /** 이 게임을 실행한 씬 이름. "다시 하기"에 쓴다. */
  sceneKey: string;
  /** 이미 세이브에 반영된 이번 판의 결과 */
  result: PlayResult;
  stats: readonly ResultStat[];
}

export interface PauseData {
  sceneKey: string;
}

/**
 * 모든 미니게임 씬의 공통 바탕.
 * 일시정지(버튼, 앱이 가려졌을 때)와 결과 화면 연결을 맡아서, 각 게임은 규칙에만 집중하면 된다.
 */
export abstract class MiniGameScene extends Phaser.Scene {
  /** registry.ts에 등록한 게임 id */
  protected abstract readonly gameId: string;

  /** 점수가 오가는 진행 중인 상태인지. 카운트다운이나 종료 연출 중에는 false. */
  protected playing = false;
  private finished = false;

  /** 하위 씬의 create() 첫머리에서 부른다. */
  protected beginMiniGame(): void {
    this.playing = false;
    this.finished = false;

    // 전화가 오거나 다른 앱으로 넘어가면 자동으로 일시정지한다.
    const onHidden = (): void => this.pauseGame();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
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

  protected pauseGame(): void {
    if (this.finished || !this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch(SCENE.pause, { sceneKey: this.scene.key } satisfies PauseData);
  }

  /**
   * 게임이 끝났을 때 부른다. 기록은 바로 저장하고, 잠깐 뒤에 결과 화면을 띄운다.
   * 저장을 먼저 해 두면 결과 화면이 뜨기 전에 앱을 닫아도 기록이 남는다.
   */
  protected finishMiniGame(score: number, stats: readonly ResultStat[] = []): void {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    sfx.finish();

    const game = getGame(this.gameId);
    const result = store.recordPlay(this.gameId, score, game?.coinsFor(score) ?? 0);
    const data: ResultData = {
      title: game?.title ?? '결과',
      sceneKey: this.scene.key,
      result,
      stats,
    };
    this.time.delayedCall(900, () => {
      this.scene.pause();
      this.scene.launch(SCENE.result, data);
    });
  }
}
