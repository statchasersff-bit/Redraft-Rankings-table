import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server. The build-time
 * prerender renders this tree in Node, where `useLayoutEffect` is a no-op that
 * React warns about; swapping it out keeps the prerender output clean.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
