import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "senha-forte-123";

function uniqueCredentials() {
	const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
	return { email, name: email.split("@")[0] };
}

/** React attaches __reactFiber$/__reactProps$ expandos during hydration;
 * their presence on the nav means event handlers are live. */
async function waitForHydration(page: Page) {
	await page.waitForFunction(() => {
		const el = document.querySelector("header nav");
		return (
			!!el &&
			Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"))
		);
	});
}

async function gotoApp(page: Page, path: string) {
	await page.goto(path);
	await waitForHydration(page);
}

async function fillCredentials(page: Page, email: string) {
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(PASSWORD);
}

// Deployed environments bind real Turnstile keys — automation can't solve
// the widget, so credential flows only run against the local captcha stub.
test.describe("auth flow", () => {
	test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "requires the local captcha stub");
	test("sign up, sign out via nav menu, sign back in", async ({ page }) => {
		const { email, name } = uniqueCredentials();

		// Sign up through the "Create account" tab.
		await gotoApp(page, "/login");
		await page.getByRole("tab", { name: "Create account" }).click();
		await fillCredentials(page, email);
		await page.getByRole("button", { name: "Create account" }).click();

		// Sign-up signs in; the app does a full reload to "/".
		await expect(page).toHaveURL("/");
		await waitForHydration(page);
		const trigger = page.getByRole("button", { name: new RegExp(name) });
		await expect(trigger).toBeVisible();

		// Sign out through the avatar dropdown.
		await trigger.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await expect(page).toHaveURL("/");
		await waitForHydration(page);
		await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

		// Sign back in (the "Sign in" tab is the default).
		await gotoApp(page, "/login");
		await fillCredentials(page, email);
		await page.getByRole("button", { name: "Sign in" }).click();
		await expect(page).toHaveURL("/");
		await waitForHydration(page);
		await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
	});

	test("shows error on invalid credentials", async ({ page }) => {
		await gotoApp(page, "/login");
		await fillCredentials(page, `nobody-${Date.now()}@test.dev`);
		await page.getByRole("button", { name: "Sign in" }).click();
		await expect(page.getByText(/invalid email or password/i)).toBeVisible();
		await expect(page).toHaveURL("/login");
	});
});
