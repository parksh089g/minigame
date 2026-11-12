import Phaser from 'phaser';
import { APP_BUILD, APP_VERSION, FONT_SIZE, GAME_WIDTH, SCENE, THEME_CSS } from '../config';
import { exportBundleText, importBundleText, resetParts } from '../core/bundle';
import { promptText, showCode } from '../core/dialog';
import { dateStamp, downloadText, pickTextFile } from '../core/files';
import { canVibrate, vibrate } from '../core/haptics';
import { showInstallGuide } from '../core/install-guide';
import { getOfflineStatus, isStandalone, onOfflineStatus, type OfflineStatus } from '../core/pwa';
import { sfx } from '../core/sfx';
import { store } from '../core/store';
import { addBackdrop, addPanel, addText, fadeIn, fadeToScene, PixelButton, whileBlocked } from '../core/ui';
import { nextVolume, volumeLabel } from '../core/volume';
import { failureText } from '../online/api';
import { afterImport, createTransferCode, useTransferCode } from '../online/online';
import { isJoined } from '../online/profile';
import { cleanCode, CODE_LENGTH, formatCode, TRANSFER_TTL_MS } from '../online/protocol';

const LEFT = 16;
const RIGHT = GAME_WIDTH - 16;
const CONTENT_WIDTH = RIGHT - LEFT;
const RESET_CONFIRM_MS = 3000;
/**
 * 구역마다의 세로 자리. 화면이 가장 짧을 때(400)에도 맨 아래 줄까지 들어가게 맞춘 값이다.
 * notice는 방금 한 일의 결과를 알리는 두 줄짜리 자리다.
 */
const TOP = { sound: 44, data: 124, transfer: 214, notice: 266, info: 298 } as const;
const TRANSFER_MINUTES = Math.round(TRANSFER_TTL_MS / 60000);

/** 색 구분 도우미를 켰을 때 무엇이 달라지는지 알려 주는 안내 */
const ASSIST_ON = '색깔 물 나누기와 길 잇기에서\n색마다 무늬를 또렷하게 보여 줘요.';
const ASSIST_OFF = '색 구분 도우미를 껐어요.';

/** 기록을 초기화한 뒤에 보여 주는 안내 */
const RESET_DONE = '기록, 코인, 꾸미기, 업적과\n등불지기, 새싹 컴퍼니까지 모두 지웠어요.';
/** 랭킹에 참여한 사람에게는 올린 기록이 남아 있다는 것까지 두 줄 안에 알려야 해서 줄여 쓴다. 지워지는 것은 누르기 전에 알렸다. */
const RESET_DONE_JOINED = '등불지기, 새싹 컴퍼니까지 모두 지웠어요.\n랭킹 기록은 랭킹 화면에서 뺄 수 있어요.';
/** "기록 초기화"를 한 번 눌렀을 때 무엇이 지워지는지 미리 알린다. */
const RESET_WARNING = '기록, 코인, 꾸미기, 업적과\n등불지기, 새싹 컴퍼니가 모두 지워져요.';

/** 저장 공간 보호가 꺼져 있을 때 저장 데이터 버튼 아래에 보여 주는 안내 */
const BACKUP_HINT = '브라우저가 기록을 지울 수 있어요.\n내보내기로 백업해 두세요.';

const OFFLINE_TEXT: Record<OfflineStatus, string> = {
  ready: '준비 완료',
  preparing: '준비 중',
  unsupported: '사용 불가',
};

interface SettingsData {
  /** 씬을 다시 그린 뒤 보여 줄 안내 문구 */
  notice?: { text: string; ok: boolean };
}

