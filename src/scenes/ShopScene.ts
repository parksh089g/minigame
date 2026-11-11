import Phaser from 'phaser';
import { cardBackPreviewTexture, runnerTexture } from '../art/cosmetics';
import { COLOR, CSS, FONT_SIZE, GAME_WIDTH, SCENE } from '../config';
import { vibrate } from '../core/haptics';
import { sfx } from '../core/sfx';
import {
  isEquipped,
  isOwned,
  itemsIn,
  SLOT_INFO,
  SLOTS,
  type CosmeticItem,
  type CosmeticSlot,
} from '../core/shop';
import { store } from '../core/store';
import {
  addBackdrop,
  addTapZone,
  addText,
  CoinCounter,
  drawPanel,
  fadeIn,
  fadeToScene,
  PixelButton,
} from '../core/ui';

const MARGIN = 12;
const CONTENT_WIDTH = GAME_WIDTH - MARGIN * 2;
const TABS_TOP = 44;
const TAB_GAP = 4;
const TAB_HEIGHT = 24;
const HINT_TOP = 76;
const ROWS_TOP = 94;
const ROW_HEIGHT = 52;
const ROW_GAP = 6;
const PREVIEW_SIZE = 40;
/**
 * 사기 전에 한 번 더 눌러야 하는 시간(ms). 그 안에 다시 누르지 않으면 취소된다.
 * 아직 사지 않은 배경을 화면에 깔아 미리 보여 주는 시간이기도 하다.
 */
const CONFIRM_MS = 3000;

interface ShopData {
  /** 처음에 열어 둘 탭 */
  slot?: CosmeticSlot;
}

