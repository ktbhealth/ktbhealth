import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema.ts";

export const makeDb = (d1: D1Database) => drizzle(d1, { schema });
export type DbClient = ReturnType<typeof makeDb>;

// Ports: the platform supplies the D1 binding; the lib stays
// runtime-agnostic (workerd, bun, or a local SQLite shim later).
export class Binding extends Context.Service<Binding, D1Database>()("@ktb/db/Binding") {}
export class Db extends Context.Service<Db, DbClient>()("@ktb/db/Db") {}
export const DbLive = Layer.effect(Db, Effect.map(Binding, makeDb));
