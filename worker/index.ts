/**
 * 포켓 아케이드의 서버. 하는 일은 두 가지뿐이다: 게임별 닉네임 랭킹, 그리고 세이브를 다른 기기로 옮길 때 잠깐 맡아 두기.
 * 게임 파일(dist/)은 Cloudflare가 그대로 내려 주고, 맞는 파일이 없는 요청만 여기로 온다.
 * 계정도 개인 정보도 받지 않는다. 받는 것은 닉네임, 점수, 앱이 무작위로 만든 기기 id, 그리고 옮길 세이브뿐이다.
 */
import { busy, handleApi } from './api';
import { ArcadeBoard } from './board';

export { ArcadeBoard };

interface Env {
  BOARD: DurableObjectNamespace<ArcadeBoard>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // 랭킹과 옮기기 코드는 Durable Object 하나가 모두 맡는다.
      return await handleApi(request, env.BOARD.getByName('main'));
    } catch {
      // 저장소가 답하지 않거나 무료 한도를 다 쓴 날에는 여기로 온다.
      return busy();
    }
  },
} satisfies ExportedHandler<Env>;
