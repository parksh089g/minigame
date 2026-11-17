/**
 * 영구 해금의 화면: 시작 화면의 버튼과 그 아래의 한 줄, 해금과 유물의 창, 판이 끝났을 때 받은 조각을 알리는 글.
 * 창은 두 쪽("해금", "유물")으로 나뉘고, 유물 쪽의 줄들은 relic-views.ts가 놓는다.
 * 무엇을 얼마에 여는지와 적는 글은 perks.ts와 relics.ts가 정하고, 여기서는 그리고 누름을 받기만 한다.
 * 세이브를 고치는 일은 씬이 넘겨준 함수(PerkPanelHost)에 맡긴다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { LOOK, PERK_BOX, perkTexture, PIECE_ICON, pieceTexture } from './art';
import { isUnlocked, perkHint, PERKS, PERK_TEXT, shortNotice, unlockBlock, unlockedNotice, type UnlockBlock } from './perks';
import { buildRelicBody } from './relic-views';
import { canSpend, keepLabel, RELIC_TEXT, startTab, type KeepState, type KeepTab, type RaiseBlock } from './relics';
import type { Box, PerkId, RelicId } from './rules';

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** 그 글을 그 크기로 적었을 때의 폭(논리 픽셀, 올림). 버튼을 놓기 전에 자리를 잡을 때 쓴다. */
export function textWidth(scene: Phaser.Scene, label: string, size: number = FONT_SIZE.normal): number {
  const probe = addText(scene, 0, 0, label, { size }).setVisible(false);
  const width = Math.ceil(probe.width);
  probe.destroy();
  return width;
}

// ───────── 시작 화면의 버튼 ─────────

/** "해금 1/4"(해금을 다 열었으면 "유물 12/40")가 적힌 작은 버튼 */
export interface PerkButton extends Disposable {
  /** 적힌 수와, 살 수 있는 것이 있다는 표시를 다시 맞춘다. */
  refresh(): void;
  /** 흐려지며 사라진다. */
  fade(): void;
}

/** 버튼의 글 양옆에 두는 여백을 더한 것. 도감 버튼(CandySlotScene의 addBookButton)과 같다. */
export const PERK_BUTTON_PAD = 18;

/**
 * 도감 버튼과 같은 모양의 작은 금빛 버튼을 놓는다. 누르면 onTap이 불린다.
 * 지금 가진 조각으로 살 수 있는 것이 있으면(relics.ts의 canSpend) 오른쪽 위에 작은 빨간 점이 달린다.
 * centerX는 버튼의 가운데, top은 위쪽 끝이다.
 */
