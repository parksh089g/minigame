/**
 * 도감: 위에 쪽(카드, 적, 보물, 업적)을 고르는 버튼, 가운데에 그 쪽의 항목이 늘어선 격자, 아래에 고른 항목의 설명.
 * 아직 못 만난 것은 그림자로만 보인다. 업적 쪽은 줄마다 진행이 보이고, 다 채운 줄을 누르면 구름 조각을 받는다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, PixelButton } from '../../core/ui';
import { achievementProgress, ACHIEVEMENTS, canClaim, claimAchievement, claimableCount, isClaimed } from './achievements';
import { CARD_COLOR, cardTypeTexture, enemyTexture, PX, PX_CSS, TEX, treasureTexture } from './art';
import { addPill, addWideRow, drawSky, MARGIN, PagedList, pxPanel, WIDTH } from './bits';
import { CARD_IDS, CARDS, ENEMIES, RARITY_NAME, TREASURE_IDS, TREASURES, type CardId, type EnemyId, type TreasureId } from './data';
import { codexNow, type TowerMeta } from './run';
import { cardName, cardText, cardTypeName, CODEX_TEXT } from './text';


export type CodexTab = 0 | 1 | 2 | 3;

export interface CodexHooks {
  getMeta: () => TowerMeta;
  setMeta: (meta: TowerMeta) => void;
  onTab: (tab: CodexTab) => void;
  onBack: () => void;
}

const TAB = { top: 40, height: 22, gap: 4 } as const;
const COUNT_Y = 72;
const GRID_TOP = 82;
const TILE = { size: 28, gap: 3, perRow: 7 } as const;
const DETAIL = { height: 86, art: 34 } as const;
const ACHIEVEMENT_ROW = { height: 36, gap: 4 } as const;

interface Entry {
  open: boolean;
  texture: string;
  /** 칸 안에서의 그림 크기 */
  art: number;
  /** 카드는 갈래의 색 띠를 칸 바탕에 깐다. */
  band?: number;
  name: string;
  note: string;
  text: string;
}

function entriesOf(tab: 0 | 1 | 2, meta: TowerMeta): Entry[] {
  const codex = codexNow(meta);
  if (tab === 0) {
    return CARD_IDS.map((id: CardId) => {
      const def = CARDS[id];
      return {
        open: codex.cards.includes(id),
        texture: cardTypeTexture(def.type),
        art: 18,
        band: CARD_COLOR[def.type].face,
        name: cardName(id, false),
        note: `${cardTypeName(id)} · ${RARITY_NAME[def.rarity]} · 마력 ${def.cost[0]}`,
        text: `${cardText(id, false)}\n강화: ${cardText(id, true)}`,
      };
    });
  }
  if (tab === 1) {
    return (Object.keys(ENEMIES) as EnemyId[]).map((id) => {
      const def = ENEMIES[id];
      return {
        open: codex.foes.includes(id),
        texture: enemyTexture(def.look),
        art: 24,
        name: def.name,
        note: CODEX_TEXT.hp(def.hp[0], def.hp[1]),
        text: def.moves.map((move) => move.name).join(' · '),
      };
    });
  }
  return TREASURE_IDS.map((id: TreasureId) => {
    const def = TREASURES[id];
    return {
      open: codex.treasures.includes(id),
      texture: treasureTexture(id),
      art: 20,
      name: def.name,
      note: def.boss ? '대장 보물' : '보물',
      text: def.blurb,
    };
  });
}

/** 아직 열리지 않은 것은 그림자로만 보인다. */
function shroud(image: Phaser.GameObjects.Image, hidden: boolean): void {
  if (hidden) image.setTint(PX.ink).setTintMode(Phaser.TintModes.FILL).setAlpha(0.8);
  else image.clearTint().setAlpha(1);
}

