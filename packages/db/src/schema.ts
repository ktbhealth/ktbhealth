// Composed schema: plugin-owned table definitions live in
// plugins/<pkg>/src/schema.ts and are aggregated by the GENERATED
// ./schema.gen.ts (tools/gen-db-schema.mjs — `bun run gen:db-schema`,
// verified by the ci:db-schema task). @ktb/db still never depends on
// plugin packages: the generated file reaches into plugin sources by
// relative path, so plugins keep importing tables from `@ktb/db/schema`
// without a workspace cycle.
//
// Host-owned slices stay here as hand-written modules:
// - auth.ts — better-auth's user/session/account/verification tables
//   (auth infrastructure, not a plugin concern).
// - plugin-state.ts — platform-owned runtime plugin state (P-058);
//   deliberately kept out of the plugin glob (see the file's comment).
export * from "./auth.ts";
export * from "./plugin-state.ts";
export * from "./schema.gen.ts";
