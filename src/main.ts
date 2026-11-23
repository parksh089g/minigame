import Phaser from 'phaser';
import './style.css';
import { computeGameHeight, FONT_FAMILY, FONT_SIZE, GAME_WIDTH, THEME } from './config';
import { initAppShell, untilUpright } from './core/shell';
import { initStage } from './core/stage-watch';
import { HiDpiPlugin, pickRenderScale, renderScale, setRenderScale } from './core/hidpi';
import { initInstall } from './core/install-guide';
import { initMotionGuard } from './core/motion-guard';
import { initPwa, isStandalone } from './core/pwa';
import { initAudioUnlock } from './core/sfx';
import { store } from './core/store';
import { BlockFillScene } from './games/block-fill/BlockFillScene';
import { BoxPushScene } from './games/box-push/BoxPushScene';
import { BrickBreakScene } from './games/brick-break/BrickBreakScene';
import { CandySlotScene } from './games/candy-slot/CandySlotScene';
import { ChosungQuizScene } from './games/chosung-quiz/ChosungQuizScene';
import { CloudTowerScene } from './games/cloud-tower/CloudTowerScene';
import { PyramidScene } from './games/pyramid/PyramidScene';
import { ColorSortScene } from './games/color-sort/ColorSortScene';
import { DuelScene } from './games/duel/DuelScene';
import { HulaScene } from './games/hula/HulaScene';
import { GardenGuardScene } from './games/garden-guard/GardenGuardScene';
import { GateRunScene } from './games/gate-run/GateRunScene';
import { HighLowScene } from './games/high-low/HighLowScene';
import { BlackjackScene } from './games/blackjack/BlackjackScene';
import { JumpRunnerScene } from './games/jump-runner/JumpRunnerScene';
import { LanternKeeperScene } from './games/lantern-keeper/LanternKeeperScene';
import { SproutCompanyScene } from './games/sprout-company/SproutCompanyScene';
import { LightningTapScene } from './games/lightning-tap/LightningTapScene';
import { LogicTilesScene } from './games/logic-tiles/LogicTilesScene';
import { MemoryCardsScene } from './games/memory-cards/MemoryCardsScene';
import { MergeTilesScene } from './games/merge-tiles/MergeTilesScene';
import { NemoLogicScene } from './games/nemo-logic/NemoLogicScene';
import { NumberPuzzleScene } from './games/number-puzzle/NumberPuzzleScene';
import { OneCardScene } from './games/one-card/OneCardScene';
import { ParkingOutScene } from './games/parking-out/ParkingOutScene';
import { MatchThreeScene } from './games/match-three/MatchThreeScene';
import { PathLinkScene } from './games/path-link/PathLinkScene';
import { PinPullScene } from './games/pin-pull/PinPullScene';
import { ScrewSortScene } from './games/screw-sort/ScrewSortScene';
import { SolitaireScene } from './games/solitaire/SolitaireScene';
import { StackTowerScene } from './games/stack-tower/StackTowerScene';
import { TailChaseScene } from './games/tail-chase/TailChaseScene';
import { initOnline } from './online/online';
import { AchievementsScene } from './scenes/AchievementsScene';
import { BootScene } from './scenes/BootScene';
import { HubScene } from './scenes/HubScene';
import { PauseScene } from './scenes/PauseScene';
import { RankingScene } from './scenes/RankingScene';
import { RuleBookScene } from './scenes/RuleBookScene';
import { ResultScene } from './scenes/ResultScene';
import { SettingsScene } from './scenes/SettingsScene';
import { StageResultScene } from './scenes/StageResultScene';
import { StagesScene } from './scenes/StagesScene';
import { ShopScene } from './scenes/ShopScene';
import { StatsScene } from './scenes/StatsScene';

declare global {
  interface Window {
    /** 디버깅과 자동 테스트에서 게임 상태를 들여다보는 용도 */
    __pocketArcade?: Phaser.Game;
  }
}

