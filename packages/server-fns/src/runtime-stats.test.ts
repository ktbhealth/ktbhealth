import { describe, expect, it } from "vitest";

import { audioStorageStats, type AudioObjectLister } from "./index.ts";

const lister = (
	pages: ReadonlyArray<{
		readonly objects: readonly { key: string; size: number }[];
		readonly truncated: boolean;
		readonly cursor?: string;
	}>,
): AudioObjectLister & { calls: number } => {
	const probe = {
		calls: 0,
		list: async () => {
			const page = pages[probe.calls] ?? { objects: [], truncated: false };
			probe.calls += 1;
			return page;
		},
	};
	return probe;
};

describe("audioStorageStats", () => {
	it("returns null when the bucket is missing or cannot list", async () => {
		expect(await audioStorageStats(undefined)).toBeNull();
		expect(await audioStorageStats({} as AudioObjectLister)).toBeNull();
	});

	it("sums objects and bytes across pages until untruncated", async () => {
		const bucket = lister([
			{
				objects: [
					{ key: "a", size: 10 },
					{ key: "b", size: 20 },
				],
				truncated: true,
				cursor: "c1",
			},
			{ objects: [{ key: "c", size: 12 }], truncated: false },
		]);
		expect(await audioStorageStats(bucket)).toEqual({ objects: 3, bytes: 42, truncated: false });
		expect(bucket.calls).toBe(2);
	});

	it("reports truncated when the page cap is hit", async () => {
		const bucket = lister(
			Array.from({ length: 10 }, (_, i) => ({
				objects: [{ key: `k${i}`, size: 1 }],
				truncated: true,
				cursor: `c${i}`,
			})),
		);
		expect(await audioStorageStats(bucket, 3)).toEqual({ objects: 3, bytes: 3, truncated: true });
		expect(bucket.calls).toBe(3);
	});

	it("stops early when truncated pages carry no cursor", async () => {
		const bucket = lister([{ objects: [{ key: "a", size: 5 }], truncated: true }]);
		expect(await audioStorageStats(bucket)).toEqual({ objects: 1, bytes: 5, truncated: true });
		expect(bucket.calls).toBe(1);
	});

	it("returns null when a page rejects", async () => {
		const bucket: AudioObjectLister = {
			list: () => Promise.reject(new Error("r2 down")),
		};
		expect(await audioStorageStats(bucket)).toBeNull();
	});
});
