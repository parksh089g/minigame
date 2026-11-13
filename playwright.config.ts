/**
 * 화면 점검(e2e/): 빌드한 앱을 실제 브라우저(Chromium)에 띄워 허브와 모든 게임이 오류 없이 열리는지 본다.
 * 단위 테스트(vitest)가 못 보는 것, 곧 Phaser가 그리는 동안 나는 오류나 장면 사이를 오가다 멈추는 것을 잡는다.
 *
 * 돌리는 법: `npm run build` 뒤에 `npm run e2e`. 서버(wrangler dev)는 저절로 띄우고,
 * 이미 떠 있으면(로컬) 그것을 쓴다. 휴대폰의 가장 작은 화면과 흔한 화면, 두 크기에서 모두 돌린다.
 */
import { defineConfig } from '@playwright/test';

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  // 단위 테스트(*.test.ts)와 섞이지 않게 화면 점검은 *.e2e.ts로 쓴다.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // CI의 느린 기계에서 한 번 흔들린 것은 다시 돌려 보고, 다시 돌려서 통과한 것은 "flaky"로 따로 적힌다.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  reporter: CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    // 서비스 워커가 지난 빌드를 내주거나 점검끼리 캐시를 나눠 쓰지 않게 막는다.
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    isMobile: true,
    hasTouch: true,
  },
  projects: [
    { name: '320x568', use: { viewport: { width: 320, height: 568 } } },
    { name: '390x844', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
