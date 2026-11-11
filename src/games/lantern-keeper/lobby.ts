import Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel, PixelButton } from '../../core/ui';
import { DARK_PANEL, FLOOR_OF, HERO_FRAMES, LK } from './art';
import {
  HERO_ORDER,
  HEROES,
  META,
  META_ORDER,
  STAGE_ORDER,
  STAGES,
  WEAPONS,
  type HeroId,
  type MetaId,
  type StageId,
} from './data';
import { iconKey } from './icons';
import { buyMeta, chooseHero, chooseStage, type LanternMeta } from './meta';
import { formatClock, isUnlocked, metaCost } from './rules';
import type { RunState } from './sim';

const MARGIN = 12;
const ROW_WIDTH = GAME_WIDTH - MARGIN * 2;
const BUY_WIDTH = 62;
const CARD_GAP = 6;
const HERO_CARD = { width: (ROW_WIDTH - CARD_GAP * 2) / 3, height: 62 } as const;
const STAGE_CARD = { width: (ROW_WIDTH - CARD_GAP) / 2, height: 38 } as const;
const DETAIL_HEIGHT = 56;
const UPGRADE_BUTTON_HEIGHT = 24;
/** 고르는 구역(누가 갈까 ~ 스테이지 설명)의 높이 */
const PICK_HEIGHT = 15 + HERO_CARD.height + 4 + DETAIL_HEIGHT + 15 + STAGE_CARD.height + 4 + 14;
/** 화면이 가장 짧을 때(400)의 배치를 기준으로 하고, 길면 구역 사이를 이만큼까지 벌린다. */
const MAX_SPREAD = 30;

/** 긴 화면에서만 보이는 미리보기 띠: 이만큼 남아야 넣고, 이 높이까지 키운다. */
const SHOWCASE = { needs: 64, max: 84, gap: 6 } as const;

/** 준비 화면의 쪽. main은 캐릭터와 스테이지를 고르는 곳, upgrades는 영구 강화를 사는 곳. */
export type LobbyPage = 'main' | 'upgrades';

export interface LobbyHandlers {
  getMeta: () => LanternMeta;
  setMeta: (meta: LanternMeta) => void;
  /** 저장해 둔 판. 없으면 null */
  savedRun: RunState | null;
  onStart: () => void;
  onResume: () => void;
  onBack: () => void;
  /** 다른 쪽으로 넘어간다 */
  onPage: (page: LobbyPage) => void;
}

/** 판을 시작하기 전의 준비 화면: 캐릭터와 스테이지를 고르고, 모은 불씨로 영구 강화를 산다. */
export function buildLobby(scene: Phaser.Scene, handlers: LobbyHandlers, page: LobbyPage = 'main'): void {
  const { width, height } = scene.scale;
  const floor = scene.add.tileSprite(0, 0, width, height, FLOOR_OF[handlers.getMeta().stage]).setOrigin(0, 0);
  scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.55).setOrigin(0, 0);

  new PixelButton(scene, {
    x: 8,
    y: 8,
    width: 26,
    height: 26,
    icon: 'icon-back',
    hitPadding: 6,
    onTap: page === 'main' ? handlers.onBack : () => handlers.onPage('main'),
  });
  addText(scene, GAME_WIDTH / 2, 6, page === 'main' ? '등불지기' : '영구 강화', {
    size: FONT_SIZE.large,
    bold: true,
    color: CSS.yellow,
    originX: 0.5,
    shadow: CSS.orange,
  });

  // 가진 불씨와 지금까지의 기록
  const info = scene.add.graphics();
  drawPanel(info, MARGIN, 40, ROW_WIDTH, 24, { fill: COLOR.ink, border: COLOR.navy, shadow: null });
  scene.add.image(MARGIN + 8, 52, LK.ember).setOrigin(0, 0.5);
  const embers = addText(scene, MARGIN + 18, 46, '', { color: CSS.orange, bold: true });
  const meta = handlers.getMeta();
  const record =
    meta.runs === 0
      ? '첫 밤을 기다려요'
      : meta.clears > 0
        ? `새벽을 본 횟수 ${meta.clears}`
        : `최고 ${formatClock(meta.bestSeconds)}`;
  addText(scene, MARGIN + ROW_WIDTH - 8, 46, record, { color: CSS.silver, originX: 1 });

  const refreshers: Array<() => void> = [
    () => embers.setText(`불씨 ${handlers.getMeta().embers}`),
    // 고른 스테이지의 바닥이 뒤에 깔린다.
    () => floor.setTexture(FLOOR_OF[handlers.getMeta().stage]),
  ];
  const refresh = (): void => {
    for (const fn of refreshers) fn();
  };

  if (page === 'upgrades') addUpgradeRows(scene, handlers, refreshers, refresh);
  else addMainPage(scene, handlers, refreshers, refresh, height);
  refresh();
}