export function addPerkButton(
  scene: Phaser.Scene,
  centerX: number,
  top: number,
  height: number,
  depth: number,
  state: () => KeepState,
  onTap: () => void,
): PerkButton {
  const back = scene.add.graphics().setDepth(depth);
  const label = addText(scene, Math.round(centerX), Math.round(top + height / 2), '', {
    color: LOOK.text.ink,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth + 0.5);
  let pressed = false;
  let gone = false;
  let width = 0;
  const draw = (): void => {
    if (gone) return;
    const left = Math.round(centerX - width / 2);
    back.clear();
    back.fillStyle(LOOK.machine.trimLip, 1);
    back.fillRoundedRect(left, top, width, height, height / 2);
    back.fillStyle(pressed ? LOOK.machine.bulbOff : LOOK.machine.trim, 1);
    back.fillRoundedRect(left + 1.5, top + 1.5, width - 3, height - 3, (height - 3) / 2);
    if (!canSpend(state())) return;
    // 살 수 있는 것이 있다는 점. 버튼의 오른쪽 위 모서리에 걸친다.
    back.fillStyle(THEME.white, 1);
    back.fillCircle(left + width - 4, top + 3, 5);
    back.fillStyle(THEME.bad, 1);
    back.fillCircle(left + width - 4, top + 3, 3.6);
  };
  const measure = (): void => {
    label.setText(keepLabel(state()));
    width = Math.ceil(label.width) + PERK_BUTTON_PAD;
  };
  measure();
  draw();
  const zone = addTapZone(
    scene,
    Math.round(centerX - width / 2) - 2,
    top,
    width + 4,
    height,
    (down) => {
      pressed = down;
      draw();
    },
    () => {
      sfx.click();
      vibrate(8);
      onTap();
    },
  ).setDepth(depth + 0.5);
  const destroy = (): void => {
    if (gone) return;
    gone = true;
    scene.tweens.killTweensOf([back, label]);
    for (const part of [back, label, zone]) part.destroy();
  };
  return {
    destroy,
    refresh: () => {
      if (gone) return;
      // 글이 바뀌면("해금 4/4"에서 "유물 0/40"으로) 버튼의 폭과 누르는 자리도 따라 바뀐다.
      measure();
      zone.setPosition(Math.round(centerX - width / 2) - 2, top).setSize(width + 4, height);
      draw();
    },
    fade: () => {
      if (gone) return;
      zone.disableInteractive();
      scene.tweens.add({ targets: [back, label], alpha: 0, duration: 200, onComplete: destroy });
    },
  };
}

/** 시작 화면의 버튼 아래에 작게 적는 한 줄(켜져 있는 해금의 수와 유물의 단계). 판에 얹은 작은 알약 모양이다. */
export interface PerkNote extends Disposable {
  fade(): void;
}

export const PERK_NOTE_HEIGHT = 16;

/** top은 알약의 위쪽 끝이다. 화면보다 넓은 글은 그만큼 줄인다. */
export function addPerkNote(scene: Phaser.Scene, top: number, depth: number, label: string): PerkNote {
  const height = PERK_NOTE_HEIGHT;
  const text = addText(scene, GAME_WIDTH / 2, Math.round(top + height / 2), label, {
    size: FONT_SIZE.small,
    color: LOOK.text.ink,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth + 0.5);
  text.setScale(Math.min(1, (GAME_WIDTH - 40) / text.width));
  const width = Math.ceil(text.displayWidth) + 16;
  const x = Math.round(GAME_WIDTH / 2 - width / 2);
  const y = Math.round(text.y - height / 2);
  const back = scene.add.graphics().setDepth(depth);
  back.fillStyle(LOOK.machine.trimLip, 1);
  back.fillRoundedRect(x, y + 1, width, height, height / 2);
  back.fillStyle(LOOK.machine.slotAlt, 1);
  back.fillRoundedRect(x, y, width, height, height / 2);
  let gone = false;
  const destroy = (): void => {
    if (gone) return;
    gone = true;
    scene.tweens.killTweensOf([back, text]);
    back.destroy();
    text.destroy();
  };
  return {
    destroy,
    fade: () => {
      if (!gone) scene.tweens.add({ targets: [back, text], alpha: 0, duration: 200, onComplete: destroy });
    },
  };
}

// ───────── 해금과 유물의 창 ─────────

/** 창이 씬에 맡기는 일 */
export interface PerkPanelHost {
  /** 창이 놓이는 층 */
  depth: number;
  /** 지금 가진 조각과 열어 둔 해금, 유물의 단계 */
  state(): KeepState;
  /** 그 해금을 연다(세이브를 고친다). 열었으면 null, 열지 못했으면 그 까닭을 돌려준다. */
  unlock(id: PerkId): UnlockBlock | null;
  /** 그 유물을 한 단계 올린다(세이브를 고친다). 올렸으면 null, 올리지 못했으면 그 까닭을 돌려준다. */
  raise(id: RelicId): RaiseBlock | null;
  /** 닫기 버튼을 만든다. 씬의 버튼(SoftButton)을 그대로 쓴다. */
  addButton(box: Box, label: string, onTap: () => void): Disposable;
  /** 창 밖이나 닫기 버튼을 눌렀을 때 */
  close(): void;
}

/** 창의 한 쪽(해금 쪽, 유물 쪽)이 줄을 놓을 때 창에서 받는 것 */
export interface PanelFrame {
  scene: Phaser.Scene;
  host: PerkPanelHost;
  depth: number;
  /** 줄들이 놓이는 자리: 머리글 아래부터 맨 아래 한 줄 위까지 */
  body: Box;
  /** 머리글에 적힌 가진 조각. 조각을 썼을 때 톡 튀게 하려고 내준다. */
  owned: Text;
  /** 가진 조각의 수를 다시 적는다. */
  refreshOwned(): void;
}

/**
 * 창의 치수: 창의 폭, 머리글의 높이, 해금 한 줄이 차지하는 높이(줄 사이의 틈 4까지),
 * 알림 한 줄과 맨 아래 한 줄의 높이, 닫기 버튼의 높이
 */
const PANEL = { width: 224, head: 30, row: 42, status: 18, foot: 14, close: 32 } as const;
/** 머리글에 놓는 쪽 이름의 칸 */
const TAB = { width: 46, height: 20, gap: 4 } as const;
/** 줄의 오른쪽에 놓는 값의 알약 */
const PILL = { width: 40, height: 22 } as const;

/** 줄들이 놓이는 자리의 높이. 유물 쪽(relic-views.ts)도 이 안에 놓인다. */
export const PANEL_BODY_HEIGHT = PERKS.length * PANEL.row + 2 + PANEL.status;

/** 창이 차지하는 높이. 화면에 들어가는지 따질 때 쓴다. */
export const PERK_PANEL_HEIGHT = PANEL.head + PANEL_BODY_HEIGHT + PANEL.foot + 8 + PANEL.close + 10;

interface PerkRow {
  id: PerkId;
  box: Box;
  back: Graphics;
  icon: Phaser.GameObjects.Image;
  name: Text;
  description: Text;
  mark: Graphics;
  piece: Phaser.GameObjects.Image;
  price: Text;
  pressed: boolean;
}

/**
 * 해금 쪽: 해금 넷을 늘어놓는다. 줄을 누르면 조각을 내고 열고, 조각이 모자라면 얼마나 모자란지 알린다.
 * 놓은 것들을 돌려주니, 쪽을 바꾸거나 창을 닫을 때 모두 치운다.
 */
function buildPerkBody(frame: PanelFrame): Disposable[] {
  const { scene, host, depth, body } = frame;
  const views: Disposable[] = [];

  const statusY = body.y + PERKS.length * PANEL.row + 2 + PANEL.status / 2;
  const status = addText(scene, GAME_WIDTH / 2, Math.round(statusY), '', {
    size: FONT_SIZE.small,
    color: LOOK.text.sub,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth);
  views.push(status);
  /** 알림 줄에 글을 적는다. 창보다 넓으면 그만큼 줄인다. */
  const say = (label: string, color: string): void => {
    status.setScale(1).setText(label).setColor(color);
    status.setScale(Math.min(1, (body.width - 12) / status.width));
  };

  const drawRow = (row: PerkRow): void => {
    const state = host.state();
    const perk = PERKS.find((item) => item.id === row.id);
    if (!perk) return;
    const { box: at } = row;
    const middle = at.y + at.height / 2;
    const open = isUnlocked(state, row.id);
    const afford = unlockBlock(state, row.id) === null;
    row.back.clear();
    row.back.fillStyle(row.pressed && !open ? THEME.dim : THEME.bg, 1);
    row.back.fillRoundedRect(at.x, at.y, at.width, at.height, 10);
    row.mark.clear();
    row.piece.setVisible(!open);
    if (open) {
      // 연 줄: 값 대신 "열림"과 그 왼쪽의 작은 갈고리 표시
      row.price.setText(PERK_TEXT.open).setColor(LOOK.text.good).setX(at.x + at.width - 9);
      const tick = { x: Math.floor(row.price.x - row.price.width) - 9, y: middle };
      row.mark.lineStyle(2, THEME.good, 1);
      row.mark.beginPath();
      row.mark.moveTo(tick.x - 4, tick.y);
      row.mark.lineTo(tick.x - 1, tick.y + 3);
      row.mark.lineTo(tick.x + 4, tick.y - 3.5);
      row.mark.strokePath();
      return;
    }
    const pill = { x: at.x + at.width - PILL.width - 5, y: middle - PILL.height / 2 };
    row.mark.fillStyle(afford ? THEME.lilacSoft : THEME.dim, 1);
    row.mark.fillRoundedRect(pill.x, pill.y, PILL.width, PILL.height, PILL.height / 2);
    row.piece.setPosition(pill.x + 4 + PIECE_ICON.width / 2, middle).setAlpha(afford ? 1 : 0.5);
    row.price
      .setText(String(perk.price))
      .setColor(afford ? LOOK.text.ink : LOOK.text.bad)
      .setX(pill.x + PILL.width - 5);
  };

  const rows: PerkRow[] = PERKS.map((perk, index) => {
    const at: Box = { x: body.x, y: body.y + index * PANEL.row, width: body.width, height: PANEL.row - 4 };
    const middle = at.y + at.height / 2;
    const textLeft = at.x + 4 + PERK_BOX + 5;
    const row: PerkRow = {
      id: perk.id,
      box: at,
      back: scene.add.graphics().setDepth(depth),
      icon: scene.add.image(at.x + 4 + PERK_BOX / 2, middle, perkTexture(scene, perk.id)).setDepth(depth),
      name: addText(scene, textLeft, middle - 15, perk.name, { color: LOOK.text.ink }).setDepth(depth),
      description: addText(scene, textLeft, middle + 2, perk.description, {
        size: FONT_SIZE.small,
        color: LOOK.text.sub,
      }).setDepth(depth),
      mark: scene.add.graphics().setDepth(depth),
      piece: scene.add.image(0, middle, pieceTexture(scene)).setDepth(depth),
      price: addText(scene, 0, middle, '', { originX: 1, originY: 0.5 }).setDepth(depth),
      pressed: false,
    };
    // 좁은 줄에서 설명이 값에 닿지 않게, 넘치면 그만큼 줄인다.
    const room = at.x + at.width - PILL.width - 5 - 4 - textLeft;
    row.description.setScale(Math.min(1, room / row.description.width));
    const zone = addTapZone(
      scene,
      at.x,
      at.y,
      at.width,
      at.height,
      (pressed) => {
        row.pressed = pressed;
        drawRow(row);
      },
      () => tap(row),
    ).setDepth(depth);
    views.push(row.back, row.icon, row.name, row.description, row.mark, row.piece, row.price, zone);
    return row;
  });

  const refresh = (): void => {
    frame.refreshOwned();
    for (const row of rows) drawRow(row);
  };

  const tap = (row: PerkRow): void => {
    const before = host.state();
    if (isUnlocked(before, row.id)) {
      sfx.click();
      say(PERK_TEXT.owned, LOOK.text.sub);
      return;
    }
    const block = host.unlock(row.id);
    if (block !== null) {
      sfx.deny();
      vibrate(12);
      say(shortNotice(before, row.id), LOOK.text.bad);
      // 모자란 값이 좌우로 흔들린다.
      scene.tweens.killTweensOf(row.price);
      drawRow(row);
      const x = row.price.x;
      scene.tweens.add({ targets: row.price, x: x - 3, duration: 50, yoyo: true, repeat: 2, onComplete: () => row.price.setX(x) });
      return;
    }
    sfx.gold();
    vibrate([15, 30, 15]);
    refresh();
    say(unlockedNotice(row.id), LOOK.text.good);
    // 방금 연 줄의 그림과 "열림"이 톡 튀고, 줄어든 조각의 수도 튄다.
    for (const target of [row.icon, row.price, frame.owned]) {
      scene.tweens.killTweensOf(target);
      scene.tweens.add({ targets: target, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
    }
  };

  refresh();
  say(perkHint(host.state()), LOOK.text.sub);

  // 튀거나 흔들리는 도중에 치워도, 치운 글자를 움직이려 들지 않게 움직임부터 거둔다.
  views.unshift({
    destroy: () => scene.tweens.killTweensOf(rows.flatMap((row) => [row.icon, row.price])),
  });
  return views;
}

/**
 * 해금과 유물의 창을 연다. 화면을 덮는 창의 머리글에 두 쪽의 이름("해금", "유물")과 가진 조각이 놓이고,
 * 이름을 누르면 그 쪽의 줄들로 바뀐다. first는 먼저 보일 쪽이다(주지 않으면 해금이 남아 있는 동안은 해금 쪽).
 * 창에 놓인 것들을 돌려주니, 닫을 때 모두 치운다.
 */
export function openPerkPanel(scene: Phaser.Scene, host: PerkPanelHost, first: KeepTab = startTab(host.state())): Disposable[] {
  const { width: screenWidth, height: screenHeight } = scene.scale;
  const depth = host.depth;
  const height = PERK_PANEL_HEIGHT;
  const box: Box = {
    x: Math.round((GAME_WIDTH - PANEL.width) / 2),
    y: Math.max(4, Math.round((screenHeight - height) / 2)),
    width: PANEL.width,
    height,
  };
  const views: Disposable[] = [];

  // 밑의 것이 눌리지 않게 화면을 덮는다. 창 밖을 누르면 닫히고, 창 안의 빈 곳은 눌러도 그대로다.
  const scrim = scene.add.rectangle(0, 0, screenWidth, screenHeight, THEME.inkDeep, 0.6).setOrigin(0, 0).setDepth(depth);
  const outside = addTapZone(scene, 0, 0, screenWidth, screenHeight, () => undefined, () => host.close()).setDepth(depth);
  const panel = scene.add.graphics().setDepth(depth);
  drawPanel(panel, box.x, box.y, box.width, box.height, { radius: 14 });
  const inside = scene.add.zone(box.x, box.y, box.width, box.height).setOrigin(0, 0).setInteractive().setDepth(depth);
  views.push(scrim, outside, panel, inside);

  // 머리글의 왼쪽: 두 쪽의 이름. 지금 보이는 쪽에 색이 깔린다.
  let current: KeepTab = first;
  const tabBack = scene.add.graphics().setDepth(depth);
  views.push(tabBack);
  const tabs = (['perks', 'relics'] as const).map((tab, index) => {
    const at: Box = { x: box.x + 8 + index * (TAB.width + TAB.gap), y: box.y + 6, width: TAB.width, height: TAB.height };
    const label = addText(
      scene,
      Math.round(at.x + at.width / 2),
      Math.round(at.y + at.height / 2),
      tab === 'perks' ? PERK_TEXT.title : RELIC_TEXT.title,
      { color: LOOK.text.ink, originX: 0.5, originY: 0.5 },
    ).setDepth(depth);
    const zone = addTapZone(
      scene,
      at.x - TAB.gap / 2,
      box.y + 2,
      at.width + TAB.gap,
      PANEL.head - 3,
      () => undefined,
      () => {
        if (tab === current) return;
        sfx.click();
        show(tab);
      },
    ).setDepth(depth);
    views.push(label, zone);
    return { tab, at, label };
  });
  const drawTabs = (): void => {
    tabBack.clear();
    for (const { tab, at, label } of tabs) {
      const on = tab === current;
      tabBack.fillStyle(on ? THEME.lilacSoft : THEME.bg, 1);
      tabBack.fillRoundedRect(at.x, at.y, at.width, at.height, at.height / 2);
      label.setColor(on ? LOOK.text.ink : LOOK.text.faint);
    }
  };

  // 머리글의 오른쪽: 가진 조각
  const owned = addText(scene, box.x + box.width - 14, box.y + 8, '', { color: LOOK.text.points, originX: 1 }).setDepth(depth);
  const ownedIcon = scene.add.image(0, 0, pieceTexture(scene)).setDepth(depth);
  views.push(owned, ownedIcon);

  const frame: PanelFrame = {
    scene,
    host,
    depth,
    body: { x: box.x + 4, y: box.y + PANEL.head, width: box.width - 8, height: PANEL_BODY_HEIGHT },
    owned,
    refreshOwned: () => {
      owned.setText(String(host.state().pieces));
      ownedIcon.setPosition(
        Math.floor(owned.x - owned.width) - 2 - PIECE_ICON.width / 2,
        Math.round(owned.y + owned.height / 2),
      );
    },
  };

  // 두 쪽 어디에서나 맨 아래에 적어 두는 한 줄
  const foot = addText(
    scene,
    GAME_WIDTH / 2,
    Math.round(frame.body.y + frame.body.height + PANEL.foot / 2),
    PERK_TEXT.noDaily,
    { size: FONT_SIZE.small, color: LOOK.text.faint, originX: 0.5, originY: 0.5 },
  ).setDepth(depth);
  views.push(foot);

  let body: Disposable[] = [];
  const clearBody = (): void => {
    for (const view of body) view.destroy();
    body = [];
  };
  const show = (tab: KeepTab): void => {
    clearBody();
    current = tab;
    drawTabs();
    body = tab === 'perks' ? buildPerkBody(frame) : buildRelicBody(frame);
  };
  show(first);

  // 닫을 때는 움직이던 것부터 거두고, 지금 보이는 쪽의 줄들을 치운다.
  views.unshift({
    destroy: () => {
      scene.tweens.killTweensOf(owned);
      clearBody();
    },
  });

  const closeWidth = 104;
  views.push(
    host.addButton(
      {
        x: Math.round(box.x + (box.width - closeWidth) / 2),
        y: box.y + box.height - 10 - PANEL.close,
        width: closeWidth,
        height: PANEL.close,
      },
      PERK_TEXT.close,
      () => host.close(),
    ),
  );
  sfx.pop();
  return views;
}

// ───────── 받은 조각 ─────────

/**
 * 판이 끝났을 때 받은 조각을 조각 그림과 함께 "+7"로 띄운다. (centerX, centerY)가 한가운데다.
 * 결과 화면이 덮을 때까지 그대로 떠 있다.
 */
export function showPieceGain(scene: Phaser.Scene, centerX: number, centerY: number, amount: number, depth: number): void {
  const size = FONT_SIZE.normal + 2;
  const label = addText(scene, 0, Math.round(centerY), `+${amount}`, {
    size,
    color: LOOK.text.points,
    originY: 0.5,
    stroke: LOOK.text.outline,
    shadow: LOOK.text.shadow,
  }).setDepth(depth);
  const gap = 3;
  const left = Math.round(centerX - (PIECE_ICON.width + gap + label.width) / 2);
  // 그림 밑에 흰 동그라미를 깔아서 기계의 그림 위에서도 조각이 또렷하게 보인다.
  const back = scene.add.graphics().setDepth(depth);
  back.fillStyle(THEME.white, 1);
  back.fillCircle(left + PIECE_ICON.width / 2, Math.round(centerY), PIECE_ICON.width / 2 + 2);
  const icon = scene.add.image(left + PIECE_ICON.width / 2, Math.round(centerY), pieceTexture(scene)).setDepth(depth);
  label.setX(left + PIECE_ICON.width + gap);
  // 판이 끝났다는 글이 먼저 뜨고, 조금 뒤에 나타난다.
  const parts = [back, icon, label];
  for (const part of parts) part.setAlpha(0);
  scene.tweens.add({ targets: parts, alpha: 1, duration: 200, delay: 250 });
}
