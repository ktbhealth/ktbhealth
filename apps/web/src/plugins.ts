// Client-safe plugin registry (@ktb/app-host/client): nav/panel/landing
// contributions only — never the server registry, whose index.ts modules
// pull Effect services, drizzle schema and CQRS groups into the bundle.
export { plugins } from "@ktb/app-host/client";
