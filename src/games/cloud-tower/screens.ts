/**
 * 싸움 밖의 화면들: 준비 화면, 갈림길, 보상, 쉼터, 가게, 보물 상자, 수상한 길, 덱 고르기.
 * 화면마다 판(RunState)을 읽어 그리고, 누르면 run.ts의 함수로 판을 바꾼 뒤 hooks.next()로 다음 화면을 연다.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { sfx } from '../../core/sfx';
import { addText, drawPanel, PixelButton } from '../../core/ui';
import { nodeTexture, TEX, treasureTexture, upgradeTexture } from './art';
import type { Card } from './battle';
import {
  addCardRow,
  addHeading,
  addPill,
  addWideRow,
  CARD_ROW_HEIGHT,
  drawSky,
  drawTopBar,
  MARGIN,
  PagedList,
  TOP_BAR,
  WIDTH,
} from './bits';
import {
  ACT_NAMES,
  CARDS,
  EVENTS,
  TOP_FLOOR,
  TREASURES,
  UPGRADE_ORDER,
  UPGRADES,
  type TreasureId,
  type UpgradeId,
} from './data';
import {
  actOf,
  buyCard,
  buyTreasure,
  buyUpgrade,
  canChoose,
  canRemove,
  canRest,
  choiceNeedsCard,
  chooseEvent,
  finishNode,
  floorInAct,
  leaveEvent,
  levelOf,
  removePrice,
  rest,
  restAmount,
  restUpgrade,
  rewardDone,
  shopRemove,
  takeBossTreasure,
  takeRewardCard,
  upgradable,
  upgradeCost,
  type RunState,
  type TowerMeta,
} from './run';
import { cardName } from './text';

export interface ScreenHooks {
  /** 판이 바뀌었으니 저장하고 판의 지금 화면을 다시 연다. */
  next: () => void;
  /** 저장만 한다(같은 화면에 머문다). */
  save: () => void;
}

export const SCREEN_TEXT = {
  start: '출발!',
  resume: '이어하기',
  giveUp: '포기',
  giveUpAgain: '한 번 더 누르면 포기해요',
  intro: '카드로 싸우며 구름 탑을 올라요.\n판이 끝나면 구름 조각으로 강화해요.',
  upgradeHint: '강화를 누르면 설명이 보여요',
  pickRoad: '어느 길로 갈까요?',
  deck: '덱',
  pickCard: '카드를 하나 골라 덱에 넣어요',
  skip: '건너뛰기',
  pickBoss: '대장의 보물을 하나 골라요',
  leave: '떠나기',
  onward: '계속',
  back: '뒤로',
  close: '닫기',
  restTitle: '쉼터',
  restHint: '쉬거나, 카드 하나를 강화해요',
  restUpgrade: '카드 강화',
  noRest: '졸린 달 때문에 쉴 수 없어요',
  pickUpgrade: '강화할 카드를 골라요',
  shopTitle: '구름 가게',
  remove: '카드 빼기',
  removeHint: '덱에서 뺄 카드를 골라요',
  removeDone: '이 가게에서는 이미 뺐어요',
  chestTitle: '보물 상자',
} as const;

// ───────── 준비 화면 ─────────

export interface LobbyHooks {
  getMeta: () => TowerMeta;
  setMeta: (meta: TowerMeta) => void;
  onStart: () => void;
  onResume: () => void;
  onGiveUp: () => void;
  onBack: () => void;
}

const UPGRADE_ROW = { height: 36, gap: 4 } as const;

