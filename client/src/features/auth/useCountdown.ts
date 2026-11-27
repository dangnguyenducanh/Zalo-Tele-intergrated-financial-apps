import { useEffect, useState } from 'react';

// A wait that ends at `initialAt` (ms timestamp): the seconds left, ticking once a second. `start(seconds)` begins a
// new wait and returns when it ends, so the caller can keep it (the countdown survives a reload that way).
export function useCountdown(initialAt = 0) {
  const [endsAt, setEndsAt] = useState(initialAt);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const counting = seconds > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  function start(waitSeconds: number) {
    const at = Date.now() + waitSeconds * 1000;
    setEndsAt(at);
    setNow(Date.now());
    return at;
  }
  return { seconds, counting, start };
}
