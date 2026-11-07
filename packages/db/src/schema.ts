// Composed schema: plugin-owned table slices merged here so drizzle-kit
// sees one entry point. Add `export *` per plugin domain.
export * from "./schema/patients.ts";
export * from "./schema/consultations.ts";
export * from "@ktb/auth-better/schema";
