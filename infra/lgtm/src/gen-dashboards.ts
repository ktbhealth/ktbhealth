import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedDashboards } from "./dashboards/index";

/**
 * Emit dashboard JSON into provisioning/dashboards/ — the directory the
 * compose stack mounts read-only at
 * /otel-lgtm/grafana/conf/provisioning/dashboards and the file provider
 * scans (provider.yaml, updateIntervalSeconds: 30).
 *
 * Output is deterministic (builder construction order fixed, tab
 * indentation, trailing newline) so generated files can be committed and
 * diffed in review — same convention as the previous hand-written
 * ktb-platform.json.
 *
 * Usage: `bun run gen:dashboards` (from infra/lgtm or the repo root via
 * `bun --cwd infra/lgtm gen:dashboards`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "provisioning", "dashboards");

/** Grafana schema version matching the stack's known-good dashboard
 * (the previous hand-written file used 39; provisioning tolerates older
 * versions and Grafana migrates on load). */
const SCHEMA_VERSION = 39;

const main = (): void => {
	mkdirSync(outDir, { recursive: true });
	for (const { uid, dashboard } of generatedDashboards()) {
		// Force a stable schemaVersion — the SDK builders don't emit one.
		const model = { ...dashboard, schemaVersion: SCHEMA_VERSION };
		const json = `${JSON.stringify(model, null, "\t")}\n`;
		const file = join(outDir, `${uid}.json`);
		writeFileSync(file, json);
		console.log(`wrote ${file}`);
	}
};

main();
