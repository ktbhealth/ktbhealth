// Composed schema: plugin-owned table slices merged here so drizzle-kit
// sees one entry point. Add `export *` per plugin domain.
export * from "@ktb/patients/schema";
export * from "@ktb/consultations/schema";
export * from "@ktb/groups/schema";
export * from "@ktb/notifications/schema";
export * from "@ktb/auth/schema";
export * from "@ktb/rbac/schema";
export * from "@ktb/doctors/schema";
export * from "@ktb/secretaries/schema";
export * from "@ktb/patient-access/schema";
