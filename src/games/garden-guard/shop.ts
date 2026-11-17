/**
 * 동료 가게 창과, 일시정지 화면에 덧붙이는 "함께하는 동료".
 * 무엇을 내놓고 사면 무엇이 바뀌는지는 allies.ts가 정하고, 여기는 그리기만 한다.
 */
import type Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import type { PauseExtra } from '../../scenes/MiniGameScene';
import { allyLabel, canBuyCard, canReroll, type Ally } from './allies';
import { allyTexture, TEX } from './art';
import { ALLIES, SHOP } from './data';
import { cardStatus, SHOP_TEXT } from './shop-text';
import type { RunState } from './sim';

export { cardStatus, SHOP_TEXT } from './shop-text';

/** 카드 한 장 */
const CARD = { margin: 10, height: 46, gap: 5 } as const;
/** 아래의 단추 줄 */
const BUTTON = { height: 30, gap: 8, top: 7 } as const;
/** 카드 위의 글 한 줄 */
interface HeadLine {
  text: string;
  size: number;
  color: string;
  /** 이 줄이 차지하는 높이 */
  height: number;
}
/** 마지막 줄과 첫 카드 사이 */
const HEAD_GAP = 3;
/** 창이 뜨고 이 시간(ms)이 지나야 눌린다. 벌레를 겨누던 손가락이 카드를 잘못 누르지 않게 한다. */
const ARM_MS = 280;
/** 카드 그림의 크기 배율(동료의 그림은 30 × 38) */
const ICON_SCALE = 0.68;

/** 방금 지킨 날의 알림. 가게 창의 맨 위에 함께 적는다. */
export interface ClearedNote {
  /** "3일째 지킴!" */
  title: string;
  /** "씨앗 +12 · 열매 +4" */
  detail: string;
}

export interface ShopHandlers {
  buy(index: number): void;
  reroll(): void;
  ready(): void;
}

export interface ShopPanel {
  /** 사거나 다시 뽑은 뒤의 판으로 다시 그린다. */
  refresh(state: RunState): void;
  destroy(): void;
}

type Faded = Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown };

/**
 * 판 위(top과 bottom 사이)에 동료 가게를 띄운다. 카드를 누르면 buy에 그 자리(0부터)를 넘기고,
 * 아래의 단추로 다시 뽑거나 가게를 닫는다. 판이 바뀌면(사거나 다시 뽑으면) 부른 쪽이 refresh로 다시 그린다.
 * cleared가 있으면 방금 지킨 날의 알림을 맨 위에 적는다(판의 첫날 앞과 이어 한 판에서는 없다).
 */
