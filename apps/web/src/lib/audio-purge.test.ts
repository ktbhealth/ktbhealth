import { describe, expect, it, vi } from "vitest";

import { purgeAudio } from "./audio-purge.ts";

describe("purgeAudio", () => {
	it("does nothing without keys", async () => {
		const bucket = { delete: vi.fn<(keys: string[]) => Promise<void>>() };
		expect(await purgeAudio(bucket, [])).toEqual([]);
		expect(bucket.delete).not.toHaveBeenCalled();
	});

	it("reports every key as left over when no bucket is bound", async () => {
		expect(await purgeAudio(undefined, ["a", "b"])).toEqual(["a", "b"]);
	});

	it("deletes in R2-sized batches and returns only the keys that failed", async () => {
		const keys = Array.from({ length: 1500 }, (_, i) => `audio/${i}`);
		const bucket = {
			delete: vi
				.fn<(keys: string[]) => Promise<void>>()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error("r2 down")),
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await purgeAudio(bucket, keys)).toEqual(keys.slice(1000));
		expect(bucket.delete.mock.calls.map(([batch]) => batch.length)).toEqual([1000, 500]);
		expect(error).toHaveBeenCalledOnce();
		error.mockRestore();
	});
});
