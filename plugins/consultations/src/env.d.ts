// import.meta.env is a Vite build-time transform; declare the slice we
// use so the package typechecks without a vite dependency (same pattern
// as @ktb/app-host/env.d.ts). The index signature keeps ImportMetaEnv
// assignable to Record<string, unknown> for docsBaseUrl.
interface ImportMetaEnv {
	readonly PROD: boolean;
	readonly DEV: boolean;
	readonly [key: string]: unknown;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