/** 캔버스에 글자를 그리기 전에 글꼴을 받아 둔다. 실패해도 기본 글꼴로 계속 진행한다. */
async function loadFonts(): Promise<void> {
  try {
    await document.fonts.load(`${FONT_SIZE.normal}px ${FONT_FAMILY}`, '가A1');
  } catch {
    // 글꼴이 없어도 게임은 할 수 있다.
  }
}

async function boot(): Promise<void> {
  // 브라우저가 "설치할 수 있다"고 알리는 것은 페이지를 연 직후 한 번뿐이라, 기다리는 일보다 먼저 들을 준비를 한다.
  initInstall();
  // 휴대폰을 가로로 눕힌 채 켰으면, 세로로 돌린 뒤에 화면 크기를 잰다(core/orientation.ts).
  await Promise.all([loadFonts(), store.load(), untilUpright()]);

  const parent = document.getElementById('app');
  if (!parent) throw new Error('#app 요소가 없습니다.');

  // 화면에 실제로 보이는 폭에 맞춰 캔버스를 논리 크기의 몇 배로 만들지 정한다(core/hidpi.ts).
  const logicalHeight = computeGameHeight(parent.clientWidth, parent.clientHeight);
  const displayWidth = Math.min(parent.clientWidth, (parent.clientHeight * GAME_WIDTH) / logicalHeight);
  setRenderScale(pickRenderScale(displayWidth, GAME_WIDTH, window.devicePixelRatio || 1));

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH * renderScale(),
    height: logicalHeight * renderScale(),
    backgroundColor: THEME.bg,
    antialias: true,
    plugins: {
      scene: [{ key: HiDpiPlugin.KEY, plugin: HiDpiPlugin, mapping: 'hidpi' }],
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 3 },
    disableContextMenu: true,
    // 효과음은 core/sfx.ts가 Web Audio로 직접 만든다.
    audio: { noAudio: true },
    banner: false,
    scene: [
      BootScene,
      HubScene,
      SettingsScene,
      StatsScene,
      ShopScene,
      AchievementsScene,
      RankingScene,
      LightningTapScene,
      MemoryCardsScene,
      JumpRunnerScene,
      StackTowerScene,
      ColorSortScene,
      GateRunScene,
      PinPullScene,
      ParkingOutScene,
      ScrewSortScene,
      MergeTilesScene,
      TailChaseScene,
      HighLowScene,
      BlackjackScene,
      LogicTilesScene,
      NemoLogicScene,
      NumberPuzzleScene,
      PathLinkScene,
      MatchThreeScene,
      BoxPushScene,
      BlockFillScene,
      ChosungQuizScene,
      BrickBreakScene,
      PyramidScene,
      CandySlotScene,
      SolitaireScene,
      OneCardScene,
      DuelScene,
      HulaScene,
      LanternKeeperScene,
      GardenGuardScene,
      CloudTowerScene,
      SproutCompanyScene,
      PauseScene,
      RuleBookScene,
      ResultScene,
      StagesScene,
      StageResultScene,
    ],
  });
  window.__pocketArcade = game;

  document.getElementById('boot')?.remove();
  initAudioUnlock();
  initMotionGuard();
  initPwa();
  initAppShell(game, parent);
  // 안내 문구와 입력 창의 크기를 캔버스에 맞춘다.
  initStage(game);
  // 닉네임을 정해 랭킹에 참여한 경우에만, 올리지 못한 기록을 올린다.
  initOnline();

  // 홈 화면에 설치해 쓰는 경우에는 브라우저가 세이브를 지우지 않도록 요청한다.
  if (isStandalone()) void store.requestPersistence();
}

boot().catch((error: unknown) => {
  console.error(error);
  const message =
    document.getElementById('boot') ?? document.body.appendChild(document.createElement('div'));
  message.id = 'boot';
  message.textContent = '게임을 시작하지 못했어요. 새로고침해 주세요.';
});
