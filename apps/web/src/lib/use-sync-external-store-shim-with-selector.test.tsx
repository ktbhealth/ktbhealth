// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { useSyncExternalStoreWithSelector } from "./use-sync-external-store-shim-with-selector";

function createStore(initial: number) {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		subscribe: (onChange: () => void) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		getSnapshot: () => value,
		set: (next: number) => {
			value = next;
			for (const l of listeners) l();
		},
	};
}

describe("useSyncExternalStoreWithSelector", () => {
	it("applies the selector and updates on store changes", () => {
		const store = createStore(1);
		const { result } = renderHook(() =>
			useSyncExternalStoreWithSelector(
				store.subscribe,
				store.getSnapshot,
				undefined,
				(s: number) => s * 2,
			),
		);
		expect(result.current).toBe(2);
		act(() => store.set(5));
		expect(result.current).toBe(10);
	});

	it("returns the previous selection when isEqual matches", () => {
		const store = createStore(1);
		const isEqual = (a: { v: string }, b: { v: string }) => a.v === b.v;
		const { result } = renderHook(() =>
			useSyncExternalStoreWithSelector(
				store.subscribe,
				store.getSnapshot,
				undefined,
				(s: number) => ({ v: s > 5 ? "big" : "small" }),
				isEqual,
			),
		);
		const first = result.current;
		act(() => store.set(2));
		// "small" === "small" → same selection object is reused.
		expect(result.current).toBe(first);
		act(() => store.set(9));
		expect(result.current).not.toBe(first);
		expect(result.current).toEqual({ v: "big" });
	});

	it("reuses the committed selection when a new selector yields an equal value", () => {
		const store = createStore(1);
		const isEqual = (a: { v: number }, b: { v: number }) => a.v === b.v;
		let scale = 1;
		const makeSelector = () => (s: number) => ({ v: s * scale });
		const { result, rerender } = renderHook(
			({ selector }: { selector: (s: number) => { v: number } }) =>
				useSyncExternalStoreWithSelector(
					store.subscribe,
					store.getSnapshot,
					undefined,
					selector,
					isEqual,
				),
			{ initialProps: { selector: makeSelector() } },
		);
		const committed = result.current;

		// New selector identity, same snapshot → isEqual hits the inst.hasValue path.
		rerender({ selector: makeSelector() });
		expect(result.current).toBe(committed);

		// Selector output changes without a store notification → isEqual returns false.
		act(() => store.set(7));
		const afterChange = result.current;
		scale = 2;
		rerender({ selector: makeSelector() });
		expect(result.current).toEqual({ v: 14 });
		expect(result.current).not.toBe(afterChange);
	});

	it("uses the server snapshot during SSR", () => {
		const store = createStore(1);
		function ServerComponent() {
			const value = useSyncExternalStoreWithSelector(
				store.subscribe,
				store.getSnapshot,
				() => 99,
				(s: number) => s + 1,
			);
			return createElement("span", null, value);
		}
		expect(renderToString(createElement(ServerComponent))).toContain("100");
	});
});