export function buildLobby(scene: Phaser.Scene, hooks: LobbyHooks): void {
  const { height } = scene.scale;
  let meta = hooks.getMeta();
  drawSky(scene, 0);
  new PixelButton(scene, { x: 8, y: 8, width: 26, height: 26, icon: 'icon-back', hitPadding: 6, onTap: hooks.onBack });
  addText(scene, 42, 21, '구름 탑 모험', { size: 16, originY: 0.5 });
  let shardLeft = 0;
  let shardObjects: Phaser.GameObjects.GameObject[] = [];
  const drawShards = (): void => {
    for (const object of shardObjects) object.destroy();
    const before = scene.children.list.length;
    shardLeft = addPill(scene, GAME_WIDTH - MARGIN, 10, TEX.shard, String(meta.shards), THEME_CSS.accent);
    shardObjects = scene.children.list.slice(before);
  };
  drawShards();
  void shardLeft;

  // 기록 칸
  drawPanel(scene.add.graphics(), MARGIN, 40, WIDTH, 30, { depth: 2, radius: 10 });
  if (meta.runs > 0) {
    addText(scene, MARGIN + 10, 55, meta.wins > 0 ? `꼭대기 ${meta.wins}번` : `최고 ${meta.best}층`, { color: THEME_CSS.accent, originY: 0.5 });
    addText(scene, GAME_WIDTH - MARGIN - 10, 55, `${meta.runs}판 · 최고 ${meta.best}층`, {
      size: 10,
      color: THEME_CSS.sub,
      originX: 1,
      originY: 0.5,
    });
  } else {
    addText(scene, GAME_WIDTH / 2, 55, SCREEN_TEXT.intro, {
      size: 10,
      color: THEME_CSS.sub,
      originX: 0.5,
      originY: 0.5,
      align: 'center',
      lineSpacing: 1,
    });
  }

  const footTop = height - 8 - 36;
  const infoTop = footTop - 34;
  const infoPanel = scene.add.graphics();
  drawPanel(infoPanel, MARGIN, infoTop, WIDTH, 28, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, infoTop + 14, SCREEN_TEXT.upgradeHint, {
    size: 10,
    color: THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
    lineSpacing: 0,
  });
  let picked: UpgradeId | null = null;

  const list = new PagedList<UpgradeId>(scene, UPGRADE_ORDER, 78, infoTop - 4, UPGRADE_ROW.height, UPGRADE_ROW.gap, (id, y) => {
    const level = levelOf(meta.levels, id);
    const cost = upgradeCost(meta.levels, id);
    const affordable = cost !== null && meta.shards >= cost;
    const def = UPGRADES[id];
    const objects = addWideRow(scene, {
      y,
      height: UPGRADE_ROW.height,
      texture: upgradeTexture(id),
      // 한 단계뿐인 강화는 단계를 적지 않는다(아래 줄의 "열림"이나 "닫힘"으로 안다).
      title: def.costs.length === 1 ? def.name : `${def.name} ${level >= def.costs.length ? '끝' : `${level}단계`}`,
      note: def.effect(level),
      side: cost === null ? '다 올림' : `조각 ${cost}`,
      sideColor: cost === null ? THEME_CSS.good : affordable ? THEME_CSS.accent : THEME_CSS.faint,
      border: picked === id ? THEME.pinkDeep : undefined,
      onTap: () => {
        picked = id;
        const next = buyUpgrade(meta, id);
        if (next === meta) {
          if (cost !== null) sfx.deny();
          info.setText(def.blurb);
        } else {
          sfx.coin();
          meta = next;
          hooks.setMeta(meta);
          info.setText(`${def.name}: ${def.effect(levelOf(meta.levels, id))}`);
          drawShards();
        }
        list.show(list.current);
      },
    });
    return objects;
  });

  const run = meta.run;
  if (run) {
    let armed = false;
    const giveUp = new PixelButton(scene, {
      x: MARGIN,
      y: footTop,
      width: 64,
      height: 36,
      label: SCREEN_TEXT.giveUp,
      onTap: () => {
        if (!armed) {
          armed = true;
          giveUp.setStyle('red');
          info.setText(SCREEN_TEXT.giveUpAgain);
          return;
        }
        hooks.onGiveUp();
      },
    });
    new PixelButton(scene, {
      x: MARGIN + 70,
      y: footTop,
      width: WIDTH - 70,
      height: 36,
      label: `${SCREEN_TEXT.resume} (${Math.max(1, run.floor)}층)`,
      style: 'pink',
      onTap: hooks.onResume,
    });
  } else {
    new PixelButton(scene, { x: MARGIN, y: footTop, width: WIDTH, height: 36, label: SCREEN_TEXT.start, style: 'pink', onTap: hooks.onStart });
  }
}

