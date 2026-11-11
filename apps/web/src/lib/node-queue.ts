import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import type { QueueDepth } from "@ktb/server-fns";

/**
 * Restart-persistent stand-in for the Cloudflare Queue binding under
 * `KTB_DEV_NODE=1` (see node-cloudflare-workers.ts). Messages live in a
 * dedicated SQLite file — separate from the app schema, no drizzle
 * involvement — so queued jobs survive dev-server restarts and the
 * consumer sees the same batch/message contract workerd would deliver
 * (`handleAudioQueueBatch` in audio-jobs.ts).
 *
 * Delivery model mirrors Cloudflare: `send()` only inserts a row and
 * resolves immediately; a background poller claims due rows and invokes
 * the consumer with `{ body, ack, retry }` messages. `ack()` marks the
 * row `done`; `retry()` (or an unacked message after the handler
 * returns/throws) reschedules it with linear backoff until
 * `max_attempts`, then marks it `failed`. `failed` rows ARE the dead
 * letter queue — inspect/replay them with the sqlite3 CLI.
 *
 * `attempts` counts delivery attempts and is incremented when a row is
 * CLAIMED, not when it fails: a row stuck in `processing` across a crash
 * is reset to `pending` on open but keeps its attempt count, so a
 * poison message cannot loop forever.
 *
 * Plain deploy glue for apps/web — no ports/adapters involved.
 */

/** Shape the queue consumer expects (handleAudioQueueBatch input). */
export interface LocalQueueMessage {
	readonly body: unknown;
	ack(): void;
	retry(): void;
}

export type LocalQueueHandler = (messages: readonly LocalQueueMessage[]) => Promise<void>;

export interface LocalQueueOptions {
	/**
	 * SQLite file for the queue (parent dir is created). Default
	 * `./data/queue.db` relative to cwd — the wiring resolves it under
	 * apps/web/data like the other dev stores.
	 */
	readonly dbPath?: string;
	/** Logical queue name stored per row (future-proofing — the binding
	 * is per-queue on Cloudflare). Default `"audio"`. */
	readonly queue?: string;
	/** Deferred consumer import — same lazy-load trick as before:
	 * audio-jobs.ts → platform.ts → this module would be a cycle. */
	readonly loadHandler: () => Promise<LocalQueueHandler>;
	/** Max rows claimed per poll. Default 10. */
	readonly batchSize?: number;
	/** Poll interval ms. Default 250. */
	readonly pollMs?: number;
	/** Delivery attempts before a row is dead-lettered (`failed`).
	 * Default 3 — same budget the in-process stand-in used. */
	readonly maxAttempts?: number;
	/** Linear backoff base: run_at = now + base * attempts. Default 250 —
	 * same schedule the in-process stand-in used (250ms, 500ms). */
	readonly backoffBaseMs?: number;
}

/** Returned queue: the Cloudflare QueueProducer slice plus close()
 * (tests use close()+reopen on the same dbPath to simulate restarts)
 * and stats() — the dev-only depth probe behind ServerRuntime's
 * `audioQueueDepth` (prod workerd Queues expose no query API, so the
 * ops console reports them as externally managed). */
export interface LocalQueue {
	send(body: unknown): Promise<unknown>;
	stats(): Promise<QueueDepth>;
	close(): void;
}

const DEFAULT_DB_PATH = "./data/queue.db";
const DEFAULT_QUEUE = "audio";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 250;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;

interface JobRow {
	readonly id: number;
	readonly body: string;
}

type Outcome = "done" | "retry";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	queue TEXT NOT NULL,
	body TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL DEFAULT 3,
	run_at INTEGER NOT NULL,
	last_error TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_poll ON jobs(status, run_at);
