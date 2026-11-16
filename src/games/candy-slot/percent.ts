/**
 * 몫들을 더해서 꼭 100이 되는 정수 퍼센트로 바꾼다.
 *
 * 하나씩 따로 반올림하면 합이 99나 101이 되기도 한다. 먼저 모두 내림하고,
 * 모자라는 만큼을 잘려 나간 소수가 큰 것부터 1씩 올려 준다. 소수가 같으면 앞의 것이 먼저다.
 * 몫의 합이 0이면 모두 0이다.
 */
export function wholePercents(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, share) => sum + Math.max(0, share), 0);
  if (!(total > 0)) return shares.map(() => 0);
  const exact = shares.map((share) => (Math.max(0, share) / total) * 100);
  const percents = exact.map((value) => Math.floor(value + 1e-9));
  const order = exact
    .map((value, index) => ({ index, rest: value - percents[index] }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  let short = 100 - percents.reduce((sum, value) => sum + value, 0);
  for (const { index } of order) {
    if (short <= 0) break;
    percents[index] += 1;
    short -= 1;
  }
  return percents;
}