// ---------------------------------------------------------------- 고르는 쪽

function addMainPage(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  refresh: () => void,
  height: number,
): void {
  const saved = handlers.savedRun;
  const buttonsTop = height - (saved ? 78 : 50);
  // 영구 강화 버튼은 출발 버튼 바로 위에 붙이고, 남는 높이는 고르는 구역의 위아래와 가운데에 나눠 준다.
  const upgradeTop = buttonsTop - UPGRADE_BUTTON_HEIGHT - 10;
  const room = Math.max(0, upgradeTop - 6 - 68 - PICK_HEIGHT);
  // 화면이 길어 자리가 넉넉하면, 고른 캐릭터가 고른 스테이지에 서 있는 모습을 위에 보여 준다.
  const showcase = room >= SHOWCASE.needs ? Math.min(SHOWCASE.max, room - 30) : 0;
  const slack = room - (showcase > 0 ? showcase + SHOWCASE.gap : 0);
  const spread = Math.min(MAX_SPREAD, Math.floor(slack / 3));

  let y = 68;
  if (showcase > 0) {
    addShowcase(scene, handlers, refreshers, y, showcase);
    y += showcase + SHOWCASE.gap;
  }
  y += Math.floor((slack - spread) / 2);
  addText(scene, MARGIN + 2, y, '누가 갈까', { color: CSS.silver });
  y += 15;
  addHeroCards(scene, handlers, refreshers, refresh, y);
  y += HERO_CARD.height + 4;
  addHeroDetail(scene, handlers, refreshers, y);
  y += DETAIL_HEIGHT + spread;

  addText(scene, MARGIN + 2, y, '어디로 갈까', { color: CSS.silver });
  y += 15;
  addStageCards(scene, handlers, refreshers, refresh, y);
  y += STAGE_CARD.height + 4;
  const stageBlurb = addText(scene, GAME_WIDTH / 2, y, '', { color: CSS.silver, originX: 0.5, size: FONT_SIZE.small });
  refreshers.push(() => stageBlurb.setText(STAGES[handlers.getMeta().stage].blurb));

  new PixelButton(scene, {
    x: MARGIN,
    y: upgradeTop,
    width: ROW_WIDTH,
    height: UPGRADE_BUTTON_HEIGHT,
    label: '영구 강화 사러 가기',
    style: 'yellow',
    onTap: () => handlers.onPage('upgrades'),
  });

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

/** 고른 캐릭터가 고른 스테이지에서 그곳의 적에게 둘러싸여 있는 미리보기 */
function addShowcase(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  top: number,
  height: number,
): void {
  const frame = scene.add.graphics();
  drawPanel(frame, MARGIN, top, ROW_WIDTH, height, { fill: COLOR.ink, border: COLOR.navy, shadow: null, radius: 6 });
  const inset = 4;
  const floor = scene.add
    .tileSprite(MARGIN + inset, top + inset, ROW_WIDTH - inset * 2, height - inset * 2, FLOOR_OF.meadow)
    .setOrigin(0, 0);
  const centerX = GAME_WIDTH / 2;
  const centerY = top + height / 2 + 2;
  // 등불 빛
  const glow = scene.add.graphics();
  glow.fillStyle(COLOR.yellow, 0.07).fillCircle(centerX, centerY, 30);
  glow.fillStyle(COLOR.yellow, 0.08).fillCircle(centerX, centerY, 19);
  const hero = scene.add.image(centerX, centerY, HERO_FRAMES.keeper[0]).setScale(2);
  // 왼쪽과 오른쪽에서 다가오는 적들. 스테이지의 등장표 차례대로 둔다.
  const spots: Array<[number, number]> = [
    [-84, -8],
    [-56, 12],
    [58, -12],
    [86, 9],
  ];
  const foes = spots.map(([dx, dy]) => scene.add.image(centerX + dx, centerY + dy, LK.shade[0]));
  let step = 0;
  const draw = (): void => {
    const meta = handlers.getMeta();
    const spawns = STAGES[meta.stage].spawns;
    floor.setTexture(FLOOR_OF[meta.stage]);
    hero.setTexture(HERO_FRAMES[meta.hero][step % 2]);
    foes.forEach((foe, index) => {
      foe.setTexture(LK[spawns[index % spawns.length].kind][(step + index) % 2]);
      // 가운데를 보게 한다.
      foe.setFlipX(foe.x > centerX);
    });
  };
  refreshers.push(draw);
  scene.time.addEvent({
    delay: 320,
    loop: true,
    callback: () => {
      step += 1;
      draw();
    },
  });
}

function addHeroCards(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  refresh: () => void,
  top: number,
): void {
  HERO_ORDER.forEach((id: HeroId, index) => {
    const hero = HEROES[id];
    const x = Math.round(MARGIN + index * (HERO_CARD.width + CARD_GAP));
    const open = isUnlocked(hero, handlers.getMeta().bestSeconds);
    const frame = scene.add.graphics();
    const draw = (pressed: boolean): void => {
      const chosen = handlers.getMeta().hero === id;
      frame.clear();
      drawPanel(frame, x, top, HERO_CARD.width, HERO_CARD.height, {
        fill: pressed ? COLOR.navy : chosen ? COLOR.navy : COLOR.charcoal,
        border: chosen ? COLOR.yellow : COLOR.slate,
        shadow: COLOR.ink,
      });
    };
    const centerX = x + HERO_CARD.width / 2;
    const sprite = scene.add.image(centerX, top + 24, HERO_FRAMES[id][0]).setScale(2);
    if (open) {
      addText(scene, centerX, top + 43, hero.name, { color: CSS.white, bold: true, originX: 0.5 });
    } else {
      // 잠긴 캐릭터는 그림자로만 보이고, 여는 조건을 적어 둔다.
      sprite.setTint(COLOR.ink).setTintMode(Phaser.TintModes.FILL).setAlpha(0.7);
      scene.add.image(centerX, top + 24, 'icon-lock');
      addText(scene, centerX, top + 45, `${formatClock(hero.unlockSeconds)} 버티기`, {
        color: CSS.silver,
        size: FONT_SIZE.small,
        originX: 0.5,
      });
    }
    refreshers.push(() => draw(false));
    addTapZone(scene, x, top, HERO_CARD.width, HERO_CARD.height, draw, () => {
      const before = handlers.getMeta();
      const after = chooseHero(before, id);
      if (!open) sfx.deny();
      else if (after !== before) {
        handlers.setMeta(after);
        sfx.click();
      }
      refresh();
    });
  });
}

/** 고른 캐릭터의 시작 무기와 고유 특성 */
function addHeroDetail(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  top: number,
): void {
  const panel = scene.add.graphics();
  drawPanel(panel, MARGIN, top, ROW_WIDTH, DETAIL_HEIGHT, { fill: COLOR.ink, border: COLOR.navy, shadow: null });
  const tile = scene.add.graphics();
  drawPanel(tile, MARGIN + 8, top + 6, 36, 32, { fill: COLOR.navy, shadow: null, radius: 8 });
  const icon = scene.add.image(MARGIN + 26, top + 22, iconKey('ember')).setScale(1.5);
  const weapon = addText(scene, MARGIN + 26, top + 39, '', {
    color: CSS.yellow,
    size: FONT_SIZE.small,
    originX: 0.5,
  });
  const textLeft = MARGIN + 52;
  const blurb = addText(scene, textLeft, top + 5, '', { color: CSS.white, bold: true });
  const perk = addText(scene, textLeft, top + 21, '', { color: CSS.cyan });
  const flaw = addText(scene, textLeft, top + 36, '', { color: CSS.orange });
  refreshers.push(() => {
    const hero = HEROES[handlers.getMeta().hero];
    icon.setTexture(iconKey(hero.weapon));
    weapon.setText(WEAPONS[hero.weapon].name);
    blurb.setText(hero.blurb);
    perk.setText(hero.perk);
    // 치르는 값이 없으면 좋은 점을 가운데 줄에 둔다.
    flaw.setText(hero.flaw ?? '');
    perk.setY(top + (hero.flaw ? 21 : 28));
    blurb.setY(top + (hero.flaw ? 5 : 9));
  });
}

function addStageCards(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  refresh: () => void,
  top: number,
): void {
  STAGE_ORDER.forEach((id: StageId, index) => {
    const stage = STAGES[id];
    const x = Math.round(MARGIN + index * (STAGE_CARD.width + CARD_GAP));
    const open = isUnlocked(stage, handlers.getMeta().bestSeconds);
    const frame = scene.add.graphics();
    const draw = (pressed: boolean): void => {
      const chosen = handlers.getMeta().stage === id;
      frame.clear();
      drawPanel(frame, x, top, STAGE_CARD.width, STAGE_CARD.height, {
        fill: pressed ? COLOR.navy : chosen ? COLOR.navy : COLOR.charcoal,
        border: chosen ? COLOR.yellow : COLOR.slate,
        shadow: COLOR.ink,
      });
    };
    // 그 스테이지의 바닥과 거기 사는 적을 작은 창으로 보여 준다.
    const swatch = scene.add
      .tileSprite(x + 7, top + 7, 24, 24, FLOOR_OF[id])
      .setOrigin(0, 0)
      .setAlpha(open ? 1 : 0.35);
    const rim = scene.add.graphics();
    rim.lineStyle(1, COLOR.ink, 1).strokeRect(swatch.x - 0.5, swatch.y - 0.5, 25, 25);
    const textX = x + 37;
    if (open) {
      scene.add.image(swatch.x + 12, swatch.y + 13, LK[stage.spawns[0].kind][0]);
      addText(scene, textX, top + 12, stage.name, { color: CSS.white, bold: true });
    } else {
      scene.add.image(swatch.x + 12, swatch.y + 12, 'icon-lock');
      addText(scene, textX, top + 5, stage.name, { color: CSS.silver, bold: true });
      addText(scene, textX, top + 21, `${formatClock(stage.unlockSeconds)} 버티기`, {
        color: CSS.silver,
        size: FONT_SIZE.small,
      });
    }
    refreshers.push(() => draw(false));
    addTapZone(scene, x, top, STAGE_CARD.width, STAGE_CARD.height, draw, () => {
      const before = handlers.getMeta();
      const after = chooseStage(before, id);
      if (!open) sfx.deny();
      else if (after !== before) {
        handlers.setMeta(after);
        sfx.click();
      }
      refresh();
    });
  });
}

// ---------------------------------------------------------------- 영구 강화를 사는 쪽

const UPGRADE_ROW = { top: 70, height: 32, gap: 3 } as const;

function addUpgradeRows(
  scene: Phaser.Scene,
  handlers: LobbyHandlers,
  refreshers: Array<() => void>,
  refresh: () => void,
): void {
  META_ORDER.forEach((id: MetaId, index) => {
    const item = META[id];
    const y = UPGRADE_ROW.top + index * (UPGRADE_ROW.height + UPGRADE_ROW.gap);
    const panel = scene.add.graphics();
    drawPanel(panel, MARGIN, y, ROW_WIDTH, UPGRADE_ROW.height, DARK_PANEL);
    const name = addText(scene, MARGIN + 8, y + 3, item.name, { bold: true, color: CSS.white });
    addText(scene, MARGIN + 8, y + 17, item.perLevel, { color: CSS.silver, size: FONT_SIZE.small });
    const pips = scene.add.graphics();
    const pipsLeft = Math.round(name.x + name.width) + 6;

    const button = new PixelButton(scene, {
      x: MARGIN + ROW_WIDTH - BUY_WIDTH - 5,
      y: y + 4,
      width: BUY_WIDTH,
      height: 22,
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
        pips.fillRect(pipsLeft + i * 6, y + 7, 4, 4);
      }
      if (cost === null) {
        button.setLabel('최대').setStyle('neutral').setEnabled(false);
      } else {
        const affordable = current.embers >= cost;
        button.setLabel(`불씨 ${cost}`).setStyle(affordable ? 'yellow' : 'neutral').setEnabled(affordable);
      }
    });
  });
}
