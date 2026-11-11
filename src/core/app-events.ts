/** 앱 바깥 틀(뒤로 가기, 화면 방향)과 씬이 주고받는 약속. Phaser에 의존하지 않는다. */

/** game.events로 알리는 일 */
export const APP_EVENT = {
  /** 진행 중인 미니게임이 있으면 일시정지해 달라는 요청. 화면이 가로로 돌아갔을 때 보낸다. */
  pauseRequest: 'app-pause-request',
} as const;

/**
 * 뒤로 가기를 스스로 처리하는 씬이 갖추는 모양.
 * 이 메서드가 없는 씬에서는 허브로 돌아간다(core/back.ts).
 */
export interface BackAware {
  onBackRequest(): void;
}