`;

export const makeLocalQueue = (options: LocalQueueOptions): LocalQueue => {
	const dbPath =
		options.dbPath === ":memory:" ? ":memory:" : resolve(options.dbPath ?? DEFAULT_DB_PATH);
	const queue = options.queue ?? DEFAULT_QUEUE;
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

	if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.pragma("busy_timeout = 5000");
	if (dbPath !== ":memory:") {
		db.pragma("journal_mode = WAL");
	}
	db.exec(SCHEMA);

	const now = () => Date.now();

	// Crash recovery: rows claimed by a dead process go back to pending.
	// attempts was already incremented at claim time, so they keep their
	// budget — no infinite redelivery of poison messages.
	db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing'").run();

	const insert = db.prepare(
		`INSERT INTO jobs (queue, body, status, attempts, max_attempts, run_at, created_at, updated_at)
		 VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`,
	);

	// Claim due rows atomically: a single UPDATE...RETURNING selects and
	// marks rows in one statement, so a racing claimer (another dev:node
	// on the same file) cannot double-deliver. attempts is incremented
	// HERE, at claim time — see the module docstring.
	const claim = db.prepare(
		`UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = ?
		 WHERE id IN (
			SELECT id FROM jobs
			WHERE queue = ? AND status = 'pending' AND run_at <= ?
			ORDER BY id LIMIT ?
		 )
		 RETURNING id, body`,
	);

	const settle = db.transaction(
		(results: readonly { id: number; outcome: Outcome; error?: string }[], nowMs: number) => {
			const done = db.prepare(
				`UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ? AND status = 'processing'`,
			);
			const retry = db.prepare(
				`UPDATE jobs SET status = 'pending', run_at = ?, last_error = ?, updated_at = ?
			 WHERE id = ? AND status = 'processing'`,
			);
			const fail = db.prepare(
				`UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ?
			 WHERE id = ? AND status = 'processing'`,
			);
			const attemptsOf = db.prepare(`SELECT attempts FROM jobs WHERE id = ?`);
			for (const r of results) {
				if (r.outcome === "done") {
					done.run(nowMs, r.id);
					continue;
				}
				const attempts = (attemptsOf.get(r.id) as { attempts: number }).attempts;
				if (attempts >= maxAttempts) {
					fail.run(r.error ?? "delivery attempts exhausted", nowMs, r.id);
				} else {
					retry.run(nowMs + backoffBaseMs * attempts, r.error ?? null, nowMs, r.id);
				}
			}
		},
	);

	let polling = false;

	const poll = async (): Promise<void> => {
		if (polling) return; // a slow consumer must not stack batches
		polling = true;
		try {
			const rows = claim.all(now(), queue, now(), batchSize) as JobRow[];
			if (rows.length === 0) return;
			const outcomes = new Map<number, Outcome>();
			const errors = new Map<number, string>();
			const messages: LocalQueueMessage[] = rows.map((row) => ({
				// Corrupt JSON still gets delivered (as the raw string) so the
				// consumer's decode-and-ack path can dead-letter it itself.
				body: (() => {
					try {
						return JSON.parse(row.body) as unknown;
					} catch {
						return row.body;
					}
				})(),
				ack: () => {
					outcomes.set(row.id, "done");
				},
				retry: () => {
					outcomes.set(row.id, "retry");
				},
			}));
			try {
				const handler = await options.loadHandler();
				await handler(messages);
			} catch (error) {
				// Whole-batch failure (handler load or unexpected throw):
				// anything not explicitly acked counts as a retry.
				const message = error instanceof Error ? error.message : String(error);
				for (const row of rows) {
					if (!outcomes.has(row.id)) {
						outcomes.set(row.id, "retry");
						errors.set(row.id, message);
					}
				}
			}
			const results = rows.map((row) => {
				const outcome = outcomes.get(row.id) ?? "retry";
				return { id: row.id, outcome, error: errors.get(row.id) };
			});
			settle(results, now());
			const done = results.filter((r) => r.outcome === "done").length;
			if (done > 0) console.info("[dev:node] queue batch processed", { done, total: rows.length });
		} catch (error) {
			console.error("[dev:node] queue poll failed", error);
		} finally {
			polling = false;
		}
	};

	// The poller starts at construction (not lazily on first send) so
	// jobs left pending by a previous process drain after a restart even
	// when nothing new is sent. It's unref'd — an idle queue costs one
	// indexed SELECT per pollMs and never keeps the process alive.
	const timer = setInterval(() => void poll(), pollMs);
	timer.unref();

	const countByStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`);

	return {
		send: (body: unknown): Promise<unknown> => {
			const text = JSON.stringify(body) ?? "null";
			const t = now();
			insert.run(queue, text, maxAttempts, t, t, t);
			return Promise.resolve({});
		},
		stats: (): Promise<QueueDepth> => {
			const depth: Record<keyof QueueDepth, number> = {
				pending: 0,
				processing: 0,
				done: 0,
				failed: 0,
			};
			for (const row of countByStatus.all() as { status: string; n: number }[]) {
				if (row.status in depth) depth[row.status as keyof QueueDepth] = row.n;
			}
			return Promise.resolve(depth);
		},
		close: () => {
			clearInterval(timer);
			db.close();
		},
	};
};
