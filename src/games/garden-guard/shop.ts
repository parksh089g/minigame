/**
 * 동료 가게 창과, 일시정지 화면에 덧붙이는 "함께하는 동료".
 * 무엇을 내놓고 사면 무엇이 바뀌는지는 allies.ts가 정하고, 여기는 그리기만 한다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import type { PauseExtra } from '../../scenes/MiniGameScene';
import {
  allyLabel,
  canBuyAny,
  canBuyCard,
  canJoin,
  canReroll,
  cellAt,
  cellCorner,
  cellMap,
  fitsAt,
  formsPair,
  mergeTarget,
  owns,
  pairReady,
  refundFor,
  shapeCells,
  starOf,
  type Ally,
  type BuyAt,
  type BuyMode,
} from './allies';
import { openAllyInfo, type InfoPanel } from './ally-info';
import { allyTexture, TEX } from './art';
import { ALLIES, CELL_COUNT, FIELD, GARDEN_CELLS, PAIRS, SHOP, type AllyId } from './data';
import { DAMAGE_TEXT, damageRows } from './damage';
import { dayFinished, drawDaySummary, hasDamage, openDamagePanel, SUMMARY } from './damage-panel';
import { drawHeart } from './pair-mark';
import { allyInfo, cardStatus, mergedStar, purseLine, SHOP_TEXT } from './shop-text';
import type { RunState } from './sim';

export { cardStatus, SHOP_TEXT } from './shop-text';

/** 카드 한 장 */
const CARD = { margin: 10, height: 46, gap: 5 } as const;
/** 이미 있는 동료의 카드를 누르면 나오는 두 단추(합치기, 새로 놓기) */
const CHOICE = { width: 66, height: 18, gap: 4, top: 22 } as const;
/** 카드 이름 옆의 칸 표시(작은 네모) */
const PIP = { size: 6, gap: 2 } as const;
/**
 * 카드의 왼쪽 위 모서리에 걸친 자물쇠 단추. 동그라미(radius)는 카드 모서리에 반쯤 걸치고,
 * 누르는 자리(hit, 네모의 한 변)는 손가락에 넉넉하게 동그라미보다 크며 카드 밖의 여백까지 닿는다.
 * 위의 카드와 겹치지 않게 카드 사이의 틈에서 시작한다. 그림과 이름, 값은 가리지 않는다.
 */
const LOCK = { x: 5, y: 5, radius: 8, hit: 26 } as const;
/** 아래의 단추 줄 */
const BUTTON = { height: 30, gap: 8, top: 7 } as const;
/** 맨 위 줄의 오른쪽 끝에 붙는 "피해 보기" 단추. 누르는 자리(hitHeight)는 손가락에 넉넉하게 단추보다 높다. */
const DAMAGE_BUTTON = { width: 48, height: 18, hitHeight: 26 } as const;
/** 카드 위의 글 한 줄 */
interface HeadLine {
  text: string;
  size: number;
  color: string;
  /** 이 줄이 차지하는 높이 */
  height: number;
  /** 말풍선(옅게 커졌다 작아지는 분홍 칸)에 담아 적는 줄 */
  bubble?: boolean;
}
/** "꾹 누르면 자세히" 말풍선: 줄 높이, 풍선의 높이와 좌우 여백, 아래로 뾰족한 꼬리의 길이 */
const BUBBLE = { line: 16, height: 14, pad: 8, tail: 3 } as const;
/** 마지막 줄과 첫 카드 사이 */
const HEAD_GAP = 3;
/** 창이 뜨고 이 시간(ms)이 지나야 눌린다. 벌레를 겨누던 손가락이 카드를 잘못 누르지 않게 한다. */
const ARM_MS = 280;
/** 카드 그림의 크기 배율(동료의 그림은 30 × 38) */
const ICON_SCALE = 0.68;
/** 이만큼(px) 넘게 끌면 누른 것이 아니라 끌어 옮기는 것이다(누른 것으로 치는 거리와 같다). */
const DRAG_START = 12;
/** 끌고 있는 동료의 그림은 손가락보다 이만큼 위에 보이고, 놓을 자리도 그 그림이 가리키는 칸이다. 손가락에 가리지 않게 한다. */
const DRAG_LIFT = 26;
/**
 * 카드나 밭의 동료를 움직이지 않고(DRAG_START 안에서) 이만큼(ms) 누르고 있으면 그 동료의 정보 창이 뜬다.
 * 그 뒤에 손을 떼도 사거나 고르지 않는다. 그보다 먼저 끌기 시작하면 정보 창은 뜨지 않는다.
 */
const HOLD_MS = 450;
/**
 * 꾹 누른 것으로 치려면 손가락이 이 안(px)에 머물러야 한다. 끌기가 시작되는 거리(DRAG_START)보다 좁게 잡아서,
 * 천천히 끌기 시작한 손가락(프레임이 느린 기기에서는 움직임이 띄엄띄엄 들어온다)이 끌기 전에 정보 창을 띄우지 않게 한다.
 */
const HOLD_SLOP = DRAG_START / 2;
/** 끌 때 밭에 칠하는 색: 놓을 수 있는 자리, 놓을 수 없는 자리, 합치는 동료 */
const DROP_COLOR = { place: THEME.mintDeep, blocked: THEME.coral, merge: THEME.pink } as const;

/** 방금 지킨 날의 알림. 가게 창의 맨 위에 함께 적는다. */
export interface ClearedNote {
  /** "3일째 지킴!" */
  title: string;
  /** "씨앗 +12 · 열매 +4" */
  detail: string;
}

