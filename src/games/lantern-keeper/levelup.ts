import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { MAX_LEVEL } from './data';
import { upgradeDescription, upgradeTitle, type Upgrade } from './rules';

const CARD_WIDTH = 208;
const CARD_HEIGHT = 56;
const CARD_GAP = 8;
/** 움직이던 손가락으로 엉뚱한 것을 고르지 않도록 잠깐 뒤부터 누를 수 있다. */
const ARM_DELAY_MS = 380;

const TITLE_COLOR: Record<Upgrade['type'], string> = {
  weapon: CSS.yellow,
  passive: CSS.cyan,
  heal: CSS.lime,
  embers: CSS.orange,
};

function badge(upgrade: Upgrade): string {
  if (upgrade.type === 'heal' || upgrade.type === 'embers') return '';
  if (upgrade.level === 1) return '새로!';
  return upgrade.level >= MAX_LEVEL ? '최대' : `Lv ${upgrade.level}`;
}

/**
 * 레벨업 선택 화면을 게임 위에 띄운다. 하나를 고르면 스스로 사라지고 onPick이 불린다.
 */
export function showLevelUp(
  scene: Phaser.Scene,
  level: number,
  options: readonly Upgrade[],
  depth: number,
  onPick: (upgrade: Upgrade) => void,
): void {
  const { width, height } = scene.scale;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject & { setDepth(value: number): unknown }>(item: T): T => {
    item.setDepth(depth);
    parts.push(item);
    return item;
  };

  const total = options.length * CARD_HEIGHT + (options.length - 1) * CARD_GAP;
  const top = Math.round((height - total) / 2) + 14;
  const left = Math.round((GAME_WIDTH - CARD_WIDTH) / 2);

  keep(scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.66).setOrigin(0, 0));
  keep(
    addText(scene, GAME_WIDTH / 2, top - 52, '레벨 업!', {
      size: FONT_SIZE.large,
      bold: true,
      color: CSS.yellow,
      originX: 0.5,
      shadow: CSS.orange,
    }),
  );
  keep(addText(scene, GAME_WIDTH / 2, top - 22, `Lv ${level} · 하나를 골라요`, { color: CSS.silver, originX: 0.5 }));

  let armed = false;
  let picked = false;
  scene.time.delayedCall(ARM_DELAY_MS, () => {
    armed = true;
  });

  options.forEach((upgrade, index) => {
    const y = top + index * (CARD_HEIGHT + CARD_GAP);
    const frame = keep(scene.add.graphics());
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, left, y, CARD_WIDTH, CARD_HEIGHT, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: pressed ? COLOR.sky : COLOR.ink,
        highlight: pressed ? COLOR.navy : COLOR.slate,
      });
    };
    draw(false);
    keep(addText(scene, left + 10, y + 8, upgradeTitle(upgrade), { bold: true, color: TITLE_COLOR[upgrade.type] }));
    keep(addText(scene, left + CARD_WIDTH - 10, y + 8, badge(upgrade), { color: CSS.white, originX: 1 }));
    keep(
      addText(scene, left + 10, y + 26, upgradeDescription(upgrade), {
        color: CSS.silver,
        wrapWidth: CARD_WIDTH - 20,
      }),
    );
    keep(
      addTapZone(scene, left, y, CARD_WIDTH, CARD_HEIGHT, (pressed) => draw(pressed && armed), () => {
        if (!armed || picked) return;
        picked = true;
        sfx.click();
        vibrate(8);
        for (const part of parts) part.destroy();
        onPick(upgrade);
      }),
    );
  });
}
