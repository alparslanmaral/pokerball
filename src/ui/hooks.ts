import { useEffect, useRef, useState } from 'react';

/** Milliseconds left until `deadlineAt` (a local clock timestamp); null when there is no deadline. */
export function useCountdown(deadlineAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadlineAt]);
  return deadlineAt === null ? null : Math.max(0, deadlineAt - now);
}

/** Animates a number from 0 to `target` once `active` becomes true. */
export function useCountUp(target: number, active: boolean, duration = 700): number {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setValue(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, active, duration]);
  return value;
}

/** Steps through `delays` (ms from mount); returns the current step index. */
export function useSteps(delays: number[], resetKey: unknown): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const timers = delays.map((d, i) => setTimeout(() => setStep(i + 1), d));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return step;
}
