/**
 * 준비 화면에서 잔치의 밤 단추를 누르면 뜨는 창: 잔치의 밤이 무엇인지 알려 주고, 난이도를 고르거나 끈다.
 * 하나를 고르면 스스로 사라지고 onPick이 불린다. 카드 바깥을 누르면 아무것도 바꾸지 않고 닫힌다.
 */
import type Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';
import { FEAST, FEAST_LEVELS, FEAST_ORDER, MAX_WEAPONS, type FeastId } from './data';
import { formatTimes } from './rules';

const CARD = { width: 212, height: 38, gap: 6 } as const;
/** 단추를 누른 손가락이 떨어지는 것을 창의 바깥을 누른 것으로 보지 않도록 잠깐 뒤부터 받는다. */
const ARM_DELAY_MS = 150;

interface FeastChoice {
  level: FeastId | null;
  title: string;
  description: string;
  color: string;
}

/** 난이도마다 경험치와, 점수와 불씨의 배율을 한 줄로 적는다. */
export function feastChoiceText(level: FeastId): string {
  const { xp, reward } = FEAST_LEVELS[level];
  return `경험치 ${formatTimes(xp)} · 점수와 불씨 ${formatTimes(reward)}`;
}

/** 난이도마다의 글자색. 고르는 창과 판을 시작할 때 뜨는 글자가 같이 쓴다. */
export const FEAST_COLOR: Readonly<Record<FeastId, string>> = { easy: CSS.lime, normal: CSS.yellow, hard: CSS.orange };

export function showFeastPicker(
  scene: Phaser.Scene,
  depth: number,
  /** 지금 고른 난이도. 꺼져 있으면 null */
  current: FeastId | null,
  onPick: (level: FeastId | null) => void,
): void {
  const { width, height } = scene.scale;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject & { setDepth(value: number): unknown }>(item: T): T => {
    item.setDepth(depth);
    parts.push(item);
    return item;
  };
  let armed = false;
  let closed = false;
  scene.time.delayedCall(ARM_DELAY_MS, () => {
    armed = true;
  });
  const close = (): void => {
    closed = true;
    for (const part of parts) part.destroy();
  };

  const choices: FeastChoice[] = [
    ...FEAST_ORDER.map((level) => ({
      level,
      title: FEAST_LEVELS[level].name,
      description: feastChoiceText(level),
      color: FEAST_COLOR[level],
    })),
    { level: null, title: '끄기', description: `무기 ${MAX_WEAPONS}칸의 보통 판으로 가요`, color: CSS.silver },
  ];

  const intro = `무기를 ${FEAST.weapons}개까지 들어요.\n정예 둘도 무기 강화권을 줘요.`;
  const cards = choices.length * CARD.height + (choices.length - 1) * CARD.gap;
  // 제목(24) + 설명 두 줄(30) + 카드 + 아래 한 줄(14)을 한 덩어리로 화면 가운데에 둔다.
  const top = Math.max(8, Math.round((height - (24 + 8 + 30 + 10 + cards + 8 + 14)) / 2));
  const left = Math.round((GAME_WIDTH - CARD.width) / 2);

  // 뒤를 가리는 막. 카드 바깥을 누르면 바꾸지 않고 닫는다.
  const scrim = keep(scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.9).setOrigin(0, 0).setInteractive());
  scrim.on('pointerup', () => {
    if (!armed || closed) return;
    close();
  });
  keep(
    addText(scene, GAME_WIDTH / 2, top, FEAST.name, {
      size: FONT_SIZE.large,
      bold: true,
      color: CSS.yellow,
      originX: 0.5,
      shadow: CSS.orange,
    }),
  );
  keep(
    addText(scene, GAME_WIDTH / 2, top + 32, intro, {
      color: CSS.white,
      originX: 0.5,
      align: 'center',
      lineSpacing: 3,
      shadow: CSS.ink,
    }),
  );

  const cardsTop = top + 32 + 30 + 10;
  choices.forEach((choice, index) => {
    const y = cardsTop + index * (CARD.height + CARD.gap);
    const picked = choice.level === current;
    const frame = keep(scene.add.graphics());
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, left, y, CARD.width, CARD.height, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: picked ? COLOR.yellow : pressed ? COLOR.sky : COLOR.slate,
        shadow: COLOR.ink,
      });
      // 고른 것에는 오른쪽에 채운 네모, 아닌 것에는 빈 네모(준비 화면의 단추와 같은 모양)
      const boxX = left + CARD.width - 18;
      const boxY = y + CARD.height / 2 - 4;
      frame.lineStyle(1, picked ? COLOR.yellow : COLOR.silver, 1).strokeRect(boxX + 0.5, boxY + 0.5, 7, 7);
      if (picked) frame.fillStyle(COLOR.yellow, 1).fillRect(boxX + 2, boxY + 2, 4, 4);
    };
    draw(false);
    keep(addText(scene, left + 12, y + 5, choice.title, { bold: true, color: choice.color }));
    keep(addText(scene, left + 12, y + 21, choice.description, { size: FONT_SIZE.small, color: CSS.silver }));
    keep(
      addTapZone(scene, left, y, CARD.width, CARD.height, draw, () => {
        if (!armed || closed) return;
        sfx.click();
        close();
        onPick(choice.level);
      }),
    );
  });
  keep(
    addText(scene, GAME_WIDTH / 2, cardsTop + cards + 8, '오늘의 판은 늘 보통 판이에요', {
      size: FONT_SIZE.small,
      color: CSS.silver,
      originX: 0.5,
    }),
  );
}
