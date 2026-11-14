import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { fitStack, stackHeight } from '../../core/paging';
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
/**
 * 머리글이 첫 카드 위로 차지하는 높이. 보통은 제목과 한 줄 설명이고,
 * 카드가 다 들어가지 않을 때는 한 줄 설명을 빼고 제목만 둔다.
 */
const HEADER_HEIGHT = { full: 54, compact: 36 } as const;
/** 카드 아래에 붙는 작은 버튼(다시 뽑기) */
const EXTRA = { width: 136, height: 26, gap: 8 } as const;
/** 카드가 많을 때 간격을 좁히기 전에 카드를 이 높이까지는 낮춰 본다(core/paging.ts의 fitStack). */
const ROOMY_HEIGHT = 50;
/**
 * 카드가 머리글 아래에 다 들어가지 않을 때(잔치의 밤의 강화권은 여섯 장까지 된다) 차례로 줄여 보는 것.
 * 앞의 것으로 들어가면 거기서 멈춘다. 카드는 가장 긴 글이 테두리 안에 드는 데까지만 낮추고, 그래도 모자라면
 * 머리글의 한 줄 설명을 빼고, 카드 설명을 작은 글씨(잔치의 밤을 고르는 창의 설명과 같은 크기)로 쓰고,
 * 마지막에는 여백을 좁힌다. 글의 높이는 기기마다 1~2px씩 다르게 재지므로 마지막 단계에 그만큼의 틈을 둔다.
 * - gap: 카드를 ROOMY_HEIGHT 밑으로 낮춰야 할 때의 카드 사이 간격
 * - bottom: 마지막 카드(또는 다시 뽑기) 아래에 남기는 여백
 * - pad: 카드 안에서 글 덩어리 위아래로 남기는 여백. 카드 테두리가 2px이고 글 상자에도 1px 여유가 있어서
 *   1이어도 글자가 테두리에 닿지 않는다.
 */
const FITTINGS = [
  { header: HEADER_HEIGHT.full, small: false, gap: 4, bottom: 10, pad: 2 },
  { header: HEADER_HEIGHT.compact, small: false, gap: 4, bottom: 10, pad: 2 },
  { header: HEADER_HEIGHT.compact, small: true, gap: 4, bottom: 10, pad: 2 },
  { header: HEADER_HEIGHT.compact, small: true, gap: 2, bottom: 4, pad: 1 },
] as const;
type Fitting = (typeof FITTINGS)[number];
/** 움직이던 손가락으로 엉뚱한 것을 고르지 않도록 잠깐 뒤부터 누를 수 있다. */
const ARM_DELAY_MS = 380;

const TITLE_COLOR: Record<Upgrade['type'], string> = {
  weapon: CSS.yellow,
  passive: CSS.cyan,
  boon: CSS.sky,
  heal: CSS.lime,
  embers: CSS.orange,
};

/** 무기가 최종 진화형이 되는 선택지인지 */
const evolves = (upgrade: Upgrade): boolean => upgrade.type === 'weapon' && isEvolved(upgrade.level);

