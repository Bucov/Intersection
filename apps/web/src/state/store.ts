import { useRef, useSyncExternalStore } from "react";

export interface Store<T> {
  getState(): T;
  setState(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal external store; components subscribe to slices with `useStore`. */
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(next) {
      const value = typeof next === "function" ? (next as (previous: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Subscribe to a derived slice. Re-renders only when the selected value changes
 * according to `isEqual` (reference equality by default, `shallowEqual` for small objects).
 */
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
  const cache = useRef<{ state: T; selector: (state: T) => S; selected: S } | null>(null);
  const getSnapshot = () => {
    const state = store.getState();
    const cached = cache.current;
    if (cached && cached.state === state && cached.selector === selector) return cached.selected;
    const selected = selector(state);
    if (cached && isEqual(cached.selected, selected)) {
      cache.current = { state, selector, selected: cached.selected };
      return cached.selected;
    }
    cache.current = { state, selector, selected };
    return selected;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
