/** The slice of R2 needed to drop objects — the real R2Bucket satisfies this. */
export interface AudioDeleter {
	delete(keys: string[]): Promise<void>;
}

/** R2 accepts at most 1000 keys per delete call. */
const R2_DELETE_BATCH = 1000;

/**
 * Best-effort removal of consultation audio once its database rows are
 * gone (storage is outside the D1 batch). Returns the keys that could
 * not be removed so the caller can report orphaned recordings instead
 * of losing track of patient audio silently.
 */
export async function purgeAudio(
	bucket: AudioDeleter | undefined,
	keys: readonly string[],
): Promise<string[]> {
	if (keys.length === 0) return [];
	if (!bucket) return [...keys];
	const failed: string[] = [];
	for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
		const batch = keys.slice(i, i + R2_DELETE_BATCH);
		try {
			await bucket.delete(batch);
		} catch (error) {
			console.error("audio purge failed", { keys: batch.length, error });
			failed.push(...batch);
		}
	}
	return failed;
}
