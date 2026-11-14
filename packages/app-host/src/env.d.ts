/// <reference types="@cloudflare/workers-types" />

// import.meta.glob is a Vite build-time transform; declare the slice we use
// so the package typechecks without a vite dependency. import.meta.env is
// declared the same way — when vite/client types are also loaded the two
// ImportMetaEnv/ImportMeta declarations merge (vite declares the same
// props), so this stays compatible in the apps/web program.
interface ImportMetaEnv {
	PROD: boolean;
	DEV: boolean;
}
interface ImportMeta {
	glob(pattern: string | readonly string[], options: { eager: true }): Record<string, unknown>;
	readonly env: ImportMetaEnv;
}
