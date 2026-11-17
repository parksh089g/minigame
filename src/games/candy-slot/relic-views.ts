/**
 * 유물 쪽의 화면: 해금과 유물의 창(perk-views.ts의 openPerkPanel)에서 "유물"을 골랐을 때 놓이는 줄들.
 * 줄의 모양은 텃밭 지키기의 강화 목록(garden-guard/lobby.ts)과 같다: 높이 36에 틈 4, 왼쪽에 작은 그림,
 * 이름과 그 옆의 단계, 그 아래에 "지금 값 → 다음 값", 오른쪽에 조각 그림과 값이 적힌 버튼.
 * 줄의 왼쪽을 누르면 목록 아래의 칸에 설명이 보이고, 오른쪽의 값 버튼을 누르면 조각을 내고 한 단계 올린다.
 * 값과 적는 글은 relics.ts가 정하고, 세이브를 고치는 일은 씬이 넘겨준 함수(PerkPanelHost.raise)에 맡긴다.
 */
import type Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { LOOK, PIECE_ICON, pieceTexture, RELIC_BOX, relicTexture } from './art';
import type { PanelFrame } from './perk-views';
import {
  effectLine,
  levelOf,
  levelText,
  raiseBlock,
  raisedNotice,
  RELIC_TEXT,
  relicPrice,
  RELICS,
  relicShortNotice,
} from './relics';
import type { Box, RelicId } from './rules';

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** 유물 한 줄의 높이와 줄 사이. 텃밭 지키기의 강화 목록과 같다. */
const ROW = { height: 36, gap: 4 } as const;
/** 줄의 오른쪽에 놓는 값 버튼. 아래 2는 버튼의 두께다. */
const BUY = { width: 50, height: 24, lip: 2 } as const;
/** 목록 아래의 설명 칸 */
const INFO_HEIGHT = 24;

interface RelicRow {
  id: RelicId;
  box: Box;
  back: Graphics;
  icon: Phaser.GameObjects.Image;
  name: Text;
  level: Text;
  effect: Text;
  button: Graphics;
  piece: Phaser.GameObjects.Image;
  price: Text;
  pressed: boolean;
}

/**
 * 유물 쪽의 줄들을 놓는다. 놓은 것들을 돌려주니, 쪽을 바꾸거나 창을 닫을 때 모두 치운다.
 */
