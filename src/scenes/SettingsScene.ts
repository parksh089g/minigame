import Phaser from 'phaser';
import { APP_VERSION, FONT_SIZE, GAME_WIDTH, SCENE, THEME_CSS } from '../config';
import { dateStamp, downloadText, pickTextFile } from '../core/files';
import { canVibrate, vibrate } from '../core/haptics';
import { getOfflineStatus, onOfflineStatus, type OfflineStatus } from '../core/pwa';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { addBackdrop, addPanel, addText, fadeIn, fadeToScene, PixelButton } from '../core/ui';

const LEFT = 16;
const RIGHT = GAME_WIDTH - 16;
const CONTENT_WIDTH = RIGHT - LEFT;
const RESET_CONFIRM_MS = 3000;

const OFFLINE_TEXT: Record<OfflineStatus, string> = {
  ready: '준비 완료',
  preparing: '준비 중',
  unsupported: '사용 불가',
};

interface SettingsData {
  /** 씬을 다시 그린 뒤 보여 줄 안내 문구 */
  notice?: { text: string; ok: boolean };
}

/** 소리·진동 설정, 세이브 내보내기·가져오기·초기화, 앱 정보. */
export class SettingsScene extends Phaser.Scene {
  private noticeText!: Phaser.GameObjects.Text;
  private resetArmedUntil = 0;

  constructor() {
    super(SCENE.settings);
  }

  create(data: SettingsData = {}): void {
    this.resetArmedUntil = 0;
    addBackdrop(this);

    new PixelButton(this, {
      x: 8,
      y: 8,
      width: 26,
      height: 26,
      icon: 'icon-back',
      hitPadding: 6,
      onTap: () => fadeToScene(this, SCENE.hub),
    });
    addText(this, GAME_WIDTH / 2, 8, '설정', { size: FONT_SIZE.large, originX: 0.5 });

    this.addSection(48, '소리와 진동');
    this.addToggleRow(66, '효과음', {
      isOn: () => store.data.settings.sound,
      toggle: () => {
        store.update((save) => void (save.settings.sound = !save.settings.sound));
        sfx.click();
      },
    });
    if (canVibrate()) {
      this.addToggleRow(98, '진동', {
        isOn: () => store.data.settings.vibration,
        toggle: () => {
          store.update((save) => void (save.settings.vibration = !save.settings.vibration));
          vibrate(30);
        },
      });
    } else {
      addText(this, LEFT, 104, '진동');
      addText(this, RIGHT, 104, '이 기기는 지원 안 함', { color: THEME_CSS.sub, originX: 1 });
    }

    this.addSection(138, '저장 데이터');
    this.addDataButtons(156);
    this.noticeText = addText(this, LEFT, 228, '', { wrapWidth: CONTENT_WIDTH });
    if (data.notice) this.showNotice(data.notice.text, data.notice.ok);

    this.addSection(262, '정보');
    this.addInfoRows(286);

    fadeIn(this);
  }

  private addSection(y: number, title: string): void {
    addText(this, LEFT, y, title, { color: THEME_CSS.accent });
  }

  private addToggleRow(
    y: number,
    label: string,
    binding: { isOn: () => boolean; toggle: () => void },
  ): void {
    addText(this, LEFT, y + 6, label);
    const width = 64;
    const button = new PixelButton(this, {
      x: RIGHT - width,
      y,
      width,
      height: 26,
      label: '',
      onTap: () => {
        binding.toggle();
        refresh();
      },
    });
    const refresh = (): void => {
      const on = binding.isOn();
      button.setLabel(on ? '켜짐' : '꺼짐').setStyle(on ? 'green' : 'neutral');
    };
    refresh();
  }

  private addDataButtons(y: number): void {
    const half = (CONTENT_WIDTH - 8) / 2;
    new PixelButton(this, {
      x: LEFT,
      y,
      width: half,
      height: 28,
      label: '내보내기',
      style: 'green',
      onTap: () => {
        downloadText(`pocket-arcade-save-${dateStamp()}.json`, store.exportJson());
        this.showNotice('세이브 파일을 내려받았어요.', true);
      },
    });
    new PixelButton(this, {
      x: LEFT + half + 8,
      y,
      width: half,
      height: 28,
      label: '가져오기',
      style: 'green',
      onTap: () => void this.importSave(),
    });

    const resetButton = new PixelButton(this, {
      x: LEFT,
      y: y + 36,
      width: CONTENT_WIDTH,
      height: 28,
      label: '기록 초기화',
      style: 'red',
      onTap: () => {
        if (this.time.now < this.resetArmedUntil) {
          store.resetProgress();
          this.scene.restart({ notice: { text: '기록, 코인, 꾸미기, 업적을 모두 지웠어요.', ok: true } });
          return;
        }
        // 실수로 지우지 않도록 두 번 눌러야 초기화된다.
        this.resetArmedUntil = this.time.now + RESET_CONFIRM_MS;
        resetButton.setLabel('한 번 더 누르면 지워져요').setStyle('yellow');
        this.time.delayedCall(RESET_CONFIRM_MS, () => {
          resetButton.setLabel('기록 초기화').setStyle('red');
        });
      },
    });
  }

  private async importSave(): Promise<void> {
    const text = await pickTextFile('application/json,.json');
    if (text === null || !this.scene.isActive()) return;
    if (store.importJson(text)) {
      this.scene.restart({ notice: { text: '세이브를 불러왔어요.', ok: true } });
    } else {
      this.showNotice('이 앱의 세이브 파일이 아니에요.', false);
    }
  }

  private showNotice(text: string, ok: boolean): void {
    this.noticeText.setText(text).setColor(ok ? THEME_CSS.good : THEME_CSS.bad);
  }

  private addInfoRows(top: number): void {
    addPanel(this, LEFT - 6, top - 6, CONTENT_WIDTH + 12, 3 * 16 + 10);
    const row = (index: number, label: string, value: string): Phaser.GameObjects.Text => {
      const y = top + index * 16;
      addText(this, LEFT + 2, y, label, { color: THEME_CSS.sub });
      return addText(this, RIGHT - 2, y, value, { originX: 1 });
    };

    const offline = row(0, '오프라인 플레이', OFFLINE_TEXT[getOfflineStatus()]);
    const unsubscribe = onOfflineStatus((status) => offline.setText(OFFLINE_TEXT[status]));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    const persisted = row(1, '저장 공간 보호', '확인 중');
    void store.isPersisted().then((value) => {
      if (!persisted.active) return;
      persisted.setText(value === null ? '확인 불가' : value ? '켜짐' : '꺼짐');
    });

    row(2, '버전', APP_VERSION);
    addText(this, LEFT, top + 62, '글꼴 주아(Jua)', { size: FONT_SIZE.small, color: THEME_CSS.sub });
  }
}