/** 가진 보물을 한 줄로. 누르면 이름과 설명이 잠깐 뜬다. */
export function drawTreasureStrip(scene: Phaser.Scene, treasures: readonly TreasureId[], top: number): void {
  if (treasures.length === 0) return;
  const step = Math.min(26, WIDTH / treasures.length);
  let note: Phaser.GameObjects.Text | null = null;
  treasures.forEach((id, index) => {
    const x = MARGIN + 12 + index * step;
    const image = scene.add.image(x, top + 12, treasureTexture(id)).setInteractive({ useHandCursor: true });
    image.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      note?.destroy();
      const text = addText(scene, GAME_WIDTH / 2, top - 6, `${TREASURES[id].name}: ${TREASURES[id].blurb}`, {
        size: 10,
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 1,
        align: 'center',
        wrapWidth: WIDTH,
        stroke: THEME_CSS.white,
      }).setDepth(5);
      note = text;
      scene.tweens.add({ targets: text, alpha: 0, delay: 2600, duration: 400, onComplete: () => text.destroy() });
    });
  });
}

// ───────── 덱 고르기 ─────────

export interface PickerOptions {
  title: string;
  sub?: string;
  cards: readonly Card[];
  /** 보여 줄 모습: 강화를 고를 때는 강화한 모습을 보인다. */
  showUp?: boolean;
  onPick: ((card: Card) => void) | null;
  onClose: () => void;
  closeLabel?: string;
}

/** 덱의 카드를 쪽으로 나눠 보여 주는 화면. onPick이 있으면 카드를 눌러 고른다. */
export function buildPicker(scene: Phaser.Scene, run: RunState, options: PickerOptions): void {
  const { height } = scene.scale;
  drawSky(scene, actOf(Math.max(1, run.floor)));
  drawTopBar(scene, run);
  addHeading(scene, TOP_BAR + 14, options.title, options.sub);
  const sorted = [...options.cards].sort(
    (a, b) => typeOrder(a) - typeOrder(b) || CARDS[a.id].name.localeCompare(CARDS[b.id].name) || Number(a.up) - Number(b.up),
  );
  const footTop = height - 44;
  new PagedList<Card>(scene, sorted, TOP_BAR + (options.sub ? 44 : 32), footTop - 4, CARD_ROW_HEIGHT, 4, (card, y) =>
    addCardRow(scene, {
      x: MARGIN,
      y,
      width: WIDTH,
      id: card.id,
      up: options.showUp ? true : card.up,
      onTap: options.onPick
        ? () => {
            sfx.click();
            options.onPick?.(card);
          }
        : undefined,
    }),
  );
  new PixelButton(scene, { x: MARGIN, y: footTop, width: WIDTH, height: 34, label: options.closeLabel ?? SCREEN_TEXT.close, onTap: options.onClose });
}

const typeOrder = (card: Card): number => ['attack', 'skill', 'power'].indexOf(CARDS[card.id].type);

// ───────── 보상 ─────────

