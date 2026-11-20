import { useEffect, useState } from 'react';

// `value` once it has stopped changing for `ms` milliseconds, e.g. after the user pauses typing.
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
