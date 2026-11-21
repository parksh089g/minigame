/**
 * 갈림길: 이 구역의 일곱 층을 아래에서 위로 쌓은 탑으로 보여 준다.
 * 맨 아래는 구역의 입구, 맨 위는 대장이 기다리는 층이다. 토끼는 방금 마친 층에 서 있고,
 * 바로 위층에 고를 수 있는 길이 문으로 놓인다. 지나온 층에는 그때 고른 일이, 더 위의 층에는 구름이 끼어 있다.
 *
 * 문을 누르면 문이 올라오고 아래 설명 칸에 무엇이 있는지 보인다. 같은 문을 한 번 더 누르거나 "올라가기"를 누르면
 * 토끼가 그 문으로 폴짝 뛰어오른 뒤 그 층이 열린다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, PixelButton } from '../../core/ui';
import { enemyTexture, nodeTexture, PX, PX_CSS, TEX } from './art';
import { drawSky, drawTopBar, MARGIN, TOP_BAR, WIDTH, pxPanel } from './bits';
import { ENCOUNTERS, ENEMIES, FLOORS_PER_ACT, NODE_BLURBS, NODE_NAMES, type NodeKind } from './data';
import { discardPotion, potionsOf } from './potions';
import { actOf, chooseNode, floorInAct, type RunState } from './run';
import { drawPotionStrip, drawTreasureStrip, type ScreenHooks } from './screens';
import { MAP_TEXT } from './text';


/** 탑의 몸통이 차지하는 가로 범위 */
const TOWER = { left: 26, right: GAME_WIDTH - 26 } as const;
/** 줄마다의 높이: 고를 층은 크게, 토끼가 선 층은 그다음, 나머지는 남는 만큼 나눈다. */
const ROW = { next: 76, current: 46, least: 16, most: 40 } as const;
/** 탑의 색 */
const LOOK = {
  wall: PX.panel,
  wallEdge: PX.edge,
  ledge: PX.slate,
  window: PX.navy,
  done: PX.teal,
  fog: PX.silver,
  door: [PX.navy, PX.navy, PX.navy] as const,
  doorEdge: [PX.yellow, PX.yellow, PX.yellow] as const,
} as const;

interface Band {
  /** 0은 입구, 1~7은 구역 안의 층 */
  position: number;
  top: number;
  height: number;
}

