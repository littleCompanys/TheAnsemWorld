import { useEffect, useState } from "react";

/**
 * A single "the chain moved" signal, shared by everything on screen.
 *
 * Each page already tracks its own refresh counter and bumps it after a
 * write, which updates that page and nothing else. The header lives
 * outside all of them, so the $ANSEMW balance beside the wallet button
 * stayed at whatever it read on mount - burn 25,000 activating a piece
 * and the number sat there until a full reload, which reads as the
 * transaction not having worked.
 *
 * Subscribers rather than a context: no provider to thread through the
 * tree, and a page can announce a change without knowing who is
 * listening. Same shape as usePrices.
 */
const subscribers = new Set<() => void>();

/** Call after any write that lands. Everything reading chain state reloads. */
export const notifyChainChanged = () => {
  subscribers.forEach((fn) => fn());
};

/**
 * A counter that increments whenever a write lands anywhere in the app.
 * Feed it to the hooks that take a refreshKey.
 */
export const useChainRefresh = (): number => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((v) => v + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  return tick;
};
