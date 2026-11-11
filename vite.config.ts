import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// 도메인 루트가 아닌 하위 경로에 올릴 때는 BASE_PATH=/경로/ 로 빌드한다.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    // Phaser 한 덩어리가 1MB를 넘는다. 설치할 때 한 번만 받으므로 경고 기준을 올린다.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        // 엔진을 따로 떼어 두면 게임 코드만 바뀐 업데이트에서 엔진을 다시 받지 않는다.
        codeSplitting: {
          groups: [{ name: 'phaser', test: /node_modules[\\/]phaser/ }],
        },
      },
    },
  },
  plugins: [
    VitePWA({
      // 플레이 도중에 멋대로 새로고침되지 않도록, 새 버전은 안내를 띄우고 사용자가 누를 때 적용한다.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '포켓 아케이드',
        short_name: '포켓 아케이드',
        description: '온·오프라인에서 즐기는 픽셀 아트 미니게임 모음',
        lang: 'ko',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1a1c2c',
        theme_color: '#1a1c2c',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 오프라인 실행에 필요한 파일을 설치할 때 모두 받아 둔다.
        globPatterns: ['**/*.{js,css,html,png,woff2,webmanifest,txt}'],
        // 기본 한도(2MB) 때문에 엔진 파일이 빠지면 오프라인에서 실행되지 않는다.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
