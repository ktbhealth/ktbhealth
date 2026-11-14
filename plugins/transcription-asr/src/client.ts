import { definePlugin, type Plugin } from "@ktb/kernel";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). The eval.* `contributions`
 * entries are server/CLI-side data (adapter keys, port tags) with no
 * browser consumer, so they degrade to a bare-id marker here — the
 * same convention tables/services follow. Keep ids and dep edges in
 * sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const plugins: readonly Plugin[] = [definePlugin({ id: "transcription.asr" })];
