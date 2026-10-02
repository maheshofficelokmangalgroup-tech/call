import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDebounced, useKeyedState, useNow, usePageReset } from "@/lib/hooks";
import { useLocalStorage } from "@/lib/use-local-storage";

describe("useKeyedState", () => {
  it("starts over whenever the key changes", () => {
    const { result, rerender } = renderHook(({ k }) => useKeyedState<number>(0, k), { initialProps: { k: "a" } });
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    rerender({ k: "b" });
    expect(result.current[0]).toBe(0);
    act(() => result.current[1]((n) => n + 2));
    expect(result.current[0]).toBe(2);
    rerender({ k: "a" });
    expect(result.current[0]).toBe(0); // "a" is not remembered once we left it
  });

  it("applies updater functions to the value of the current key", () => {
    const { result } = renderHook(() => useKeyedState<number>(10, "k"));
    act(() => result.current[1]((n) => n + 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(12);
  });
});

describe("usePageReset", () => {
  it("returns to page 1 when a filter changes, but not when only the page does", () => {
    const { result, rerender } = renderHook(({ q }) => usePageReset([q, "7d"]), { initialProps: { q: "" } });
    act(() => result.current[1](4));
    expect(result.current[0]).toBe(4);
    rerender({ q: "" });
    expect(result.current[0]).toBe(4);
    rerender({ q: "sneha" });
    expect(result.current[0]).toBe(1);
  });
});

describe("useDebounced", () => {
  it("waits until typing has stopped", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), { initialProps: { v: "" } });
      rerender({ v: "s" });
      rerender({ v: "sn" });
      act(() => void vi.advanceTimersByTime(200));
      expect(result.current).toBe("");
      rerender({ v: "sne" });
      act(() => void vi.advanceTimersByTime(299));
      expect(result.current).toBe("");
      act(() => void vi.advanceTimersByTime(2));
      expect(result.current).toBe("sne");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useNow", () => {
  it("ticks", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useNow(1000));
      const first = result.current;
      act(() => void vi.advanceTimersByTime(3000));
      expect(result.current).toBeGreaterThanOrEqual(first + 3000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useLocalStorage", () => {
  it("falls back until something is saved, then follows the saved value everywhere", () => {
    window.localStorage.removeItem("test-key");
    const a = renderHook(() => useLocalStorage("test-key", "default"));
    const b = renderHook(() => useLocalStorage("test-key", "default"));
    expect(a.result.current[0]).toBe("default");
    act(() => a.result.current[1]("saved"));
    expect(window.localStorage.getItem("test-key")).toBe("saved");
    expect(a.result.current[0]).toBe("saved");
    expect(b.result.current[0]).toBe("saved"); // another component using the same key sees it too
  });

  it("keeps working when the browser refuses to store anything", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useLocalStorage("blocked-key", "default"));
    expect(() => act(() => result.current[1]("x"))).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    expect(result.current[0]).toBe("default");
  });
});
