import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as References from "effect/References";

import { telemetryConsoleDriver, logLevelLayer, Telemetry } from "./index.ts";
import { telemetryConfigFromEnv } from "./config.ts";

describe("telemetryConsoleDriver", () => {
	it("is always eligible (no when predicate) and targets the Telemetry port", () => {
		expect(telemetryConsoleDriver).not.toHaveProperty("when");
		expect(telemetryConsoleDriver.port).toBe(Telemetry.key);
		expect(telemetryConsoleDriver.id).toBe("telemetry-console");
	});

	it("provides a working Telemetry service", async () => {
		const runtime = ManagedRuntime.make(
			telemetryConsoleDriver.provides({}) as Layer.Layer<unknown, unknown, never>,
		);
		try {
			const health = await runtime.runPromise(
				Effect.gen(function* () {
					const t = yield* Telemetry;
					return yield* t.health;
				}),
			);
			expect(health).toEqual({ logs: "console", traces: "off", metrics: "prometheus" });
		} finally {
			await runtime.dispose();
		}
	});

	it("installs the JSON logger set", async () => {
		const runtime = ManagedRuntime.make(
			telemetryConsoleDriver.provides({}) as Layer.Layer<unknown, unknown, never>,
		);
		try {
			await runtime.runPromise(Effect.logInfo("driver smoke"));
		} finally {
			await runtime.dispose();
		}
	});
});

describe("logLevelLayer", () => {
	it("is empty when no level is configured", async () => {
		const config = telemetryConfigFromEnv({});
		const runtime = ManagedRuntime.make(logLevelLayer(config));
		try {
			const level = await runtime.runPromise(Effect.service(References.MinimumLogLevel));
			expect(level).toBe("Info");
		} finally {
			await runtime.dispose();
		}
	});

	it("provides the configured minimum level", async () => {
		const config = telemetryConfigFromEnv({ KTB_LOG_LEVEL: "warning" });
		const runtime = ManagedRuntime.make(logLevelLayer(config));
		try {
			const level = await runtime.runPromise(Effect.service(References.MinimumLogLevel));
			expect(level).toBe("Warning");
		} finally {
			await runtime.dispose();
		}
	});
});
