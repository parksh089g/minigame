/**
 * 피해 기록 창과, 가게 창의 맨 위에 적는 짧은 피해 막대.
 * 누가 얼마나 주었는지는 damage.ts가 세고, 여기는 그리기만 한다.
 * 창은 가게의 "피해 보기"를 누르면 가게 창 자리에 뜨고(동료 정보 창과 같다), 그날과 이 판을 단추로 바꿔 본다.
 */
import Phaser from 'phaser';
import { FONT_SIZE, GAME_WIDTH, THEME, THEME_CSS } from '../../config';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import type { InfoPanel } from './ally-info';
import { allyTexture, TEX } from './art';
import { DAMAGE_TEXT, damageLabel, damageRows, sharePercent, sourceName, type DamageRow, type DamageSource } from './damage';
import type { RunState } from './sim';

/** 창의 바깥 여백(가게 카드와 같다), 안쪽 여백, 모서리 */
const PANEL = { margin: 10, pad: 12, radius: 14 } as const;
/** 맨 위 줄(제목과 그날/이 판 단추)의 높이와 단추 */
const HEAD = { height: 28 } as const;
const TAB = { width: 56, height: 20, gap: 4 } as const;
/** 한 줄: 그림, 이름, 막대, 몫(%), 피해 */
const ROW = {
  height: 18,
  icon: 15,
  name: 20,
  bar: 72,
  barWidth: 52,
  barHeight: 6,
  share: 152,
} as const;
/** 아래의 닫기 단추 */
const CLOSE = { width: 96, height: 28, top: 10 } as const;
/** 가게 창에 적는 짧은 막대 줄 */
export const SUMMARY = {
  rows: 3,
  row: 13,
  gap: 3,
  width: 196,
  name: 0,
  bar: 46,
  barHeight: 5,
} as const;

/** 피해를 준 것의 그림 */
export function sourceTexture(source: DamageSource): string {
  switch (source) {
    case 'gun':
      return TEX.gun;
    case 'storm':
      return TEX.storm;
    case 'thorns':
      return TEX.spine;
    default:
      return allyTexture(source);
  }
}

/** 막대의 색: 물총과 물벼락은 하늘색, 가시는 산호색, 동료는 박하색 */
function barColor(source: DamageSource): number {
  if (source === 'gun' || source === 'storm') return THEME.skyDeep;
  if (source === 'thorns') return THEME.coral;
  return THEME.mintDeep;
}

/** 그날의 피해를 볼 수 있는지: 날을 지키고 쉬는 동안(가게가 열린 동안)만 그날의 기록이 다 모여 있다. */
export function dayFinished(state: Pick<RunState, 'phase' | 'lastCleared' | 'day'>): boolean {
  return state.phase === 'rest' && state.lastCleared === state.day && state.lastCleared > 0;
}

/** 가게에 "피해 보기"를 둘지: 이 판에서 준 피해가 있으면 둔다. */
export function hasDamage(state: Pick<RunState, 'dealt'>): boolean {
  return damageRows(state.dealt.run).length > 0;
}

/**
 * 가게 창의 맨 위에 그날 가장 많이 준 것 몇을 짧은 막대로 적는다(위에서 SUMMARY.rows줄). top은 첫 줄의 위쪽 끝이다.
 * 만든 것들을 돌려준다. 그날 준 피해가 없으면 아무것도 만들지 않는다.
 */
export function drawDaySummary(
  scene: Phaser.Scene,
  rows: readonly DamageRow[],
  top: number,
  depth: number,
): Array<Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown }> {
  const made: Array<Phaser.GameObjects.GameObject & { setAlpha(alpha: number): unknown }> = [];
  const left = (GAME_WIDTH - SUMMARY.width) / 2;
  const shown = rows.slice(0, SUMMARY.rows);
  if (shown.length === 0) return made;
  const best = shown[0].amount;
  const g = scene.add.graphics().setDepth(depth);
  made.push(g);
  shown.forEach((row, index) => {
    const middle = top + index * SUMMARY.row + SUMMARY.row / 2;
    made.push(
      addText(scene, left + SUMMARY.name, middle, sourceName(row.source), {
        size: FONT_SIZE.small,
        color: THEME_CSS.ink,
        originY: 0.5,
        stroke: THEME_CSS.white,
      }).setDepth(depth),
    );
    const barRight = left + SUMMARY.width - 70;
    const barWidth = barRight - (left + SUMMARY.bar);
    g.fillStyle(THEME.shadow, 1);
    g.fillRoundedRect(left + SUMMARY.bar, middle - SUMMARY.barHeight / 2, barWidth, SUMMARY.barHeight, SUMMARY.barHeight / 2);
    g.fillStyle(barColor(row.source), 1);
    g.fillRoundedRect(
      left + SUMMARY.bar,
      middle - SUMMARY.barHeight / 2,
      Math.max(SUMMARY.barHeight, (barWidth * row.amount) / best),
      SUMMARY.barHeight,
      SUMMARY.barHeight / 2,
    );
    made.push(
      addText(scene, left + SUMMARY.width, middle, `${damageLabel(row.amount)} · ${sharePercent(row.share)}%`, {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 1,
        originY: 0.5,
        stroke: THEME_CSS.white,
      }).setDepth(depth),
    );
  });
  return made;
}

