/**
 * 새벽을 맞았을 때 게임 위에 띄우는 선택 화면: 여기서 마칠지, 끝없는 밤으로 이어 갈지.
 * 하나를 고르면 스스로 사라지고 onPick이 불린다. 레벨업 선택 화면(levelup.ts)과 같은 모양의 카드를 쓴다.
 */
import type Phaser from 'phaser';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH } from '../../config';
import { vibrate } from '../../core/haptics';
import { sfx } from '../../core/sfx';
import { addTapZone, addText, drawPanel } from '../../core/ui';

const CARD = { width: 212, height: 64, gap: 8 } as const;
/** 움직이던 손가락으로 엉뚱한 것을 고르지 않도록 잠깐 뒤부터 누를 수 있다. */
const ARM_DELAY_MS = 500;

interface DawnOption {
  goOn: boolean;
  title: string;
  description: string;
  color: string;
  border: number;
}

export function showDawnChoice(
  scene: Phaser.Scene,
  depth: number,
  /** 지금 마치면 받는 점수 */
  score: number,
  /** goOn이면 끝없는 밤으로 이어 간다. */
  onPick: (goOn: boolean) => void,
): void {
  const { width, height } = scene.scale;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const keep = <T extends Phaser.GameObjects.GameObject & { setDepth(value: number): unknown }>(item: T): T => {
    item.setDepth(depth);
    parts.push(item);
    return item;
  };

  const options: DawnOption[] = [
    {
      goOn: false,
      title: '여기서 마치기',
      description: `새벽을 맞고 판을 끝내요 · ${score}점`,
      color: CSS.yellow,
      border: COLOR.yellow,
    },
    {
      goOn: true,
      title: '끝없는 밤으로',
      description: '쓰러질 때까지 버텨 점수와 불씨를 더 쌓아요.\n그림자는 갈수록 세지고, 새벽 기록은 남아요.',
      color: CSS.sky,
      border: COLOR.slate,
    },
  ];
  const total = options.length * CARD.height + (options.length - 1) * CARD.gap;
  const top = Math.round((height - total) / 2) + 24;
  const left = Math.round((GAME_WIDTH - CARD.width) / 2);

  keep(scene.add.rectangle(0, 0, width, height, COLOR.ink, 0.66).setOrigin(0, 0));
  keep(
    addText(scene, GAME_WIDTH / 2, top - 52, '새벽이 왔다!', {
      size: FONT_SIZE.large,
      bold: true,
      color: CSS.yellow,
      originX: 0.5,
      shadow: CSS.orange,
    }),
  );
  keep(
    addText(scene, GAME_WIDTH / 2, top - 22, '여기서 마칠까요, 더 버텨 볼까요?', {
      color: CSS.white,
      originX: 0.5,
      shadow: CSS.ink,
    }),
  );

  let armed = false;
  let picked = false;
  scene.time.delayedCall(ARM_DELAY_MS, () => {
    armed = true;
  });

  options.forEach((option, index) => {
    const y = top + index * (CARD.height + CARD.gap);
    const frame = keep(scene.add.graphics());
    const draw = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, left, y, CARD.width, CARD.height, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: pressed ? COLOR.sky : option.border,
        shadow: COLOR.ink,
      });
    };
    draw(false);
    const title = keep(addText(scene, left + 14, y, option.title, { bold: true, color: option.color }));
    const description = keep(
      addText(scene, left + 14, y, option.description, {
        size: FONT_SIZE.small,
        color: CSS.silver,
        lineSpacing: 2,
        wrapWidth: CARD.width - 24,
      }),
    );
    // 설명이 한 줄이든 두 줄이든 글 덩어리가 카드 가운데에 오게 한다.
    const textTop = Math.round(y + (CARD.height - title.height - 3 - description.height) / 2);
    title.setY(textTop);
    description.setY(textTop + title.height + 3);
    keep(
      addTapZone(scene, left, y, CARD.width, CARD.height, (pressed) => draw(pressed && armed), () => {
        if (!armed || picked) return;
        picked = true;
        sfx.click();
        vibrate(8);
        for (const part of parts) part.destroy();
        onPick(option.goOn);
      }),
    );
  });
}