/** 코인으로 꾸미기를 사고 바꿔 끼우는 화면. */
export class ShopScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.TileSprite;
  private coins!: CoinCounter;
  private tabs!: Record<CosmeticSlot, PixelButton>;
  private hint!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private slot: CosmeticSlot = SLOTS[0];
  /** 지금 탭의 줄들을 이루는 것들. 탭을 바꾸거나 사고 나면 지우고 다시 만든다. */
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private rowsDirty = false;
  /** 한 번 눌러서 살지 묻고 있는 꾸미기 */
  private armedId: string | null = null;
  /** 묻는 것과 미리 보기를 끝내는 타이머 */
  private armedTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(SCENE.shop);
  }

  create(data: ShopData = {}): void {
    this.slot = data.slot ?? SLOTS[0];
    this.rowObjects = [];
    this.rowsDirty = false;
    this.armedId = null;
    this.armedTimer = null;

    this.backdrop = addBackdrop(this);
    new PixelButton(this, {
      x: 8,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-back',
      hitPadding: 6,
      onTap: () => fadeToScene(this, SCENE.hub),
    });
    addText(this, GAME_WIDTH / 2, 9, '꾸미기', {
      size: FONT_SIZE.large,
      bold: true,
      originX: 0.5,
      shadow: CSS.navy,
    });
    this.coins = new CoinCounter(this, GAME_WIDTH - 8, 11, store.data.coins);

    const tabWidth = (CONTENT_WIDTH - TAB_GAP * (SLOTS.length - 1)) / SLOTS.length;
    const tabs: Partial<Record<CosmeticSlot, PixelButton>> = {};
    SLOTS.forEach((slot, index) => {
      tabs[slot] = new PixelButton(this, {
        x: MARGIN + index * (tabWidth + TAB_GAP),
        y: TABS_TOP,
        width: tabWidth,
        height: TAB_HEIGHT,
        label: SLOT_INFO[slot].label,
        onTap: () => this.showSlot(slot),
      });
    });
    this.tabs = tabs as Record<CosmeticSlot, PixelButton>;

    this.hint = addText(this, MARGIN + 2, HINT_TOP, '', { color: CSS.silver });
    const rowCount = Math.max(...SLOTS.map((slot) => itemsIn(slot).length));
    const noticeTop = ROWS_TOP + rowCount * (ROW_HEIGHT + ROW_GAP) + 2;
    this.notice = addText(this, GAME_WIDTH / 2, noticeTop, '', {
      originX: 0.5,
      align: 'center',
      wrapWidth: CONTENT_WIDTH,
    });

    this.showSlot(this.slot, false);
    fadeIn(this);
  }

  override update(): void {
    // 줄을 누른 손가락이 떨어지는 도중에 그 줄을 지우지 않도록, 다시 그리는 일은 다음 프레임으로 미룬다.
    if (this.rowsDirty) {
      this.rowsDirty = false;
      this.buildRows();
    }
  }

  private showSlot(slot: CosmeticSlot, announce = true): void {
    this.slot = slot;
    this.disarm();
    for (const key of SLOTS) this.tabs[key].setStyle(key === slot ? 'blue' : 'neutral');
    this.hint.setText(SLOT_INFO[slot].hint);
    if (announce) this.setNotice('');
    this.rowsDirty = true;
  }

  private setNotice(text: string, color: string = CSS.silver): void {
    this.notice.setText(text).setColor(color);
  }

  /** 살지 묻던 것과 미리 보기를 거두고, 쓰고 있는 꾸미기로 되돌린다. */
  private disarm(): void {
    this.armedId = null;
    this.armedTimer?.remove();
    this.armedTimer = null;
    this.applyLook();
  }

  /**
   * 아직 사지 않은 꾸미기를 잠깐 입혀 본다. 지금은 화면 전체에 깔리는 배경만 해당한다.
   * 시간이 지나거나 다른 것을 누르면 disarm()이 되돌린다.
   */
  private tryOn(item: CosmeticItem, onEnd: () => void): void {
    if (item.slot === 'backdrop') this.backdrop.setTexture(item.id);
    this.armedTimer = this.time.delayedCall(CONFIRM_MS, () => {
      this.disarm();
      onEnd();
    });
  }

  private buildRows(): void {
    for (const object of this.rowObjects) object.destroy();
    this.rowObjects = [];
    itemsIn(this.slot).forEach((item, index) => {
      this.addRow(item, MARGIN, ROWS_TOP + index * (ROW_HEIGHT + ROW_GAP));
    });
  }

  private addRow(item: CosmeticItem, x: number, y: number): void {
    const cosmetics = store.data.cosmetics;
    const owned = isOwned(cosmetics, item.id);
    const equipped = isEquipped(cosmetics, item.id);
    const armed = this.armedId === item.id;
    const affordable = store.data.coins >= item.price;
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.rowObjects.push(object);
      return object;
    };

    const frame = keep(this.add.graphics());
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CONTENT_WIDTH, ROW_HEIGHT, {
        fill: pressed ? COLOR.navy : COLOR.charcoal,
        border: armed ? COLOR.yellow : equipped ? COLOR.lime : pressed ? COLOR.sky : COLOR.ink,
        highlight: pressed ? COLOR.navy : COLOR.slate,
      });
      drawPanel(frame, x + 6, y + 6, PREVIEW_SIZE, PREVIEW_SIZE, {
        fill: COLOR.ink,
        border: COLOR.navy,
        highlight: COLOR.ink,
      });
    };
    drawFrame(false);
    keep(this.addPreview(item, x + 6 + PREVIEW_SIZE / 2, y + 6 + PREVIEW_SIZE / 2));

    keep(addText(this, x + 54, y + 8, item.name, { bold: true }));
    const right = x + CONTENT_WIDTH - 10;
    if (equipped) {
      keep(addText(this, x + 54, y + 28, '사용 중', { color: CSS.lime }));
      keep(this.add.image(right, y + ROW_HEIGHT / 2, 'icon-check').setOrigin(1, 0.5).setTint(COLOR.lime));
    } else if (owned) {
      keep(addText(this, x + 54, y + 28, '눌러서 바꾸기', { color: CSS.silver }));
    } else {
      keep(this.add.image(x + 54, y + 30, 'coin').setOrigin(0, 0));
      keep(
        addText(this, x + 66, y + 28, String(item.price), {
          color: affordable ? CSS.yellow : CSS.slate,
        }),
      );
      if (armed) {
        keep(addText(this, right, y + 28, '한 번 더!', { bold: true, color: CSS.yellow, originX: 1 }));
      } else {
        keep(
          this.add
            .image(right, y + ROW_HEIGHT / 2, 'icon-lock')
            .setOrigin(1, 0.5)
            .setAlpha(affordable ? 1 : 0.5),
        );
      }
    }

    keep(
      addTapZone(this, x, y, CONTENT_WIDTH, ROW_HEIGHT, drawFrame, () => {
        if (equipped) {
          this.disarm();
          sfx.click();
          this.setNotice('지금 쓰고 있는 꾸미기예요.');
          this.rowsDirty = true;
        } else if (owned) {
          this.equip(item);
        } else if (!affordable) {
          this.disarm();
          this.tryOn(item, () => undefined);
          sfx.deny();
          this.setNotice(`코인이 ${item.price - store.data.coins}개 모자라요.`, CSS.orange);
          this.rowsDirty = true;
        } else if (armed) {
          this.buy(item);
        } else {
          this.arm(item);
        }
      }),
    );
  }

  /** 미리보기 칸 한가운데에 놓을 그림 */
  private addPreview(item: CosmeticItem, centerX: number, centerY: number): Phaser.GameObjects.GameObject {
    switch (item.slot) {
      case 'backdrop': {
        // 무늬가 드문드문해서, 두 배로 키워 한 귀퉁이를 보여 준다.
        const size = PREVIEW_SIZE - 4;
        return this.add
          .tileSprite(centerX, centerY, size, size, item.id)
          .setTileScale(2)
          .setTilePosition(-1, -1);
      }
      case 'runner':
        return this.add.image(centerX, centerY, runnerTexture(item.id, 'run1')).setScale(2);
      case 'cardBack':
        return this.add.image(centerX, centerY, cardBackPreviewTexture(item.id));
      case 'orb':
        return this.add.image(centerX, centerY, item.id);
    }
  }

  private equip(item: CosmeticItem): void {
    if (!store.equipCosmetic(item.id)) return;
    this.disarm();
    sfx.flip();
    vibrate(8);
    this.setNotice(`바꿨어요: ${item.name}`, CSS.lime);
    this.rowsDirty = true;
  }

  /** 첫 번째 누름: 실수로 사지 않도록 한 번 더 누르게 한다. */
  private arm(item: CosmeticItem): void {
    this.disarm();
    this.armedId = item.id;
    this.tryOn(item, () => {
      this.setNotice('');
      this.rowsDirty = true;
    });
    sfx.click();
    this.setNotice(`한 번 더 누르면 코인 ${item.price}개로 사요.`, CSS.yellow);
    this.rowsDirty = true;
  }

  private buy(item: CosmeticItem): void {
    const result = store.buyCosmetic(item.id);
    this.disarm();
    if (result.ok) {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.coins.set(store.data.coins);
      this.setNotice(`샀어요: ${item.name}`, CSS.lime);
    } else {
      sfx.deny();
      this.setNotice('지금은 살 수 없어요.', CSS.orange);
    }
    this.rowsDirty = true;
  }

  /** 쓰고 있는 배경을 이 화면에 깐다. */
  private applyLook(): void {
    this.backdrop.setTexture(store.data.cosmetics.equipped.backdrop);
  }
}