export function buildMap(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks & { showDeck: () => void }): void {
  const { height } = scene.scale;
  const nextFloor = run.floor + 1;
  const act = actOf(nextFloor);
  const next = floorInAct(nextFloor);
  const current = next - 1;
  const actStart = act * FLOORS_PER_ACT;
  drawSky(scene, act);
  drawTopBar(scene, run);

  // 아래쪽: 덱 보기와 설명 칸, 그 위에 가진 보물
  const footTop = height - 42;
  const infoTop = footTop - 30;
  const treasureTop = run.treasures.length > 0 ? infoTop - 26 : infoTop;
  const towerTop = TOP_BAR + 22;
  const towerBottom = treasureTop - 4;


  // 줄의 높이를 정한다: 입구(0)부터 대장 층(7)까지 여덟 줄
  const others = FLOORS_PER_ACT + 1 - 2;
  const rest = towerBottom - towerTop - ROW.next - ROW.current;
  const small = Math.max(ROW.least, Math.min(ROW.most, Math.floor(rest / others)));
  const heights = Array.from({ length: FLOORS_PER_ACT + 1 }, (_, position) =>
    position === next ? ROW.next : position === current ? ROW.current : small,
  );
  // 남는 자리는 탑 위의 하늘로 둔다. 탑은 아래쪽에 붙는다.
  let bottom = towerBottom;
  const bands: Band[] = heights.map((bandHeight, position) => {
    const band = { position, top: bottom - bandHeight, height: bandHeight };
    bottom -= bandHeight;
    return band;
  });
  const topOfTower = bands[bands.length - 1].top;

  // 탑의 몸통과 지붕
  const g = scene.add.graphics();
  g.fillStyle(LOOK.wallEdge, 1);
  g.fillRoundedRect(TOWER.left - 2, topOfTower - 2, TOWER.right - TOWER.left + 4, towerBottom - topOfTower + 6, 3);
  g.fillStyle(LOOK.wall, 1);
  g.fillRoundedRect(TOWER.left, topOfTower, TOWER.right - TOWER.left, towerBottom - topOfTower + 2, 2);
  // 지붕 꼭대기의 깃발
  g.fillStyle(PX.yellow, 1);
  g.fillTriangle(GAME_WIDTH / 2, topOfTower - 16, GAME_WIDTH / 2 + 14, topOfTower - 11, GAME_WIDTH / 2, topOfTower - 6);
  g.lineStyle(2, LOOK.ledge, 1);
  g.lineBetween(GAME_WIDTH / 2, topOfTower - 17, GAME_WIDTH / 2, topOfTower);

  for (const band of bands) drawBand(scene, g, run, band, { next, current, actStart, act });

  // 토끼: 방금 마친 층(구역을 막 시작했으면 입구)에 선다.
  const standing = bands[current];
  const bunny = scene.add
    .image(TOWER.left + 48, standing.top + standing.height - 22, TEX.bunny)
    .setScale(Math.min(0.8, (standing.height - 4) / 52));
  scene.tweens.add({ targets: bunny, y: bunny.y - 2, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.InOut' });

  // 설명 칸과 올라가기 버튼
  const panel = scene.add.graphics();
  pxPanel(panel, MARGIN, infoTop, WIDTH, 26, { fill: PX.navy, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, infoTop + 13, MAP_TEXT.hint, {
    size: 10,
    color: PX_CSS.text,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 14,
  });
  // 보물은 왼쪽부터, 물약은 오른쪽 끝에 놓는다.
  const potions = potionsOf(run);
  if (run.treasures.length > 0) drawTreasureStrip(scene, run.treasures, treasureTop, WIDTH - potions.length * 22 - 6);
  if (potions.length > 0)
    drawPotionStrip(scene, potions, treasureTop, (slot) => {
      // 올라가는 중에는 화면을 다시 열지 않는다.
      if (!leaving && discardPotion(run, slot)) {
        sfx.pop();
        hooks.next();
      }
    });

  let picked: number | null = null;
  let leaving = false;
  const doorBand = bands[next];
  const doors = drawDoors(scene, run.choices, doorBand, (index) => select(index));
  const climbButton = new PixelButton(scene, {
    x: MARGIN + 92,
    y: footTop,
    width: WIDTH - 92,
    height: 34,
    label: MAP_TEXT.climb,
    style: 'green',
    onTap: () => {
      if (picked !== null) climb(picked);
    },
  });
  climbButton.setEnabled(false);
  new PixelButton(scene, { x: MARGIN, y: footTop, width: 86, height: 34, label: MAP_TEXT.deck(run.deck.length), onTap: hooks.showDeck });

  // 문이 하나뿐이면 처음부터 골라 둔다.
  if (run.choices.length === 1) select(0, false);

  function select(index: number, sound = true): void {
    if (leaving) return;
    if (picked === index) {
      climb(index);
      return;
    }
    picked = index;
    if (sound) sfx.flip();
    const kind = run.choices[index];
    info.setText(`${NODE_NAMES[kind]}: ${NODE_BLURBS[kind]}`);
    doors.forEach((door, i) => door.setPicked(i === index));
    climbButton.setEnabled(true);
  }

  function climb(index: number): void {
    if (leaving) return;
    leaving = true;
    climbButton.setEnabled(false);
    const door = doors[index];
    sfx.jump();
    scene.tweens.killTweensOf(bunny);
    // 문 앞으로 폴짝 뛰어올라 문 안으로 들어간다.
    scene.tweens.add({
      targets: bunny,
      x: door.centerX,
      duration: 380,
      ease: 'Sine.InOut',
    });
    scene.tweens.add({
      targets: bunny,
      y: { from: bunny.y, to: door.floorY - 18 },
      duration: 380,
      ease: 'Back.Out',
      onComplete: () => {
        scene.tweens.add({
          targets: bunny,
          alpha: 0,
          scale: bunny.scale * 0.6,
          duration: 200,
          onComplete: () => {
            if (chooseNode(run, index)) {
              sfx.go();
              hooks.next();
            }
          },
        });
      },
    });
  }
}

/** 한 층의 띠: 왼쪽에 층 번호, 가운데에 그 층의 모습 */
function drawBand(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  run: RunState,
  band: Band,
  at: { next: number; current: number; actStart: number; act: number },
): void {
  const { position, top, height } = band;
  const middle = top + height / 2;
  const floor = at.actStart + position;
  // 층 사이의 턱
  g.fillStyle(LOOK.ledge, 1);
  g.fillRoundedRect(TOWER.left - 6, top + height - 3, TOWER.right - TOWER.left + 12, 5, 0);
  if (position === 0) {
    // 입구: 아치 문
    g.fillStyle(LOOK.wallEdge, 1);
    g.fillRoundedRect(GAME_WIDTH / 2 - 12, top + Math.max(2, height - 26), 24, Math.min(24, height - 4), { tl: 12, tr: 12, bl: 0, br: 0 });
    addText(scene, TOWER.right - 8, middle, MAP_TEXT.entrance, { size: 9, color: PX_CSS.faint, originX: 1, originY: 0.5 });
    return;
  }
  const label = addText(scene, TOWER.left + 6, middle, `${floor}층`, {
    size: 9,
    color: position === at.next ? PX_CSS.accent : PX_CSS.faint,
    originY: 0.5,
  });
  if (position < at.next) {
    // 지나온 층: 고른 일의 아이콘과 별
    g.fillStyle(LOOK.done, 0.45);
    g.fillRect(TOWER.left + 2, top + 2, TOWER.right - TOWER.left - 4, height - 5);
    label.setDepth(1);
    const kind = run.path[floor - 1];
    if (kind && position !== at.current) {
      scene.add.image(GAME_WIDTH / 2, middle, nodeTexture(kind)).setScale(Math.min(0.6, (height - 4) / 28)).setAlpha(0.8);
    }
    if (kind && position === at.current) {
      scene.add.image(TOWER.right - 22, middle, nodeTexture(kind)).setScale(0.7).setAlpha(0.8);
    }
    return;
  }
  if (position === at.next) return;
  // 아직 못 간 층: 창문과 구름. 대장 층에는 대장이 보인다.
  if (position === FLOORS_PER_ACT) {
    const boss = ENEMIES[ENCOUNTERS[at.act].boss];
    const size = Math.min(height, 40);
    scene.add.image(GAME_WIDTH / 2, middle - 1, enemyTexture(boss.look)).setDisplaySize(size, size);
    scene.add.image(GAME_WIDTH / 2 + size / 2 + 6, middle, nodeTexture('boss')).setScale(0.55);
    addText(scene, TOWER.right - 8, middle, boss.name, { size: 9, color: PX_CSS.bad, originX: 1, originY: 0.5 });
    return;
  }
  const windowSize = Math.min(10, height - 8);
  for (const x of [GAME_WIDTH / 2 - 30, GAME_WIDTH / 2, GAME_WIDTH / 2 + 30]) {
    g.fillStyle(LOOK.window, 1);
    g.fillRoundedRect(x - windowSize / 2, middle - windowSize / 2, windowSize, windowSize, { tl: windowSize / 2, tr: windowSize / 2, bl: 2, br: 2 });
  }
  g.fillStyle(LOOK.fog, 0.75);
  const puff = Math.min(6, Math.floor(height / 2) - 2);
  g.fillRect(TOWER.right - 34, middle - puff / 2 + 2, 20, puff);
  g.fillRect(TOWER.right - 28, middle - puff / 2 - 1, 10, puff);
}

interface DoorView {
  centerX: number;
  /** 문이 선 바닥의 높이 */
  floorY: number;
  setPicked: (picked: boolean) => void;
}

/** 고를 층에 길의 수만큼 문을 놓는다. */
function drawDoors(scene: Phaser.Scene, choices: readonly NodeKind[], band: Band, onTap: (index: number) => void): DoorView[] {
  const count = Math.max(1, choices.length);
  const inner = TOWER.right - TOWER.left - 40;
  const gap = 8;
  const width = Math.min(64, (inner - gap * (count - 1)) / count);
  const span = width * count + gap * (count - 1);
  const left = TOWER.left + 30 + (inner - span) / 2;
  const floorY = band.top + band.height - 3;
  const doorHeight = band.height - 10;
  return choices.map((kind, index) => {
    const x = left + index * (width + gap);
    const g = scene.add.graphics();
    const color = index % LOOK.door.length;
    let picked = false;
    const icon = scene.add.image(x + width / 2, floorY - doorHeight + 22, nodeTexture(kind));
    const name = addText(scene, x + width / 2, floorY - 12, NODE_NAMES[kind], {
      size: 10,
      color: PX_CSS.text,
      originX: 0.5,
      originY: 0.5,
    });
    if (name.width > width - 6) name.setScale((width - 6) / name.width);
    const draw = (pressed: boolean): void => {
      const lift = picked ? 4 : pressed ? -1 : 0;
      g.clear();
      const y = floorY - doorHeight - lift;
      const radius = { tl: width / 2, tr: width / 2, bl: 4, br: 4 };
      g.fillStyle(picked ? LOOK.doorEdge[color] : LOOK.wallEdge, 1);
      g.fillRoundedRect(x - 2, y - 2, width + 4, doorHeight + 2 + lift, { ...radius, tl: width / 2 + 2, tr: width / 2 + 2 });
      g.fillStyle(kind === 'boss' ? PX.plum : kind === 'elite' ? PX.red : LOOK.door[color], 1);
      g.fillRoundedRect(x, y, width, doorHeight + lift, radius);
      icon.setY(floorY - doorHeight + 22 - lift);
      name.setY(floorY - 12 - lift);
    };
    draw(false);
    scene.tweens.add({ targets: icon, scale: { from: 1, to: 1.12 }, yoyo: true, repeat: -1, duration: 650 + index * 90, ease: 'Sine.InOut' });
    addTapZone(scene, x - 2, floorY - doorHeight - 6, width + 4, doorHeight + 6, draw, () => onTap(index));
    return {
      centerX: x + width / 2,
      floorY,
      setPicked: (value: boolean) => {
        picked = value;
        draw(false);
      },
    };
  });
}
