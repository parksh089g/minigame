/**
 * 준비 화면의 강화 목록(lobby.ts)과 유물 화면의 목록(relic-page.ts)이 함께 쓰는 치수와 조각들:
 * 줄의 크기, 오른쪽의 값 단추, 위쪽의 가진 것 칸. 두 목록이 같은 모양으로 보이게 한곳에 둔다.
 */
import type Phaser from 'phaser';
import { GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addText, drawPanel } from '../../core/ui';

export const MARGIN = 8;
export const WIDTH = GAME_WIDTH - MARGIN * 2;
/** 목록 한 줄의 높이와 줄 사이 */
export const ROW = { height: 36, gap: 4 } as const;
/** 줄의 오른쪽에 놓이는 값 단추 */
export const BUY = { width: 60, height: 26 } as const;
/** 목록의 위쪽 끝 */
export const LIST_TOP = 76;
/** 목록 아래의 설명 칸. 글씨 10의 두 줄(높이 27)이 위아래로 조금 남게 들어간다. */
export const INFO_HEIGHT = 30;
/** 맨 아래 줄의 단추 */
export const FOOT = { height: 36, bottom: 8 } as const;
/** 다 올린 줄의 값 단추 자리에 적는 말 */
export const MAXED_LABEL = '다 올림';

/** 가진 것(씨앗, 유물 조각)을 보여 주는 알약 모양 칸. 오른쪽 끝이 right에 맞춰진다. */
export class PillCounter {
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly amount: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly right: number,
    private readonly y: number,
    texture: string,
    amount: number,
  ) {
    this.panel = scene.add.graphics();
    this.icon = scene.add.image(0, y + 11, texture).setOrigin(0, 0.5);
    this.amount = addText(scene, 0, y + 11, '', { originY: 0.5 });
    this.set(amount);
  }

  set(amount: number): void {
    this.amount.setText(String(amount));
    const width = Math.ceil(this.amount.width) + 30;
    const left = this.right - width;
    this.panel.clear();
    drawPanel(this.panel, left, this.y, width, 22, { depth: 2 });
    this.icon.setX(left + 5);
    this.amount.setX(left + 21);
  }
}

/** 값 단추를 이루는 것들: 단추의 바탕, 재화 그림, 값 */
export interface BuyButtonView {
  button: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  cost: Phaser.GameObjects.Text;
}

/**
 * 위쪽 끝이 rowTop인 줄의 오른쪽에 값 단추를 그린다. cost가 null이면 다 올린 줄이라 단추 없이 "다 올림"만 적는다.
 * affordable이 아니면 흐리게 그리고, 눌려도 들어가지 않는다.
 */
export function drawBuyButton(
  view: BuyButtonView,
  rowTop: number,
  cost: string | null,
  affordable: boolean,
  pressed: boolean,
): void {
  const x = MARGIN + WIDTH - BUY.width - 6;
  const y = rowTop + (ROW.height - BUY.height) / 2;
  const offset = pressed && affordable ? 2 : 0;
  view.button.clear();
  if (cost === null) {
    view.icon.setVisible(false);
    view.cost.setText(MAXED_LABEL).setColor(THEME_CSS.good).setPosition(x + BUY.width / 2, y + BUY.height / 2);
    view.cost.setOrigin(0.5, 0.5);
    return;
  }
  view.button.fillStyle(affordable ? THEME.pinkDeep : THEME.shadow, 1);
  view.button.fillRoundedRect(x, y + 3, BUY.width, BUY.height - 3, 10);
  view.button.fillStyle(affordable ? THEME.pink : THEME.dim, 1);
  view.button.fillRoundedRect(x, y + offset, BUY.width, BUY.height - 3, 10);
  const middle = y + offset + (BUY.height - 3) / 2;
  view.cost
    .setText(cost)
    .setColor(affordable ? THEME_CSS.inkDeep : THEME_CSS.faint)
    .setOrigin(0, 0.5);
  // 재화 그림과 값을 한 덩어리로 가운데에 놓는다.
  const span = 14 + 2 + view.cost.width;
  const left = x + (BUY.width - span) / 2;
  view.icon.setVisible(true).setPosition(left + 7, middle).setAlpha(affordable ? 1 : 0.55);
  view.cost.setPosition(Math.round(left + 16), Math.round(middle));
}
