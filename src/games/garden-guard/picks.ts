/**
 * 날을 지킨 뒤 강화 셋 가운데 하나를 고르는 창과, 일시정지 화면에 덧붙이는 "이 판에서 고른 강화".
 * 무엇을 내놓고 고르면 무엇이 바뀌는지는 boons.ts가 정하고, 여기는 그리기만 한다.
 */
import type Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import type { PauseExtra } from '../../scenes/MiniGameScene';
import { upgradeTexture } from './art';
import { boonCount } from './boons';
import { BOON_ORDER, BOON_PICKS, BOONS, type BoonId } from './data';

/** 화면에 적는 글. 글꼴에 들어 있는 글자만 쓰는지 테스트가 확인한다. */
export const PICK_TEXT = {
  title: '강화를 하나 골라요',
  /** picked는 이 판에서 이미 고른 수 */
  turn: (picked: number) => `이 판에서만 써요 · ${picked + 1}/${BOON_PICKS}`,
  /** 이미 고른 강화의 카드에 적는다. */
  owned: (count: number) => `${count}번 골랐어요`,
  pauseTitle: (picked: number) => `이 판에서 고른 강화 ${picked}/${BOON_PICKS}`,
} as const;

/** 고르는 카드 한 장 */
const CARD = { margin: 10, height: 46, gap: 6 } as const;
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

export interface PickPanel {
  destroy(): void;
}

type Faded = Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown };

/** 방금 지킨 날의 알림. 고르는 창의 맨 위에 함께 적는다. */
export interface ClearedNote {
  /** "3일째 지킴!" */
  title: string;
  /** "씨앗 +12 · 새 기록!" */
  detail: string;
}

/**
 * 판 위(top과 bottom 사이)에 강화를 고르는 창을 띄운다. 카드를 누르면 onPick에 그 자리(0부터)를 넘긴다.
 * 한 번 고르면 더 눌리지 않는다. 창은 부른 쪽이 destroy로 닫는다.
 * cleared가 있으면 방금 지킨 날의 알림을 맨 위에 적는다(이어 한 판에서 다시 띄울 때는 없다).
 */
export function openPickPanel(
  scene: Phaser.Scene,
  area: { top: number; bottom: number },
  depth: number,
  offer: readonly BoonId[],
  boons: readonly BoonId[],
  cleared: ClearedNote | null,
  onPick: (index: number) => void,
): PickPanel {
  const objects: Phaser.GameObjects.GameObject[] = [];
  /** 창이 뜰 때 함께 나타나는 것들(누르는 자리를 뺀 모두) */
  const shown: Faded[] = [];
  const keep = <T extends Faded>(object: T): T => {
    objects.push(object);
    shown.push(object);
    return object;
  };
  const openedAt = scene.time.now;
  let done = false;

  // 판을 옅게 가려서 카드가 벌레와 물방울 위에서 또렷이 보이게 한다.
  keep(
    scene.add
      .rectangle(0, area.top, GAME_WIDTH, area.bottom - area.top, THEME.bg, 0.72)
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
    { text: PICK_TEXT.title, size: cleared ? 14 : 16, color: THEME_CSS.inkDeep, height: cleared ? 19 : 22 },
    { text: PICK_TEXT.turn(boons.length), size: FONT_SIZE.small, color: THEME_CSS.sub, height: 15 },
  ];
  const headHeight = head.reduce((sum, line) => sum + line.height, 0) + HEAD_GAP;
  const height = headHeight + offer.length * CARD.height + (offer.length - 1) * CARD.gap;
  const top = Math.round((area.top + area.bottom - height) / 2);
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
  offer.forEach((id, index) => {
    const boon = BOONS[id];
    const y = top + headHeight + index * (CARD.height + CARD.gap);
    const panel = keep(scene.add.graphics().setDepth(depth));
    const draw = (pressed: boolean): void => {
      panel.clear();
      drawPanel(panel, CARD.margin, y, width, CARD.height - 3, {
        depth: 3,
        radius: 12,
        border: pressed ? THEME.pinkDeep : undefined,
      });
    };
    draw(false);
    keep(scene.add.image(CARD.margin + 24, y + (CARD.height - 3) / 2, upgradeTexture(boon.icon)).setDepth(depth));
    const name = keep(addText(scene, CARD.margin + 46, y + 7, boon.name, { size: 14 }).setDepth(depth));
    const had = boonCount(boons, id);
    if (had > 0) {
      keep(
        addText(scene, name.x + name.width + 6, y + 10, PICK_TEXT.owned(had), {
          size: FONT_SIZE.small,
          color: THEME_CSS.accent,
        }).setDepth(depth),
      );
    }
    keep(
      addText(scene, CARD.margin + 46, y + 26, boon.blurb, { size: FONT_SIZE.small, color: THEME_CSS.sub }).setDepth(depth),
    );
    objects.push(
      addTapZone(scene, CARD.margin, y, width, CARD.height, draw, () => {
        if (done || scene.time.now - openedAt < ARM_MS) return;
        done = true;
        sfx.click();
        onPick(index);
      }),
    );
  });

  for (const object of shown) object.setAlpha(0);
  const fade = scene.tweens.add({ targets: shown, alpha: 1, duration: 160 });

  return {
    destroy: () => {
      fade.remove();
      for (const object of objects) object.destroy();
    },
  };
}

const PAUSE = { head: 14, row: 17, icon: 13 } as const;

/** 일시정지 화면에 덧붙이는 "이 판에서 고른 강화". 고른 것이 없으면 덧붙일 것도 없다. */
export function pickedInfo(boons: readonly BoonId[]): PauseExtra | undefined {
  const rows = BOON_ORDER.filter((id) => boons.includes(id)).map((id) => ({ id, count: boonCount(boons, id) }));
  if (rows.length === 0) return undefined;
  const lines = Math.ceil(rows.length / 2);
  return {
    width: GAME_WIDTH - 16,
    height: PAUSE.head + lines * PAUSE.row,
    draw: (scene, left, top, width) => {
      addText(scene, left, top, PICK_TEXT.pauseTitle(boons.length), { size: FONT_SIZE.small, color: THEME_CSS.sub });
      rows.forEach((row, index) => {
        const x = left + (index % 2) * Math.floor(width / 2);
        const y = top + PAUSE.head + Math.floor(index / 2) * PAUSE.row;
        scene.add
          .image(x + PAUSE.icon / 2, y + PAUSE.row / 2, upgradeTexture(BOONS[row.id].icon))
          .setDisplaySize(PAUSE.icon, PAUSE.icon);
        const label = row.count > 1 ? `${BOONS[row.id].name} ×${row.count}` : BOONS[row.id].name;
        addText(scene, x + PAUSE.icon + 4, y + PAUSE.row / 2, label, { size: FONT_SIZE.small, originY: 0.5 });
      });
    },
  };
}