export interface ShopHandlers {
  /** 그 자리(0부터)의 카드를 합치거나(merge) 새로 놓아(place) 산다. 끌어다 놓았으면 놓은 칸이나 합칠 동료도 넘긴다. */
  buy(index: number, mode: BuyMode, at?: BuyAt): void;
  reroll(): void;
  /** 그 자리(0부터)의 카드를 묶거나 푼다. 묶어 둔 카드는 다시 뽑아도, 다음 날에도 남는다. */
  lock(index: number): void;
  /** 텃밭의 그 동료(state.allies의 차례)를 다른 칸(첫 칸)으로 옮긴다. */
  move(ally: number, cell: number): void;
  /** 텃밭의 같은 동료 둘을 합친다(from이 to에 합쳐진다). */
  join(from: number, to: number): void;
  /** 텃밭의 그 동료(state.allies의 차례)를 내보낸다. */
  dismiss(index: number): void;
  ready(): void;
  /** 카드나 밭의 동료를 꾹 눌러 정보 창을 열었다. */
  held?(): void;
}

/** 끌고 있는 것: 가게의 카드나 밭의 동료. grip은 손가락이 잡은 칸이 모양의 첫 칸에서 떨어진 정도다. */
interface Drag {
  from: { kind: 'card'; index: number } | { kind: 'ally'; index: number };
  id: AllyId;
  grip: readonly [number, number];
  ghost: Phaser.GameObjects.Image;
  marks: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  /** 끌고 있는 손가락. 다른 손가락이 움직이거나 떨어져도 끌던 것은 그대로 둔다(11차 검토 G15). */
  pointer: number;
}

/** 끌던 것을 놓으면 할 일 */
type Drop =
  | { kind: 'place'; cell: number }
  | { kind: 'merge'; ally: number }
  | { kind: 'blocked'; cell: number | null };

export interface ShopPanel {
  /** 사거나 다시 뽑거나 내보낸 뒤의 판으로 다시 그린다. */
  refresh(state: RunState): void;
  destroy(): void;
}

type Faded = Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown };

/**
 * 자물쇠 단추를 그린다. 묶었으면 짙은 라일락 동그라미에 닫힌 흰 자물쇠, 풀었으면 흰 동그라미에 고리가 열린 옅은 자물쇠다.
 * (cx, cy)는 동그라미의 한가운데다.
 */
function drawLock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, locked: boolean, pressed: boolean): void {
  g.clear();
  const y = cy + (pressed ? 1 : 0);
  g.fillStyle(locked ? THEME.lilacDeep : THEME.card, 1);
  g.fillCircle(cx, y, LOCK.radius);
  g.lineStyle(1.5, locked ? THEME.lilacDeep : THEME.shadow, 1);
  g.strokeCircle(cx, y, LOCK.radius);
  const ink = locked ? THEME.card : THEME.faint;
  // 몸통
  g.fillStyle(ink, 1);
  g.fillRoundedRect(cx - 4, y - 1, 8, 6, 1.5);
  // 고리: 묶었으면 몸통에 꽂히고, 풀었으면 들려서 왼쪽이 떠 있다.
  const lift = locked ? 0 : 2;
  g.lineStyle(1.6, ink, 1);
  g.beginPath();
  g.arc(cx, y - 2.5 - lift, 2.6, Math.PI, 0, false);
  g.strokePath();
  g.lineBetween(cx + 2.6, y - 2.5 - lift, cx + 2.6, y - 1);
  if (locked) g.lineBetween(cx - 2.6, y - 2.5, cx - 2.6, y - 1);
}

/**
 * 판 위(top과 bottom 사이)에 동료 가게를 띄운다. bottom은 울타리이고, 그 아래 텃밭은 가리지 않는다.
 * 처음 보는 동료의 카드는 누르면 바로 빈칸에 놓는다. 이미 있는 동료의 카드는 누르면 "합치기"와 "새로 놓기"가 나와서 고른다.
 * 텃밭의 동료를 누르면 왼쪽 아래 단추가 "내보내기"로 바뀐다. 카드 왼쪽 위의 자물쇠를 누르면 그 카드를 묶거나 푼다.
 * 판이 바뀌면 부른 쪽이 refresh로 다시 그린다.
 * cleared가 있으면 방금 지킨 날의 알림을 맨 위에 적는다(판의 첫날 앞과 이어 한 판에서는 없다).
 * holdHint면 카드 바로 위에 "꾹 누르면 자세히 보여요" 말풍선을 띄운다. 꾹 눌러 정보 창을 한 번 열면 걷힌다.
 */