function badge(upgrade: Upgrade): string {
  if (upgrade.type === 'heal' || upgrade.type === 'embers') return '';
  // 밤의 축복은 몇 번이든 겹친다. 이미 받은 것이면 몇 번째인지 적는다.
  if (upgrade.type === 'boon') return upgrade.level > 1 ? `${upgrade.level}번째` : '';
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

/** 끝없는 밤에서 밤의 축복을 고를 때의 머리글 */
export const BOON_HEADER: ChoiceHeader = {
  title: '밤의 축복',
  subtitle: '몇 번이든 겹쳐요 · 하나를 골라요',
  color: CSS.sky,
  shadow: CSS.blue,
};

/**
 * 강화 선택 화면을 게임 위에 띄운다. 하나를 고르면 스스로 사라지고 onPick이 불린다.
 * 레벨업과 무기 강화권이 함께 쓴다. 지금 든 무기는 위쪽 HUD에 그대로 보인다.
 */
export function showChoices(
  scene: Phaser.Scene,
  header: ChoiceHeader,
  options: readonly Upgrade[],
  depth: number,
  onPick: (upgrade: Upgrade) => void,
  /** 화면 위쪽에서 이 높이까지는 HUD가 쓰므로 머리글을 그 아래에 둔다. */
  clearTop = 0,
  /** 카드 아래에 두는 작은 버튼. 누르면 이 화면이 사라지고 onTap이 불린다(다시 뽑기에 쓴다). */
  extra?: { label: string; onTap: () => void },
): void {
  const { width, height } = scene.scale;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject & { setDepth(value: number): unknown }>(item: T): T => {
    item.setDepth(depth);
    parts.push(item);
    return item;
  };

  const left = Math.round((GAME_WIDTH - CARD_WIDTH) / 2);
  keep(scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.66).setOrigin(0, 0));

  // 카드의 글을 먼저 만들어 높이를 잰 뒤에 카드의 크기와 자리를 정한다.
  const cards = options.map((upgrade) => {
    // 진화하는 선택지는 테두리를 밝게 해서 눈에 띄게 한다.
    const special = evolves(upgrade);
    return {
      upgrade,
      special,
      frame: keep(scene.add.graphics()),
      icon: keep(scene.add.image(0, 0, iconKey(upgradeIcon(upgrade))).setScale(ICON_SCALE)),
      title: keep(
        addText(scene, left + TEXT_LEFT, 0, upgradeTitle(upgrade), {
          bold: true,
          color: special ? CSS.white : TITLE_COLOR[upgrade.type],
        }),
      ),
      mark: keep(
        addText(scene, left + CARD_WIDTH - 10, 0, badge(upgrade), {
          color: special ? CSS.yellow : CSS.white,
          bold: special,
          originX: 1,
        }),
      ),
      description: keep(
        addText(scene, left + TEXT_LEFT, 0, upgradeDescription(upgrade), {
          color: CSS.silver,
          wrapWidth: CARD_WIDTH - TEXT_LEFT - 8,
          lineSpacing: 1,
        }),
      ),
    };
  });
  /** 이름과 설명을 합친 글 덩어리의 높이 */
  const textHeight = (card: (typeof cards)[number]): number =>
    card.title.height + TEXT_GAP + card.description.height;

  const below = extra ? EXTRA.gap + EXTRA.height : 0;
  // 머리글이 HUD 아래에 오고 마지막 카드 아래에 여백이 남도록, 카드가 많으면 FITTINGS의 차례대로 줄여 본다.
  const plan = (fitting: Fitting) => {
    const room = height - clearTop - fitting.header - fitting.bottom - below;
    const tallest = Math.max(...cards.map(textHeight));
    const least = Math.max(TILE + 4, Math.ceil(tallest + fitting.pad * 2));
    const squeeze = { roomy: ROOMY_HEIGHT, gap: fitting.gap, least };
    const size = fitStack(cards.length, room, { height: CARD_HEIGHT, gap: CARD_GAP }, squeeze);
    return { fitting, size, fits: stackHeight(cards.length, size) <= room };
  };
  let layout = plan(FITTINGS[0]);
  for (const fitting of FITTINGS.slice(1)) {
    if (layout.fits) break;
    if (fitting.small) for (const card of cards) card.description.setFontSize(FONT_SIZE.small);
    layout = plan(fitting);
  }
  const { fitting, size } = layout;
  const stack = stackHeight(cards.length, size);
  const total = stack + below;
  // 가운데에 두되, 카드가 많아 길어져도 머리글이 위쪽 HUD를 덮지 않게 내린다.
  // 그래도 다 들어가지 않을 만큼 화면이 짧으면 마지막 카드가 잘리지 않는 데까지만 내린다.
  const centered = Math.round((height - total) / 2) + Math.round(fitting.header / 4);
  const top = Math.max(centered, Math.min(clearTop + fitting.header, height - total - fitting.bottom));

  keep(
    addText(scene, GAME_WIDTH / 2, top - fitting.header + 2, header.title, {
      size: FONT_SIZE.large,
      bold: true,
      color: header.color,
      originX: 0.5,
      shadow: header.shadow,
    }),
  );
  if (fitting.header === HEADER_HEIGHT.full) {
    keep(addText(scene, GAME_WIDTH / 2, top - 22, header.subtitle, { color: CSS.silver, originX: 0.5 }));
  }

  let armed = false;
  let picked = false;
  scene.time.delayedCall(ARM_DELAY_MS, () => {
    armed = true;
  });

  if (extra) {
    const x = Math.round((GAME_WIDTH - EXTRA.width) / 2);
    const y = top + stack + EXTRA.gap;
    const frame = keep(scene.add.graphics());
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, EXTRA.width, EXTRA.height, {
        fill: pressed ? COLOR.navy : COLOR.ink,
        border: pressed ? COLOR.sky : COLOR.slate,
        shadow: null,
      });
    };
    draw(false);
    keep(
      addText(scene, GAME_WIDTH / 2, y + EXTRA.height / 2, extra.label, {
        color: CSS.cyan,
        originX: 0.5,
        originY: 0.5,
      }),
    );
    keep(
      addTapZone(scene, x, y, EXTRA.width, EXTRA.height, (pressed) => draw(pressed && armed), () => {
        if (!armed || picked) return;
        picked = true;
        sfx.click();
        vibrate(8);
        for (const part of parts) part.destroy();
        extra.onTap();
      }),
    );
  }

  cards.forEach((card, index) => {
    const y = top + index * (size.height + size.gap);
    const tileX = left + TILE_INSET;
    const tileY = y + Math.round((size.height - TILE) / 2);
    const draw = (pressed: boolean): void => {
      card.frame.clear();
      drawPanel(card.frame, left, y, CARD_WIDTH, size.height, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: pressed ? COLOR.sky : card.special ? COLOR.yellow : COLOR.slate,
        shadow: COLOR.ink,
      });
      drawPanel(card.frame, tileX, tileY, TILE, TILE, {
        fill: pressed ? COLOR.charcoal : COLOR.navy,
        border: card.special ? COLOR.yellow : undefined,
        shadow: null,
        radius: 8,
      });
    };
    draw(false);
    card.icon.setPosition(tileX + TILE / 2, tileY + TILE / 2);
    // 설명이 한 줄이든 두 줄이든 글 덩어리가 카드 가운데에 오게 한다.
    const textTop = Math.round(y + (size.height - textHeight(card)) / 2);
    card.title.setY(textTop);
    card.mark.setY(textTop);
    card.description.setY(textTop + card.title.height + TEXT_GAP);
    keep(
      addTapZone(scene, left, y, CARD_WIDTH, size.height, (pressed) => draw(pressed && armed), () => {
        if (!armed || picked) return;
        picked = true;
        sfx.click();
        vibrate(8);
        for (const part of parts) part.destroy();
        onPick(card.upgrade);
      }),
    );
  });
}
