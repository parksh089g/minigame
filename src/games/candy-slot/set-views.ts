/**
 * 부적 세트(sets.ts)를 화면에 놓는 것들: 가게의 카드에 다는 세트의 표, 가게의 세트 줄("체리 세트 2/3"),
 * 붙인 부적의 세트 표시(같은 세트의 점과, 덤이 들면 두르는 테두리), 설명 창의 세트 한 줄.
 * 무엇을 적을지는 sets.ts가 정하고, 여기서는 자리를 잡아 그리기만 한다. 씬은 여기의 함수를 불러 놓고 치운다.
 */
import type Phaser from 'phaser';
import { FONT_SIZE, THEME } from '../../config';
import { addText } from '../../core/ui';
import { LOOK, SET_TONES, setInk } from './art';
import type { Box } from './rules';
import { CHIP } from './shop-text';
import { SET_TEXT, setNoteOf, setOf, setProgressText, shopSetsOf, type SetProgress } from './sets';

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;

/** 치울 수 있는 것 */
interface Disposable {
  destroy(): void;
}

/** 세트 표의 글자 색: 색을 칠한 바탕 위에 놓는 흰 글자 */
const ON_TONE = '#ffffff';

// ───────── 가게의 카드에 다는 표 ─────────

/**
 * 가게의 카드에서 부적 그림의 아래 끝에 걸리는 세트의 표. 표가 붙는 카드는 그림을 lift만큼 올려서 표가 그림을 덜 가린다.
 * 표의 한가운데는 카드의 한가운데에서 drop만큼 아래다(줄의 높이가 가장 낮은 40일 때에도 카드 안에 든다).
 */
export const SET_RIBBON = { height: 12, padX: 3, minWidth: 22, drop: 13, lift: 3 } as const;

export interface SetRibbon {
  back: Graphics;
  text: Text;
}

export function addSetRibbon(scene: Phaser.Scene, depth: number): SetRibbon {
  return {
    back: scene.add.graphics().setDepth(depth),
    text: addText(scene, 0, 0, '', { size: FONT_SIZE.small, color: ON_TONE, originX: 0.5, originY: 0.5 }).setDepth(depth),
  };
}

/**
 * 부적 id가 드는 세트의 표를 (centerX, middle + drop)에 그린다. 세트에 들지 않거나 id가 없으면 감춘다.
 * 표가 놓였는지를 돌려준다(놓였으면 씬이 그림을 lift만큼 올린다).
 */
export function drawSetRibbon(ribbon: SetRibbon, id: string | null, centerX: number, middle: number): boolean {
  const set = id ? setOf(id) : undefined;
  ribbon.back.clear();
  if (!set) {
    ribbon.text.setText('').setVisible(false);
    return false;
  }
  const y = Math.round(middle + SET_RIBBON.drop);
  ribbon.text.setText(set.tag).setPosition(Math.round(centerX), y).setVisible(true);
  const width = Math.max(SET_RIBBON.minWidth, Math.ceil(ribbon.text.width) + SET_RIBBON.padX * 2);
  const top = y - SET_RIBBON.height / 2;
  ribbon.back.fillStyle(THEME.white, 1);
  ribbon.back.fillRoundedRect(centerX - width / 2 - 1, top - 1, width + 2, SET_RIBBON.height + 2, (SET_RIBBON.height + 2) / 2);
  ribbon.back.fillStyle(SET_TONES[set.id], 1);
  ribbon.back.fillRoundedRect(centerX - width / 2, top, width, SET_RIBBON.height, SET_RIBBON.height / 2);
  return true;
}

// ───────── 가게의 세트 줄 ─────────

/** 가게의 세트 줄에서 표 사이의 틈 */
const LINE_GAP = 4;

/**
 * 가게의 세트 줄: 붙인 부적으로 모으고 있는 세트를 "체리 세트 2/3"처럼 표로 늘어놓는다(덤이 든 세트는 색을 칠한다).
 * 많이 모은 세트부터 줄에 들어가는 만큼만 놓고, 모은 세트가 없으면 세트를 모으라는 안내를 적는다.
 * box는 줄이 차지하는 자리이고, 표는 그 한가운데 높이에 가운데 맞춰 놓인다.
 */
