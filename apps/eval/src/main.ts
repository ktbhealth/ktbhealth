import { Command } from "effect/cli";
import * as Effect from "effect/Effect";
import { cli } from "./commands.ts";
import { platformLayer } from "./platform.ts";

const run = Command.runWith(cli, { version: "0.1.0" });

await Effect.runPromise(
	Effect.scoped(run(process.argv.slice(2))).pipe(Effect.provide(platformLayer)),
);
