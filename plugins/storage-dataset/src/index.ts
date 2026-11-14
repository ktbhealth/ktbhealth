import { definePlugin, type Plugin } from "@ktb/kernel";
import { ReportPort, type Contribution } from "@ktb/eval-core";
import { DatasetStorePort } from "@ktb/eval-consultation/ports";

/**
 * storage.dataset — dataset persistence + reporting capability plugin
 * (P-074 phase 3, P-070).
 *
 * DATA-ONLY registrar, same contract as transcription.tts: declares
 * the eval-core contributions (on the manifest's `contributions`
 * channel) and adapter keys for the two storage ports —
 * DatasetStorePort (samples, blobs with provenance meta, results) and
 * ReportPort (run-record sink + markdown render). Adapter
 * implementations stay in the exempt-edge packages
 * (@ktb/eval-adapter-stub/-local/-cloud): the SQLite/filesystem store
 * needs node:fs/better-sqlite3, which plugins/* may not import
 * (arch-policy PORT_GLOBS). See plugins/transcription-tts/src/index.ts
 * for the full mechanism.
 *
 * Storage is not a pipeline stage — it contributes capabilities only.
 *
 * Adapter keys → packages/factories: "stub" → @ktb/eval-adapter-stub
 * (`makeStubLayer`), "sqlite-fs" → @ktb/eval-adapter-local
 * `makeLocalStoreLayer`, "r2" → @ktb/eval-adapter-cloud `makeR2Store`,
 * "jsonl" → @ktb/eval-adapter-local `makeLocalReportLayer`.
 */

/**
 * Declared contributions. `store` covers DatasetStorePort (sample
 * manifest rows, audio blobs + blob_meta provenance, eval results);
 * `report` covers ReportPort (append + render — the markdown shape is
 * part of the port contract, not adapter-defined).
 */
export const storageDatasetContributions: readonly Contribution[] = [
	{
		kind: "eval.capability",
		id: "store",
		version: "1",
		meta: {
			port: DatasetStorePort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				"sqlite-fs": "@ktb/eval-adapter-local",
				r2: "@ktb/eval-adapter-cloud",
			},
		},
	},
	{
		kind: "eval.capability",
		id: "report",
		version: "1",
		meta: {
			port: ReportPort.key,
			adapters: {
				stub: "@ktb/eval-adapter-stub",
				jsonl: "@ktb/eval-adapter-local",
			},
		},
	},
];

export const storageDatasetPlugin = definePlugin({
	id: "storage.dataset",
	contributions: storageDatasetContributions,
});

export const plugins: readonly Plugin[] = [storageDatasetPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"storage.dataset": true;
	}
}
