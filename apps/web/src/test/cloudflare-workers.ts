import { makeD1 } from "@ktb/db/testing";
import migrationSql from "../../../../packages/db/drizzle/0000_reflective_vulture.sql?raw";

/** Test double for the workerd `cloudflare:workers` module. Fresh per test file. */
export const env = {
	DB: makeD1(migrationSql),
	AI: {
		run: async (_model: string, _input: unknown) => ({ text: "transcrição do servidor" }),
	},
	BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
	BETTER_AUTH_URL: "http://localhost:3000",
	TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
};
