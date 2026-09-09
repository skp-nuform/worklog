"use client";

import { useSyncExternalStore } from "react";

// Never changes, so the store never notifies.
const subscribe = () => () => {};

/**
 * True once the client has hydrated, false during SSR.
 *
 * Used instead of the `useState(false)` + `useEffect(() => setMounted(true))`
 * pattern, which React's lint rules correctly flag: setState inside an effect
 * causes a cascading render. `useSyncExternalStore` expresses the same thing
 * as what it actually is — a different value on server and client.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}
