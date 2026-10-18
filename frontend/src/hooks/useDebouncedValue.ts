import { useEffect, useState } from "react";

/** 値が delayMs のあいだ変わらなくなってから返す(入力のたびに外部を呼ばないため)。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
