/**
 * 동료 정보 창: 가게의 카드나 밭의 동료를 꾹 누르면 가게 창 자리에 뜬다.
 * 무엇을 적는지는 shop-text.ts의 allyInfo가 정하고, 여기는 그리기만 한다. 아무 데나 누르거나 "닫기"를 누르면 닫힌다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { allyTexture } from './art';
import { ALLIES } from './data';
import { INFO_TEXT, type AllyInfo } from './shop-text';

/** 창의 바깥 여백(가게 카드와 같다), 안쪽 여백, 모서리 */
const PANEL = { margin: 10, pad: 12, radius: 14 } as const;
/** 위쪽의 그림(동료의 그림은 30 × 38)과 이름 줄의 높이 */
const HEAD = { scale: 1.1, height: 46, nameLeft: 44 } as const;
/** 모양을 그리는 작은 네모 */
const PIP = { size: 7, gap: 2 } as const;
/** 줄 사이 */
const LINE_GAP = 4;
/** 아래의 닫기 단추 */
const CLOSE = { width: 96, height: 28, top: 10 } as const;

export interface InfoPanel {
  destroy(): void;
}

/**
 * 판 위(top과 bottom 사이)의 가운데에 동료 정보 창을 띄운다. 밭의 동료를 보는 것이면 ring에 그 동료가 선 칸(화면 좌표)을 주어 테두리를 두른다.
 * 창이 떠 있는 동안은 화면 전체(top 아래)를 덮는 누르는 자리가 있어서 아래의 카드나 동료는 눌리지 않는다.
 */
export function openAllyInfo(
  scene: Phaser.Scene,
  area: { top: number; bottom: number },
  depth: number,
  info: AllyInfo,
  ring: ReadonlyArray<{ x: number; y: number; size: number }>,
  onClose: () => void,
): InfoPanel {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
    objects.push(object);
    return object;
  };
  const left = PANEL.margin;
  const width = GAME_WIDTH - PANEL.margin * 2;
  const inner = width - PANEL.pad * 2;

  // 판을 옅게 가린다(가게 창과 같은 색). 그 위를 아무 데나 누르면 닫힌다.
  keep(scene.add.rectangle(0, area.top, GAME_WIDTH, area.bottom - area.top, THEME.bg, 0.78).setOrigin(0, 0).setDepth(depth));
  if (ring.length > 0) {
    const g = keep(scene.add.graphics().setDepth(depth));
    g.lineStyle(2, THEME.coralDeep, 1);
    for (const cell of ring) g.strokeRoundedRect(cell.x + 1, cell.y + 1, cell.size - 2, cell.size - 2, 5);
  }
  const panel = keep(scene.add.graphics().setDepth(depth));

  // 글을 먼저 만들어 높이를 잰 뒤 창을 가운데에 놓는다. 글의 y는 창의 위쪽 끝에서 잰 값이다.
  const placed: Array<{ object: Phaser.GameObjects.Components.Transform; y: number }> = [];
  const put = <
    T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Depth,
  >(
    object: T,
    y: number,
  ): T => {
    placed.push({ object, y });
    object.setDepth(depth);
    return keep(object);
  };
  put(scene.add.image(left + PANEL.pad + 17, 0, allyTexture(info.id)).setScale(HEAD.scale), PANEL.pad + HEAD.height / 2 - 2);
  const nameX = left + PANEL.pad + HEAD.nameLeft;
  put(addText(scene, nameX, 0, info.name, { size: 16, color: THEME_CSS.inkDeep }), PANEL.pad + 2);
  put(addText(scene, nameX, 0, info.star, { size: FONT_SIZE.normal, color: THEME_CSS.pinkDeep }), PANEL.pad + 24);
  // 오른쪽 위: 칸 수와, 그 동료가 차지하는 칸의 모양
  const shape = ALLIES[info.id].shape;
  const cols = Math.max(...shape.map(([x]) => x)) + 1;
  const rows = Math.max(...shape.map(([, y]) => y)) + 1;
  const shapeWidth = cols * PIP.size + (cols - 1) * PIP.gap;
  const shapeHeight = rows * PIP.size + (rows - 1) * PIP.gap;
  const shapeLeft = left + width - PANEL.pad - shapeWidth;
  const pips = put(scene.add.graphics(), PANEL.pad + HEAD.height / 2 - shapeHeight / 2 - 2);
  pips.fillStyle(THEME.mintDeep, 1);
  for (const [x, y] of shape) {
    pips.fillRoundedRect(shapeLeft + x * (PIP.size + PIP.gap), y * (PIP.size + PIP.gap), PIP.size, PIP.size, 1.5);
  }
  put(
    addText(scene, shapeLeft - 5, 0, info.cells, { size: FONT_SIZE.small, color: THEME_CSS.sub, originX: 1, originY: 0.5 }),
    PANEL.pad + HEAD.height / 2 - 2,
  );

  let y = PANEL.pad + HEAD.height + 2;
  const line = (text: string, color: string): void => {
    const object = put(addText(scene, left + PANEL.pad, 0, text, { size: FONT_SIZE.normal, color, wrapWidth: inner }), y);
    y += object.height + LINE_GAP;
  };
  line(info.aim, THEME_CSS.ink);
  for (const special of info.specials) line(special, THEME_CSS.good);
  info.numbers.forEach((text, index) => {
    // 마지막 두 줄(다음 별, 값)은 덜 중요하므로 옅게 적는다.
    line(text, index >= info.numbers.length - 2 ? THEME_CSS.sub : THEME_CSS.ink);
  });
  const closeTop = y - LINE_GAP + CLOSE.top;
  const height = closeTop + CLOSE.height + PANEL.pad;
  const top = Math.max(area.top + 4, Math.round((area.top + area.bottom - height) / 2));
  for (const { object, y: at } of placed) object.y += top + at;
  drawPanel(panel, left, top, width, height, { depth: 3, radius: PANEL.radius });

  // 닫기 단추(가게의 "다음 날"과 같은 모습)
  const buttonX = GAME_WIDTH / 2 - CLOSE.width / 2;
  const buttonY = top + closeTop;
  const button = keep(scene.add.graphics().setDepth(depth));
  const drawButton = (pressed: boolean): void => {
    button.clear();
    button.fillStyle(THEME.pinkDeep, 1);
    button.fillRoundedRect(buttonX, buttonY + 3, CLOSE.width, CLOSE.height - 3, 12);
    button.fillStyle(THEME.pink, 1);
    button.fillRoundedRect(buttonX, buttonY + (pressed ? 2 : 0), CLOSE.width, CLOSE.height - 3, 12);
  };
  drawButton(false);
  keep(
    addText(scene, GAME_WIDTH / 2, buttonY + (CLOSE.height - 3) / 2, INFO_TEXT.close, {
      size: 13,
      color: THEME_CSS.inkDeep,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(depth),
  );

  // 화면의 판 아래까지 모두 덮어서, 어디를 누르든 닫히고 아래의 것은 눌리지 않는다. 닫기 단추는 눌린 모습만 보인다.
  keep(addTapZone(scene, 0, area.top, GAME_WIDTH, scene.scale.height - area.top, () => undefined, onClose).setDepth(depth + 1));
  keep(addTapZone(scene, buttonX, buttonY, CLOSE.width, CLOSE.height, drawButton, onClose).setDepth(depth + 2));

  return {
    destroy: () => {
      for (const object of objects) object.destroy();
      objects.length = 0;
    },
  };
}
