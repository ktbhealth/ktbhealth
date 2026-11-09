import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CommandBus, QueryBus } from "@effect-server-utils/cqrs";
import { PatientOwnerOf, PatientsCommands } from "@ktb/patients/api";
import { run } from "#/lib/platform.ts";

/**
 * App-wide bus smoke test (P-049): proves the composition root enumerated
 * plugin api groups, built dispatch tables, and serves QueryBus/CommandBus
 * with every tag routable. Dynamic dispatch is the fallback path — typed
 * `dispatcher(Group)` remains preferred for static deps.
 */
describe("app-wide CQRS buses", () => {
	it("QueryBus routes a registered query tag", async () => {
		const owner = await run(
			Effect.gen(function* () {
				const bus = yield* QueryBus;
				return yield* bus.execute(PatientOwnerOf, { id: 999_999_999 });
			}),
		);
		expect(owner).toBeNull();
	});

	it("QueryBus exposes the enumerated tag set", async () => {
		const tags = await run(
			Effect.gen(function* () {
				const bus = yield* QueryBus;
				return [...bus.tags];
			}),
		);
		expect(tags).toContain("patients.ownerOf");
		expect(tags).toContain("users.get");
		expect(tags).toContain("groups.get");
	});

	it("CommandBus exposes command tags", async () => {
		const tags = await run(
			Effect.gen(function* () {
				const bus = yield* CommandBus;
				return [...bus.tags];
			}),
		);
		expect(tags).toContain("patients.delete");
		expect(PatientsCommands).toBeDefined();
	});
});
