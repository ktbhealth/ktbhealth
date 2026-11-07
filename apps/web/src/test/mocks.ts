import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

/** Shared platform mocks for apps/web tests. Import for side effects only. */

const MIGRATION = readFileSync(
	fileURLToPath(new URL("../../../../packages/db/drizzle/0000_reflective_vulture.sql", import.meta.url)),
	"utf8",
);

export const requestHeaders = { current: new Headers() };

export async function setupPlatformMocks() {
	const { makeD1 } = await import("@ktb/db/testing");
	vi.doMock("cloudflare:workers", () => ({
		env: {
			DB: makeD1(MIGRATION),
			AI: { run: vi.fn(async () => ({ text: "transcrição mock" })) },
			BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
			BETTER_AUTH_URL: "http://localhost:3000",
		},
	}));
	vi.doMock("@tanstack/react-start/server", () => ({
		getRequestHeaders: () => requestHeaders.current,
	}));
	vi.doMock("@tanstack/react-start", () => ({
		createServerFn: () => {
			const chain = {
				validator: () => chain,
				handler: (h: (arg?: { data?: unknown }) => unknown) =>
					async (arg?: { data?: unknown }) => h(arg ?? {}),
			};
			return chain;
		},
	}));
}
