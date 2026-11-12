import Phaser from 'phaser';
import { FONT_SIZE } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { BUTTON_LIP, drawBar, drawButton, LOOK, SYMBOL_SIZE, symbolTexture } from './art';
import { optionAt, screenRect, type Buttons, type HalfLayout, type Rect } from './layout';
import { SYMBOL_LOCK_MS, TUG_TIME_MS, type Contest, type Outcome, type Player } from './rules';
import { coinLine, reasonLine, roundLabel, scoreLine, TEXT } from './text';

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;
type ButtonColors = { face: number; lip: number };

/** 반쪽 판의 바탕: 평소, "지금!" 신호, 이겼을 때, 졌을 때 */
type Tone = 'idle' | 'signal' | 'won' | 'lost';
/** 그림 버튼의 모습 */
type SymbolState = 'normal' | 'right' | 'wrong';

/** 가운데 자리와 버튼에 놓는 그림의 크기 */
const TARGET_ICON = 36;
/** 연타 줄다리기의 골라인 너머에 놓는 것들: 남은 시간 막대와 큰 글자까지의 거리 */
const TUG_BAR = { offset: 21, width: 112, height: 7, hurryMs: 3000 } as const;
const TUG_TITLE_OFFSET = 50;
/** 틀려서 쉬는 막대: 그림 버튼 위로 띄우는 거리와 크기 */
const LOCK_BAR = { above: 10, width: 150, height: 6 } as const;
/** 쉬는 동안 그림 버튼이 흐려지는 정도 */
const LOCKED_ALPHA = 0.35;

interface Lines {
  kicker?: string;
  title: string;
  titleSize?: number;
  titleColor?: string;
  sub?: string;
  subColor?: string;
  hint?: string;
}

/** 반쪽에 놓이는 버튼 하나의 그림. 누르는 자리는 쓰는 쪽에서 따로 정한다. */
class ButtonView {
  private readonly graphics: Graphics;
  private readonly label: Text;

  constructor(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    readonly rect: Rect,
    label: string,
    private colors: ButtonColors,
  ) {
    this.graphics = scene.add.graphics();
    this.label = addText(scene, 0, 0, label, { color: LOOK.text.button, originX: 0.5, originY: 0.5 });
    parent.add([this.graphics, this.label]);
    this.draw(false);
  }

  set(label: string, colors: ButtonColors): void {
    this.label.setText(label);
    this.colors = colors;
    this.draw(false);
  }

  setVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
    this.label.setVisible(visible);
  }

  draw(pressed: boolean): void {
    const { x, y, width, height } = this.rect;
    this.graphics.clear();
    drawButton(this.graphics, x, y, width, height, this.colors, pressed);
    const offset = pressed ? BUTTON_LIP - 1 : 0;
    this.label.setPosition(Math.round(x + width / 2), Math.round(y + offset + (height - BUTTON_LIP) / 2));
  }
}

/**
 * 한 사람의 반쪽 화면. 두 사람의 것을 똑같이 만들고 위쪽 것만 반 바퀴 돌려서,
 * 마주 앉은 두 사람이 자기 자리에서 같은 화면을 본다. 안의 자리는 모두 그 사람이 보는 좌표다(layout.ts).
 */
export class HalfView {
  private readonly container: Phaser.GameObjects.Container;
  /** 지금 누를 수 있게 나와 있는 버튼 */
  private buttons: Buttons = 'none';

  private readonly panel: Graphics;
  private readonly flash: Graphics;
  private readonly kicker: Text;
  private readonly title: Text;
  private readonly sub: Text;
  private readonly hint: Text;
  private readonly ready: ButtonView;
  private readonly bar: Graphics;
  private readonly goalLine: Graphics;
  private readonly targetPlate: Graphics;
  private readonly targetIcon: Phaser.GameObjects.Image;
  private readonly targetMark: Text;
  private readonly symbolFaces: Graphics[] = [];
  private readonly symbolIcons: Phaser.GameObjects.Image[] = [];
  /** 버튼 안 그림의 배율. 톡 튀었다가 이 크기로 돌아온다. */
  private readonly symbolScale: number;
  private readonly endButtons: ButtonView[] = [];
  private readonly endZones: Phaser.GameObjects.Zone[] = [];
  private readonly coinRow: Phaser.GameObjects.Container;
  private readonly coinLabel: Text;

