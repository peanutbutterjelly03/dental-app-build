import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaveScheduler, hasTextChange, sameJson } from './chartAutosave';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createSaveScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs once for a request and not twice at the same time', async () => {
    let concurrent = 0; let max = 0; let calls = 0;
    let release: () => void = () => {};
    const s = createSaveScheduler(async () => {
      calls++; concurrent++; max = Math.max(max, concurrent);
      await new Promise<void>((r) => { release = r; });
      concurrent--;
    });
    s.request(0); s.request(0); s.request(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    // changes made during the run are saved by ONE more run, never in parallel
    expect(calls).toBe(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(max).toBe(1);
  });

  it('waits for a pause when asked, and restarts the pause on every call', async () => {
    const run = vi.fn(async () => {});
    const s = createSaveScheduler(run);
    s.request(600);
    await vi.advanceTimersByTimeAsync(400);
    s.request(600);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a tick (delay 0) does not wait for a typing pause that is already running', async () => {
    const run = vi.fn(async () => {});
    const s = createSaveScheduler(run);
    s.request(600);
    s.request(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flush runs at once with force and resolves when idle', async () => {
    const seen: boolean[] = [];
    const s = createSaveScheduler(async (force) => { seen.push(force); });
    s.request(600);
    const p = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([true]);
  });

  it('flush during a run waits for it and the follow-up run', async () => {
    const seen: boolean[] = [];
    let release: () => void = () => {};
    const s = createSaveScheduler(async (force) => { seen.push(force); await new Promise<void>((r) => { release = r; }); });
    s.request(0);
    await vi.advanceTimersByTimeAsync(0);
    let done = false;
    void s.flush().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([false, true]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('a failing run still goes idle', async () => {
    const onIdle = vi.fn();
    const s = createSaveScheduler(async () => { throw new Error('x'); }, onIdle);
    await s.flush();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('draft helpers', () => {
  it('sameJson compares data', () => {
    expect(sameJson({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
  it('hasTextChange is true for typing and false for a tick', () => {
    expect(hasTextChange({ allergies: '', asthma: false }, { allergies: 'p', asthma: false })).toBe(true);
    expect(hasTextChange({ allergies: '', asthma: false }, { allergies: '', asthma: true })).toBe(false);
  });
});