/** 효과음·배경 음악·진동·색 구분 도우미 설정, 세이브 내보내기·가져오기·초기화, 다른 기기로 옮기기, 앱 정보. 통계와 설치 안내로 가는 버튼도 있다. */
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
    this.addHeaderButtons();
    addText(this, GAME_WIDTH / 2, 8, '설정', { size: FONT_SIZE.large, originX: 0.5 });

    this.addSection(TOP.sound, '소리, 진동, 화면');
    // 한 줄에 둘씩 반반 나란히 둔다. 윗줄은 효과음과 배경 음악(음악이 있는 게임에서만 들린다),
    // 아랫줄은 진동과 색 구분 도우미다.
    const half = (CONTENT_WIDTH - 12) / 2;
    const leftHalf = { left: LEFT, right: LEFT + half, width: 50 };
    const rightHalf = { left: RIGHT - half, right: RIGHT, width: 50 };
    this.addToggleRow(
      TOP.sound + 16,
      '효과음',
      {
        isOn: () => store.data.settings.sound,
        label: () => volumeLabel(store.data.settings.sound, store.data.volume.sound),
        toggle: () => {
          // 누를 때마다 꺼짐, 작게, 보통, 크게를 돈다. 바꾼 크기는 바로 나는 누름 소리로 들어 볼 수 있다.
          store.update((save) => {
            const next = nextVolume(save.settings.sound, save.volume.sound);
            save.settings.sound = next.on;
            save.volume.sound = next.level;
          });
          sfx.click();
        },
      },
      leftHalf,
    );
    this.addToggleRow(
      TOP.sound + 16,
      '음악',
      {
        isOn: () => store.data.settings.music,
        label: () => volumeLabel(store.data.settings.music, store.data.volume.music),
        toggle: () => {
          store.update((save) => {
            const next = nextVolume(save.settings.music, save.volume.music);
            save.settings.music = next.on;
            save.volume.music = next.level;
          });
          sfx.click();
        },
      },
      rightHalf,
    );
    if (canVibrate()) {
      this.addToggleRow(
        TOP.sound + 46,
        '진동',
        {
          isOn: () => store.data.settings.vibration,
          toggle: () => {
            store.update((save) => void (save.settings.vibration = !save.settings.vibration));
            vibrate(30);
          },
        },
        leftHalf,
      );
    } else {
      addText(this, leftHalf.left, TOP.sound + 52, '진동');
      addText(this, leftHalf.right, TOP.sound + 53, '지원 안 함', {
        size: FONT_SIZE.small,
        color: THEME_CSS.sub,
        originX: 1,
      });
    }
    // 켜면 색으로 푸는 게임이 색마다 다른 무늬를 또렷하게 그린다. 무엇이 달라지는지는 켤 때 아래에 알린다.
    this.addToggleRow(
      TOP.sound + 46,
      '색 구분\n도우미',
      {
        isOn: () => store.data.settings.colorAssist,
        toggle: () => {
          store.update((save) => void (save.settings.colorAssist = !save.settings.colorAssist));
          sfx.click();
          const on = store.data.settings.colorAssist;
          this.showNotice(on ? ASSIST_ON : ASSIST_OFF, true);
        },
      },
      rightHalf,
    );

    this.addSection(TOP.data, '저장 데이터');
    this.addDataButtons(TOP.data + 16);

    this.addSection(TOP.transfer, '다른 기기로 옮기기');
    this.addTransferButtons(TOP.transfer + 16);
    this.noticeText = addText(this, LEFT, TOP.notice, '', { wrapWidth: CONTENT_WIDTH });
    if (data.notice) this.showNotice(data.notice.text, data.notice.ok);

    this.addSection(TOP.info, '정보');
    this.addInfoRows(TOP.info + 20);

    fadeIn(this);
  }

  /**
   * 제목 오른쪽의 작은 버튼들: 통계 화면과, 홈 화면에 추가하는 방법.
   * 아래 구역들은 가장 짧은 화면에 꼭 맞게 차 있어서 자리를 더 쓰지 않는 제목 줄에 둔다.
   * 이미 홈 화면에서 연 경우에는 설치 안내가 필요 없으니 통계만 보인다.
   */
  private addHeaderButtons(): void {
    const button = { y: 8, width: 38, height: 26, hitPadding: 2 } as const;
    const right = GAME_WIDTH - 8 - button.width;
    new PixelButton(this, {
      ...button,
      x: right,
      label: '통계',
      onTap: () => fadeToScene(this, SCENE.stats),
    });
    if (isStandalone()) return;
    new PixelButton(this, {
      ...button,
      x: right - button.width - 4,
      label: '설치',
      style: 'yellow',
      onTap: () => void whileBlocked(this, showInstallGuide),
    });
  }

  private addSection(y: number, title: string): void {
    addText(this, LEFT, y, title, { color: THEME_CSS.accent });
  }

  /**
   * 이름은 왼쪽 끝에, 켜고 끄는 버튼은 오른쪽 끝에 둔다. span을 안 주면 한 줄을 다 쓴다.
   * 이름이 두 줄이면 줄 사이를 붙여서 버튼의 높이 안에 들어가게 한다.
   */
  private addToggleRow(
    y: number,
    label: string,
    binding: { isOn: () => boolean; toggle: () => void; label?: () => string },
    span: { left: number; right: number; width: number } = { left: LEFT, right: RIGHT, width: 64 },
  ): void {
    if (label.includes('\n')) addText(this, span.left, y - 2, label, { lineSpacing: -1 });
    else addText(this, span.left, y + 6, label);
    const width = span.width;
    const button = new PixelButton(this, {
      x: span.right - width,
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
      // label이 있으면 켜짐 대신 그 말(소리의 크기)을 적는다.
      button.setLabel(binding.label?.() ?? (on ? '켜짐' : '꺼짐')).setStyle(on ? 'green' : 'neutral');
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
      onTap: () => void this.exportSave(),
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
          this.resetArmedUntil = 0;
          void this.resetAll();
          return;
        }
        // 실수로 지우지 않도록 두 번 눌러야 초기화된다. 무엇이 지워지는지도 미리 알린다.
        this.resetArmedUntil = this.time.now + RESET_CONFIRM_MS;
        resetButton.setLabel('한 번 더 누르면 지워져요').setStyle('yellow');
        const before = { text: this.noticeText.text, size: this.noticeText.style.fontSize, color: this.noticeText.style.color };
        this.showNotice(RESET_WARNING, false);
        this.time.delayedCall(RESET_CONFIRM_MS, () => {
          resetButton.setLabel('기록 초기화').setStyle('red');
          // 지우지 않고 지나갔으면 원래 떠 있던 문구로 돌려 둔다.
          if (this.noticeText.text === RESET_WARNING) {
            this.noticeText.setText(before.text).setFontSize(before.size).setColor(before.color);
          }
        });
      },
    });
  }

  /** 이 기기의 기록을 모두 지운다. 따로 저장하는 큰 게임(등불지기, 새싹 컴퍼니)도 처음 상태로 돌린다. */
  private async resetAll(): Promise<void> {
    store.resetProgress();
    await resetParts();
    if (!this.scene.isActive()) return;
    // 이 기기 안의 기록만 지워진다. 랭킹에 참여한 사람에게는 올린 기록이 남아 있다는 것도 알린다.
    const text = isJoined(store.data.online) ? RESET_DONE_JOINED : RESET_DONE;
    this.scene.restart({ notice: { text, ok: true } });
  }

  private async exportSave(): Promise<void> {
    const text = await exportBundleText(Infinity, true);
    if (text === null || !this.scene.isActive()) return;
    downloadText(`pocket-arcade-save-${dateStamp()}.json`, text);
    this.showNotice('세이브 파일을 내려받았어요.', true);
  }

  private async importSave(): Promise<void> {
    const text = await pickTextFile('application/json,.json');
    if (text === null || !this.scene.isActive()) return;
    if (await importBundleText(text)) {
      afterImport();
      if (this.scene.isActive()) this.scene.restart({ notice: { text: '세이브를 불러왔어요.', ok: true } });
    } else if (this.scene.isActive()) {
      this.showNotice('이 앱의 세이브 파일이 아니에요.', false);
    }
  }

  /** 코드로 다른 기기에 기록을 옮기는 두 버튼: 이 기기에서 코드를 만들고, 받을 기기에서 그 코드를 넣는다. */
  private addTransferButtons(y: number): void {
    const half = (CONTENT_WIDTH - 8) / 2;
    new PixelButton(this, {
      x: LEFT,
      y,
      width: half,
      height: 28,
      label: '코드 만들기',
      style: 'blue',
      onTap: () => void this.makeCode(),
    });
    new PixelButton(this, {
      x: LEFT + half + 8,
      y,
      width: half,
      height: 28,
      label: '코드 입력',
      style: 'blue',
      onTap: () => void this.enterCode(),
    });
  }

  private async makeCode(): Promise<void> {
    this.showNotice('코드를 만드는 중...', true);
    await whileBlocked(this, async () => {
      const result = await createTransferCode();
      if (!result.ok) {
        this.showNotice(
          result.reason === 'invalid' ? '기록이 너무 커서 옮길 수 없어요.' : failureText(result.reason),
          false,
        );
        return;
      }
      this.showNotice(`코드를 만들었어요. ${TRANSFER_MINUTES}분 동안 쓸 수 있어요.`, true);
      await showCode({
        title: '옮기기 코드',
        code: formatCode(result.data.code),
        hint: `${TRANSFER_MINUTES}분 안에 받을 기기의 설정에서 '코드 입력'을 눌러 이 코드를 넣어 주세요. 이 기기의 기록은 그대로 남아요.`,
      });
    });
  }

  private async enterCode(): Promise<void> {
    const notice = await whileBlocked(this, async () => {
      const answer = await promptText({
        title: '코드 입력',
        hint: '다른 기기에서 만든 코드를 넣어 주세요. 이 기기의 기록은 불러온 기록으로 바뀌어요.',
        placeholder: 'ABCD-EFGH',
        maxLength: CODE_LENGTH + 3,
        confirmLabel: '불러오기',
        code: true,
        check: (value) => {
          const code = cleanCode(value);
          return code === null ? { error: `코드는 ${CODE_LENGTH}글자예요. 다시 확인해 주세요.` } : { value: code };
        },
      });
      if (answer.action !== 'confirm') return null;
      this.showNotice('기록을 불러오는 중...', true);
      const result = await useTransferCode(answer.value);
      if (result.ok) return { text: '기록을 불러왔어요.', ok: true };
      const text =
        result.reason === 'notfound'
          ? '코드가 맞지 않거나 시간이 지났어요.'
          : result.reason === 'unreadable' || result.reason === 'invalid'
            ? '불러올 수 없는 기록이에요.'
            : failureText(result.reason);
      return { text, ok: false };
    });
    if (!notice || !this.scene.isActive()) return;
    if (notice.ok) this.scene.restart({ notice });
    else this.showNotice(notice.text, false);
  }

  private showNotice(text: string, ok: boolean): void {
    this.noticeText
      .setFontSize(FONT_SIZE.normal)
      .setText(text)
      .setColor(ok ? THEME_CSS.good : THEME_CSS.bad);
    // 두 줄로 넘어가는 긴 문구는 아래의 "정보" 제목에 붙지 않도록 작은 글자로 쓴다.
    if (this.noticeText.height > FONT_SIZE.normal * 2) this.noticeText.setFontSize(FONT_SIZE.small);
  }

  /**
   * 브라우저가 세이브를 지켜 주지 않을 때 백업을 권한다.
   * 방금 한 일의 결과를 알리는 문구가 떠 있으면 그것을 가리지 않는다.
   * 두 줄이라 아래의 "정보" 제목에 붙지 않도록 작은 글자로 쓴다.
   */
  private showBackupHint(): void {
    if (this.noticeText.text !== '') return;
    this.noticeText.setFontSize(FONT_SIZE.small).setText(BACKUP_HINT).setColor(THEME_CSS.sub);
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
      if (value === false) this.showBackupHint();
    });

    // 버전 숫자는 잘 바뀌지 않아서, 어느 빌드인지 알아볼 수 있는 코드를 옆에 붙인다.
    row(2, '버전', APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION);
    addText(this, LEFT, top + 58, '글꼴 주아(Jua)', { size: FONT_SIZE.small, color: THEME_CSS.sub });
  }
}
