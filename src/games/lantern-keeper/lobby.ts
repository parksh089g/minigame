import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { sfx } from '../../core/sfx';
import { addText, drawPanel, PixelButton } from '../../core/ui';
import { LK } from './art';
import { META, META_ORDER, type MetaId } from './data';
import { buyMeta, type LanternMeta } from './meta';
import { formatClock, metaCost } from './rules';
import type { RunState } from './sim';

const MARGIN = 12;
const ROW_WIDTH = GAME_WIDTH - MARGIN * 2;
const ROW_HEIGHT = 34;
const ROW_GAP = 4;
const ROWS_TOP = 92;
const BUY_WIDTH = 62;

export interface LobbyHandlers {
  getMeta: () => LanternMeta;
  setMeta: (meta: LanternMeta) => void;
  /** 저장해 둔 판. 없으면 null */
  savedRun: RunState | null;
  onStart: () => void;
  onResume: () => void;
  onBack: () => void;
}

/** 판을 시작하기 전의 준비 화면: 모은 불씨로 영구 강화를 사고 출발한다. */
export function buildLobby(scene: Phaser.Scene, handlers: LobbyHandlers): void {
  const { width, height } = scene.scale;

  scene.add.tileSprite(0, 0, width, height, LK.floor).setOrigin(0, 0);
  scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.5).setOrigin(0, 0);

  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: handlers.onBack,
  });
  addText(scene, GAME_WIDTH / 2, 8, '등불지기', {
    size: FONT_SIZE.large,
    bold: true,
    color: CSS.yellow,
    originX: 0.5,
    shadow: CSS.orange,
  });
  addText(scene, GAME_WIDTH / 2, 40, '끌어서 움직이고 10분을 버텨요', {
    color: CSS.silver,
    originX: 0.5,
  });

  // 가진 불씨와 지금까지의 기록
  const info = scene.add.graphics();
  drawPanel(info, MARGIN, 60, ROW_WIDTH, 24, { fill: COLOR.ink, border: COLOR.navy, highlight: COLOR.ink });
  scene.add.image(MARGIN + 8, 72, LK.ember).setOrigin(0, 0.5);
  const embers = addText(scene, MARGIN + 18, 66, '', { color: CSS.orange, bold: true });
  const meta = handlers.getMeta();
  const record =
    meta.runs === 0
      ? '첫 밤을 기다려요'
      : meta.clears > 0
        ? `새벽을 본 횟수 ${meta.clears}`
        : `최고 ${formatClock(meta.bestSeconds)}`;
  addText(scene, MARGIN + ROW_WIDTH - 8, 66, record, { color: CSS.silver, originX: 1 });

  // 영구 강화
  const refreshers: Array<() => void> = [];
  const refresh = (): void => {
    embers.setText(`불씨 ${handlers.getMeta().embers}`);
    for (const fn of refreshers) fn();
  };

  META_ORDER.forEach((id: MetaId, index) => {
    const item = META[id];
    const y = ROWS_TOP + index * (ROW_HEIGHT + ROW_GAP);
    const panel = scene.add.graphics();
    drawPanel(panel, MARGIN, y, ROW_WIDTH, ROW_HEIGHT);
    const name = addText(scene, MARGIN + 8, y + 4, item.name, { bold: true });
    addText(scene, MARGIN + 8, y + 19, item.perLevel, { color: CSS.silver });
    const pips = scene.add.graphics();
    const pipsLeft = Math.round(name.x + name.width) + 6;

    const button = new PixelButton(scene, {
      x: MARGIN + ROW_WIDTH - BUY_WIDTH - 5,
      y: y + 5,
      width: BUY_WIDTH,
      height: 24,
      label: '',
      style: 'yellow',
      onTap: () => {
        const before = handlers.getMeta();
        const after = buyMeta(before, id);
        if (after === before) {
          sfx.deny();
          return;
        }
        handlers.setMeta(after);
        sfx.coin();
        refresh();
      },
    });

    refreshers.push(() => {
      const current = handlers.getMeta();
      const level = current.upgrades[id] ?? 0;
      const cost = metaCost(id, level);
      pips.clear();
      for (let i = 0; i < item.maxLevel; i += 1) {
        pips.fillStyle(i < level ? COLOR.yellow : COLOR.ink, 1);
        pips.fillRect(pipsLeft + i * 6, y + 8, 4, 4);
      }
      if (cost === null) {
        button.setLabel('최대').setStyle('neutral').setEnabled(false);
      } else {
        const affordable = current.embers >= cost;
        button.setLabel(`불씨 ${cost}`).setStyle(affordable ? 'yellow' : 'neutral').setEnabled(affordable);
      }
    });
  });
  refresh();

  // 출발
  const saved = handlers.savedRun;
  const buttonsTop = height - (saved ? 78 : 50);
  addShowcase(scene, ROWS_TOP + META_ORDER.length * (ROW_HEIGHT + ROW_GAP), buttonsTop);
  const buttonX = MARGIN + 12;
  const buttonWidth = ROW_WIDTH - 24;
  if (saved) {
    new PixelButton(scene, {
      x: buttonX,
      y: height - 78,
      width: buttonWidth,
      height: 30,
      label: `이어하기 (${formatClock(saved.t)} · Lv ${saved.player.level})`,
      style: 'green',
      onTap: handlers.onResume,
    });
    new PixelButton(scene, {
      x: buttonX,
      y: height - 42,
      width: buttonWidth,
      height: 28,
      label: '새로 시작',
      onTap: handlers.onStart,
    });
  } else {
    new PixelButton(scene, {
      x: buttonX,
      y: height - 50,
      width: buttonWidth,
      height: 34,
      label: '출발!',
      style: 'green',
      onTap: handlers.onStart,
    });
  }
}

/** 강화 목록과 버튼 사이에 자리가 남으면 등불을 든 수호자와 다가오는 그림자를 세워 둔다. */
function addShowcase(scene: Phaser.Scene, top: number, bottom: number): void {
  if (bottom - top < 76) return;
  const y = Math.round((top + bottom) / 2);
  const centerX = GAME_WIDTH / 2;
  const glow = scene.add.graphics();
  glow.fillStyle(COLOR.yellow, 0.08);
  glow.fillCircle(centerX, y, 34);
  glow.fillStyle(COLOR.yellow, 0.1);
  glow.fillCircle(centerX, y, 22);
  scene.tweens.add({ targets: glow, alpha: 0.6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  scene.add.image(centerX, y, LK.keeper[0]).setScale(2);
  const shades: Array<[number, number, string]> = [
    [-78, -8, LK.shade[0]],
    [70, 10, LK.shade[1]],
    [-52, 20, LK.bat[0]],
    [92, -14, LK.wisp[0]],
  ];
  for (const [dx, dy, key] of shades) {
    const image = scene.add.image(centerX + dx, y + dy, key).setScale(2).setAlpha(0.8);
    scene.tweens.add({ targets: image, y: image.y - 2, duration: 500 + Math.abs(dx) * 4, yoyo: true, repeat: -1 });
  }
}