export function openShopPanel(
  scene: Phaser.Scene,
  area: { top: number; bottom: number },
  depth: number,
  state: RunState,
  cleared: ClearedNote | null,
  handlers: ShopHandlers,
  holdHint = false,
): ShopPanel {
  const openedAt = scene.time.now;
  let hint = holdHint;
  let objects: Phaser.GameObjects.GameObject[] = [];
  let closed = false;
  /** 고른 카드(두 단추를 펼친 카드)와 고른 텃밭의 동료. 둘 가운데 하나만 고른다. */
  let pickedCard: number | null = null;
  let pickedAlly: number | null = null;
  let current = state;
  const armed = (): boolean => !closed && scene.time.now - openedAt >= ARM_MS;

  // ---------------------------------------------------------- 끌어다 놓기
  /**
   * 누르고 있는 카드나 동료(아직 끌기 전). 손가락이 DRAG_START만큼 움직이면 끌기가 시작되고(canDrag가 아니면 그냥 그친다),
   * 움직이지 않고 HOLD_MS만큼 누르고 있으면 정보 창이 뜬다.
   */
  let pending: {
    from: Drag['from'];
    id: AllyId;
    grip: readonly [number, number];
    x: number;
    y: number;
    pointer: number;
    canDrag: boolean;
    /** 누른 때(performance.now()) */
    at: number;
    /** 손가락이 아직 HOLD_SLOP 안에 머물러 있는지. 한 번 벗어나면 정보 창은 뜨지 않는다. */
    still: boolean;
  } | null = null;
  let drag: Drag | null = null;
  /** 떠 있는 동료 정보 창 */
  let info: InfoPanel | null = null;

  /** 화면의 한 점이 가리키는 밭의 칸. 밭 밖이면 null */
  const cellUnder = (x: number, y: number): number | null => {
    const simY = FIELD.depth + (y - area.bottom);
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const corner = cellCorner(cell);
      if (x >= corner.x && x < corner.x + GARDEN_CELLS.cell && simY >= corner.y && simY < corner.y + GARDEN_CELLS.cell) return cell;
    }
    return null;
  };
  /** 그 칸을 grip으로 잡은 모양의 첫 칸. 밭 밖으로 나가면 null */
  const anchorOf = (cell: number, grip: readonly [number, number]): number | null => {
    const { col, row } = cellAt(cell);
    const x = col - grip[0];
    const y = row - grip[1];
    if (x < 0 || y < 0) return null;
    return y * GARDEN_CELLS.cols * 2 + x;
  };
  /** 지금 손가락 자리에 놓으면 할 일 */
  const dropAt = (now: Drag, x: number, y: number): Drop => {
    const cell = cellUnder(x, y - DRAG_LIFT);
    if (cell === null) return { kind: 'blocked', cell: null };
    const run = current;
    const under = cellMap(run.allies)[cell];
    if (now.from.kind === 'card') {
      const index = now.from.index;
      if (under !== -1 && run.allies[under].id === now.id) {
        return canBuyCard(run, index, 'merge', { ally: under }) ? { kind: 'merge', ally: under } : { kind: 'blocked', cell: null };
      }
      const anchor = anchorOf(cell, now.grip);
      return anchor !== null && canBuyCard(run, index, 'place', { cell: anchor })
        ? { kind: 'place', cell: anchor }
        : { kind: 'blocked', cell: anchor };
    }
    const index = now.from.index;
    if (under !== -1 && under !== index && run.allies[under].id === now.id) {
      return canJoin(run, index, under) ? { kind: 'merge', ally: under } : { kind: 'blocked', cell: null };
    }
    const anchor = anchorOf(cell, now.grip);
    return anchor !== null && fitsAt(run.allies, now.id, anchor, index) ? { kind: 'place', cell: anchor } : { kind: 'blocked', cell: anchor };
  };
  /** 끄는 동안 밭에 놓을 자리(또는 합칠 동료)를 칠한다. */
  const paintDrop = (now: Drag, x: number, y: number): void => {
    const drop = dropAt(now, x, y);
    const g = now.marks;
    g.clear();
    const cells =
      drop.kind === 'merge'
        ? (shapeCells(current.allies[drop.ally].id, current.allies[drop.ally].cell) ?? [])
        : drop.cell !== null
          ? (shapeCells(now.id, drop.cell) ?? [])
          : [];
    g.fillStyle(DROP_COLOR[drop.kind], 0.55);
    g.lineStyle(2, DROP_COLOR[drop.kind], 1);
    for (const cell of cells) {
      const corner = cellCorner(cell);
      const top = area.bottom + (corner.y - FIELD.depth);
      g.fillRoundedRect(corner.x + 1, top + 1, GARDEN_CELLS.cell - 2, GARDEN_CELLS.cell - 2, 5);
      g.strokeRoundedRect(corner.x + 1, top + 1, GARDEN_CELLS.cell - 2, GARDEN_CELLS.cell - 2, 5);
    }
    // 놓으면 짝이 생기는 자리면 "짝!"이라고 알려 준다.
    const ignore = now.from.kind === 'ally' ? now.from.index : -1;
    const paired = drop.kind === 'place' && formsPair(current.allies, now.id, drop.cell, ignore);
    now.label
      .setText(drop.kind === 'merge' ? SHOP_TEXT.mergeSame : paired ? SHOP_TEXT.pair : '')
      .setPosition(x, y - DRAG_LIFT - 26);
    now.ghost.setPosition(x, y - DRAG_LIFT);
  };
  const startDrag = (pointer: Phaser.Input.Pointer): void => {
    if (!pending) return;
    const scale = Math.min(1, ICON_SCALE + ALLIES[pending.id].cells * 0.12);
    drag = {
      from: pending.from,
      id: pending.id,
      grip: pending.grip,
      pointer: pending.pointer,
      ghost: scene.add.image(pointer.worldX, pointer.worldY, allyTexture(pending.id)).setScale(scale).setAlpha(0.9).setDepth(depth + 3),
      marks: scene.add.graphics().setDepth(depth + 2),
      label: addText(scene, pointer.worldX, pointer.worldY, '', {
        size: FONT_SIZE.small,
        color: THEME_CSS.pinkDeep,
        originX: 0.5,
        originY: 0.5,
        stroke: THEME_CSS.white,
      }).setDepth(depth + 3),
    };
    pending = null;
    pickedCard = null;
    pickedAlly = null;
    build(current, false);
    paintDrop(drag, pointer.worldX, pointer.worldY);
  };
  const endDrag = (): void => {
    if (!drag) return;
    drag.ghost.destroy();
    drag.marks.destroy();
    drag.label.destroy();
    drag = null;
  };
  const onMove = (pointer: Phaser.Input.Pointer): void => {
    if (drag) {
      if (pointer.id === drag.pointer) paintDrop(drag, pointer.worldX, pointer.worldY);
      return;
    }
    if (!pending || pointer.id !== pending.pointer) return;
    const moved = Math.hypot(pointer.worldX - pending.x, pointer.worldY - pending.y);
    if (moved > HOLD_SLOP) pending.still = false;
    if (moved > DRAG_START) {
      if (pending.canDrag) startDrag(pointer);
      else pending = null;
    }
  };
  const onUp = (pointer: Phaser.Input.Pointer): void => {
    if (pending && pointer.id === pending.pointer) pending = null;
    if (!drag || pointer.id !== drag.pointer) return;
    const now = drag;
    const drop = dropAt(now, pointer.worldX, pointer.worldY);
    endDrag();
    if (closed) return;
    if (now.from.kind === 'card') {
      if (drop.kind === 'place') handlers.buy(now.from.index, 'place', { cell: drop.cell });
      else if (drop.kind === 'merge') handlers.buy(now.from.index, 'merge', { ally: drop.ally });
    } else if (drop.kind === 'place') handlers.move(now.from.index, drop.cell);
    else if (drop.kind === 'merge') handlers.join(now.from.index, drop.ally);
  };
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
  /**
   * 그 자리(카드나 밭의 칸)를 누르면 끌기를 준비한다. 손가락이 움직이지 않고 떼면 누른 것이 되고,
   * 움직이지 않고 누르고 있으면 정보 창이 뜬다. canDrag가 아니면(열매가 모자란 카드) 끌 수는 없고 정보만 본다.
   */
  const grabbable = (
    zone: Phaser.GameObjects.Zone,
    from: Drag['from'],
    id: AllyId,
    grip: readonly [number, number],
    canDrag = true,
  ): void => {
    zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!armed() || drag || info) return;
      pending = { from, id, grip, x: pointer.worldX, y: pointer.worldY, pointer: pointer.id, canDrag, at: performance.now(), still: true };
    });
  };
  /**
   * 누른 채로 HOLD_MS가 지났는지 프레임마다 본다. 손을 떼거나 끌기 시작하면 pending이 비고, 손가락이 HOLD_SLOP을 벗어났으면 still이 꺼지므로 띄우지 않는다.
   * 타이머(time.delayedCall)는 프레임이 느린 기기에서 게임 시간이 실제 시간보다 느리게 흘러 늦게 뜨므로, 실제 시각(performance.now())으로 잰다.
   * scene.time.now는 그 프레임이 시작된 때여서, 느린 프레임에서는 누른 때가 한 프레임만큼 앞으로 잡혀 일찍 뜬다.
   */
  const onUpdate = (): void => {
    if (pending && pending.still && !drag && !info && !closed && performance.now() - pending.at >= HOLD_MS) showInfo(pending.from, pending.id);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  // 장면의 이벤트는 장면을 다시 열어도 남으므로, 가게를 닫지 않은 채 장면이 끝나도 떼어 낸다.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
  /**
   * 정보 창을 띄운다. 가게의 것은 모두 감춰서(감춘 누르는 자리는 눌리지 않는다) 누르고 있던 손을 떼도 사거나 고르지 않는다.
   * 창을 닫으면 가게를 새로 그린다.
   */
  const showInfo = (from: Drag['from'], id: AllyId): void => {
    pending = null;
    const ally = from.kind === 'ally' ? current.allies[from.index] : undefined;
    if (from.kind === 'ally' && !ally) return;
    // 꾹 누르는 법을 알았으니 말풍선은 걷는다(창을 닫고 새로 그릴 때 빠진다).
    hint = false;
    handlers.held?.();
    for (const object of objects) (object as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible).setVisible(false);
    const ring = ally
      ? (shapeCells(ally.id, ally.cell) ?? []).map((cell) => {
          const corner = cellCorner(cell);
          return { x: corner.x, y: area.bottom + (corner.y - FIELD.depth), size: GARDEN_CELLS.cell };
        })
      : [];
    info = openAllyInfo(scene, area, depth + 4, allyInfo(current, id, ally?.copies, ally ? from.index : undefined), ring, () => {
      closeInfo();
      if (!closed) build(current, false);
    });
  };
  const closeInfo = (): void => {
    info?.destroy();
    info = null;
  };
  /** 피해 기록 창을 띄운다. 동료 정보 창처럼 가게의 것은 감추고, 닫으면 가게를 새로 그린다. */
  const showDamage = (): void => {
    if (!armed() || drag || info) return;
    pending = null;
    for (const object of objects) (object as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible).setVisible(false);
    info = openDamagePanel(scene, area, depth + 4, current, () => {
      closeInfo();
      if (!closed) build(current, false);
    });
  };

  const build = (run: RunState, fade: boolean): void => {
    for (const object of objects) {
      scene.tweens.killTweensOf(object);
      object.destroy();
    }
    objects = [];
    current = run;
    if (pickedCard !== null && (!run.shop[pickedCard] || run.shop[pickedCard].sold)) pickedCard = null;
    if (pickedAlly !== null && !run.allies[pickedAlly]) pickedAlly = null;
    const rebuild = (): void => build(current, false);
    /** 창이 뜰 때 함께 나타나는 것들(누르는 자리를 뺀 모두) */
    const shown: Faded[] = [];
    const keep = <T extends Faded>(object: T): T => {
      objects.push(object);
      shown.push(object);
      return object;
    };

    // 판을 옅게 가려서 카드가 벌레와 물방울 위에서 또렷이 보이게 한다.
    keep(
      scene.add
        .rectangle(0, area.top, GAME_WIDTH, area.bottom - area.top, THEME.bg, 0.78)
        .setOrigin(0, 0)
        .setDepth(depth),
    );

    // 방금 지킨 날의 알림 아래에, 자리가 있으면 그날 피해를 많이 준 것 몇을 짧은 막대로 적는다(짧은 화면에서는 "피해 보기"로만 본다).
    const before: HeadLine[] = cleared
      ? [
          { text: cleared.title, size: 18, color: THEME_CSS.good, height: 24 },
          { text: cleared.detail, size: FONT_SIZE.normal, color: THEME_CSS.accent, height: 20 },
        ]
      : [];
    const after: HeadLine[] = [
      { text: SHOP_TEXT.title, size: cleared ? 14 : 16, color: THEME_CSS.inkDeep, height: cleared ? 19 : 22 },
      { text: purseLine(run), size: FONT_SIZE.small, color: THEME_CSS.sub, height: 15 },
      { text: SHOP_TEXT.dragHint, size: FONT_SIZE.small, color: THEME_CSS.faint, height: 15 },
    ];
    const lineHeights = (lines: readonly HeadLine[]): number => lines.reduce((sum, line) => sum + line.height, 0);
    const cards = run.shop.length;
    const cardsHeight = cards * CARD.height + Math.max(0, cards - 1) * CARD.gap;
    const room = area.bottom - area.top - 8;
    const heightOf = (lines: readonly HeadLine[]): number =>
      lineHeights(before) + lineHeights(lines) + HEAD_GAP + cardsHeight + BUTTON.top + BUTTON.height;
    // 꾹 누르는 법의 말풍선은 카드 바로 위에 한 줄 더 둔다. 판이 짧아 창이 울타리에 닿으면 끌어다 놓는 도움말 자리에 대신 둔다.
    if (hint && (cards > 0 || run.allies.length > 0)) {
      const bubble: HeadLine = { text: SHOP_TEXT.holdHint, size: FONT_SIZE.small, color: THEME_CSS.inkDeep, height: BUBBLE.line, bubble: true };
      if (heightOf([...after, bubble]) <= room) after.push(bubble);
      else after[after.length - 1] = bubble;
    }
    const baseHeight = heightOf(after);
    // 그날 피해의 막대는 말풍선까지 놓고도 자리가 남을 때만 둔다.
    const dayRows = dayFinished(run) ? damageRows(run.dealt.day) : [];
    const summaryLines = Math.min(SUMMARY.rows, dayRows.length);
    const summaryHeight = summaryLines > 0 ? summaryLines * SUMMARY.row + SUMMARY.gap : 0;
    const withSummary = summaryHeight > 0 && baseHeight + summaryHeight <= room;
    const headHeight = lineHeights(before) + (withSummary ? summaryHeight : 0) + lineHeights(after) + HEAD_GAP;
    const height = headHeight + cardsHeight + BUTTON.top + BUTTON.height;
    const top = Math.max(area.top + 4, Math.round((area.top + area.bottom - height) / 2));
    // 맨 위 줄의 오른쪽 끝: "피해 보기". 이 판에서 준 피해가 있을 때만 둔다.
    const damageButton = hasDamage(run);
    const buttonLeft = GAME_WIDTH - CARD.margin - DAMAGE_BUTTON.width;
    let lineTop = top;
    // 말풍선: 분홍 칸에 담고 아래(카드 쪽)로 꼬리를 단다. 가운데를 기준으로 옅게 커졌다 작아진다. 누르는 자리가 없어 아래의 카드를 가리지 않는다.
    const drawBubble = (line: HeadLine): void => {
      const label = addText(scene, 0, 0, line.text, { size: line.size, color: line.color, originX: 0.5, originY: 0.5 });
      const w = Math.ceil(label.width) + BUBBLE.pad * 2;
      const h = BUBBLE.height;
      const g = scene.add.graphics();
      g.fillStyle(THEME.pink, 1);
      g.lineStyle(1.5, THEME.pinkDeep, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      g.fillTriangle(-4, h / 2 - 1, 4, h / 2 - 1, 0, h / 2 + BUBBLE.tail);
      const box = keep(scene.add.container(GAME_WIDTH / 2, lineTop + h / 2, [g, label]).setDepth(depth));
      scene.tweens.add({ targets: box, scale: 1.05, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      lineTop += line.height;
    };
    const writeLines = (lines: readonly HeadLine[]): void => {
      for (const line of lines) {
        if (line.bubble) {
          drawBubble(line);
          continue;
        }
        const text = keep(
          addText(scene, GAME_WIDTH / 2, lineTop, line.text, {
            size: line.size,
            color: line.color,
            originX: 0.5,
            stroke: THEME_CSS.white,
          }).setDepth(depth),
        );
        // 맨 위 줄이 길면 "피해 보기"에 닿지 않게 왼쪽으로 민다.
        if (damageButton && lineTop === top) text.setX(Math.min(GAME_WIDTH / 2, buttonLeft - 4 - text.width / 2));
        lineTop += line.height;
      }
    };
    writeLines(before);
    if (withSummary) {
      const summaryTop = lineTop;
      for (const object of drawDaySummary(scene, dayRows, summaryTop, depth)) keep(object);
      // 막대를 눌러도 피해 기록 창이 뜬다. 글 상자가 줄보다 조금 높아서 누르는 자리를 위아래로 넉넉하게 둔다.
      const reach = 4;
      const zoneHeight = summaryLines * SUMMARY.row + reach * 2;
      objects.push(
        addTapZone(scene, CARD.margin, summaryTop - reach, GAME_WIDTH - CARD.margin * 2, zoneHeight, () => undefined, showDamage).setDepth(
          depth,
        ),
      );
      lineTop += summaryHeight;
    }
    writeLines(after);
    if (damageButton) {
      const firstHeight = (before[0] ?? after[0]).height;
      const by = top + Math.round((firstHeight - DAMAGE_BUTTON.height) / 2);
      const g = keep(scene.add.graphics().setDepth(depth));
      const paint = (pressed: boolean): void => {
        g.clear();
        g.fillStyle(THEME.skyDeep, 1);
        g.fillRoundedRect(buttonLeft, by + 2, DAMAGE_BUTTON.width, DAMAGE_BUTTON.height - 2, 8);
        g.fillStyle(THEME.skySoft, 1);
        g.fillRoundedRect(buttonLeft, by + (pressed ? 2 : 0), DAMAGE_BUTTON.width, DAMAGE_BUTTON.height - 2, 8);
      };
      paint(false);
      keep(
        addText(scene, buttonLeft + DAMAGE_BUTTON.width / 2, by + (DAMAGE_BUTTON.height - 2) / 2, DAMAGE_TEXT.open, {
          size: FONT_SIZE.small,
          color: THEME_CSS.inkDeep,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(depth),
      );
      const hitTop = by + DAMAGE_BUTTON.height / 2 - DAMAGE_BUTTON.hitHeight / 2;
      objects.push(
        addTapZone(scene, buttonLeft, hitTop, DAMAGE_BUTTON.width, DAMAGE_BUTTON.hitHeight, paint, showDamage).setDepth(depth + 1),
      );
    }

    const width = GAME_WIDTH - CARD.margin * 2;
    run.shop.forEach((card, index) => {
      const ally = ALLIES[card.id];
      const y = top + headHeight + index * (CARD.height + CARD.gap);
      const face = CARD.height - 3;
      const owned = owns(run, card.id);
      const affordable = canBuyAny(run, index);
      const picked = pickedCard === index;
      const panel = keep(scene.add.graphics().setDepth(depth));
      const draw = (pressed: boolean): void => {
        panel.clear();
        drawPanel(panel, CARD.margin, y, width, face, {
          depth: 3,
          radius: 12,
          fill: card.sold ? THEME.bg : undefined,
          border: (pressed && affordable) || picked ? THEME.pinkDeep : card.locked && !card.sold ? THEME.lilacDeep : undefined,
        });
      };
      draw(false);
      const fade = card.sold ? 0.5 : 1;
      keep(
        scene.add
          .image(CARD.margin + 22, y + face / 2 + 1, allyTexture(card.id))
          .setScale(ICON_SCALE)
          .setDepth(depth)
          .setAlpha(fade),
      );
      const name = keep(addText(scene, CARD.margin + 42, y + 6, ally.name, { size: 14 }).setDepth(depth).setAlpha(fade));
      // 이름 옆의 작은 네모: 차지하는 칸 수
      const pips = keep(scene.add.graphics().setDepth(depth).setAlpha(fade));
      const pipLeft = name.x + name.width + 5;
      pips.fillStyle(THEME.mintDeep, 1);
      for (let at = 0; at < ally.cells; at += 1) {
        pips.fillRoundedRect(pipLeft + at * (PIP.size + PIP.gap), y + 12, PIP.size, PIP.size, 1.5);
      }
      const statusLeft = pipLeft + ally.cells * (PIP.size + PIP.gap) + 3;
      if (!card.sold) {
        const status = cardStatus(run, card.id);
        keep(
          addText(scene, statusLeft, y + 9, status.text, {
            size: FONT_SIZE.small,
            color: status.color,
          }).setDepth(depth),
        );
      }
      if (!picked) {
        // 누르기만 해도 제 짝 효과가 맞는 자리에 서는 카드에는 설명 대신 그 짝 효과를 하트와 함께 적는다.
        const paired = !card.sold && pairReady(run.allies, card.id);
        if (paired) drawHeart(keep(scene.add.graphics().setDepth(depth)), CARD.margin + 46, y + 31);
        keep(
          addText(scene, CARD.margin + (paired ? 53 : 42), y + 25, paired ? PAIRS[card.id].line : ally.blurb, {
            size: FONT_SIZE.small,
            color: paired ? THEME_CSS.pinkDeep : THEME_CSS.sub,
          })
            .setDepth(depth)
            .setAlpha(fade),
        );
      }
      // 오른쪽 끝의 값: 열매 그림과 수. 산 카드에는 값 대신 "데려왔어요"
      const right = CARD.margin + width - 10;
      if (card.sold) {
        keep(
          addText(scene, right, y + face / 2, SHOP_TEXT.sold, {
            size: FONT_SIZE.small,
            color: THEME_CSS.good,
            originX: 1,
            originY: 0.5,
          }).setDepth(depth),
        );
      } else {
        const price = keep(
          addText(scene, right, y + face / 2, String(ally.price), {
            size: 16,
            color: affordable ? THEME_CSS.accent : THEME_CSS.faint,
            originX: 1,
            originY: 0.5,
          }).setDepth(depth),
        );
        keep(
          scene.add
            .image(price.x - price.width - 9, y + face / 2, TEX.fruit)
            .setDepth(depth)
            .setAlpha(affordable ? 1 : 0.45),
        );
      }
      const zone = addTapZone(scene, CARD.margin, y, width, CARD.height, draw, () => {
        if (!armed() || !canBuyAny(run, index)) return;
        // 처음 보는 동료는 고를 것이 없으니 누르기만 해도 물총에 가까운 빈자리에 놓는다.
        if (!owned) {
          handlers.buy(index, 'place');
          return;
        }
        pickedCard = picked ? null : index;
        pickedAlly = null;
        rebuild();
      }).setDepth(depth);
      // 카드를 밭으로 끌어다 놓으면 그 자리에 선다(같은 동료 위에 놓으면 합쳐진다). 열매가 모자란 카드는 끌 수 없다.
      // 꾹 누르면 정보 창이 뜨는 것은 모든 카드가 같다.
      grabbable(zone, { kind: 'card', index }, card.id, ally.shape[Math.floor(ally.shape.length / 2)], !card.sold && run.fruit >= ally.price);
      objects.push(zone);
      // 사지 않은 카드의 왼쪽 위 자물쇠: 누르면 묶거나 푼다. 카드보다 위에 있어서 누른 손가락이 카드를 사거나 끌지 않는다.
      if (!card.sold) {
        const locked = card.locked === true;
        const cx = CARD.margin + LOCK.x;
        const cy = y + LOCK.y;
        const lock = keep(scene.add.graphics().setDepth(depth + 1));
        drawLock(lock, cx, cy, locked, false);
        const drawPressed = (pressed: boolean): void => drawLock(lock, cx, cy, locked, pressed);
        objects.push(
          addTapZone(scene, cx - LOCK.hit / 2, y - CARD.gap, LOCK.hit, LOCK.hit, drawPressed, () => {
            if (!armed()) return;
            handlers.lock(index);
          }).setDepth(depth + 1),
        );
      }
      if (picked) {
        const merged = mergedStar(run, card.id);
        const choices: Array<{ label: string; mode: BuyMode }> = [
          {
            label: merged !== null && merged > starOf(mergeTarget(run, card.id)?.copies ?? 0) ? SHOP_TEXT.mergeButton(merged) : SHOP_TEXT.mergeSame,
            mode: 'merge',
          },
          { label: `${SHOP_TEXT.placeButton} ${SHOP_TEXT.cells(ally.cells)}`, mode: 'place' },
        ];
        choices.forEach((choice, at) => {
          const x = CARD.margin + 42 + at * (CHOICE.width + CHOICE.gap);
          const by = y + CHOICE.top;
          const enabled = canBuyCard(run, index, choice.mode);
          const g = keep(scene.add.graphics().setDepth(depth));
          const drawChoice = (pressed: boolean): void => {
            g.clear();
            g.fillStyle(choice.mode === 'merge' ? THEME.pinkDeep : THEME.mintDeep, 1);
            g.fillRoundedRect(x, by + 2, CHOICE.width, CHOICE.height - 2, 8);
            g.fillStyle(choice.mode === 'merge' ? THEME.pink : THEME.mint, 1);
            g.fillRoundedRect(x, by + (pressed && enabled ? 2 : 0), CHOICE.width, CHOICE.height - 2, 8);
          };
          drawChoice(false);
          g.setAlpha(enabled ? 1 : 0.4);
          keep(
            addText(scene, x + CHOICE.width / 2, by + (CHOICE.height - 2) / 2, choice.label, {
              size: FONT_SIZE.small,
              color: THEME_CSS.inkDeep,
              originX: 0.5,
              originY: 0.5,
            })
              .setDepth(depth)
              .setAlpha(enabled ? 1 : 0.4),
          );
          objects.push(
            addTapZone(scene, x, by - 2, CHOICE.width, CHOICE.height + 4, drawChoice, () => {
              if (!armed() || !canBuyCard(run, index, choice.mode)) return;
              pickedCard = null;
              handlers.buy(index, choice.mode);
            }).setDepth(depth + 1),
          );
        });
      }
    });

    // 텃밭의 동료: 누르면 고르고(고른 동료는 테두리로 보인다), 끌면 다른 칸으로 옮기거나 같은 동료에 합친다.
    // 울타리 아래는 가리지 않으므로 동료가 그대로 보인다. 칸마다 누르는 자리를 두어 ㄴ자 모양의 빈 곳은 비워 둔다.
    run.allies.forEach((ally, index) => {
      const cells = shapeCells(ally.id, ally.cell) ?? [];
      const anchor = cellAt(ally.cell);
      if (pickedAlly === index) {
        const ring = keep(scene.add.graphics().setDepth(depth));
        ring.lineStyle(2, THEME.coralDeep, 1);
        for (const cell of cells) {
          const corner = cellCorner(cell);
          ring.strokeRoundedRect(corner.x + 1, area.bottom + (corner.y - FIELD.depth) + 1, GARDEN_CELLS.cell - 2, GARDEN_CELLS.cell - 2, 5);
        }
      }
      for (const cell of cells) {
        const corner = cellCorner(cell);
        const at = cellAt(cell);
        const zone = addTapZone(
          scene,
          corner.x,
          area.bottom + (corner.y - FIELD.depth),
          GARDEN_CELLS.cell,
          GARDEN_CELLS.cell,
          () => undefined,
          () => {
            if (!armed()) return;
            pickedAlly = pickedAlly === index ? null : index;
            pickedCard = null;
            rebuild();
          },
        ).setDepth(depth);
        grabbable(zone, { kind: 'ally', index }, ally.id, [at.col - anchor.col, at.row - anchor.row]);
        objects.push(zone);
      }
    });

    // 아래의 단추 줄: 왼쪽은 다시 뽑기(동료를 골랐으면 내보내기), 오른쪽은 가게를 닫고 날을 시작한다.
    const buttonTop = top + headHeight + cardsHeight + BUTTON.top;
    const half = (width - BUTTON.gap) / 2;
    const button = (
      x: number,
      label: string,
      fill: number,
      lip: number,
      enabled: boolean,
      onTap: () => void,
      cost?: { value: number; color: string },
    ): void => {
      const g = keep(scene.add.graphics().setDepth(depth));
      const draw = (pressed: boolean): void => {
        g.clear();
        const offset = pressed && enabled ? 2 : 0;
        g.fillStyle(lip, 1);
        g.fillRoundedRect(x, buttonTop + 3, half, BUTTON.height - 3, 12);
        g.fillStyle(fill, 1);
        g.fillRoundedRect(x, buttonTop + offset, half, BUTTON.height - 3, 12);
      };
      draw(false);
      g.setAlpha(enabled ? 1 : 0.45);
      const middle = buttonTop + (BUTTON.height - 3) / 2;
      const text = keep(
        addText(scene, x + half / 2 - (cost !== undefined ? 9 : 0), middle, label, {
          size: 13,
          color: THEME_CSS.inkDeep,
          originX: 0.5,
          originY: 0.5,
        })
          .setDepth(depth)
          .setAlpha(enabled ? 1 : 0.45),
      );
      if (cost !== undefined) {
        const iconX = text.x + text.width / 2 + 10;
        keep(scene.add.image(iconX, middle, TEX.fruit).setDepth(depth).setAlpha(enabled ? 1 : 0.45));
        keep(
          addText(scene, iconX + 8, middle, cost.value > 0 && cost.color === THEME_CSS.good ? `+${cost.value}` : String(cost.value), {
            size: 12,
            color: cost.color,
            originY: 0.5,
          })
            .setDepth(depth)
            .setAlpha(enabled ? 1 : 0.45),
        );
      }
      objects.push(
        addTapZone(scene, x, buttonTop, half, BUTTON.height, draw, () => {
          if (!armed() || !enabled) return;
          onTap();
        }).setDepth(depth),
      );
    };
    const leaving = pickedAlly !== null ? run.allies[pickedAlly] : undefined;
    if (leaving && pickedAlly !== null) {
      const index = pickedAlly;
      button(CARD.margin, SHOP_TEXT.dismiss, THEME.coral, THEME.coralDeep, true, () => {
        pickedAlly = null;
        handlers.dismiss(index);
      }, { value: refundFor(leaving), color: THEME_CSS.good });
    } else {
      button(CARD.margin, SHOP_TEXT.reroll, THEME.card, THEME.shadow, canReroll(run), () => handlers.reroll(), {
        value: SHOP.reroll,
        color: THEME_CSS.accent,
      });
    }
    const opening = run.lastCleared < run.day;
    button(CARD.margin + half + BUTTON.gap, opening ? SHOP_TEXT.start(run.day) : SHOP_TEXT.next, THEME.pink, THEME.pinkDeep, true, () => {
      closed = true;
      handlers.ready();
    });

    if (fade) {
      for (const object of shown) object.setAlpha(0);
      scene.tweens.add({ targets: shown, alpha: 1, duration: 160 });
    }
  };

  build(state, true);

  return {
    refresh: (run) => {
      if (closed) return;
      // 판이 바뀌면 끌던 것은 내려놓는다(다른 카드나 동료를 가리키게 될 수 있다).
      endDrag();
      pending = null;
      closeInfo();
      build(run, false);
    },
    destroy: () => {
      closed = true;
      endDrag();
      pending = null;
      closeInfo();
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
      for (const object of objects) {
        scene.tweens.killTweensOf(object);
        object.destroy();
      }
      objects = [];
    },
  };
}

const PAUSE = { head: 14, row: 17, icon: 15 } as const;

/** 일시정지 화면에 덧붙이는 "함께하는 동료". 동료가 없으면 덧붙일 것도 없다. */
export function teamInfo(allies: readonly Ally[]): PauseExtra | undefined {
  if (allies.length === 0) return undefined;
  const lines = Math.ceil(allies.length / 2);
  return {
    width: GAME_WIDTH - 16,
    height: PAUSE.head + lines * PAUSE.row,
    draw: (scene, left, top, width) => {
      addText(scene, left, top, SHOP_TEXT.pauseTitle, { size: FONT_SIZE.small, color: THEME_CSS.sub });
      allies.forEach((ally, index) => {
        const x = left + (index % 2) * Math.floor(width / 2);
        const y = top + PAUSE.head + Math.floor(index / 2) * PAUSE.row;
        scene.add
          .image(x + PAUSE.icon / 2, y + PAUSE.row / 2, allyTexture(ally.id))
          .setDisplaySize(PAUSE.icon * (30 / 38), PAUSE.icon);
        addText(scene, x + PAUSE.icon + 4, y + PAUSE.row / 2, allyLabel(ally), { size: FONT_SIZE.small, originY: 0.5 });
      });
    },
  };
}
