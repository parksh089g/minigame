import Phaser from 'phaser';
import { mascotTexture } from '../art/cosmetics';
import { TEXTURE } from '../art/sprites';
import { paintArt } from '../art/vector';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
import type { BackAware } from '../core/app-events';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { addPanel, addScrim, addTapZone, addText, fadeToScene, PixelButton } from '../core/ui';
import type { Achievement } from '../core/achievements';
import type { DailyOutcome } from '../core/save';
import { getGame } from '../games/registry';
import { loadBoard, scoreSync, syncScores } from '../online/online';
import { isJoined } from '../online/profile';
import { isRankedGame, rankLabel } from '../online/protocol';
import { makeShareImage } from '../share/card';
import { displayHost, shareFileName, shareNotice, shareText, shareTitle, shareUrl } from '../share/link';
import { sendShare } from '../share/send';
import type { ResultData, ResultStrip } from './MiniGameScene';
import { askNickname } from './nickname';
import type { RankingData } from './RankingScene';

const PANEL_WIDTH = 204;
const STAT_ROW = 16;
/** 오늘의 도전 결과나 새로 달성한 업적을 알리는 줄의 높이 */
const EXTRA_ROW = 24;
/** 기록 아래에 덧붙는 아이콘 한 줄: 작은 설명 글씨의 높이와 아이콘 줄의 높이, 아이콘과 글자 사이, 칸 사이(넓을 때와 좁을 때) */
const STRIP = { caption: 13, row: 20, icon: 18, gap: 2, between: 12, tight: 2 } as const;
/** 캐릭터가 카드 위로 올라와 보이는 높이와 카드에 걸치는 높이 */
const MASCOT = { above: 46, overlap: 20 } as const;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 7;
/** 카드 오른쪽 위의 공유 버튼: 한 변, 카드 모서리에서 떨어진 거리, 공유한 뒤 알림이 떠 있는 시간(ms), 그림을 만들기 시작할 때까지의 여유(ms) */
const SHARE = { size: 24, margin: 10, noticeMs: 1800, prepareMs: 400 } as const;

/** 한 판이 끝난 뒤 게임 위에 겹쳐 뜨는 결과 화면. 기록은 게임 씬이 이미 저장해 두었다. */
export class ResultScene extends Phaser.Scene implements BackAware {
  /** 결과를 낸 게임 씬의 이름 */
  private gameKey = '';
  /** 공유할 점수 카드 그림. 결과 화면이 뜨면 바로 만들기 시작하고, 다 되기 전에는 null이다. */
  private shareImage: File | null = null;
  /** 결과 화면이 열릴 때마다 올라간다. 지난 판의 그림이나 알림이 뒤늦게 끼어들지 않게 한다. */
  private shareRound = 0;

  constructor() {
    super(SCENE.result);
  }

  /** 결과 화면에서 뒤로 가기는 "다른 게임 고르기"와 같다. */
  onBackRequest(): void {
    this.leave();
  }

  private leave(): void {
    this.scene.stop(this.gameKey);
    fadeToScene(this, SCENE.hub);
  }