export function buildReward(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks): void {
  const { height } = scene.scale;
  const reward = run.reward;
  drawSky(scene, actOf(run.floor));
  drawTopBar(scene, run);
  if (!reward || rewardDone(run)) {
    finishNode(run);
    hooks.next();
    return;
  }
  const gotLines = [`별사탕 +${reward.gold}`];
  if (reward.treasure) gotLines.push(`보물: ${TREASURES[reward.treasure].name}`);
  addHeading(scene, TOP_BAR + 16, '이겼어요!', gotLines.join(' · '));
  let top = TOP_BAR + 46;
  if (reward.treasure) {
    addWideRow(scene, {
      y: top,
      height: 40,
      texture: treasureTexture(reward.treasure),
      title: TREASURES[reward.treasure].name,
      note: TREASURES[reward.treasure].blurb,
      fill: THEME.butterSoft,
    });
    top += 48;
  }
  const footTop = height - 44;
  if (reward.bossPick) {
    addText(scene, GAME_WIDTH / 2, top + 6, SCREEN_TEXT.pickBoss, { color: THEME_CSS.inkDeep, originX: 0.5, originY: 0.5 });
    reward.bossPick.forEach((id, index) => {
      addWideRow(scene, {
        y: top + 18 + index * 56,
        height: 50,
        texture: treasureTexture(id),
        title: TREASURES[id].name,
        note: TREASURES[id].blurb,
        onTap: () => {
          if (takeBossTreasure(run, index)) {
            sfx.gold();
            hooks.next();
          }
        },
      });
    });
    return;
  }
  if (reward.cards) {
    addText(scene, GAME_WIDTH / 2, top + 6, SCREEN_TEXT.pickCard, { color: THEME_CSS.inkDeep, originX: 0.5, originY: 0.5 });
    const rowHeight = Math.min(52, Math.floor((footTop - top - 24) / reward.cards.length) - 6);
    reward.cards.forEach((id, index) => {
      addCardRow(scene, {
        x: MARGIN,
        y: top + 18 + index * (rowHeight + 6),
        width: WIDTH,
        height: rowHeight,
        id,
        up: false,
        onTap: () => {
          if (takeRewardCard(run, index)) {
            sfx.gold();
            hooks.next();
          }
        },
      });
    });
    new PixelButton(scene, {
      x: MARGIN,
      y: footTop,
      width: WIDTH,
      height: 34,
      label: SCREEN_TEXT.skip,
      onTap: () => {
        takeRewardCard(run, null);
        hooks.next();
      },
    });
  }
}

// ───────── 쉼터 ─────────

