/**
 * 일시정지 화면에 덧붙이는 "지금 빌드": 든 무기와 패시브의 이름과 레벨, 무기마다 준 피해의 비중.
 * 플레이 중에는 HUD의 작은 아이콘으로만 보이던 것을, 멈춘 김에 이름과 숫자로 확인할 수 있다.
 */
import type Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addText } from '../../core/ui';
import type { PauseExtra } from '../../scenes/MiniGameScene';
import { levelLabel, passiveRows, percent, weaponRows, type PassiveRow, type WeaponRow } from './build';
import { MAX_WEAPONS } from './data';
import { iconKey } from './icons';
import type { RunState } from './sim';

/** 일시정지 카드의 너비. 이름과 막대가 한 줄에 들어가도록 기본보다 넓힌다. */
const CARD_WIDTH = GAME_WIDTH - 16;
/** 제목 줄, 항목 한 줄, 무기와 패시브 사이, 패시브 두 칸 사이 */
const HEAD = 14;
const ROW = 19;
const SECTION_GAP = 5;
const COLUMN_GAP = 8;
/** 한 줄 안에서의 자리: 이름이 시작하는 곳, 레벨이 시작하는 곳, 피해 막대가 시작하는 곳과 그 길이 */
const AT = { name: 22, level: 78, bar: 108, barWidth: 56, barHeight: 5 } as const;

export function pauseInfo(state: RunState): PauseExtra {
  const weapons = weaponRows(state.weapons, state.dealt);
  const passives = passiveRows(state.passives);
  const passiveLines = Math.max(1, Math.ceil(passives.length / 2));
  return {
    width: CARD_WIDTH,
    height: HEAD + weapons.length * ROW + SECTION_GAP + HEAD + passiveLines * ROW,
    draw: (scene, left, top, width) => {
      let y = top;
      addText(scene, left, y, `무기 ${weapons.length}/${MAX_WEAPONS}`, { size: FONT_SIZE.small, color: THEME_CSS.sub });
      addText(scene, left + width, y, '준 피해', { size: FONT_SIZE.small, color: THEME_CSS.faint, originX: 1 });
      y += HEAD;
      const bars = scene.add.graphics();
      for (const row of weapons) {
        drawWeapon(scene, bars, row, left, y, width);
        y += ROW;
      }
      y += SECTION_GAP;
      addText(scene, left, y, '패시브', { size: FONT_SIZE.small, color: THEME_CSS.sub });
      y += HEAD;
      if (passives.length === 0) {
        addText(scene, left + 2, y + ROW / 2, '아직 없어요', {
          size: FONT_SIZE.small,
          color: THEME_CSS.faint,
          originY: 0.5,
        });
        return;
      }
      const column = Math.floor((width - COLUMN_GAP) / 2);
      passives.forEach((row, index) => {
        const x = left + (index % 2) * (column + COLUMN_GAP);
        drawPassive(scene, row, x, y + Math.floor(index / 2) * ROW, column);
      });
    },
  };
}

function drawIcon(scene: Phaser.Scene, key: string, x: number, middle: number): void {
  if (scene.textures.exists(key)) scene.add.image(Math.round(x + 9), Math.round(middle), key);
}

/** 아이콘, 이름, 레벨, 그리고 이 무기가 준 피해의 비중을 막대와 숫자로 */
function drawWeapon(
  scene: Phaser.Scene,
  bars: Phaser.GameObjects.Graphics,
  row: WeaponRow,
  left: number,
  top: number,
  width: number,
): void {
  const middle = top + ROW / 2;
  drawIcon(scene, iconKey(row.icon), left, middle);
  addText(scene, left + AT.name, middle, row.name, { size: FONT_SIZE.small, originY: 0.5 });
  addText(scene, left + AT.level, middle, levelLabel(row), {
    size: FONT_SIZE.small,
    color: row.evolved ? THEME_CSS.accent : THEME_CSS.sub,
    originY: 0.5,
  });
  const barTop = Math.round(middle - AT.barHeight / 2);
  bars.fillStyle(THEME.dim, 1);
  bars.fillRoundedRect(left + AT.bar, barTop, AT.barWidth, AT.barHeight, 2);
  const filled = Math.round(AT.barWidth * row.share);
  if (filled >= 2) {
    bars.fillStyle(THEME.coral, 1);
    bars.fillRoundedRect(left + AT.bar, barTop, filled, AT.barHeight, Math.min(2, filled / 2));
  }
  addText(scene, left + width, middle, percent(row.share), { size: FONT_SIZE.small, originX: 1, originY: 0.5 });
}

function drawPassive(scene: Phaser.Scene, row: PassiveRow, left: number, top: number, width: number): void {
  const middle = top + ROW / 2;
  drawIcon(scene, iconKey(row.icon), left, middle);
  addText(scene, left + AT.name, middle, row.name, { size: FONT_SIZE.small, originY: 0.5 });
  addText(scene, left + width, middle, levelLabel(row), {
    size: FONT_SIZE.small,
    color: THEME_CSS.sub,
    originX: 1,
    originY: 0.5,
  });
}
