import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	webServer: {
		// Plain `vp dev`, not `bun run dev`: arca would inject the real
		// Turnstile keys and the widget would hit Cloudflare for real.
		// Without them the captcha port is unbound and auth skips it.
		command: "bunx vp dev --port 3000",
		url: "http://localhost:3000",
		env: {
			// Local wrangler sees two CF accounts; pick the KTB one.
			CLOUDFLARE_ACCOUNT_ID: "2c03574ae47e534415b762ab3c474815",
		},
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
