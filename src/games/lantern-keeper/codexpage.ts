import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel, PixelButton } from '../../core/ui';
import { LK } from './art';
import { CODEX_TABS, entriesOf, isOpen, unreadIn, type CodexEntry, type CodexTab, type FindId } from './codex';
import type { EnemyKind } from './data';
import { iconKey, type IconId } from './icons';
import type { LobbyHandlers } from './lobby';
import { readEntries } from './meta';

/** 준비 화면의 다른 쪽과 같은 여백 */
const MARGIN = 12;
const TAB = { top: 70, height: 22, gap: 4 } as const;
/** 격자의 칸. 한 줄에 일곱 칸까지 들어간다(스테이지의 그림자 여섯과 마지막 보스). */
const TILE = { size: 28, gap: 3, art: 22 } as const;
const GRID_TOP = TAB.top + TAB.height + 8;
/** 고른 항목을 크게 보여 주는 아래 칸 */
const DETAIL = { height: 110, art: 40 } as const;
/** 그림이 두 장인 것(그림자)이 걷는 박자(ms) */
const STEP_MS = 320;

const FIND_ART: Readonly<Record<FindId, string>> = {
  gem: LK.gemMid,
  heal: LK.heal,
  pull: LK.pull,
  blast: LK.blast,
  chest: LK.chest,
  post: LK.postLit,
};

/** 그 항목의 그림. 그림자는 걷는 그림 두 장, 나머지는 한 장이다. */
function artOf(entry: CodexEntry): readonly string[] {
  if (entry.tab === 'foes') return LK[entry.id as EnemyKind];
  if (entry.tab === 'finds') return [FIND_ART[entry.id as FindId]];
  return [iconKey(entry.id as IconId)];
}

/** 그림을 칸에 맞춘다. 작은 그림은 정수배로 키우고, 칸보다 큰 그림(보스)만 줄인다. */
function fit(image: Phaser.GameObjects.Image, box: number): void {
  const size = Math.max(image.width, image.height);
  image.setScale(size > box ? box / size : Math.max(1, Math.floor(box / size)));
}

/** 아직 열리지 않은 것은 그림자로만 보인다. */
function shroud(image: Phaser.GameObjects.Image, hidden: boolean): void {
  if (hidden) image.setTint(COLOR.ink).setTintMode(Phaser.TintModes.FILL).setAlpha(0.75);
  else image.clearTint().setAlpha(1);
}

/** tab이 정해지지 않았으면 새로 열린 것이 있는 첫 쪽을, 없으면 첫 쪽을 연다. */
export function startingTab(handlers: LobbyHandlers, tab: number | undefined): number {
  if (tab !== undefined) return Math.max(0, Math.min(Math.floor(tab), CODEX_TABS.length - 1));
  const meta = handlers.getMeta();
  return Math.max(
    0,
    CODEX_TABS.findIndex((item) => unreadIn(item.id, meta) > 0),
  );
}

/**
 * 도감: 위에 쪽을 고르는 버튼, 가운데에 그 쪽의 항목이 늘어선 격자, 아래에 고른 항목의 설명.
 * 새로 열린 항목에는 점이 붙고, 그 쪽을 열어 본 것으로 치므로 다음에 들어오면 점이 사라져 있다.
 */