export function openShopPanel(
  scene: Phaser.Scene,
  area: { top: number; bottom: number },
  depth: number,
  state: RunState,
  cleared: ClearedNote | null,
  handlers: ShopHandlers,
): ShopPanel {
  const openedAt = scene.time.now;
  let objects: Phaser.GameObjects.GameObject[] = [];
  let closed = false;
  const armed = (): boolean => !closed && scene.time.now - openedAt >= ARM_MS;

  const build = (run: RunState, fade: boolean): void => {
    for (const object of objects) object.destroy();
    objects = [];
    /** 창이 뜰 때 함께 나타나는 것들(누르는 자리를 뺀 모두) */
    const shown: Faded[] = [];
    const keep = <T extends Faded>(object: T): T => {
      objects.push(object);
      shown.push(object);
      return object;
    };

    // 판을 옅게 가려서 카드가 벌레와 물방울 위에서 또렷이 보이게 한다.
    keep(
      scene.add
        .rectangle(0, area.top, GAME_WIDTH, area.bottom - area.top, THEME.bg, 0.78)
        .setOrigin(0, 0)
        .setDepth(depth),
    );

    const head: HeadLine[] = [
      ...(cleared
        ? [
            { text: cleared.title, size: 18, color: THEME_CSS.good, height: 24 },
            { text: cleared.detail, size: FONT_SIZE.normal, color: THEME_CSS.accent, height: 20 },
          ]
        : []),
      { text: SHOP_TEXT.title, size: cleared ? 14 : 16, color: THEME_CSS.inkDeep, height: cleared ? 19 : 22 },
      { text: SHOP_TEXT.purse(run.fruit), size: FONT_SIZE.small, color: THEME_CSS.sub, height: 15 },
    ];
    const cards = run.shop.length;
    const headHeight = head.reduce((sum, line) => sum + line.height, 0) + HEAD_GAP;
    const cardsHeight = cards * CARD.height + Math.max(0, cards - 1) * CARD.gap;
    const height = headHeight + cardsHeight + BUTTON.top + BUTTON.height;
    const top = Math.max(area.top + 4, Math.round((area.top + area.bottom - height) / 2));
    let lineTop = top;
    for (const line of head) {
      keep(
        addText(scene, GAME_WIDTH / 2, lineTop, line.text, {
          size: line.size,
          color: line.color,
          originX: 0.5,
          stroke: THEME_CSS.white,
        }).setDepth(depth),
      );
      lineTop += line.height;
    }

    const width = GAME_WIDTH - CARD.margin * 2;
    run.shop.forEach((card, index) => {
      const ally = ALLIES[card.id];
      const y = top + headHeight + index * (CARD.height + CARD.gap);
      const face = CARD.height - 3;
      const affordable = canBuyCard(run, index);
      const panel = keep(scene.add.graphics().setDepth(depth));
      const draw = (pressed: boolean): void => {
        panel.clear();
        drawPanel(panel, CARD.margin, y, width, face, {
          depth: 3,
          radius: 12,
          fill: card.sold ? THEME.bg : undefined,
          border: pressed && affordable ? THEME.pinkDeep : undefined,
        });
      };
      draw(false);
      const fade = card.sold ? 0.5 : 1;
      keep(
        scene.add
          .image(CARD.margin + 22, y + face / 2 + 1, allyTexture(card.id))
          .setScale(ICON_SCALE)
          .setDepth(depth)
          .setAlpha(fade),
      );
      const name = keep(addText(scene, CARD.margin + 42, y + 6, ally.name, { size: 14 }).setDepth(depth).setAlpha(fade));
      if (!card.sold) {
        const status = cardStatus(run, card.id);
        keep(
          addText(scene, name.x + name.width + 6, y + 9, status.text, {
            size: FONT_SIZE.small,
            color: status.color,
          }).setDepth(depth),
        );
      }
      keep(
        addText(scene, CARD.margin + 42, y + 25, ally.blurb, { size: FONT_SIZE.small, color: THEME_CSS.sub })
          .setDepth(depth)
          .setAlpha(fade),
      );
      // 오른쪽 끝의 값: 열매 그림과 수. 산 카드에는 값 대신 "데려왔어요"
      const right = CARD.margin + width - 10;
      if (card.sold) {
        keep(
          addText(scene, right, y + face / 2, SHOP_TEXT.sold, {
            size: FONT_SIZE.small,
            color: THEME_CSS.good,
            originX: 1,
            originY: 0.5,
          }).setDepth(depth),
        );
      } else {
        const price = keep(
          addText(scene, right, y + face / 2, String(ally.price), {
            size: 16,
            color: affordable ? THEME_CSS.accent : THEME_CSS.faint,
            originX: 1,
            originY: 0.5,
          }).setDepth(depth),
        );
        keep(
          scene.add
            .image(price.x - price.width - 9, y + face / 2, TEX.fruit)
            .setDepth(depth)
            .setAlpha(affordable ? 1 : 0.45),
        );
      }
      objects.push(
        addTapZone(scene, CARD.margin, y, width, CARD.height, draw, () => {
          if (!armed() || !canBuyCard(run, index)) return;
          handlers.buy(index);
        }),
      );
    });

    // 아래의 단추 줄: 왼쪽은 다시 뽑기, 오른쪽은 가게를 닫고 날을 시작한다.
    const buttonTop = top + headHeight + cardsHeight + BUTTON.top;
    const half = (width - BUTTON.gap) / 2;
    const button = (
      x: number,
      label: string,
      fill: number,
      lip: number,
      enabled: boolean,
      onTap: () => void,
      cost?: number,
    ): void => {
      const g = keep(scene.add.graphics().setDepth(depth));
      const draw = (pressed: boolean): void => {
        g.clear();
        const offset = pressed && enabled ? 2 : 0;
        g.fillStyle(lip, 1);
        g.fillRoundedRect(x, buttonTop + 3, half, BUTTON.height - 3, 12);
        g.fillStyle(fill, 1);
        g.fillRoundedRect(x, buttonTop + offset, half, BUTTON.height - 3, 12);
      };
      draw(false);
      g.setAlpha(enabled ? 1 : 0.45);
      const middle = buttonTop + (BUTTON.height - 3) / 2;
      const text = keep(
        addText(scene, x + half / 2 - (cost !== undefined ? 9 : 0), middle, label, {
          size: 13,
          color: THEME_CSS.inkDeep,
          originX: 0.5,
          originY: 0.5,
        })
          .setDepth(depth)
          .setAlpha(enabled ? 1 : 0.45),
      );
      if (cost !== undefined) {
        const iconX = text.x + text.width / 2 + 10;
        keep(scene.add.image(iconX, middle, TEX.fruit).setDepth(depth).setAlpha(enabled ? 1 : 0.45));
        keep(
          addText(scene, iconX + 8, middle, String(cost), {
            size: 12,
            color: THEME_CSS.accent,
            originY: 0.5,
          })
            .setDepth(depth)
            .setAlpha(enabled ? 1 : 0.45),
        );
      }
      objects.push(
        addTapZone(scene, x, buttonTop, half, BUTTON.height, draw, () => {
          if (!armed() || !enabled) return;
          onTap();
        }),
      );
    };
    button(CARD.margin, SHOP_TEXT.reroll, THEME.card, THEME.shadow, canReroll(run), () => handlers.reroll(), SHOP.reroll);
    const opening = run.lastCleared < run.day;
    button(CARD.margin + half + BUTTON.gap, opening ? SHOP_TEXT.start(run.day) : SHOP_TEXT.next, THEME.pink, THEME.pinkDeep, true, () => {
      closed = true;
      handlers.ready();
    });

    if (fade) {
      for (const object of shown) object.setAlpha(0);
      scene.tweens.add({ targets: shown, alpha: 1, duration: 160 });
    }
  };

  build(state, true);

  return {
    refresh: (run) => {
      if (!closed) build(run, false);
    },
    destroy: () => {
      closed = true;
      for (const object of objects) {
        scene.tweens.killTweensOf(object);
        object.destroy();
      }
      objects = [];
    },
  };
}

const PAUSE = { head: 14, row: 17, icon: 15 } as const;

/** 일시정지 화면에 덧붙이는 "함께하는 동료". 동료가 없으면 덧붙일 것도 없다. */
export function teamInfo(allies: readonly Ally[]): PauseExtra | undefined {
  if (allies.length === 0) return undefined;
  const lines = Math.ceil(allies.length / 2);
  return {
    width: GAME_WIDTH - 16,
    height: PAUSE.head + lines * PAUSE.row,
    draw: (scene, left, top, width) => {
      addText(scene, left, top, SHOP_TEXT.pauseTitle, { size: FONT_SIZE.small, color: THEME_CSS.sub });
      allies.forEach((ally, index) => {
        const x = left + (index % 2) * Math.floor(width / 2);
        const y = top + PAUSE.head + Math.floor(index / 2) * PAUSE.row;
        scene.add
          .image(x + PAUSE.icon / 2, y + PAUSE.row / 2, allyTexture(ally.id))
          .setDisplaySize(PAUSE.icon * (30 / 38), PAUSE.icon);
        addText(scene, x + PAUSE.icon + 4, y + PAUSE.row / 2, allyLabel(ally), { size: FONT_SIZE.small, originY: 0.5 });
      });
    },
  };
}
