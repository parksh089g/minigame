/**
 * 앱의 모듈(게임 목록 같은)을 점검 쪽(Node)에서 가져오기 전에, 빌드할 때 Vite가 채워 넣는 값을 둔다(vite.config.ts의 define).
 * 이 파일을 다른 앱 모듈보다 먼저 가져와야 한다. 가져온 차례대로 실행되므로 맨 위에 둔다.
 */
(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'e2e';
