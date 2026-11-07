/// <reference types="@cloudflare/workers-types" />

// import.meta.glob is a Vite build-time transform; declare the slice we use
// so the package typechecks without a vite dependency.
interface ImportMeta {
	glob(pattern: string, options: { eager: true }): Record<string, unknown>;
}
