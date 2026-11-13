// Drive /consultations/new in dictation mode; watch model-status chip + worker msgs.
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const email = `t098b-${Date.now()}@test.dev`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`PAGEERROR: ${String(e).slice(0, 200)}`));
let progressCount = 0;
const seen = new Set();
page.on("console", (m) => {
	const t = m.text();
	const mm = t.match(/worker → (\w+)\s*(.*)/);
	if (mm) {
		if (mm[1] === "progress") progressCount++;
		const key = `${mm[1]}:${mm[2]}`;
		if (!seen.has(key)) {
			seen.add(key);
			console.log(`WORKER ${mm[1]}: ${mm[2]}`);
		}
	}
});

await ctx.request.post("/api/auth/sign-up/email", {
	headers: { origin: BASE },
	data: { email, password: "flow-password-123", name: "T098 Doc" },
});

await page.goto("/consultations/new");
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(
	() => {
		const b = document.querySelector("button");
		return b && Object.keys(b).some((k) => k.startsWith("__react"));
	},
	{ timeout: 15000 },
);
const dictTab = page.getByRole("tab", { name: /dictation/i });
if (await dictTab.count()) await dictTab.click();

const chipRe =
	/^(downloading model|loading model|model ready|model unavailable|worker started|first use|model cached|low confidence|transcription)/i;
let lastChip = "";
for (let i = 0; i < 60; i++) {
	const lines = (await page.locator("body").innerText()).split("\n");
	const chip = lines.map((l) => l.trim()).find((l) => chipRe.test(l)) ?? "(none)";
	if (chip !== lastChip) {
		console.log(`t=${i * 2}s CHIP: ${JSON.stringify(chip)}`);
		lastChip = chip;
	}
	await page.waitForTimeout(2000);
}
console.log(`total worker progress messages: ${progressCount}`);
await browser.close();
