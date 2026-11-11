import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { MAX_LEVEL } from './data';
import { ICON_SIZE, iconKey, upgradeIcon } from './icons';
import { isEvolved, upgradeDescription, upgradeTitle, type Upgrade } from './rules';

const CARD_WIDTH = 212;
const CARD_HEIGHT = 60;
const CARD_GAP = 8;
/** 아이콘은 픽셀이 뭉개지지 않게 정수 배로만 키운다. */
const ICON_SCALE = 2;
/** 카드 왼쪽에 놓는 아이콘 칸의 한 변. 테두리까지 그린 아이콘보다 사방으로 2px 넓다. */
const TILE = (ICON_SIZE + 2) * ICON_SCALE + 4;
const TILE_INSET = 9;
/** 글이 시작하는 자리 */
const TEXT_LEFT = TILE_INSET + TILE + 8;
/** 이름과 설명 사이 */
const TEXT_GAP = 2;
/** 첫 카드가 이보다 아래에 있으면 머리글이 HUD의 레벨, 처치 글자와 겹치지 않는다. */
const HEADER_CLEAR = 102;
/** 카드 아래에 두 줄짜리 설명이 들어갈 높이 */
const FOOTER_ROOM = 40;
/** 움직이던 손가락으로 엉뚱한 것을 고르지 않도록 잠깐 뒤부터 누를 수 있다. */
const ARM_DELAY_MS = 380;

const TITLE_COLOR: Record<Upgrade['type'], string> = {
  weapon: CSS.yellow,
  passive: CSS.cyan,
  heal: CSS.lime,
  embers: CSS.orange,
};

/** 무기가 최종 진화형이 되는 선택지인지 */
const evolves = (upgrade: Upgrade): boolean => upgrade.type === 'weapon' && isEvolved(upgrade.level);

function badge(upgrade: Upgrade): string {
  if (upgrade.type === 'heal' || upgrade.type === 'embers') return '';
  if (upgrade.level === 1) return '새로!';
  if (evolves(upgrade)) return '진화!';
  // 무기는 최대 레벨 다음에 진화가 남아 있다.
  return upgrade.type === 'passive' && upgrade.level >= MAX_LEVEL ? '최대' : `Lv ${upgrade.level}`;
}

export interface ChoiceHeader {
  title: string;
  subtitle: string;
  color: string;
  shadow: string;
}

/** 레벨이 올랐을 때의 머리글 */
export const levelUpHeader = (level: number): ChoiceHeader => ({
  title: '레벨 업!',
  subtitle: `Lv ${level} · 하나를 골라요`,
  color: CSS.yellow,
  shadow: CSS.orange,
});

/** 중간 보스를 잡고 무기 강화권을 받았을 때의 머리글 */
export const TICKET_HEADER: ChoiceHeader = {
  title: '무기 강화권',
  subtitle: '무기 하나를 올려요 · Lv 5는 진화',
  color: CSS.cyan,
  shadow: CSS.blue,
};

/**
 * 강화 선택 화면을 게임 위에 띄운다. 하나를 고르면 스스로 사라지고 onPick이 불린다.
 * 레벨업과 무기 강화권이 함께 쓴다.
 */
export function showChoices(
  scene: Phaser.Scene,
  header: ChoiceHeader,
  options: readonly Upgrade[],
  depth: number,
  onPick: (upgrade: Upgrade) => void,
  /** 카드 아래에 적는 한 줄. 지금 든 무기를 보여 주는 데 쓴다. */
  footer = '',
): void {
  const { width, height } = scene.scale;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject & { setDepth(value: number): unknown }>(item: T): T => {
    item.setDepth(depth);
    parts.push(item);
    return item;
  };

  const total = options.length * CARD_HEIGHT + (options.length - 1) * CARD_GAP;
  // 가운데에 두되, 카드가 넷이라 길어져도 머리글이 위쪽 HUD 글자를 덮지 않게 내린다.
  // 화면이 아주 짧을 때는 아래 한 줄이 잘리지 않는 데까지만 내린다.
  const centered = Math.round((height - total) / 2) + 14;
  const top = Math.max(centered, Math.min(HEADER_CLEAR, height - total - FOOTER_ROOM));
  const left = Math.round((GAME_WIDTH - CARD_WIDTH) / 2);

  keep(scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.66).setOrigin(0, 0));
  keep(
    addText(scene, GAME_WIDTH / 2, top - 52, header.title, {
      size: FONT_SIZE.large,
      bold: true,
      color: header.color,
      originX: 0.5,
      shadow: header.shadow,
    }),
  );
  keep(addText(scene, GAME_WIDTH / 2, top - 22, header.subtitle, { color: CSS.silver, originX: 0.5 }));

  if (footer !== '') {
    keep(
      addText(scene, GAME_WIDTH / 2, top + total + 8, footer, {
        color: CSS.silver,
        originX: 0.5,
        align: 'center',
        wrapWidth: CARD_WIDTH + 12,
      }),
    );
  }

  let armed = false;
  let picked = false;
  scene.time.delayedCall(ARM_DELAY_MS, () => {
    armed = true;
  });

  options.forEach((upgrade, index) => {
    const y = top + index * (CARD_HEIGHT + CARD_GAP);
    const frame = keep(scene.add.graphics());
    // 진화하는 선택지는 테두리를 밝게 해서 눈에 띄게 한다.
    const special = evolves(upgrade);
    const tileX = left + TILE_INSET;
    const tileY = y + (CARD_HEIGHT - TILE) / 2;
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, left, y, CARD_WIDTH, CARD_HEIGHT, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: pressed ? COLOR.sky : special ? COLOR.yellow : COLOR.slate,
        shadow: COLOR.ink,
      });
      drawPanel(frame, tileX, tileY, TILE, TILE, {
        fill: pressed ? COLOR.charcoal : COLOR.navy,
        border: special ? COLOR.yellow : undefined,
        shadow: null,
        radius: 8,
      });
    };
    draw(false);
    keep(
      scene.add
        .image(tileX + TILE / 2, tileY + TILE / 2, iconKey(upgradeIcon(upgrade)))
        .setScale(ICON_SCALE),
    );
    const title = keep(
      addText(scene, left + TEXT_LEFT, y, upgradeTitle(upgrade), {
        bold: true,
        color: special ? CSS.white : TITLE_COLOR[upgrade.type],
      }),
    );
    const mark = keep(
      addText(scene, left + CARD_WIDTH - 10, y, badge(upgrade), {
        color: special ? CSS.yellow : CSS.white,
        bold: special,
        originX: 1,
      }),
    );
    const description = keep(
      addText(scene, left + TEXT_LEFT, y, upgradeDescription(upgrade), {
        color: CSS.silver,
        wrapWidth: CARD_WIDTH - TEXT_LEFT - 8,
        lineSpacing: 1,
      }),
    );
    // 설명이 한 줄이든 두 줄이든 글 덩어리가 카드 가운데에 오게 한다.
    const textTop = Math.round(y + (CARD_HEIGHT - title.height - TEXT_GAP - description.height) / 2);
    title.setY(textTop);
    mark.setY(textTop);
    description.setY(textTop + title.height + TEXT_GAP);
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
