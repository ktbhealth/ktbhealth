// ESM replacement for use-sync-external-store/shim/with-selector (CJS-only
// upstream, breaks workerd SSR). Same semantics as the upstream shim:
// memoized selector over useSyncExternalStore.
import { useMemo, useRef, useSyncExternalStore } from "react";

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
	subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => Snapshot,
	getServerSnapshot: undefined | null | (() => Snapshot),
	selector: (snapshot: Snapshot) => Selection,
	isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
	const instRef = useRef<{ hasValue: boolean; value: Selection | null }>({
		hasValue: false,
		value: null,
	});
	const inst = instRef.current;

	const [getSelection, getServerSelection] = useMemo(() => {
		let hasMemo = false;
		let memoizedSnapshot: Snapshot | null = null;
		let memoizedSelection: Selection | null = null;

		const memoizedSelector = (nextSnapshot: Snapshot) => {
			if (!hasMemo) {
				hasMemo = true;
				memoizedSnapshot = nextSnapshot;
				const nextSelection = selector(nextSnapshot);
				if (isEqual !== undefined && inst.hasValue) {
					const currentSelection = inst.value as Selection;
					if (isEqual(currentSelection, nextSelection)) {
						memoizedSelection = currentSelection;
						return currentSelection;
					}
				}
				memoizedSelection = nextSelection;
				return nextSelection;
			}

			const prevSnapshot = memoizedSnapshot as Snapshot;
			const prevSelection = memoizedSelection as Selection;

			if (Object.is(prevSnapshot, nextSnapshot)) {
				return prevSelection;
			}

			const nextSelection = selector(nextSnapshot);

			if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
				memoizedSnapshot = nextSnapshot;
				return prevSelection;
			}

			memoizedSnapshot = nextSnapshot;
			memoizedSelection = nextSelection;
			return nextSelection;
		};

		const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;
		const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
		const getServerSnapshotWithSelector =
			maybeGetServerSnapshot === null
				? undefined
				: () => memoizedSelector(maybeGetServerSnapshot());

		return [getSnapshotWithSelector, getServerSnapshotWithSelector];
	}, [getSnapshot, getServerSnapshot, selector, isEqual]);

	const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

	useMemo(() => {
		inst.hasValue = true;
		inst.value = value;
	}, [value]);

	return value;
}