export function addCodexPage(scene: Phaser.Scene, handlers: LobbyHandlers, tabIndex: number): void {
  const width = scene.scale.width - MARGIN * 2;
  const tab: CodexTab = CODEX_TABS[tabIndex].id;
  const before = handlers.getMeta();
  const entries = entriesOf(tab);
  // 이번에 새로 열린 것. 들어온 동안에는 점을 보여 주고, 기록에서는 바로 읽은 것으로 친다.
  const fresh = entries.filter((entry) => before.unread.includes(entry.id)).map((entry) => entry.id);
  if (fresh.length > 0) handlers.setMeta(readEntries(before, fresh));
  const meta = handlers.getMeta();

  // 쪽을 고르는 버튼. 새로 열린 것이 있는 쪽은 초록으로 알린다.
  const tabWidth = (width - TAB.gap * (CODEX_TABS.length - 1)) / CODEX_TABS.length;
  CODEX_TABS.forEach((item, index) => {
    new PixelButton(scene, {
      x: Math.round(MARGIN + index * (tabWidth + TAB.gap)),
      y: TAB.top,
      width: Math.floor(tabWidth),
      height: TAB.height,
      label: item.name,
      style: index === tabIndex ? 'yellow' : unreadIn(item.id, meta) > 0 ? 'green' : 'neutral',
      onTap: () => {
        if (index !== tabIndex) handlers.onPage('codex', index);
      },
    });
  });

  const rows = Math.max(...entries.map((entry) => entry.row)) + 1;
  // 가장 긴 줄이 가운데에 오도록 놓는다.
  const perRow = Math.max(...Array.from({ length: rows }, (_, row) => entries.filter((entry) => entry.row === row).length));
  const gridLeft = MARGIN + Math.floor((width - (TILE.size * perRow + TILE.gap * (perRow - 1))) / 2);
  const detailTop = GRID_TOP + rows * (TILE.size + TILE.gap) + 3;

  // 처음에는 새로 열린 것 가운데 첫 항목을, 없으면 첫 항목을 고른다.
  let chosen = entries.find((entry) => fresh.includes(entry.id)) ?? entries[0];
  const redraws: Array<() => void> = [];

  // 고른 항목의 설명
  const panel = scene.add.graphics();
  drawPanel(panel, MARGIN, detailTop, width, DETAIL.height, { fill: COLOR.ink, border: COLOR.navy, shadow: null });
  const frame = scene.add.graphics();
  drawPanel(frame, MARGIN + 8, detailTop + 7, DETAIL.art, DETAIL.art, { fill: COLOR.navy, shadow: null, radius: 8 });
  const artX = MARGIN + 8 + DETAIL.art / 2;
  const artY = detailTop + 7 + DETAIL.art / 2;
  const art = scene.add.image(artX, artY, artOf(chosen)[0]);
  const textLeft = MARGIN + 8 + DETAIL.art + 8;
  const name = addText(scene, textLeft, detailTop + 9, '', { color: CSS.yellow, bold: true });
  const note = addText(scene, textLeft, detailTop + 27, '', { color: CSS.silver, size: FONT_SIZE.small });
  const body = addText(scene, MARGIN + 10, detailTop + DETAIL.art + 13, '', {
    color: CSS.white,
    size: FONT_SIZE.small,
    wrapWidth: width - 20,
    lineSpacing: 2,
  });
  let step = 0;
  const drawDetail = (): void => {
    const open = isOpen(chosen, handlers.getMeta());
    const frames = artOf(chosen);
    art.setTexture(frames[step % frames.length]);
    fit(art, DETAIL.art - 6);
    shroud(art, !open);
    name.setText(open ? chosen.name : '???').setColor(open ? CSS.yellow : CSS.silver);
    note.setText(chosen.note);
    body.setText(open ? chosen.text : (chosen.hint ?? '')).setColor(open ? CSS.white : CSS.silver);
  };
  redraws.push(drawDetail);
  scene.time.addEvent({
    delay: STEP_MS,
    loop: true,
    callback: () => {
      step += 1;
      const frames = artOf(chosen);
      if (frames.length > 1) art.setTexture(frames[step % frames.length]);
    },
  });

  // 격자. 같은 줄의 항목은 왼쪽부터 차례로 놓인다.
  const placed = new Map<number, number>();
  for (const entry of entries) {
    const column = placed.get(entry.row) ?? 0;
    placed.set(entry.row, column + 1);
    const x = gridLeft + column * (TILE.size + TILE.gap);
    const y = GRID_TOP + entry.row * (TILE.size + TILE.gap);
    const open = isOpen(entry, meta);
    const tile = scene.add.graphics();
    const draw = (pressed: boolean): void => {
      const picked = chosen === entry;
      tile.clear();
      drawPanel(tile, x, y, TILE.size, TILE.size, {
        fill: pressed || picked ? COLOR.navy : COLOR.charcoal,
        shadow: null,
        radius: 6,
        ...(picked ? { border: COLOR.yellow } : {}),
      });
    };
    const image = scene.add.image(x + TILE.size / 2, y + TILE.size / 2, artOf(entry)[0]);
    fit(image, TILE.art);
    shroud(image, !open);
    // 새로 열린 항목에 붙는 점
    if (fresh.includes(entry.id)) {
      const dot = scene.add.graphics();
      dot.fillStyle(COLOR.ink, 1).fillCircle(x + TILE.size - 5, y + 5, 4);
      dot.fillStyle(COLOR.yellow, 1).fillCircle(x + TILE.size - 5, y + 5, 3);
    }
    redraws.push(() => draw(false));
    addTapZone(scene, x, y, TILE.size, TILE.size, draw, () => {
      if (chosen !== entry) sfx.click();
      chosen = entry;
      step = 0;
      for (const redraw of redraws) redraw();
    });
  }
  for (const redraw of redraws) redraw();
}
