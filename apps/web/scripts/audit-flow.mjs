// Full golden-path drive v3 — hydration-aware, no networkidle (vite SSE hangs it).
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const email = `flow3-${Date.now()}@test.dev`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`PAGEERROR @ ${page.url()}: ${String(e).slice(0, 160)}`));

await ctx.request.post("/api/auth/sign-up/email", {
	headers: { origin: BASE },
	data: { email, password: "flow-password-123", name: "Flow Doc" },
});

async function settle() {
	await page.waitForLoadState("domcontentloaded");
	// wait until React hydrated (fiber keys on a button)
	await page
		.waitForFunction(
			() => {
				const b = document.querySelector("button");
				return b && Object.keys(b).some((k) => k.startsWith("__react"));
			},
			{ timeout: 15000 },
		)
		.catch(() => console.log("WARN: hydration wait timed out"));
	await page.waitForTimeout(400);
}
async function dump(name, max = 2200) {
	await settle();
	const text = await page.locator("body").innerText();
	console.log(`\n===== ${name} — ${page.url()} =====\n${text.slice(0, max)}\n`);
}

// --- patient ---
await page.goto("/patients/new");
await settle();
await page.fill("#name", "Maria Silva");
await page.fill("#age", "42");
await page.getByRole("button", { name: "Register patient" }).click();
await page.waitForTimeout(2500);
await dump("AFTER-PATIENT-SAVE", 1200);

// --- consult ---
await page.goto("/consultations/new");
await settle();
const consent = page.locator('input[type="checkbox"]').first();
if (await consent.count()) await consent.check().catch(() => consent.click({ force: true }));
await page.getByRole("button", { name: "Use sample" }).click();
await page.waitForTimeout(400);
const gen = page.getByRole("button", { name: /Generate anamnesis/ });
console.log("generate enabled?", await gen.isEnabled());
if (await gen.isEnabled()) {
	await gen.click();
	await page.waitForTimeout(6000);
}
await dump("AFTER-GENERATE", 3500);

const btns = await page.getByRole("button").allTextContents();
console.log("BUTTONS:", JSON.stringify(btns.filter((b) => b && b.trim()).slice(0, 40)));

for (const label of [/save|finish|sign|concluir|salvar|approve|send/i]) {
	const b = page.getByRole("button", { name: label }).first();
	if ((await b.count()) && (await b.isEnabled().catch(() => false))) {
		console.log("clicking:", JSON.stringify(await b.innerText()));
		await b.click();
		await page.waitForTimeout(3000);
		await dump("AFTER-SAVE-CLICK", 2500);
		break;
	}
}
await browser.close();