/**
 * 판 위(top과 bottom 사이)의 가운데에 피해 기록 창을 띄운다. 날을 막 지켰으면 그날의 기록부터 보이고, 단추로 이 판의 기록과 바꿔 본다.
 * 창이 떠 있는 동안은 화면 전체(top 아래)를 덮는 누르는 자리가 있어서 아래의 카드나 동료는 눌리지 않는다.
 */
export function openDamagePanel(
  scene: Phaser.Scene,
  area: { top: number; bottom: number },
  depth: number,
  state: Pick<RunState, 'dealt' | 'phase' | 'lastCleared' | 'day'>,
  onClose: () => void,
): InfoPanel {
  let objects: Phaser.GameObjects.GameObject[] = [];
  const withDay = dayFinished(state) && damageRows(state.dealt.day).length > 0;
  let view: 'day' | 'run' = withDay ? 'day' : 'run';

  const draw = (): void => {
    for (const object of objects) object.destroy();
    objects = [];
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      objects.push(object);
      return object;
    };
    const left = PANEL.margin;
    const width = GAME_WIDTH - PANEL.margin * 2;
    const inner = width - PANEL.pad * 2;
    const all = damageRows(view === 'day' ? state.dealt.day : state.dealt.run);
    // 화면에 다 들어가지 않으면 끝의 것들을 "그 밖"으로 묶는다.
    const room = area.bottom - area.top - 8 - PANEL.pad * 2 - HEAD.height - CLOSE.top - CLOSE.height;
    const most = Math.max(2, Math.floor(room / ROW.height));
    const rows = all.length > most ? all.slice(0, most - 1) : all;
    const rest = all.slice(rows.length);
    const lines = Math.max(1, rows.length + (rest.length > 0 ? 1 : 0));
    const height = PANEL.pad + HEAD.height + lines * ROW.height + CLOSE.top + CLOSE.height + PANEL.pad;
    const top = Math.max(area.top + 4, Math.round((area.top + area.bottom - height) / 2));

    keep(
      scene.add
        .rectangle(0, area.top, GAME_WIDTH, area.bottom - area.top, THEME.bg, 0.78)
        .setOrigin(0, 0)
        .setDepth(depth),
    );
    drawPanel(keep(scene.add.graphics().setDepth(depth)), left, top, width, height, { depth: 3, radius: PANEL.radius });
    // 화면의 판 아래까지 모두 덮어서, 어디를 누르든 닫히고 아래의 것은 눌리지 않는다. 단추는 이것보다 위에 있다.
    keep(addTapZone(scene, 0, area.top, GAME_WIDTH, scene.scale.height - area.top, () => undefined, onClose).setDepth(depth + 1));

    const headMiddle = top + PANEL.pad + TAB.height / 2;
    keep(
      addText(scene, left + PANEL.pad, headMiddle, DAMAGE_TEXT.title, {
        size: 14,
        color: THEME_CSS.inkDeep,
        originY: 0.5,
      }).setDepth(depth),
    );
    // 오른쪽 위: 그날과 이 판을 바꾸는 단추. 그날의 기록이 없으면 이 판만 보인다.
    const tabs: Array<{ key: 'day' | 'run'; label: string }> = withDay
      ? [
          { key: 'day', label: DAMAGE_TEXT.today(state.day) },
          { key: 'run', label: DAMAGE_TEXT.run },
        ]
      : [{ key: 'run', label: DAMAGE_TEXT.run }];
    tabs.forEach((tab, index) => {
      const x = left + width - PANEL.pad - (tabs.length - index) * TAB.width - (tabs.length - 1 - index) * TAB.gap;
      const y = top + PANEL.pad;
      const on = tab.key === view;
      const g = keep(scene.add.graphics().setDepth(depth));
      const paint = (pressed: boolean): void => {
        g.clear();
        g.fillStyle(on ? THEME.pinkDeep : THEME.shadow, 1);
        g.fillRoundedRect(x, y + 2, TAB.width, TAB.height - 2, 9);
        g.fillStyle(on ? THEME.pink : THEME.card, 1);
        g.fillRoundedRect(x, y + (pressed && !on ? 2 : 0), TAB.width, TAB.height - 2, 9);
      };
      paint(false);
      keep(
        addText(scene, x + TAB.width / 2, y + (TAB.height - 2) / 2, tab.label, {
          size: FONT_SIZE.small,
          color: on ? THEME_CSS.inkDeep : THEME_CSS.sub,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(depth),
      );
      keep(
        addTapZone(scene, x, y - 2, TAB.width, TAB.height + 4, paint, () => {
          if (view === tab.key) return;
          view = tab.key;
          draw();
        }).setDepth(depth + 2),
      );
    });

    const rowsTop = top + PANEL.pad + HEAD.height;
    const best = rows[0]?.amount ?? 0;
    const g = keep(scene.add.graphics().setDepth(depth));
    const x = left + PANEL.pad;
    const barX = x + ROW.bar;
    if (rows.length === 0) {
      keep(
        addText(scene, GAME_WIDTH / 2, rowsTop + ROW.height / 2, DAMAGE_TEXT.empty, {
          size: FONT_SIZE.normal,
          color: THEME_CSS.sub,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(depth),
      );
    }
    rows.forEach((row, index) => {
      const middle = rowsTop + index * ROW.height + ROW.height / 2;
      const icon = keep(scene.add.image(x + ROW.icon / 2, middle, sourceTexture(row.source)).setDepth(depth));
      icon.setScale(ROW.icon / Math.max(icon.width, icon.height));
      keep(
        addText(scene, x + ROW.name, middle, sourceName(row.source), {
          size: FONT_SIZE.normal,
          originY: 0.5,
        }).setDepth(depth),
      );
      g.fillStyle(THEME.shadow, 1);
      g.fillRoundedRect(barX, middle - ROW.barHeight / 2, ROW.barWidth, ROW.barHeight, ROW.barHeight / 2);
      g.fillStyle(barColor(row.source), 1);
      g.fillRoundedRect(
        barX,
        middle - ROW.barHeight / 2,
        Math.max(ROW.barHeight, (ROW.barWidth * row.amount) / best),
        ROW.barHeight,
        ROW.barHeight / 2,
      );
      keep(
        addText(scene, x + ROW.share, middle, `${sharePercent(row.share)}%`, {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          originX: 1,
          originY: 0.5,
        }).setDepth(depth),
      );
      keep(
        addText(scene, x + inner, middle, damageLabel(row.amount), {
          size: FONT_SIZE.normal,
          color: THEME_CSS.accent,
          originX: 1,
          originY: 0.5,
        }).setDepth(depth),
      );
    });
    if (rest.length > 0) {
      const middle = rowsTop + rows.length * ROW.height + ROW.height / 2;
      const amount = rest.reduce((sum, row) => sum + row.amount, 0);
      const share = rest.reduce((sum, row) => sum + row.share, 0);
      keep(
        addText(scene, x + ROW.name, middle, DAMAGE_TEXT.rest(rest.length), {
          size: FONT_SIZE.normal,
          color: THEME_CSS.sub,
          originY: 0.5,
        }).setDepth(depth),
      );
      keep(
        addText(scene, x + ROW.share, middle, `${sharePercent(share)}%`, {
          size: FONT_SIZE.small,
          color: THEME_CSS.sub,
          originX: 1,
          originY: 0.5,
        }).setDepth(depth),
      );
      keep(
        addText(scene, x + inner, middle, damageLabel(amount), {
          size: FONT_SIZE.normal,
          color: THEME_CSS.sub,
          originX: 1,
          originY: 0.5,
        }).setDepth(depth),
      );
    }

    // 닫기 단추(동료 정보 창과 같은 모습)
    const buttonX = GAME_WIDTH / 2 - CLOSE.width / 2;
    const buttonY = rowsTop + lines * ROW.height + CLOSE.top;
    const button = keep(scene.add.graphics().setDepth(depth));
    const paintButton = (pressed: boolean): void => {
      button.clear();
      button.fillStyle(THEME.pinkDeep, 1);
      button.fillRoundedRect(buttonX, buttonY + 3, CLOSE.width, CLOSE.height - 3, 12);
      button.fillStyle(THEME.pink, 1);
      button.fillRoundedRect(buttonX, buttonY + (pressed ? 2 : 0), CLOSE.width, CLOSE.height - 3, 12);
    };
    paintButton(false);
    keep(
      addText(scene, GAME_WIDTH / 2, buttonY + (CLOSE.height - 3) / 2, DAMAGE_TEXT.close, {
        size: 13,
        color: THEME_CSS.inkDeep,
        originX: 0.5,
        originY: 0.5,
      }).setDepth(depth),
    );
    keep(addTapZone(scene, buttonX, buttonY, CLOSE.width, CLOSE.height, paintButton, onClose).setDepth(depth + 2));
  };

  draw();
  return {
    destroy: () => {
      for (const object of objects) object.destroy();
      objects = [];
    },
  };
}