  create(data: ResultData): void {
    this.input.enabled = true;
    this.gameKey = data.sceneKey;
    const { result, stats } = data;

    const { height } = this.scale;
    const daily = result.daily;
    const achieved = result.newAchievements;
    // 점수를 낸 적이 있으면 온라인 랭킹 줄을 둔다. 닉네임을 정하기 전에는 참여를 권하는 줄이 된다.
    const ranked = result.best > 0 && isRankedGame(data.gameId);
    const extraRows = (daily ? 1 : 0) + (achieved.length > 0 ? 1 : 0) + (ranked ? 1 : 0);
    const buttonsHeight = 12 + BUTTON_HEIGHT * 2 + BUTTON_GAP + 3;
    const strip = data.strip && data.strip.chips.length > 0 ? data.strip : undefined;
    const sizeWith = (withStrip: boolean): { statsHeight: number; cardHeight: number } => {
      const inner = stats.length * STAT_ROW + (withStrip ? STRIP.caption + STRIP.row : 0);
      const statsHeight = inner > 0 ? inner + 12 : 0;
      return { statsHeight, cardHeight: 106 + statsHeight + 28 + extraRows * EXTRA_ROW + 6 };
    };
    // 알릴 것이 많은 판에 화면까지 짧으면 다 들어가지 않는다. 그때는 카드 위의 캐릭터를 먼저 빼고,
    // 그래도 넘치면 아이콘 줄을 뺀다.
    const showStrip = strip !== undefined && sizeWith(true).cardHeight + buttonsHeight + 4 <= height;
    const { statsHeight, cardHeight } = sizeWith(showStrip);
    const showMascot = MASCOT.above + cardHeight + buttonsHeight + 4 <= height;
    const above = showMascot ? MASCOT.above : 0;
    const total = above + cardHeight + buttonsHeight;
    const top = Math.max(2, Math.round((height - total) / 2)) + above;
    const left = Math.round((GAME_WIDTH - PANEL_WIDTH) / 2);
    const centerX = GAME_WIDTH / 2;
    const innerLeft = left + 16;
    const innerRight = left + PANEL_WIDTH - 16;

    addScrim(this);
    addPanel(this, left, top, PANEL_WIDTH, cardHeight, { radius: 20, depth: 4 });

    // 고른 캐릭터가 카드 위에 올라앉아 결과를 같이 본다. 신기록이면 팔을 들고 기뻐한다.
    const mascot = this.add
      .image(
        centerX,
        top + MASCOT.overlap,
        mascotTexture(store.data.cosmetics.equipped.runner, result.isNewBest ? 'cheer' : 'idle'),
      )
      .setOrigin(0.5, 1)
      .setVisible(showMascot);

    addText(this, centerX, top + 23, data.title, { color: THEME_CSS.sub, originX: 0.5 });
    this.addShareButton(data, left + PANEL_WIDTH - SHARE.margin - SHARE.size, top + SHARE.margin, centerX, top + 31);

    const scoreText = addText(this, centerX, top + 36, '0', {
      size: FONT_SIZE.huge,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
    });
    this.tweens.addCounter({
      from: 0,
      to: result.score,
      duration: Math.min(700, 150 + result.score * 8),
      onUpdate: (tween) => scoreText.setText(String(Math.round(tween.getValue() ?? 0))),
      onComplete: () => scoreText.setText(String(result.score)),
    });

    const badgeY = top + 81;
    if (result.isNewBest) {
      const badge = addText(this, centerX, badgeY + 9, '신기록!', {
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      });
      const pillWidth = Math.ceil(badge.width) + 24;
      const pill = this.add.graphics();
      pill.fillStyle(THEME.butter, 1);
      pill.fillRoundedRect(Math.round(centerX - pillWidth / 2), badgeY, pillWidth, 18, 9);
      badge.setDepth(1);
      const offset = Math.round(pillWidth / 2) + 10;
      const stars = [
        this.add.image(centerX - offset, badgeY + 9, 'icon-star').setDisplaySize(12, 12),
        this.add.image(centerX + offset, badgeY + 9, 'icon-star').setDisplaySize(12, 12),
      ];
      this.tweens.add({ targets: stars, alpha: 0.3, duration: 320, yoyo: true, repeat: -1 });
      this.tweens.add({
        targets: mascot,
        y: mascot.y - 6,
        duration: 260,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      this.time.delayedCall(350, () => {
        sfx.fanfare();
        vibrate([20, 40, 20]);
        this.celebrate(centerX, top);
      });
    } else {
      addText(this, centerX, badgeY + 9, `최고 기록 ${result.best}`, {
        color: THEME_CSS.sub,
        originX: 0.5,
        originY: 0.5,
      });
    }

    let y = top + 106;
    if (statsHeight > 0) {
      addPanel(this, innerLeft - 6, y, innerRight - innerLeft + 12, statsHeight - 4, {
        fill: THEME.bg,
        shadow: null,
        radius: 10,
      });
      y += 5;
      for (const [label, value] of stats) {
        addText(this, innerLeft + 2, y, label, { color: THEME_CSS.sub });
        addText(this, innerRight - 2, y, value, { originX: 1 });
        y += STAT_ROW;
      }
      if (strip && showStrip) {
        this.addStrip(strip, innerLeft + 2, y, innerRight - innerLeft - 4);
        y += STRIP.caption + STRIP.row;
      }
      y += 7;
    }

    y += 4;
    const coinLabel = addText(this, 0, y, `+${result.coinsEarned}`, { size: 14 });
    const coinRowWidth = 16 + Math.ceil(coinLabel.width);
    const coinLeft = Math.round(centerX - coinRowWidth / 2);
    this.add.image(coinLeft, y + 9, 'coin').setOrigin(0, 0.5);
    coinLabel.setX(coinLeft + 16);
    const coinDelay = result.isNewBest ? 900 : 500;
    if (result.coinsEarned > 0) this.time.delayedCall(coinDelay, () => sfx.coin());

    y += 24;
    let extraDelay = coinDelay + 350;
    if (daily) {
      this.addDailyRow(daily, innerLeft, innerRight, y, extraDelay);
      if (daily.cleared) extraDelay += 450;
      y += EXTRA_ROW;
    }
    if (achieved.length > 0) {
      this.addAchievementRow(achieved, innerLeft, innerRight, y, extraDelay);
      y += EXTRA_ROW;
    }
    if (ranked) this.addOnlineRow(data.gameId, innerLeft, innerRight, y);

    const buttonY = top + cardHeight + 12;
    new PixelButton(this, {
      x: left,
      y: buttonY,
      width: PANEL_WIDTH,
      height: BUTTON_HEIGHT,
      label: '다시 하기',
      style: 'pink',
      onTap: () => this.scene.start(data.sceneKey),
    });
    new PixelButton(this, {
      x: left,
      y: buttonY + BUTTON_HEIGHT + BUTTON_GAP,
      width: PANEL_WIDTH,
      height: BUTTON_HEIGHT,
      label: '다른 게임 고르기',
      onTap: () => this.leave(),
    });
  }

  /**
   * 공유 버튼. 누르면 점수 카드 그림과 이 게임을 바로 여는 주소를 공유 창으로 넘기고,
   * 공유 창이 없는 브라우저에서는 문구와 주소를 복사한 뒤 (noticeX, noticeY)에 잠깐 알린다.
   */
  private addShareButton(data: ResultData, x: number, y: number, noticeX: number, noticeY: number): void {
    const { result } = data;
    this.shareRound += 1;
    const round = this.shareRound;
    this.shareImage = null;
    const pageUrl = window.location.href;

    // 그림은 미리 만들어 둔다. 누른 그 자리에서 공유 창을 열어야 브라우저가 허락하기 때문이다.
    // 점수가 올라가는 연출이 버벅이지 않게 조금 뒤에 시작한다. 그 전에 누르면 그림 없이 주소만 보낸다.
    const mascot = mascotTexture(store.data.cosmetics.equipped.runner, result.isNewBest ? 'cheer' : 'idle');
    this.time.delayedCall(SHARE.prepareMs, () => {
      void makeShareImage(
        {
          title: data.title,
          score: result.score,
          best: result.best,
          isNewBest: result.isNewBest,
          host: displayHost(pageUrl),
          icon: getGame(data.gameId)?.icon ?? '',
          mascot,
          paint: (context, key, left, top, width, height) =>
            this.paintTexture(context, key, left, top, width, height),
        },
        shareFileName(data.gameId),
      ).then((file) => {
        if (round === this.shareRound) this.shareImage = file;
      });
    });

    let busy = false;
    new PixelButton(this, {
      x,
      y,
      width: SHARE.size,
      height: SHARE.size,
      icon: 'icon-share',
      style: 'blue',
      hitPadding: 6,
      onTap: () => {
        if (busy) return;
        busy = true;
        void sendShare({
          title: shareTitle(data.title),
          text: shareText(data.title, result.score),
          url: shareUrl(pageUrl, data.gameId),
          image: this.shareImage,
        }).then((outcome) => {
          busy = false;
          if (round !== this.shareRound || !this.scene.isActive()) return;
          const notice = shareNotice(outcome);
          if (notice) this.showNotice(notice, noticeX, noticeY);
        });
      },
    });
  }

  /**
   * 텍스처 이름이 가리키는 그림을 공유 카드에 그린다. 곡선 그림은 그 크기로 새로 그리고,
   * 픽셀 그림(등불지기 아이콘)은 번지지 않게 점을 그대로 키운다.
   */
  private paintTexture(
    context: CanvasRenderingContext2D,
    key: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (paintArt(context, key, x, y, width, height)) return;
    if (!this.textures.exists(key)) return;
    const source = this.textures.get(key).getSourceImage() as CanvasImageSource;
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(source, x, y, width, height);
    context.restore();
  }

  /** 게임 이름 자리에 잠깐 떴다가 사라지는 알림 */
  private showNotice(message: string, x: number, y: number): void {
    const label = addText(this, x, y, message, { color: THEME_CSS.white, originX: 0.5, originY: 0.5 }).setDepth(31);
    const width = Math.ceil(label.width) + 20;
    const back = this.add.graphics().setDepth(30);
    back.fillStyle(THEME.inkDeep, 0.92);
    back.fillRoundedRect(Math.round(x - width / 2), Math.round(y - 11), width, 22, 11);
    const parts = [back, label];
    this.tweens.add({
      targets: parts,
      alpha: 0,
      delay: SHARE.noticeMs,
      duration: 200,
      onComplete: () => parts.forEach((part) => part.destroy()),
    });
  }

  /**
   * 기록 아래의 아이콘 한 줄: 작은 설명 글씨 아래에 아이콘과 글자를 왼쪽부터 늘어놓는다.
   * 칸이 많아 width를 넘을 것 같으면 칸 사이를 좁힌다.
   */
  private addStrip(strip: ResultStrip, left: number, top: number, width: number): void {
    addText(this, left, top + 1, strip.caption, { size: FONT_SIZE.small, color: THEME_CSS.sub });
    const middle = top + STRIP.caption + STRIP.row / 2;
    const labels = strip.chips.map((chip) => addText(this, 0, middle, chip.label, { originY: 0.5 }));
    const used = labels.reduce((sum, label) => sum + STRIP.icon + STRIP.gap + Math.ceil(label.width), 0);
    const room = labels.length > 1 ? Math.floor((width - used) / (labels.length - 1)) : 0;
    const between = Math.max(STRIP.tight, Math.min(STRIP.between, room));
    let x = left;
    strip.chips.forEach((chip, index) => {
      if (this.textures.exists(chip.texture)) {
        this.add.image(Math.round(x + STRIP.icon / 2), Math.round(middle), chip.texture);
      }
      const label = labels[index];
      label.setX(Math.round(x + STRIP.icon + STRIP.gap));
      x += STRIP.icon + STRIP.gap + Math.ceil(label.width) + between;
    });
  }

  /** 신기록일 때 카드 위에서 색종이가 터진다. */
  private celebrate(x: number, y: number): void {
    const confetti = this.add.particles(0, 0, TEXTURE.spark, {
      speed: { min: 60, max: 150 },
      angle: { min: 200, max: 340 },
      gravityY: 260,
      lifespan: { min: 500, max: 900 },
      scale: { min: 0.8, max: 1.4 },
      alpha: { start: 1, end: 0 },
      tint: [THEME.pink, THEME.gold, THEME.mintDeep, THEME.lilac],
      emitting: false,
    });
    confetti.explode(26, x, y);
  }

  /**
   * 온라인 랭킹 줄. 랭킹에 참여하고 있으면 이 게임에서의 내 순위를 보여 주고, 누르면 랭킹 화면으로 간다.
   * 참여하지 않았으면 누를 때 닉네임을 묻는다. 인터넷이 없어도 결과 화면은 그대로 쓸 수 있다.
   */
  private addOnlineRow(gameId: string, left: number, right: number, y: number): void {
    const band = this.addBand(left, right, y, THEME.skySoft);
    this.add.image(left + 8, y + 10, 'icon-trophy').setDisplaySize(14, 14);
    const label = addText(this, left + 20, y + 3, '');
    const value = addText(this, right - 2, y + 3, '', { originX: 1 });

    const refresh = async (): Promise<void> => {
      if (!isJoined(store.data.online)) {
        label.setText('랭킹에 내 기록 올리기');
        value.setText('참여').setColor(THEME_CSS.accent);
        return;
      }
      label.setText('온라인 랭킹');
      const known = scoreSync.rankOf(gameId);
      value.setText(known === null ? '확인 중…' : rankLabel(known)).setColor(THEME_CSS.sub);

      // 게임이 끝날 때 이미 올리기 시작했다. 여기서는 그 결과를 같이 기다린다.
      const outcome = await syncScores();
      if (outcome.status === 'failed') {
        // 올리지 못한 기록은 세이브에 남아 있다가 다음에 인터넷이 될 때 올라간다.
        if (value.active) value.setText('다음에 올릴게요');
        return;
      }
      let rank = scoreSync.rankOf(gameId);
      if (rank === null) {
        const board = await loadBoard(gameId);
        if (board.ok) rank = board.data.me?.rank ?? null;
      }
      if (!value.active) return;
      if (rank !== null) value.setText(rankLabel(rank)).setColor(THEME_CSS.inkDeep);
      else value.setText('-');
    };
    void refresh();

    addTapZone(
      this,
      left - 6,
      y,
      right - left + 12,
      EXTRA_ROW - 4,
      (pressed) => band.setAlpha(pressed ? 0.55 : 1),
      () => {
        sfx.click();
        if (isJoined(store.data.online)) {
          this.scene.stop(this.gameKey);
          fadeToScene(this, SCENE.ranking, { gameId } satisfies RankingData);
          return;
        }
        void askNickname(this).then((changed) => {
          if (changed) void refresh();
        });
      },
    );
  }

  /** 알림 줄의 바탕이 되는 둥근 띠 */
  private addBand(left: number, right: number, y: number, color: number): Phaser.GameObjects.Graphics {
    const band = this.add.graphics();
    band.fillStyle(color, 1);
    band.fillRoundedRect(left - 6, y, right - left + 12, EXTRA_ROW - 4, 8);
    return band;
  }

  /** 이번 판으로 새로 달성한 업적을 알린다. 보상은 업적 화면에서 받는다. */
  private addAchievementRow(
    achieved: readonly Achievement[],
    left: number,
    right: number,
    y: number,
    delay: number,
  ): void {
    const band = this.addBand(left, right, y, THEME.lilacSoft);
    const label = addText(this, left + 2, y + 3, '업적 달성!');
    const detail = addText(
      this,
      right - 2,
      y + 3,
      achieved.length === 1 ? achieved[0].title : `${achieved.length}개`,
      { originX: 1 },
    );

    const parts = [band, label, detail];
    parts.forEach((part) => part.setAlpha(0));
    this.time.delayedCall(delay, () => {
      this.tweens.add({ targets: parts, alpha: 1, duration: 160 });
      sfx.fanfare();
      vibrate([15, 30, 15]);
    });
  }

  /** 이번 판이 오늘의 도전이었을 때, 달성했는지 또는 몇 점이 모자랐는지 알린다. */
  private addDailyRow(
    daily: DailyOutcome,
    left: number,
    right: number,
    y: number,
    delay: number,
  ): void {
    const band = this.addBand(left, right, y, daily.cleared ? THEME.butterSoft : THEME.dim);

    if (!daily.cleared) {
      addText(this, GAME_WIDTH / 2, y + 3, `오늘의 도전까지 ${daily.shortBy}점`, {
        color: THEME_CSS.sub,
        originX: 0.5,
      });
      return;
    }

    const label = addText(this, left + 2, y + 3, '오늘의 도전 달성!');
    const amount = addText(this, right - 2, y + 3, `+${daily.reward}`, { originX: 1 });
    const coin = this.add
      .image(Math.round(right - 2 - amount.width - 3), y + 10, 'coin')
      .setOrigin(1, 0.5);

    // 점수와 코인 소리가 끝난 뒤에 따로 축하한다.
    const parts = [band, label, amount, coin];
    parts.forEach((part) => part.setAlpha(0));
    this.time.delayedCall(delay, () => {
      this.tweens.add({ targets: parts, alpha: 1, duration: 160 });
      sfx.gold();
      vibrate([15, 30, 15]);
    });
  }
}
