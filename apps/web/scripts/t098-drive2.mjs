import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const email = `t098c-${Date.now()}@test.dev`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`PAGEERROR: ${String(e).slice(0, 200)}`));

const cdn = new Map();
page.on("response", async (res) => {
	const u = res.url();
	if (!u.includes("/api/cdn/")) return;
	try {
		const len = Number(res.headers()["content-length"] ?? 0);
		cdn.set(u, { status: res.status(), len });
	} catch {}
});
page.on("requestfinished", (req) => {
	const u = req.url();
	if (u.includes("/api/cdn/")) console.log(`CDN done: ${u.slice(0, 140)}`);
});
page.on("requestfailed", (req) => {
	const u = req.url();
	if (u.includes("/api/cdn/"))
		console.log(`CDN FAIL: ${u.slice(0, 140)} ${req.failure()?.errorText}`);
});

let n = 0;
page.on("console", (m) => {
	const t = m.text();
	const mm = t.match(/worker → (\w+)\s*(.*)/);
	if (mm) {
		n++;
		if (n <= 30 || mm[1] !== "progress") console.log(`W${n} ${mm[1]}: ${mm[2].slice(0, 120)}`);
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

for (let i = 0; i < 90; i++) {
	const chip = (await page.locator("body").innerText())
		.split("\n")
		.map((l) => l.trim())
		.find((l) => /model|download|loading|worker started|first use/i.test(l));
	if (i % 10 === 0 || (chip ?? "").includes("ready"))
		console.log(`t=${i * 2}s cdnFiles=${cdn.size} chip=${JSON.stringify(chip)}`);
	await page.waitForTimeout(2000);
}
console.log(
	"CDN files:",
	[...cdn.entries()].map(([u, v]) => `${v.status} ${v.len}B ${u.split("/").pop()}`).join("\n  "),
);
await browser.close();
