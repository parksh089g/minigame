import Phaser from 'phaser';
import { backdropPreviewTexture, mascotTexture } from '../art/cosmetics';
import { CARD_HEIGHT, CARD_WIDTH, MASCOT_SIZE } from '../art/vector';
import { FONT_SIZE, GAME_WIDTH, SCENE, THEME, THEME_CSS } from '../config';
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
const GRID_TOP = 94;
const COLUMNS = 2;
const CELL_GAP = 8;
const CELL_WIDTH = (CONTENT_WIDTH - CELL_GAP * (COLUMNS - 1)) / COLUMNS;
/** 칸의 높이는 화면 길이에 맞춰 이 사이에서 정한다. */
const CELL_HEIGHT = { min: 76, max: 98 } as const;
/** 칸 아래쪽의 이름과 상태 두 줄이 차지하는 높이 */
const CELL_LABELS = 36;
/** 목록 아래에 안내 문구를 쓸 자리 */
const NOTICE_SPACE = 32;
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
  private cellHeight: number = CELL_HEIGHT.min;
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
    addText(this, GAME_WIDTH / 2, 8, '꾸미기', { size: FONT_SIZE.large, originX: 0.5 });
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

    this.hint = addText(this, MARGIN + 2, HINT_TOP, '', { color: THEME_CSS.sub });
    // 가장 많은 탭(캐릭터)이 한 화면에 다 들어가도록 칸의 높이를 정한다.
    const rowCount = Math.ceil(Math.max(...SLOTS.map((slot) => itemsIn(slot).length)) / COLUMNS);
    const room = this.scale.height - GRID_TOP - NOTICE_SPACE;
    this.cellHeight = Phaser.Math.Clamp(
      Math.floor((room - CELL_GAP * (rowCount - 1)) / rowCount) - 3,
      CELL_HEIGHT.min,
      CELL_HEIGHT.max,
    );
    this.notice = addText(this, GAME_WIDTH / 2, this.noticeTop(this.slot), '', {
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
    for (const key of SLOTS) this.tabs[key].setStyle(key === slot ? 'pink' : 'neutral');
    this.hint.setText(SLOT_INFO[slot].hint);
    if (announce) this.setNotice('');
    this.notice.setY(this.noticeTop(slot));
    this.rowsDirty = true;
  }

  /** 안내 문구의 자리. 그 탭의 마지막 줄 바로 아래라서, 줄이 적은 탭에서도 물건 곁에 뜬다. */
  private noticeTop(slot: CosmeticSlot): number {
    const rows = Math.ceil(itemsIn(slot).length / COLUMNS);
    return GRID_TOP + rows * (this.cellHeight + CELL_GAP) + 2;
  }

  private setNotice(text: string, color: string = THEME_CSS.sub): void {
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
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      this.addCell(
        item,
        MARGIN + column * (CELL_WIDTH + CELL_GAP),
        GRID_TOP + row * (this.cellHeight + CELL_GAP),
      );
    });
  }

  private addCell(item: CosmeticItem, x: number, y: number): void {
    const cosmetics = store.data.cosmetics;
    const owned = isOwned(cosmetics, item.id);
    const equipped = isEquipped(cosmetics, item.id);
    const armed = this.armedId === item.id;
    const affordable = store.data.coins >= item.price;
    const height = this.cellHeight;
    const centerX = x + CELL_WIDTH / 2;
    const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      this.rowObjects.push(object);
      return object;
    };

    const frame = keep(this.add.graphics());
    const drawFrame = (pressed: boolean): void => {
      frame.clear();
      drawPanel(frame, x, y, CELL_WIDTH, height, {
        fill: pressed ? THEME.dim : equipped ? THEME.mintSoft : THEME.card,
        border: armed ? THEME.gold : equipped ? THEME.mintDeep : undefined,
        shadow: armed ? THEME.butterDeep : equipped ? THEME.mintDeep : THEME.shadow,
        radius: 14,
      });
    };
    drawFrame(false);
    const previewHeight = height - CELL_LABELS - 10;
    keep(this.addPreview(item, centerX, y + 7 + previewHeight / 2, previewHeight));

    const nameY = y + height - CELL_LABELS + 2;
    const statusY = nameY + 16;
    keep(addText(this, centerX, nameY, item.name, { originX: 0.5 }));
    if (equipped) {
      keep(addText(this, centerX, statusY, '사용 중', { color: THEME_CSS.good, originX: 0.5 }));
      keep(this.add.image(x + CELL_WIDTH - 7, y + 7, 'icon-check').setOrigin(1, 0));
    } else if (owned) {
      keep(addText(this, centerX, statusY, '눌러서 바꾸기', { color: THEME_CSS.sub, originX: 0.5 }));
    } else if (armed) {
      keep(addText(this, centerX, statusY, '한 번 더!', { color: THEME_CSS.accent, originX: 0.5 }));
    } else {
      const price = keep(
        addText(this, 0, statusY, String(item.price), {
          color: affordable ? THEME_CSS.ink : THEME_CSS.faint,
        }),
      );
      const left = Math.round(centerX - (15 + price.width) / 2);
      keep(this.add.image(left, statusY + 8, 'coin').setOrigin(0, 0.5).setAlpha(affordable ? 1 : 0.6));
      price.setX(left + 15);
      keep(
        this.add
          .image(x + CELL_WIDTH - 7, y + 7, 'icon-lock')
          .setOrigin(1, 0)
          .setAlpha(affordable ? 0.9 : 0.4),
      );
    }

    keep(
      addTapZone(this, x, y, CELL_WIDTH, height, drawFrame, () => {
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
          this.setNotice(`코인이 ${item.price - store.data.coins}개 모자라요.`, THEME_CSS.bad);
          this.rowsDirty = true;
        } else if (armed) {
          this.buy(item);
        } else {
          this.arm(item);
        }
      }),
    );
  }

  /** 칸 위쪽 한가운데에 놓을 그림. room은 그림에 쓸 수 있는 높이다. */
  private addPreview(
    item: CosmeticItem,
    centerX: number,
    centerY: number,
    room: number,
  ): Phaser.GameObjects.GameObject {
    switch (item.slot) {
      case 'backdrop':
        return this.add.image(centerX, centerY, backdropPreviewTexture(item.id));
      case 'runner': {
        const height = Math.min(room + 4, MASCOT_SIZE.height);
        const width = (height * MASCOT_SIZE.width) / MASCOT_SIZE.height;
        return this.add
          .image(centerX, centerY + 1, mascotTexture(item.id, 'idle'))
          .setDisplaySize(width, height);
      }
      case 'cardBack': {
        const height = Math.min(room, 46);
        return this.add
          .image(centerX, centerY, item.id)
          .setDisplaySize((height * CARD_WIDTH) / CARD_HEIGHT, height);
      }
      case 'orb': {
        const size = Math.min(room - 2, 36);
        return this.add.image(centerX, centerY, item.id).setDisplaySize(size, size);
      }
    }
  }

  private equip(item: CosmeticItem): void {
    if (!store.equipCosmetic(item.id)) return;
    this.disarm();
    sfx.flip();
    vibrate(8);
    this.setNotice(`바꿨어요: ${item.name}`, THEME_CSS.good);
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
    this.setNotice(`한 번 더 누르면 코인 ${item.price}개로 사요.`, THEME_CSS.accent);
    this.rowsDirty = true;
  }

  private buy(item: CosmeticItem): void {
    const result = store.buyCosmetic(item.id);
    this.disarm();
    if (result.ok) {
      sfx.gold();
      vibrate([15, 30, 15]);
      this.coins.set(store.data.coins);
      this.setNotice(`샀어요: ${item.name}`, THEME_CSS.good);
    } else {
      sfx.deny();
      this.setNotice('지금은 살 수 없어요.', THEME_CSS.bad);
    }
    this.rowsDirty = true;
  }

  /** 쓰고 있는 배경을 이 화면에 깐다. */
  private applyLook(): void {
    this.backdrop.setTexture(store.data.cosmetics.equipped.backdrop);
  }
}
