/**
 * Constant-time secret comparison for edge auth checks (e.g. the
 * METRICS_SCRAPE_TOKEN bearer on /api/metrics).
 *
 * Plain `===` on secrets leaks prefix information through early-exit
 * timing. This hashes BOTH sides to a fixed 32-byte SHA-256 digest via
 * Web Crypto (available on workerd and modern node/bun — no platform
 * imports) and XOR-folds the digests, so the comparison always scans
 * every byte and never reveals the expected value's length either.
 */
export const timingSafeEqual = async (a: string, b: string): Promise<boolean> => {
	const encoder = new TextEncoder();
	const [digestA, digestB] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(a)),
		crypto.subtle.digest("SHA-256", encoder.encode(b)),
	]);
	const left = new Uint8Array(digestA);
	const right = new Uint8Array(digestB);
	let diff = 0;
	// Both digests are SHA-256 (always 32 bytes), so the indices are in
	// bounds; `!` keeps the loop branch-free for coverage. Bitwise ops
	// coerce any unexpected undefined to 0, matching the old `?? 0`.
	for (let i = 0; i < left.length; i++) {
		diff |= left[i]! ^ right[i]!;
	}
	return diff === 0;
};