  /** 이 사람이 받은 그림들 가운데 찾아야 하는 것의 자리 */
  private rightIndex = -1;
  private locked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
    private readonly layout: HalfLayout,
    center: { x: number; y: number },
    screenHeight: number,
    onAgain: () => void,
    onLeave: () => void,
  ) {
    this.container = scene.add.container(center.x, center.y);
    if (player === 1) this.container.setRotation(Math.PI);

    this.panel = scene.add.graphics();
    this.flash = scene.add.graphics().setAlpha(0);
    this.goalLine = scene.add.graphics();
    this.bar = scene.add.graphics();
    this.container.add([this.panel, this.flash, this.goalLine, this.bar]);

    this.kicker = this.addLine(FONT_SIZE.small, LOOK.text.hint);
    this.title = this.addLine(FONT_SIZE.large, LOOK.text.title);
    this.sub = this.addLine(FONT_SIZE.normal, LOOK.text.sub);
    this.hint = this.addLine(FONT_SIZE.small, LOOK.text.hint);

    this.ready = new ButtonView(scene, this.container, layout.readyButton, TEXT.lobby.ready, LOOK.players[player]);

    // 찾아야 하는 그림이 놓이는 둥근 자리
    const { target } = layout;
    this.targetPlate = scene.add.graphics();
    this.targetPlate.fillStyle(LOOK.plate.lip, 1);
    this.targetPlate.fillCircle(target.x, target.y + 3, target.radius);
    this.targetPlate.fillStyle(LOOK.plate.face, 1);
    this.targetPlate.fillCircle(target.x, target.y, target.radius);
    this.targetIcon = scene.add.image(target.x, target.y, symbolTexture(0));
    this.targetMark = addText(scene, target.x, target.y, TEXT.symbol.unknown, {
      size: FONT_SIZE.large,
      color: LOOK.text.hint,
      originX: 0.5,
      originY: 0.5,
    });
    this.container.add([this.targetPlate, this.targetIcon, this.targetMark]);

    const iconSize = Math.min(SYMBOL_SIZE, layout.symbolButtons[0].width - 14);
    this.symbolScale = iconSize / SYMBOL_SIZE;
    for (const rect of layout.symbolButtons) {
      const face = scene.add.graphics();
      const icon = scene.add
        .image(rect.x + rect.width / 2, rect.y + (rect.height - BUTTON_LIP) / 2, symbolTexture(0))
        .setScale(this.symbolScale);
      this.symbolFaces.push(face);
      this.symbolIcons.push(icon);
      this.container.add([face, icon]);
    }

    // 경기가 끝났을 때의 버튼. 누르는 자리는 돌리지 않은 화면 좌표에 따로 둔다.
    const ends: [string, ButtonColors, () => void][] = [
      [TEXT.over.again, LOOK.players[player], onAgain],
      [TEXT.over.leave, LOOK.button.neutral, onLeave],
    ];
    ends.forEach(([label, colors, onTap], index) => {
      const view = new ButtonView(scene, this.container, layout.endButtons[index], label, colors);
      const area = screenRect(player, view.rect, screenHeight);
      const zone = addTapZone(
        scene,
        area.x,
        area.y,
        area.width,
        area.height,
        (pressed) => view.draw(pressed),
        onTap,
      );
      this.endButtons.push(view);
      this.endZones.push(zone);
    });

    // 받은 코인 한 줄. 씬이 휴대폰 주인이 앉는 아래쪽에만 내놓는다.
    const coinIcon = scene.add.image(0, 0, 'coin').setOrigin(0, 0.5);
    this.coinLabel = addText(scene, 16, 0, '', { color: LOOK.text.coin, originY: 0.5 });
    this.coinRow = scene.add.container(0, layout.endButtons[0].y - 15, [coinIcon, this.coinLabel]);
    this.container.add(this.coinRow);

    this.clear();
  }

  /** 그 사람이 보는 좌표 (x, y)를 눌렀을 때 눌린 버튼의 번호. 버튼이 아니면 undefined다. */
  optionAt(x: number, y: number): number | undefined {
    return optionAt(this.layout, this.buttons, x, y);
  }

  // ───────── 화면 바꾸기 ─────────

  /** 준비 화면. ready는 이 사람이 "준비"를 눌렀는지, starting은 두 사람이 모두 눌러 곧 시작하는지다. */
  showLobby(ready: boolean, starting: boolean): void {
    this.clear();
    this.setLines(0.22, {
      title: TEXT.lobby.title,
      sub: TEXT.lobby.rule,
      hint: starting ? TEXT.lobby.starting : ready ? TEXT.lobby.waiting : TEXT.lobby.press,
    });
    this.ready.set(
      ready ? TEXT.lobby.readyDone : TEXT.lobby.ready,
      ready ? LOOK.button.ready : LOOK.players[this.player],
    );
    this.ready.setVisible(true);
    this.buttons = ready ? 'none' : 'ready';
  }

  showIntro(roundNumber: number, contest: Contest): void {
    this.clear();
    const text = TEXT.contests[contest];
    this.setLines(0.4, { kicker: roundLabel(roundNumber), title: text.name, sub: text.how, hint: text.note });
    this.pop(this.title);
  }

  /** 번쩍 반응의 기다리는 화면. again이면 일시정지에서 돌아와 다시 기다리는 것이다. */
  showReactionWait(again: boolean): void {
    this.clear();
    this.setLines(0.42, {
      title: TEXT.reaction.wait,
      titleColor: LOOK.text.wait,
      sub: again ? TEXT.reaction.again : TEXT.reaction.how,
    });
  }

  /** 번쩍 반응의 신호. 판 전체가 밝은 색으로 번쩍인다. */
  showReactionGo(): void {
    this.clear();
    this.setTone('signal');
    this.setLines(0.42, { title: TEXT.reaction.go, titleSize: FONT_SIZE.huge });
    this.pop(this.title);
    this.blink();
  }

  showTugReady(again: boolean): void {
    this.clear();
    const { goal } = this.layout;
    this.goalLine.clear();
    this.goalLine.fillStyle(LOOK.tug.goal, 1);
    this.goalLine.fillRoundedRect(-46, goal - 2.5, 92, 5, 2.5);
    this.goalLine.setVisible(true);
    this.setTugLines(TEXT.tug.ready, LOOK.text.wait, again ? TEXT.tug.again : TEXT.tug.note);
    this.setTugTime(TUG_TIME_MS);
  }

  showTugLive(): void {
    this.setTugLines(TEXT.tug.live, LOOK.text.title, TEXT.tug.note);
    this.pop(this.title);
  }

  /** 한가운데에서 시간이 끝나, 먼저 누르는 쪽이 이기게 되었다. */
  showTugSudden(): void {
    this.setTugLines(TEXT.tug.sudden, LOOK.text.bad, TEXT.tug.suddenNote);
    this.pop(this.title);
  }

  /** 연타 줄다리기의 남은 시간 막대 */
  setTugTime(leftMs: number): void {
    this.bar.clear();
    drawBar(
      this.bar,
      0,
      this.layout.goal + TUG_BAR.offset,
      TUG_BAR.width,
      TUG_BAR.height,
      leftMs / TUG_TIME_MS,
      leftMs <= TUG_BAR.hurryMs ? LOOK.bar.hurry : LOOK.bar.time,
    );
  }

  /** 같은 그림 찾기의 "준비". 그림은 아직 물음표로 가려져 있다. */
  showSymbolReady(again: boolean): void {
    this.clear();
    this.showTarget(null);
    this.setLineAt(this.symbolTextY(), {
      title: TEXT.symbol.ready,
      titleColor: LOOK.text.wait,
      sub: again ? TEXT.symbol.again : undefined,
    });
  }

  /** 그림이 나타난다. options는 이 사람이 보는 왼쪽부터의 그림 번호다. */
  showSymbols(target: number, options: readonly number[]): void {
    this.clear();
    this.rightIndex = options.indexOf(target);
    this.showTarget(target);
    this.pop(this.targetIcon, TARGET_ICON / SYMBOL_SIZE);
    options.forEach((kind, index) => {
      const rect = this.layout.symbolButtons[index];
      this.scene.tweens.killTweensOf([this.symbolFaces[index], this.symbolIcons[index]]);
      this.symbolFaces[index].setX(0).setAlpha(1).setVisible(true);
      this.symbolIcons[index]
        .setTexture(symbolTexture(kind))
        .setX(rect.x + rect.width / 2)
        .setScale(this.symbolScale)
        .setAlpha(1)
        .setVisible(true);
      this.drawSymbol(index, 'normal');
    });
    this.setLineAt(this.symbolTextY(), { title: '', sub: TEXT.symbol.how });
    this.buttons = 'symbols';
  }

  /** 틀린 그림을 눌렀다. 그 버튼이 붉어지며 흔들린다. */
  markWrong(option: number): void {
    const face = this.symbolFaces[option];
    const icon = this.symbolIcons[option];
    if (!face || !icon) return;
    this.drawSymbol(option, 'wrong');
    this.scene.tweens.add({ targets: [face, icon], x: '+=4', duration: 45, yoyo: true, repeat: 2 });
  }

  /** 틀려서 쉬는 동안의 모습. leftMs가 0이면 다시 누를 수 있다. */
  setLock(leftMs: number): void {
    const locked = leftMs > 0;
    this.bar.clear();
    if (locked) {
      const y = this.layout.symbolButtons[0].y - LOCK_BAR.above;
      drawBar(this.bar, 0, y, LOCK_BAR.width, LOCK_BAR.height, leftMs / SYMBOL_LOCK_MS, LOOK.bar.lock);
    }
    if (locked === this.locked) return;
    this.locked = locked;
    const alpha = locked ? LOCKED_ALPHA : 1;
    this.symbolFaces.forEach((face) => face.setAlpha(alpha));
    this.symbolIcons.forEach((icon) => icon.setAlpha(alpha));
    this.sub
      .setText(locked ? TEXT.symbol.locked : TEXT.symbol.how)
      .setColor(locked ? LOOK.text.bad : LOOK.text.sub);
    if (!locked) this.symbolFaces.forEach((_, index) => this.drawSymbol(index, 'normal'));
  }

  /** 맞는 그림의 버튼을 밝혀 준다. 이긴 쪽에서 판이 끝난 순간에 부른다. */
  markRight(): void {
    if (this.rightIndex < 0) return;
    this.drawSymbol(this.rightIndex, 'right');
    this.pop(this.symbolIcons[this.rightIndex], this.symbolScale);
  }

  /** 판이 끝났을 때. 반칙으로 진 쪽에는 누구의 반칙인지 알 수 있게 "반칙!"이 뜬다. */
  showResult(won: boolean, outcome: Outcome): void {
    this.clear();
    this.setTone(won ? 'won' : 'lost');
    const fouled = outcome.reason === 'foul' && !won;
    this.setLines(0.4, {
      title: won ? TEXT.result.won : fouled ? TEXT.result.foul : TEXT.result.lost,
      titleSize: FONT_SIZE.huge,
      titleColor: won ? LOOK.text.good : fouled ? LOOK.text.bad : LOOK.text.wait,
      sub: reasonLine(outcome, won),
    });
    this.pop(this.title);
  }

  /** 경기가 끝났을 때. mine과 theirs는 이 사람과 상대가 이긴 판 수다. */
  showOver(won: boolean, outcome: Outcome, mine: number, theirs: number): void {
    this.clear();
    this.setTone(won ? 'won' : 'lost');
    this.setLines(0.2, {
      title: won ? TEXT.over.won : TEXT.over.lost,
      titleSize: won ? FONT_SIZE.huge : FONT_SIZE.large,
      titleColor: won ? LOOK.text.win : LOOK.text.wait,
      sub: scoreLine(mine, theirs, won),
      hint: reasonLine(outcome, won),
    });
    this.pop(this.title);
  }

  /** 경기가 끝나고 조금 뒤에 버튼을 내놓는다. coins가 null이 아니면 받은 코인도 적는다. */
  showEndButtons(coins: number | null): void {
    this.endButtons.forEach((button) => button.setVisible(true));
    this.endZones.forEach((zone) => zone.setInteractive());
    if (coins === null) return;
    this.coinLabel.setText(coinLine(coins));
    this.coinRow.setX(-Math.round((16 + this.coinLabel.width) / 2)).setVisible(true);
  }

  // ───────── 안에서 쓰는 것 ─────────

  private addLine(size: number, color: string): Text {
    const text = addText(this.scene, 0, 0, '', { size, color, originX: 0.5, originY: 0.5, align: 'center' });
    this.container.add(text);
    return text;
  }

  /** 모든 것을 감추고 바탕만 남긴다. 화면을 바꿀 때마다 여기서 시작한다. */
  private clear(): void {
    this.buttons = 'none';
    this.locked = false;
    this.setTone('idle');
    for (const text of [this.kicker, this.title, this.sub, this.hint]) {
      this.scene.tweens.killTweensOf(text);
      text.setVisible(false).setScale(1);
    }
    this.ready.setVisible(false);
    this.bar.clear();
    this.goalLine.setVisible(false);
    this.targetPlate.setVisible(false);
    this.targetIcon.setVisible(false);
    this.targetMark.setVisible(false);
    this.symbolFaces.forEach((face) => face.setVisible(false));
    this.symbolIcons.forEach((icon) => icon.setVisible(false));
    this.endButtons.forEach((button) => button.setVisible(false));
    this.endZones.forEach((zone) => zone.disableInteractive());
    this.coinRow.setVisible(false);
  }

  private setTone(tone: Tone): void {
    const { x, y, width, height } = this.layout.panel;
    const look = LOOK.players[this.player];
    const fills: Record<Tone, number> = {
      idle: look.soft,
      signal: LOOK.panel.signal,
      won: LOOK.panel.won,
      lost: LOOK.panel.lost,
    };
    this.panel.clear();
    drawPanel(this.panel, x, y, width, height, {
      fill: fills[tone],
      border: look.face,
      shadow: LOOK.panel.lip,
      radius: 16,
    });
  }

  /** 신호가 뜰 때 판 전체가 하얗게 번쩍인다. */
  private blink(): void {
    const { x, y, width, height } = this.layout.panel;
    this.flash.clear();
    this.flash.fillStyle(LOOK.blink, 1);
    this.flash.fillRoundedRect(x, y, width, height, 16);
    this.scene.tweens.killTweensOf(this.flash);
    this.flash.setAlpha(0.85);
    this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 260, ease: 'Quad.Out' });
  }

  /** 글자 묶음을 놓는다. where는 판의 높이에서 제목이 놓이는 비율(0~1)이다. */
  private setLines(where: number, lines: Lines): void {
    const { y, height } = this.layout.panel;
    this.setLineAt(Math.round(y + height * where), lines);
  }

  /** 제목의 가운데를 titleY에 두고, 그 위에 작은 머리글을, 아래에 설명 두 줄을 놓는다. */
  private setLineAt(titleY: number, lines: Lines): void {
    const size = lines.titleSize ?? FONT_SIZE.large;
    this.title
      .setFontSize(size)
      .setText(lines.title)
      .setColor(lines.titleColor ?? LOOK.text.title)
      .setPosition(0, titleY)
      .setVisible(lines.title !== '');
    // 제목이 없으면 그 자리에 한 줄 설명을 놓는다.
    const subY = lines.title === '' ? titleY : titleY + size / 2 + 13;
    this.kicker
      .setText(lines.kicker ?? '')
      .setPosition(0, titleY - size / 2 - 11)
      .setVisible(Boolean(lines.kicker));
    this.sub
      .setText(lines.sub ?? '')
      .setColor(lines.subColor ?? LOOK.text.sub)
      .setPosition(0, subY)
      .setVisible(Boolean(lines.sub));
    this.hint
      .setText(lines.hint ?? '')
      .setPosition(0, subY + 17)
      .setVisible(Boolean(lines.hint));
  }

  /** 톡 튀어나오듯 커진다. to는 다 커졌을 때의 배율이다. */
  private pop(target: Text | Phaser.GameObjects.Image, to = 1): void {
    this.scene.tweens.killTweensOf(target);
    target.setScale(to * 0.6);
    this.scene.tweens.add({ targets: target, scale: to, duration: 180, ease: 'Back.Out' });
  }

  private setTugLines(title: string, color: string, sub: string): void {
    this.setLineAt(this.layout.goal + TUG_TITLE_OFFSET, { title, titleColor: color, sub });
  }

  /** 같은 그림 찾기에서 가운데 자리와 버튼 사이에 글자가 놓이는 높이 */
  private symbolTextY(): number {
    const { target, symbolButtons } = this.layout;
    return Math.round((target.y + target.radius + symbolButtons[0].y) / 2) - 3;
  }

  /** 찾아야 하는 그림의 자리를 보여 준다. kind가 null이면 아직 나오지 않아 물음표만 보인다. */
  private showTarget(kind: number | null): void {
    this.targetPlate.setVisible(true);
    this.targetMark.setVisible(kind === null);
    this.targetIcon.setVisible(kind !== null);
    if (kind === null) return;
    this.scene.tweens.killTweensOf(this.targetIcon);
    this.targetIcon.setTexture(symbolTexture(kind)).setScale(TARGET_ICON / SYMBOL_SIZE);
  }

  private drawSymbol(index: number, state: SymbolState): void {
    const rect = this.layout.symbolButtons[index];
    const colors: Record<SymbolState, ButtonColors> = {
      normal: LOOK.button.symbol,
      right: LOOK.button.right,
      wrong: LOOK.button.wrong,
    };
    const face = this.symbolFaces[index];
    face.clear();
    drawButton(face, rect.x, rect.y, rect.width, rect.height, colors[state], false, 13);
  }
}