export class SetLine {
  private views: Disposable[] = [];
  /** 마지막으로 그린 부적과 가게. 알림이 걷히면 이것으로 다시 그린다. */
  private last: { charms: readonly string[]; offers: readonly (string | null)[] } = { charms: [], offers: [] };
  /** 세트의 덤을 알리는 동안 줄을 다시 그리지 않게 막는 타이머 */
  private cheering: Phaser.Time.TimerEvent | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly box: Box,
    private readonly depth: number,
  ) {}

  /** 지금 붙인 부적과 가게에 나온 부적으로 다시 그린다. */
  refresh(charms: readonly string[], offers: readonly (string | null)[]): void {
    this.last = { charms: [...charms], offers: [...offers] };
    if (this.cheering) return;
    this.clear();
    const middle = Math.round(this.box.y + this.box.height / 2);
    const sets = shopSetsOf(charms, offers);
    if (sets.length === 0) {
      this.views.push(
        addText(this.scene, this.box.x + this.box.width / 2, middle, SET_TEXT.teach, {
          size: FONT_SIZE.small,
          color: LOOK.text.faint,
          originX: 0.5,
          originY: 0.5,
        }).setDepth(this.depth),
      );
      return;
    }
    // 표의 바탕이 글 밑에 깔리게 글보다 먼저 만든다(그리는 것은 글의 폭을 잰 뒤에 한다).
    const back = this.scene.add.graphics().setDepth(this.depth);
    this.views.push(back);
    const chips: Array<{ progress: SetProgress; text: Text; width: number }> = [];
    let used = 0;
    for (const progress of sets) {
      const active = progress.active !== null;
      const text = addText(this.scene, 0, middle, setProgressText(progress), {
        size: FONT_SIZE.small,
        color: active ? ON_TONE : setInk(progress.set.id),
        originY: 0.5,
      }).setDepth(this.depth);
      const width = Math.ceil(text.width) + CHIP.padX * 2;
      const next = used + (chips.length > 0 ? LINE_GAP : 0) + width;
      if (next > this.box.width) {
        text.destroy();
        break;
      }
      used = next;
      chips.push({ progress, text, width });
    }
    let x = Math.round(this.box.x + (this.box.width - used) / 2);
    for (const { progress, text, width } of chips) {
      const tone = SET_TONES[progress.set.id];
      const top = middle - CHIP.height / 2;
      back.fillStyle(tone, 1);
      back.fillRoundedRect(x, top, width, CHIP.height, CHIP.height / 2);
      // 덤이 아직 들지 않은 세트는 테두리만 그 색이다.
      if (!progress.active) {
        back.fillStyle(THEME.white, 1);
        back.fillRoundedRect(x + 1, top + 1, width - 2, CHIP.height - 2, (CHIP.height - 2) / 2);
      }
      text.setX(x + CHIP.padX);
      this.views.push(text);
      x += width + LINE_GAP;
    }
  }

  /**
   * 세트의 덤이 새로 들었다고 이 줄에 잠깐 알린다("체리 세트! 체리 상금 +4", 세트의 색). 줄의 자리를 그대로 써서
   * 가게의 다른 글을 가리지 않는다. ms가 지나면 모은 정도로 돌아간다.
   */
  cheer(label: string, color: string, ms: number): void {
    this.cheering?.remove();
    this.clear();
    const text = addText(this.scene, this.box.x + this.box.width / 2, Math.round(this.box.y + this.box.height / 2), label, {
      size: FONT_SIZE.small,
      color,
      originX: 0.5,
      originY: 0.5,
    }).setDepth(this.depth);
    this.views.push(text);
    this.scene.tweens.add({ targets: text, scale: { from: 1.25, to: 1 }, duration: 240, ease: 'Back.Out' });
    this.cheering = this.scene.time.delayedCall(ms, () => {
      this.cheering = null;
      this.refresh(this.last.charms, this.last.offers);
    });
  }

  private clear(): void {
    for (const view of this.views) view.destroy();
    this.views = [];
  }

  destroy(): void {
    this.cheering?.remove();
    this.cheering = null;
    this.clear();
  }
}

// ───────── 붙인 부적의 세트 표시 ─────────

/** 붙인 부적의 왼쪽 아래 귀퉁이에 찍는 세트의 점(반지름)과, 덤이 든 세트의 부적을 두르는 테두리의 두께 */
const SLOT_DOT = { r: 3.5, inset: 5 } as const;
const SLOT_RING = 2;

/**
 * 붙인 부적의 세트 표시를 그린다: 세트에 드는 부적에는 왼쪽 아래 귀퉁이에 세트의 색 점을 찍고,
 * 덤이 든 세트(같은 세트를 두 장 넘게 붙인 것)의 부적은 그 색의 테두리로 두른다. 가게에서도 돌리는 동안에도 보인다.
 */
export function drawSetMarks(
  g: Graphics,
  charms: readonly string[],
  slots: ReadonlyArray<{ x: number; y: number }>,
  slotSize: number,
): void {
  g.clear();
  charms.forEach((id, index) => {
    const slot = slots[index];
    const note = setNoteOf(charms, id);
    if (!slot || !note) return;
    const tone = SET_TONES[note.set.id];
    if (note.active) {
      g.lineStyle(SLOT_RING, tone, 1);
      g.strokeRoundedRect(slot.x - 1, slot.y - 1, slotSize + 2, slotSize + 2, 9);
    }
    const x = slot.x + SLOT_DOT.inset;
    const y = slot.y + slotSize - SLOT_DOT.inset;
    g.fillStyle(THEME.white, 1);
    g.fillCircle(x, y, SLOT_DOT.r + 1.2);
    g.fillStyle(tone, 1);
    g.fillCircle(x, y, SLOT_DOT.r);
  });
}

// ───────── 설명 창의 세트 한 줄 ─────────

/**
 * 붙인 부적의 설명 창에 세트의 한 줄을 놓는다: 세트의 표("체리 세트 2/3")와 그 옆에 지금 듣는 덤(초록)이나
 * 다음 단계("3장이면 체리 상금 +3", 흐린 글). 세트에 들지 않는 부적이면 아무것도 놓지 않는다.
 * (left, middle)은 줄의 왼쪽 끝과 한가운데 높이이고, 놓은 것들을 돌려준다.
 */
export function addSetNote(
  scene: Phaser.Scene,
  charms: readonly string[],
  id: string,
  left: number,
  middle: number,
  depth: number,
): Disposable[] {
  const note = setNoteOf(charms, id);
  if (!note) return [];
  const back = scene.add.graphics().setDepth(depth);
  const label = addText(scene, left + CHIP.padX, middle, note.progress, {
    size: FONT_SIZE.small,
    color: ON_TONE,
    originY: 0.5,
  }).setDepth(depth);
  const width = Math.ceil(label.width) + CHIP.padX * 2;
  back.fillStyle(SET_TONES[note.set.id], 1);
  back.fillRoundedRect(left, middle - CHIP.height / 2, width, CHIP.height, CHIP.height / 2);
  const bonus = addText(scene, left + width + 4, middle, note.bonus, {
    size: FONT_SIZE.small,
    color: note.active ? LOOK.text.good : LOOK.text.sub,
    originY: 0.5,
  }).setDepth(depth);
  return [back, label, bonus];
}
