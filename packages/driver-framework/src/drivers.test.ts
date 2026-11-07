import { describe, expect, it } from "vitest";
import * as Layer from "effect/Layer";

import {
	driversForPort,
	enabledDrivers,
	requireDriver,
	resolveDriver,
	type Driver,
} from "./drivers.ts";

interface Env {
	readonly flag?: boolean;
}

const make = (id: string, port: string, when?: (env: Env) => boolean): Driver<Env> => ({
	id,
	port,
	provides: () => Layer.empty,
	...(when === undefined ? {} : { when }),
});

describe("enabledDrivers", () => {
	it("keeps only drivers whose when passes or is absent", () => {
		const drivers = [
			make("always", "p1"),
			make("on", "p2", (env) => env.flag === true),
			make("off", "p3", () => false),
		];
		expect(enabledDrivers(drivers, {}).map((d) => d.id)).toEqual(["always"]);
		expect(enabledDrivers(drivers, { flag: true }).map((d) => d.id)).toEqual(["always", "on"]);
	});
});

describe("driversForPort", () => {
	it("filters by port regardless of eligibility", () => {
		const drivers = [make("a", "p1", () => false), make("b", "p1"), make("c", "p2")];
		expect(driversForPort(drivers, "p1").map((d) => d.id)).toEqual(["a", "b"]);
		expect(driversForPort(drivers, "p2").map((d) => d.id)).toEqual(["c"]);
		expect(driversForPort(drivers, "p3")).toEqual([]);
	});
});

describe("resolveDriver", () => {
	it("returns undefined for unknown port or no eligible driver", () => {
		const drivers = [make("off", "p1", () => false)];
		expect(resolveDriver(drivers, "p1", {})).toBeUndefined();
		expect(resolveDriver(drivers, "p2", {})).toBeUndefined();
		expect(resolveDriver([], "p1", {})).toBeUndefined();
	});

	it("picks the first enabled driver for the port (array order tie-break)", () => {
		const drivers = [make("first", "p1"), make("second", "p1"), make("other-port", "p2")];
		expect(resolveDriver(drivers, "p1", {})?.id).toBe("first");
	});

	it("skips disabled drivers to the next eligible one", () => {
		const drivers = [
			make("off", "p1", () => false),
			make("on", "p1", (env) => env.flag === true),
			make("fallback", "p1"),
		];
		expect(resolveDriver(drivers, "p1", {})?.id).toBe("fallback");
		expect(resolveDriver(drivers, "p1", { flag: true })?.id).toBe("on");
	});

	it("passes env to when and provides", () => {
		const seen: Env[] = [];
		const driver: Driver<Env> = {
			id: "spy",
			port: "p1",
			provides: (env) => {
				seen.push(env);
				return Layer.empty;
			},
			when: (env) => {
				seen.push(env);
				return true;
			},
		};
		const env = { flag: true };
		expect(resolveDriver([driver], "p1", env)).toBe(driver);
		expect(driver.provides(env)).toBeDefined();
		expect(seen).toEqual([env, env]);
	});
});

describe("requireDriver", () => {
	it("returns the resolved driver", () => {
		const driver = make("d", "p1");
		expect(requireDriver([driver], "p1", {})).toBe(driver);
	});

	it("throws when no driver is eligible", () => {
		expect(() => requireDriver([], "p1", {})).toThrow('no enabled driver for port "p1"');
	});
});