export function buildCodex(scene: Phaser.Scene, hooks: CodexHooks, tab: CodexTab): void {
  const { height } = scene.scale;
  drawSky(scene, 0);
  new PixelButton(scene, { x: 8, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: hooks.onBack });
  addText(scene, 42, 21, CODEX_TEXT.title, { size: 16, color: PX_CSS.accent, originY: 0.5 });
  let shardObjects: Phaser.GameObjects.GameObject[] = [];
  const drawShards = (): void => {
    for (const object of shardObjects) object.destroy();
    const before = scene.children.list.length;
    addPill(scene, GAME_WIDTH - MARGIN, 10, TEX.shard, String(hooks.getMeta().shards), PX_CSS.accent);
    shardObjects = scene.children.list.slice(before);
  };
  drawShards();

  const tabWidth = (WIDTH - TAB.gap * (CODEX_TEXT.tabs.length - 1)) / CODEX_TEXT.tabs.length;
  const claimable = claimableCount(hooks.getMeta());
  CODEX_TEXT.tabs.forEach((label, index) => {
    new PixelButton(scene, {
      x: Math.round(MARGIN + index * (tabWidth + TAB.gap)),
      y: TAB.top,
      width: Math.floor(tabWidth),
      height: TAB.height,
      label: index === 3 && claimable > 0 ? `${label} ${claimable}` : label,
      style: index === tab ? 'yellow' : index === 3 && claimable > 0 ? 'green' : 'neutral',
      onTap: () => {
        if (index !== tab) hooks.onTab(index as CodexTab);
      },
    });
  });

  if (tab === 3) buildAchievements(scene, hooks, drawShards);
  else buildGrid(scene, hooks.getMeta(), tab, height);
}

function buildGrid(scene: Phaser.Scene, meta: TowerMeta, tab: 0 | 1 | 2, height: number): void {
  const entries = entriesOf(tab, meta);
  const opened = entries.filter((entry) => entry.open).length;
  addText(scene, GAME_WIDTH / 2, COUNT_Y, `${CODEX_TEXT.count[tab]} ${opened}/${entries.length}`, {
    size: 10,
    color: PX_CSS.sub,
    originX: 0.5,
    originY: 0.5,
  });

  const detailTop = height - 8 - DETAIL.height;
  const rows = Math.ceil(entries.length / TILE.perRow);
  const room = detailTop - 6 - GRID_TOP;
  const size = Math.min(TILE.size, Math.floor(room / rows) - TILE.gap);
  const gridLeft = MARGIN + Math.floor((WIDTH - (size * TILE.perRow + TILE.gap * (TILE.perRow - 1))) / 2);

  // 고른 항목의 설명
  pxPanel(scene.add.graphics(), MARGIN, detailTop, WIDTH, DETAIL.height, { fill: PX.ink, border: PX.navy, shadow: null });
  pxPanel(scene.add.graphics(), MARGIN + 8, detailTop + 8, DETAIL.art, DETAIL.art, { fill: PX.navy, border: PX.navy, shadow: null });
  const art = scene.add.image(MARGIN + 8 + DETAIL.art / 2, detailTop + 8 + DETAIL.art / 2, entries[0].texture);
  const textLeft = MARGIN + DETAIL.art + 16;
  const name = addText(scene, textLeft, detailTop + 9, '', { size: 12, color: PX_CSS.accent });
  const note = addText(scene, textLeft, detailTop + 27, '', { size: 9, color: PX_CSS.sub });
  const body = addText(scene, MARGIN + 10, detailTop + DETAIL.art + 13, '', {
    size: 10,
    color: PX_CSS.text,
    wrapWidth: WIDTH - 20,
    lineSpacing: 1,
  });
  let chosen = Math.max(0, entries.findIndex((entry) => entry.open));
  const redraws: Array<() => void> = [];
  const drawDetail = (): void => {
    const entry = entries[chosen];
    art.setTexture(entry.texture);
    const scale = (DETAIL.art - 6) / Math.max(art.width, art.height);
    art.setScale(scale);
    shroud(art, !entry.open);
    name.setText(entry.open ? entry.name : CODEX_TEXT.unknown).setColor(entry.open ? PX_CSS.accent : PX_CSS.sub);
    note.setText(entry.open ? entry.note : '');
    body.setText(entry.open ? entry.text : CODEX_TEXT.hints[tab]).setColor(entry.open ? PX_CSS.text : PX_CSS.sub);
    // 두 줄이 넘는 설명은 칸에 맞게 줄인다.
    const bodyRoom = DETAIL.height - DETAIL.art - 17;
    body.setScale(1);
    if (body.height > bodyRoom) body.setScale(bodyRoom / body.height);
  };
  redraws.push(drawDetail);

  entries.forEach((entry, index) => {
    const x = gridLeft + (index % TILE.perRow) * (size + TILE.gap);
    const y = GRID_TOP + Math.floor(index / TILE.perRow) * (size + TILE.gap);
    const tile = scene.add.graphics();
    const draw = (pressed: boolean): void => {
      const picked = chosen === index;
      tile.clear();
      pxPanel(tile, x, y, size, size, {
        fill: pressed || picked ? PX.navy : PX.panel,
        border: picked ? PX.yellow : PX.edge,
        shadow: null,
      });
      if (entry.band !== undefined && entry.open) {
        tile.fillStyle(entry.band, 1);
        tile.fillRect(x + 3, y + size - 6, size - 6, 3);
      }
    };
    const image = scene.add.image(x + size / 2, y + size / 2 - (entry.band !== undefined ? 1 : 0), entry.texture);
    image.setScale(Math.min(entry.art, size - 6) / Math.max(image.width, image.height));
    shroud(image, !entry.open);
    redraws.push(() => draw(false));
    addTapZone(scene, x, y, size, size, draw, () => {
      if (chosen !== index) sfx.click();
      chosen = index;
      for (const redraw of redraws) redraw();
    });
  });
  for (const redraw of redraws) redraw();
}

