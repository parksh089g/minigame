import type Phaser from 'phaser';
import { promptText } from '../core/dialog';
import { store } from '../core/store';
import { showToast } from '../core/toast';
import { whileBlocked } from '../core/ui';
import { failureText } from '../online/api';
import { leaveRanking, setNickname } from '../online/online';
import { isJoined } from '../online/profile';
import { cleanName, NAME_MAX, NAME_MIN } from '../online/protocol';

const NAME_RULE = `${NAME_MIN}~${NAME_MAX}자의 한글, 영문, 숫자로 지어 주세요.`;

/**
 * 닉네임을 묻는 창을 띄운다. 닉네임을 정하면 그때부터 랭킹에 참여한다.
 * 이미 참여하고 있으면 닉네임을 바꾸거나 랭킹에서 빠질 수 있다.
 * 바뀐 것이 있으면 true. 서버에는 부른 쪽이 syncScores()로 올린다.
 */
export async function askNickname(scene: Phaser.Scene): Promise<boolean> {
  const online = store.data.online;
  const joined = isJoined(online);
  const changed = await whileBlocked(scene, async () => {
    const answer = await promptText({
      title: '닉네임',
      hint: '랭킹에 보이는 이름이에요. 닉네임과 게임별 최고 점수만 서버에 올라가요.',
      value: online.name ?? '',
      placeholder: '닉네임',
      maxLength: NAME_MAX,
      confirmLabel: joined ? '바꾸기' : '참여하기',
      check: (value) => {
        const name = cleanName(value);
        return name === null ? { error: NAME_RULE } : { value: name };
      },
      extra: joined
        ? { label: '랭킹에서 내 기록 빼기', confirmLabel: '한 번 더 누르면 모든 랭킹에서 빠져요' }
        : undefined,
    });
    if (answer.action === 'confirm') {
      if (answer.value === online.name) return false;
      setNickname(answer.value);
      return true;
    }
    if (answer.action === 'extra') {
      const result = await leaveRanking();
      showToast(result.ok ? '랭킹에서 내 기록을 뺐어요.' : failureText(result.reason));
      return result.ok;
    }
    return false;
  });
  return changed === true && scene.scene.isActive();
}
