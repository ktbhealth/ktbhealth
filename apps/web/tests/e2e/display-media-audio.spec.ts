// Spike T-012: validates that getDisplayMedia can capture tab AUDIO
// (the mechanism needed to transcribe WhatsApp Web calls).
//
// Strategy: launch Chromium with flags that auto-select the target tab in
// the capture picker, open a "source" tab emitting a tone via Web Audio and
// hit /capture-test in another tab. If the level meter rises, the
// getDisplayMedia -> tab audio -> Web Audio path is proven end to end.
//
// Relevant Chromium flags:
// - --auto-select-tab-capture-source-by-title=<title>: skips the picker and
//   captures the tab whose document.title matches the value.
// - --autoplay-policy=no-user-gesture-required: lets the source tab's
//   AudioContext play without a user gesture (headless has no real gesture).
//
// Repro: `bunx playwright test tests/e2e/display-media-audio.spec.ts`
// in apps/web (the playwright.config.ts webServer boots `bunx vp dev`).
// Requires DISPLAY/X (runs headful — the Playwright headless shell has no
// screen capture). If the dev server fails on wrangler auth for the KTB
// account, boot it manually with CLOUDFLARE_ACCOUNT_ID=<accessible account> —
// `reuseExistingServer` makes Playwright reuse it.

import { chromium, expect, test } from "@playwright/test";

const AUDIO_SOURCE_TITLE = "ktb-tab-audio-source";

test.setTimeout(120_000);

test("getDisplayMedia captures tab audio end-to-end", async () => {
	// Headful: the Playwright chromium_headless_shell does not implement
	// screen capture (getDisplayMedia rejects with "Not supported") and the new
	// headless (channel "chromium") failed with ERR_NETWORK_CHANGED here.
	const browser = await chromium.launch({
		headless: false,
		args: [
			`--auto-select-tab-capture-source-by-title=${AUDIO_SOURCE_TITLE}`,
			"--autoplay-policy=no-user-gesture-required",
			"--allow-http-screen-capture",
		],
	});
	try {
		const context = await browser.newContext();

		// Source tab: emits a continuous tone via Web Audio.
		const audioPage = await context.newPage();
		await audioPage.setContent(`<!doctype html><title>${AUDIO_SOURCE_TITLE}</title>
			<script>
				const ctx = new AudioContext();
				window.__audioCtx = ctx;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				gain.gain.value = 0.5;
				osc.frequency.value = 440;
				osc.connect(gain).connect(ctx.destination);
				void ctx.resume().then(() => osc.start());
			</script>`);
		// Ensure the AudioContext is running (not autoplay-suspended).
		await expect
			.poll(() => audioPage.evaluate(() => (window as any).__audioCtx?.state), {
				timeout: 10_000,
			})
			.toBe("running");

		// Capture tab: the spike page.
		const page = await context.newPage();
		page.on("console", (m) => {
			if (m.type() === "error") console.log("[page error]", m.text());
		});
		page.on("pageerror", (e) => console.log("[pageerror]", e.message));
		await page.goto("/capture-test");
		await page.waitForLoadState("networkidle");

		// SSR ships the button before hydration; click until the handler
		// responds ("requesting…"/"capturing…" status or a visible error).
		// If the client chunk fails on load (dev-server flake), reload once and
		// retry.
		const startButton = page.getByRole("button", { name: /start capture/i });
		const feedback = page
			.locator("p")
			.filter({ hasText: /requesting|capturing|no audio|denied|allowed|failed|error/i });
		for (let round = 0; round < 2; round++) {
			for (let attempt = 0; attempt < 3; attempt++) {
				await startButton.click();
				try {
					await expect(feedback.first()).toBeVisible({ timeout: 3_000 });
					break;
				} catch {
					if (attempt === 2 && round === 1)
						throw new Error("click produced no feedback — hydration?");
				}
			}
			// If feedback appeared, leave the outer loop.
			if (
				await feedback
					.first()
					.isVisible()
					.catch(() => false)
			)
				break;
			await page.reload();
			await page.waitForLoadState("networkidle");
		}

		// If auto-capture worked, the status shows "capturing · track:".
		await expect(page.getByText(/capturing · track:/)).toBeVisible({ timeout: 15_000 });

		// The level meter must leave zero — proof that the source tab's audio
		// is reaching the captured MediaStream.
		const levelText = page.getByText(/level:/g);
		await expect
			.poll(
				async () => {
					const text = await levelText.textContent();
					const match = text?.match(/level:\s*([\d.]+)%/);
					return match ? Number(match[1]) : 0;
				},
				{ timeout: 15_000, intervals: [250] },
			)
			.toBeGreaterThan(1);
		console.log(`[spike] captured audio level: ${await levelText.textContent()}`);
	} finally {
		await browser.close();
	}
});
