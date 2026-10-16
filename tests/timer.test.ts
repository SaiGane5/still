import { describe, expect, it } from "vitest";
import { elapsedFraction, formatClock, formatDuration, isExpired, pause, remainingSeconds, resume, snapFrom } from "@/lib/timer";

describe("timer", () => {
  it("counts down from wall-clock timestamps, not ticks (no drift when throttled)", () => {
    const s = snapFrom(1500, true, 1_000_000);
    expect(remainingSeconds(s, 1_000_000)).toBe(1500);
    // a backgrounded tab fires one tick 10 minutes later: time still correct
    expect(remainingSeconds(s, 1_000_000 + 600_000)).toBe(900);
  });

  it("pauses and resumes without losing or gaining time", () => {
    let s = snapFrom(600, true, 0);
    s = pause(s, 100_000);
    expect(s.running).toBe(false);
    expect(remainingSeconds(s, 100_000)).toBe(500);
    expect(remainingSeconds(s, 900_000)).toBe(500); // paused: frozen
    s = resume(s, 900_000);
    expect(remainingSeconds(s, 960_000)).toBe(440);
  });

  it("clamps at zero, reports expiry, and cannot resume from zero", () => {
    const s = snapFrom(10, true, 0);
    expect(isExpired(s, 9_999)).toBe(false);
    expect(isExpired(s, 10_000)).toBe(true);
    expect(remainingSeconds(s, 99_999)).toBe(0);
    const p = pause(s, 20_000);
    expect(resume(p, 30_000).running).toBe(false);
    expect(snapFrom(0, true, 0).running).toBe(false);
  });

  it("computes the progress ring fraction", () => {
    const s = snapFrom(100, true, 0);
    expect(elapsedFraction(s, 0, 100)).toBe(0);
    expect(elapsedFraction(s, 25_000, 100)).toBeCloseTo(0.25);
    expect(elapsedFraction(s, 500_000, 100)).toBe(1);
  });

  it("formats clocks and durations", () => {
    expect(formatClock(24 * 60 + 18)).toBe("24:18");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-4)).toBe("00:00");
    expect(formatDuration(900)).toBe("15 min");
    expect(formatDuration(5400)).toBe("1 h 30 min");
  });
});
