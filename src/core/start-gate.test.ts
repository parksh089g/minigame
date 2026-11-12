import { describe, expect, it } from 'vitest';
import { AUTO_START_SECONDS, StartGate } from './start-gate';

describe('첫 조작을 기다리는 문', () => {
  it('처음에는 닫혀 있고, 첫 조작을 하면 열린다', () => {
    const gate = new StartGate();
    expect(gate.open).toBe(false);
    expect(gate.start()).toBe(true);
    expect(gate.open).toBe(true);
    // 두 번째부터는 이미 열려 있다고 알려 준다.
    expect(gate.start()).toBe(false);
  });

  it('아무것도 하지 않아도 정해진 시간이 지나면 열린다', () => {
    const gate = new StartGate();
    expect(gate.wait(AUTO_START_SECONDS - 0.5)).toBe(false);
    expect(gate.open).toBe(false);
    expect(gate.wait(0.5)).toBe(true);
    expect(gate.open).toBe(true);
    // 열린 뒤에는 더 기다려도 "이번에 열렸다"고 하지 않는다.
    expect(gate.wait(10)).toBe(false);
  });

  it('기다리는 시간을 따로 정할 수 있다', () => {
    const gate = new StartGate(1);
    expect(gate.wait(0.99)).toBe(false);
    expect(gate.wait(0.02)).toBe(true);
  });

  it('다시 닫으면 처음부터 새로 기다린다', () => {
    const gate = new StartGate();
    gate.wait(AUTO_START_SECONDS - 0.1);
    gate.start();
    gate.reset();
    expect(gate.open).toBe(false);
    expect(gate.wait(AUTO_START_SECONDS - 0.1)).toBe(false);
    expect(gate.wait(0.2)).toBe(true);
  });
});