export function buildRelicBody(frame: PanelFrame): Disposable[] {
  const { scene, host, depth, body } = frame;
  const views: Disposable[] = [];
  /** 설명을 보려고 고른 유물 */
  let picked: RelicId | null = null;

  // 목록 아래의 설명 칸
  const infoTop = body.y + RELICS.length * (ROW.height + ROW.gap) + 2;
  const infoBack = scene.add.graphics().setDepth(depth);
  drawPanel(infoBack, body.x, infoTop, body.width, INFO_HEIGHT, { fill: THEME.butterSoft, shadow: null, radius: 9 });
  const info = addText(scene, GAME_WIDTH / 2, Math.round(infoTop + INFO_HEIGHT / 2), '', {
    size: FONT_SIZE.small,
    color: LOOK.text.sub,
    originX: 0.5,
    originY: 0.5,
  }).setDepth(depth);
  views.push(infoBack, info);
  /** 설명 칸에 글을 적는다. 칸보다 넓으면 그만큼 줄인다. */
  const say = (label: string, color: string): void => {
    info.setScale(1).setText(label).setColor(color);
    info.setScale(Math.min(1, (body.width - 14) / info.width));
  };

  const drawRow = (row: RelicRow): void => {
    const state = host.state();
    const level = levelOf(state, row.id);
    const price = relicPrice(level);
    const afford = raiseBlock(state, row.id) === null;
    const { box: at } = row;
    row.back.clear();
    if (picked === row.id) {
      row.back.fillStyle(LOOK.relic.edge, 1);
      row.back.fillRoundedRect(at.x, at.y, at.width, at.height, 10);
      row.back.fillStyle(THEME.bg, 1);
      row.back.fillRoundedRect(at.x + 2, at.y + 2, at.width - 4, at.height - 4, 8);
    } else {
      row.back.fillStyle(THEME.bg, 1);
      row.back.fillRoundedRect(at.x, at.y, at.width, at.height, 10);
    }
    row.level.setText(levelText(level));
    // 효과의 줄이 값 버튼에 닿지 않게, 넘치면 그만큼 줄인다.
    const room = at.x + at.width - BUY.width - 5 - 4 - row.effect.x;
    row.effect.setScale(1).setText(effectLine(row.id, level));
    row.effect.setScale(Math.min(1, room / row.effect.width));

    const x = at.x + at.width - BUY.width - 5;
    const y = at.y + (at.height - BUY.height) / 2;
    row.button.clear();
    if (price === null) {
      // 다 올린 줄: 버튼 대신 "다 올림"
      row.piece.setVisible(false);
      row.price
        .setText(RELIC_TEXT.max)
        .setColor(LOOK.text.good)
        .setOrigin(0.5, 0.5)
        .setPosition(Math.round(x + BUY.width / 2), Math.round(y + BUY.height / 2));
      return;
    }
    const offset = row.pressed && afford ? BUY.lip : 0;
    const face = BUY.height - BUY.lip;
    row.button.fillStyle(afford ? LOOK.perk.edge : THEME.shadow, 1);
    row.button.fillRoundedRect(x, y + BUY.lip, BUY.width, face, 10);
    row.button.fillStyle(afford ? THEME.lilacSoft : THEME.dim, 1);
    row.button.fillRoundedRect(x, y + offset, BUY.width, face, 10);
    const middle = y + offset + face / 2;
    row.price
      .setText(String(price))
      .setColor(afford ? LOOK.text.ink : LOOK.text.bad)
      .setOrigin(0, 0.5);
    // 조각 그림과 값을 한 덩어리로 가운데에 놓는다.
    const span = PIECE_ICON.width + 2 + row.price.width;
    const left = x + (BUY.width - span) / 2;
    row.piece
      .setVisible(true)
      .setPosition(Math.round(left + PIECE_ICON.width / 2), Math.round(middle))
      .setAlpha(afford ? 1 : 0.5);
    row.price.setPosition(Math.round(left + PIECE_ICON.width + 2), Math.round(middle));
  };

  const rows: RelicRow[] = RELICS.map((relic, index) => {
    const at: Box = { x: body.x, y: body.y + index * (ROW.height + ROW.gap), width: body.width, height: ROW.height };
    const middle = at.y + at.height / 2;
    const textLeft = at.x + 4 + RELIC_BOX + 5;
    // 바닥은 글자보다 먼저 놓아야 그 밑에 그려진다.
    const back = scene.add.graphics().setDepth(depth);
    const name = addText(scene, textLeft, at.y + 4, relic.name, { color: LOOK.text.ink }).setDepth(depth);
    const row: RelicRow = {
      id: relic.id,
      box: at,
      back,
      icon: scene.add.image(at.x + 4 + RELIC_BOX / 2, middle, relicTexture(scene, relic.id)).setDepth(depth),
      name,
      level: addText(scene, Math.ceil(name.x + name.width) + 5, at.y + 6, '', {
        size: FONT_SIZE.small,
        color: LOOK.text.sub,
      }).setDepth(depth),
      effect: addText(scene, textLeft, at.y + 20, '', { size: FONT_SIZE.small, color: LOOK.text.sub }).setDepth(depth),
      button: scene.add.graphics().setDepth(depth),
      piece: scene.add.image(0, middle, pieceTexture(scene)).setDepth(depth),
      price: addText(scene, 0, middle, '', { originY: 0.5 }).setDepth(depth),
      pressed: false,
    };
    // 줄의 왼쪽을 누르면 설명만 보이고, 오른쪽의 값 버튼을 누르면 올린다.
    const split = at.width - BUY.width - 9;
    const pickZone = addTapZone(scene, at.x, at.y, split, at.height, () => undefined, () => {
      sfx.click();
      pick(row.id);
      say(relic.description, LOOK.text.ink);
    }).setDepth(depth);
    const buyZone = addTapZone(
      scene,
      at.x + split,
      at.y,
      at.width - split,
      at.height,
      (pressed) => {
        row.pressed = pressed;
        drawRow(row);
      },
      () => buy(row),
    ).setDepth(depth);
    views.push(row.back, row.icon, row.name, row.level, row.effect, row.button, row.piece, row.price, pickZone, buyZone);
    return row;
  });

  const refresh = (): void => {
    frame.refreshOwned();
    for (const row of rows) drawRow(row);
  };

  const pick = (id: RelicId): void => {
    picked = id;
    for (const row of rows) drawRow(row);
  };

  const buy = (row: RelicRow): void => {
    const before = host.state();
    const block = host.raise(row.id);
    picked = row.id;
    if (block === 'max') {
      sfx.click();
      refresh();
      say(RELIC_TEXT.maxed, LOOK.text.sub);
      return;
    }
    if (block !== null) {
      sfx.deny();
      vibrate(12);
      // 모자란 값이 좌우로 흔들린다. 앞서 흔들리던 것은 거두고 제자리에서 다시 흔든다.
      scene.tweens.killTweensOf(row.price);
      refresh();
      say(relicShortNotice(before, row.id), LOOK.text.bad);
      const x = row.price.x;
      scene.tweens.add({ targets: row.price, x: x - 3, duration: 50, yoyo: true, repeat: 2, onComplete: () => row.price.setX(x) });
      return;
    }
    sfx.gold();
    vibrate([15, 30, 15]);
    refresh();
    say(raisedNotice(row.id, levelOf(host.state(), row.id)), LOOK.text.good);
    // 방금 올린 줄의 그림과 단계가 톡 튀고, 줄어든 조각의 수도 튄다.
    for (const target of [row.icon, row.level, frame.owned]) {
      scene.tweens.killTweensOf(target);
      scene.tweens.add({ targets: target, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.Out' });
    }
  };

  refresh();
  say(RELIC_TEXT.idle, LOOK.text.sub);

  // 튀거나 흔들리는 도중에 치워도, 치운 글자를 움직이려 들지 않게 움직임부터 거둔다.
  views.unshift({
    destroy: () => scene.tweens.killTweensOf(rows.flatMap((row) => [row.icon, row.level, row.price])),
  });
  return views;
}