export function buildRest(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks & { pickUpgrade: () => void }): void {
  drawSky(scene, actOf(run.floor));
  drawTopBar(scene, run);
  addHeading(scene, TOP_BAR + 18, SCREEN_TEXT.restTitle, SCREEN_TEXT.restHint);
  const art = scene.add.image(GAME_WIDTH / 2, TOP_BAR + 80, nodeTexture('rest')).setScale(2.4);
  scene.tweens.add({ targets: art, y: art.y - 4, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.InOut' });
  const top = TOP_BAR + 126;
  const canSleep = canRest(run);
  const amount = Math.min(restAmount(run), run.maxHp - run.hp);
  addWideRow(scene, {
    y: top,
    height: 56,
    texture: TEX.heart,
    title: '쉬기',
    note: canSleep ? `체력 ${amount} 회복 (최대 체력의 ${run.restPercent}%)` : SCREEN_TEXT.noRest,
    dim: !canSleep,
    onTap: () => {
      if (!canSleep) {
        sfx.deny();
        return;
      }
      if (rest(run)) {
        sfx.gold();
        hooks.next();
      }
    },
  });
  const cards = upgradable(run);
  addWideRow(scene, {
    y: top + 66,
    height: 56,
    texture: upgradeTexture('pack1'),
    title: SCREEN_TEXT.restUpgrade,
    note: cards.length > 0 ? '덱의 카드 하나를 더 세게' : '강화할 카드가 없어요',
    dim: cards.length === 0,
    onTap: () => {
      if (cards.length === 0) {
        sfx.deny();
        return;
      }
      hooks.pickUpgrade();
    },
  });
  if (!canSleep && cards.length === 0) {
    new PixelButton(scene, {
      x: MARGIN,
      y: scene.scale.height - 44,
      width: WIDTH,
      height: 34,
      label: SCREEN_TEXT.leave,
      onTap: () => {
        finishNode(run);
        hooks.next();
      },
    });
  }
}

export function upgradePicker(run: RunState, hooks: ScreenHooks, back: () => void): PickerOptions {
  return {
    title: SCREEN_TEXT.pickUpgrade,
    sub: '강화한 모습이 보여요',
    cards: upgradable(run),
    showUp: true,
    onPick: (card) => {
      if (restUpgrade(run, card.uid)) {
        sfx.gold();
        hooks.next();
      }
    },
    onClose: back,
    closeLabel: SCREEN_TEXT.back,
  };
}

// ───────── 가게 ─────────

type ShopEntry = { kind: 'card'; index: number } | { kind: 'treasure'; index: number } | { kind: 'remove' };

export function buildShop(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks & { pickRemove: () => void }, page = 0, onPage?: (page: number) => void): void {
  const { height } = scene.scale;
  const shop = run.shop;
  drawSky(scene, actOf(run.floor));
  drawTopBar(scene, run);
  addHeading(scene, TOP_BAR + 12, SCREEN_TEXT.shopTitle);
  if (!shop) return;
  const entries: ShopEntry[] = [
    ...shop.cards.map((_, index) => ({ kind: 'card', index }) as const),
    ...shop.treasures.map((_, index) => ({ kind: 'treasure', index }) as const),
    { kind: 'remove' },
  ];
  const footTop = height - 44;
  let list: PagedList<ShopEntry> | null = null;
  const redraw = (): void => {
    // 별사탕이 바뀌었으니 화면을 통째로 다시 연다(위쪽 줄도 바뀐다).
    onPage?.(list?.current ?? 0);
    hooks.next();
  };
  list = new PagedList<ShopEntry>(
    scene,
    entries,
    TOP_BAR + 26,
    footTop - 4,
    CARD_ROW_HEIGHT,
    4,
    (entry, y) => {
      if (entry.kind === 'card') {
        const item = shop.cards[entry.index];
        const objects = addCardRow(scene, {
          x: MARGIN,
          y,
          width: WIDTH,
          id: item.id,
          up: false,
          right: 40,
          dim: item.sold,
          onTap: () => {
            if (buyCard(run, entry.index)) {
              sfx.coin();
              redraw();
            } else sfx.deny();
          },
        });
        objects.push(priceTag(scene, y, item.sold ? '팔림' : String(item.price), !item.sold && run.gold >= item.price));
        return objects;
      }
      if (entry.kind === 'treasure') {
        const item = shop.treasures[entry.index];
        return addWideRow(scene, {
          y,
          height: CARD_ROW_HEIGHT,
          texture: treasureTexture(item.id),
          title: TREASURES[item.id].name,
          note: TREASURES[item.id].blurb,
          side: item.sold ? '팔림' : String(item.price),
          sideColor: !item.sold && run.gold >= item.price ? THEME_CSS.accent : THEME_CSS.faint,
          dim: item.sold,
          onTap: () => {
            if (buyTreasure(run, entry.index)) {
              sfx.coin();
              redraw();
            } else sfx.deny();
          },
        });
      }
      const price = removePrice(run);
      const able = !shop.removed && run.gold >= price && canRemove(run);
      return addWideRow(scene, {
        y,
        height: CARD_ROW_HEIGHT,
        texture: TEX.discard,
        title: SCREEN_TEXT.remove,
        note: shop.removed ? SCREEN_TEXT.removeDone : '덱에서 카드 한 장을 빼요',
        side: shop.removed ? '끝' : String(price),
        sideColor: able ? THEME_CSS.accent : THEME_CSS.faint,
        dim: shop.removed,
        onTap: () => {
          if (able) hooks.pickRemove();
          else sfx.deny();
        },
      });
    },
    page,
  );
  new PixelButton(scene, {
    x: MARGIN,
    y: footTop,
    width: WIDTH,
    height: 34,
    label: SCREEN_TEXT.leave,
    style: 'pink',
    onTap: () => {
      finishNode(run);
      hooks.next();
    },
  });
}

function priceTag(scene: Phaser.Scene, y: number, label: string, affordable: boolean): Phaser.GameObjects.GameObject {
  return addText(scene, GAME_WIDTH - MARGIN - 8, y + CARD_ROW_HEIGHT / 2, label, {
    color: affordable ? THEME_CSS.accent : THEME_CSS.faint,
    originX: 1,
    originY: 0.5,
  });
}

export function removePicker(run: RunState, back: () => void): PickerOptions {
  return {
    title: SCREEN_TEXT.removeHint,
    sub: `값은 별사탕 ${removePrice(run)}개예요`,
    cards: run.deck,
    onPick: (card) => {
      if (shopRemove(run, card.uid)) {
        sfx.pop();
        back();
      }
    },
    onClose: back,
    closeLabel: SCREEN_TEXT.back,
  };
}

// ───────── 보물 상자 ─────────

export function buildChest(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks): void {
  const { height } = scene.scale;
  drawSky(scene, actOf(run.floor));
  drawTopBar(scene, run);
  addHeading(scene, TOP_BAR + 18, SCREEN_TEXT.chestTitle);
  const id = run.reward?.treasure ?? null;
  const art = scene.add.image(GAME_WIDTH / 2, TOP_BAR + 90, id ? treasureTexture(id) : TEX.candy).setScale(0.2);
  scene.tweens.add({ targets: art, scale: 3, duration: 420, ease: 'Back.Out' });
  sfx.fanfare();
  addText(scene, GAME_WIDTH / 2, TOP_BAR + 150, id ? TREASURES[id].name : `별사탕 ${run.reward?.gold ?? 0}개`, {
    size: 16,
    color: THEME_CSS.inkDeep,
    originX: 0.5,
    originY: 0.5,
  });
  addText(scene, GAME_WIDTH / 2, TOP_BAR + 172, id ? TREASURES[id].blurb : '보물을 다 모아서 별사탕이 들어 있었어요', {
    size: 11,
    color: THEME_CSS.sub,
    originX: 0.5,
    originY: 0,
    align: 'center',
    wrapWidth: WIDTH - 20,
  });
  new PixelButton(scene, {
    x: MARGIN,
    y: height - 44,
    width: WIDTH,
    height: 34,
    label: SCREEN_TEXT.onward,
    style: 'pink',
    onTap: () => {
      finishNode(run);
      hooks.next();
    },
  });
}

// ───────── 수상한 길 ─────────

export function buildEvent(scene: Phaser.Scene, run: RunState, hooks: ScreenHooks & { pickCard: (choice: number) => void }): void {
  const { height } = scene.scale;
  drawSky(scene, actOf(run.floor));
  drawTopBar(scene, run);
  const id = run.event;
  if (!id) return;
  const def = EVENTS[id];
  addHeading(scene, TOP_BAR + 18, def.title);
  scene.add.image(GAME_WIDTH / 2, TOP_BAR + 62, nodeTexture('event')).setScale(1.6);
  const story = drawPanel(scene.add.graphics(), MARGIN, TOP_BAR + 86, WIDTH, 50, { radius: 10, depth: 2 });
  void story;
  addText(scene, GAME_WIDTH / 2, TOP_BAR + 111, run.eventResult ?? def.story, {
    size: 11,
    color: run.eventResult ? THEME_CSS.accent : THEME_CSS.ink,
    originX: 0.5,
    originY: 0.5,
    align: 'center',
    wrapWidth: WIDTH - 16,
  });
  if (run.eventResult !== null) {
    new PixelButton(scene, {
      x: MARGIN,
      y: height - 44,
      width: WIDTH,
      height: 34,
      label: SCREEN_TEXT.onward,
      style: 'pink',
      onTap: () => {
        if (leaveEvent(run)) hooks.next();
      },
    });
    return;
  }
  def.choices.forEach((choice, index) => {
    const able = canChoose(run, index);
    addWideRow(scene, {
      y: TOP_BAR + 148 + index * 58,
      height: 50,
      title: choice.label,
      note: choice.note,
      dim: !able,
      onTap: () => {
        if (!able) {
          sfx.deny();
          return;
        }
        if (choiceNeedsCard(run, index)) {
          hooks.pickCard(index);
          return;
        }
        if (chooseEvent(run, index)) {
          sfx.pop();
          hooks.next();
        }
      },
    });
  });
}

export function eventPicker(run: RunState, choice: number, hooks: ScreenHooks, back: () => void): PickerOptions {
  return {
    title: SCREEN_TEXT.removeHint,
    cards: run.deck,
    onPick: (card) => {
      if (chooseEvent(run, choice, card.uid)) {
        sfx.pop();
        hooks.next();
      }
    },
    onClose: back,
    closeLabel: SCREEN_TEXT.back,
  };
}

/** 마친 층 수에서 다음으로 열릴 구역의 이름(결과 화면의 한 줄) */
export function towerProgressLine(cleared: number): string {
  if (cleared >= TOP_FLOOR) return '꼭대기에 닿았어요!';
  return `${ACT_NAMES[actOf(cleared + 1)]} ${floorInAct(cleared + 1)}층에서 멈췄어요`;
}

export { cardName };