function buildAchievements(scene: Phaser.Scene, hooks: CodexHooks, drawShards: () => void): void {
  const { height } = scene.scale;
  const done = ACHIEVEMENTS.filter((achievement) => isClaimed(hooks.getMeta(), achievement)).length;
  addText(scene, GAME_WIDTH / 2, COUNT_Y, `받은 업적 ${done}/${ACHIEVEMENTS.length}`, {
    size: 10,
    color: PX_CSS.sub,
    originX: 0.5,
    originY: 0.5,
  });
  const list = new PagedList(scene, ACHIEVEMENTS, GRID_TOP, height - 8, ACHIEVEMENT_ROW.height, ACHIEVEMENT_ROW.gap, (achievement, y) => {
    const meta = hooks.getMeta();
    const claimed = isClaimed(meta, achievement);
    const ready = canClaim(meta, achievement);
    const progress = achievementProgress(meta, achievement);
    return addWideRow(scene, {
      y,
      height: ACHIEVEMENT_ROW.height,
      texture: ready || claimed ? TEX.shard : TEX.spark,
      title: `${achievement.name} · ${CODEX_TEXT.reward(achievement.reward)}`,
      note: achievement.blurb,
      side: claimed ? CODEX_TEXT.claimed : ready ? CODEX_TEXT.claim(achievement.reward) : `${progress}/${achievement.goal}`,
      sideColor: claimed ? PX_CSS.faint : ready ? PX_CSS.good : PX_CSS.sub,
      border: ready ? PX.lime : undefined,
      dim: claimed,
      onTap: ready
        ? () => {
            const next = claimAchievement(hooks.getMeta(), achievement.id);
            if (next === hooks.getMeta()) return;
            sfx.coin();
            hooks.setMeta(next);
            drawShards();
            hooks.onTab(3);
          }
        : undefined,
    });
  });
  void list;
}
