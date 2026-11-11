import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLocalQueue, type LocalQueueHandler, type LocalQueueMessage } from "./node-queue.ts";

let dir: string | undefined;
const tmpDir = () => {
	dir ??= mkdtempSync(join(tmpdir(), "ktb-queue-"));
	return dir;
};
const dbPath = () => join(tmpDir(), "queue.db");

const jobs = (path: string) => {
	const db = new Database(path, { readonly: true });
	try {
		return db.prepare("SELECT * FROM jobs ORDER BY id").all() as Record<string, unknown>[];
	} finally {
		db.close();
	}
};

const ackAll: LocalQueueHandler = async (messages) => {
	for (const m of messages) m.ack();
};

/** Flush microtasks + a couple of poll ticks. */
const tick = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
	if (dir !== undefined) {
		rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	}
	vi.restoreAllMocks();
});

describe("makeLocalQueue", () => {
	it("send() resolves immediately, persists the job, and ack marks it done", async () => {
		const seen: unknown[] = [];
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				for (const m of messages) {
					seen.push(m.body);
					m.ack();
				}
			},
		});
		const result = await queue.send({ consultationId: 1, audioKey: "k", userId: "u" });
		expect(result).toEqual({});
		// The poller has not fired yet — send() only inserts the row.
		expect(seen).toHaveLength(0);
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		expect(seen[0]).toEqual({ consultationId: 1, audioKey: "k", userId: "u" });
		await vi.waitFor(() =>
			expect(jobs(dbPath())[0]).toMatchObject({ status: "done", attempts: 1 }),
		);
		queue.close();
	});

	it("batches all due rows into a single consumer call", async () => {
		const batches: LocalQueueMessage[][] = [];
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 20,
			loadHandler: async () => async (messages) => {
				batches.push([...messages]);
				for (const m of messages) m.ack();
			},
		});
		await queue.send({ n: 1 });
		await queue.send({ n: 2 });
		await queue.send(undefined); // JSON.stringify(undefined) → stored "null"
		await vi.waitFor(() => expect(batches.flat()).toHaveLength(3));
		expect(batches).toHaveLength(1);
		expect(batches[0]!.map((m) => m.body)).toEqual([{ n: 1 }, { n: 2 }, null]);
		queue.close();
	});

	it("retry() reschedules with linear backoff, then a later ack completes", async () => {
		let calls = 0;
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 10,
			backoffBaseMs: 300,
			loadHandler: async () => async (messages) => {
				calls++;
				for (const m of messages) {
					if (calls === 1) m.retry();
					else m.ack();
				}
			},
		});
		const before = Date.now();
		await queue.send({ n: 1 });
		await vi.waitFor(() => expect(calls).toBe(1));
		const [row] = jobs(dbPath());
		expect(row).toMatchObject({ status: "pending", attempts: 1 });
		// run_at = settle-time + backoffBaseMs * attempts (attempts already 1).
		expect(row!.run_at as number).toBeGreaterThan(before + 250);
		await vi.waitFor(
			() => expect(jobs(dbPath())[0]).toMatchObject({ status: "done", attempts: 2 }),
			{
				timeout: 3000,
			},
		);
		expect(calls).toBe(2);
		queue.close();
	});

	it("exhausts max_attempts into failed — the dead-letter queue", async () => {
		let calls = 0;
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 5,
			backoffBaseMs: 5,
			maxAttempts: 2,
			loadHandler: async () => async (messages) => {
				calls++;
				for (const m of messages) m.retry();
			},
		});
		vi.spyOn(console, "info").mockImplementation(() => {});
		await queue.send({ n: 1 });
		await vi.waitFor(() =>
			expect(jobs(dbPath())[0]).toMatchObject({ status: "failed", attempts: 2 }),
		);
		expect(calls).toBe(2);
		expect(jobs(dbPath())[0]!.last_error).toBe("delivery attempts exhausted");
		queue.close();
	});

	it("pending jobs survive a restart (close + reopen on the same file)", async () => {
		const path = dbPath();
		const q1 = makeLocalQueue({
			dbPath: path,
			pollMs: 60_000, // never fires before close
			loadHandler: async () => ackAll,
		});
		await q1.send({ n: 1 });
		q1.close();
		expect(jobs(path)[0]).toMatchObject({ status: "pending" });

		const seen: unknown[] = [];
		const q2 = makeLocalQueue({
			dbPath: path,
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				for (const m of messages) {
					seen.push(m.body);
					m.ack();
				}
			},
		});
		await q2.send({ n: 2 }); // also starts q2's poller
		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
		q2.close();
	});

	it("rows stuck in processing are reset to pending on open (crash recovery)", async () => {
		const path = dbPath();
		// Create the schema, then simulate a crash: a row claimed by a
		// dead process stays 'processing' with attempts already spent.
		const init = makeLocalQueue({ dbPath: path, pollMs: 60_000, loadHandler: async () => ackAll });
		init.close();
		const seed = new Database(path);
		seed
			.prepare(
				`INSERT INTO jobs (queue, body, status, attempts, max_attempts, run_at, created_at, updated_at)
				 VALUES ('audio', '{"n":0}', 'processing', 1, 3, 0, 0, 0)`,
			)
			.run();
		seed.close();

		const seen: unknown[] = [];
		const queue = makeLocalQueue({
			dbPath: path,
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				for (const m of messages) {
					seen.push(m.body);
					m.ack();
				}
			},
		});
		await queue.send({ trigger: true });
		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen).toEqual([{ n: 0 }, { trigger: true }]);
		// The recovered row kept its spent attempt (1 → 2 on redelivery).
		await vi.waitFor(() => expect(jobs(path).every((j) => j.status === "done")).toBe(true));
		expect(jobs(path)[0]).toMatchObject({ attempts: 2 });
		queue.close();
	});

	it("handler load failure retries the claimed batch like a delivery failure", async () => {
		let loads = 0;
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 10,
			backoffBaseMs: 5,
			loadHandler: async () => {
				loads++;
				if (loads === 1) throw "load boom"; // non-Error → String() branch
				return ackAll;
			},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await queue.send({ n: 1 });
		await vi.waitFor(() =>
			expect(jobs(dbPath())[0]).toMatchObject({ status: "done", attempts: 2 }),
		);
		expect(loads).toBe(2);
		queue.close();
	});

	it("a handler throw keeps acked rows done and retries the rest", async () => {
		let calls = 0;
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 10,
			backoffBaseMs: 5,
			loadHandler: async () => async (messages) => {
				calls++;
				if (calls === 1) {
					messages[0]!.ack();
					throw new Error("mid-batch boom");
				}
				for (const m of messages) m.ack();
			},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await queue.send({ n: 1 });
		await queue.send({ n: 2 });
		await vi.waitFor(() => expect(jobs(dbPath()).every((j) => j.status === "done")).toBe(true));
		const rows = jobs(dbPath());
		expect(rows[0]).toMatchObject({ attempts: 1 });
		expect(rows[1]).toMatchObject({ attempts: 2 });
		queue.close();
	});

	it("messages neither acked nor retried are treated as retries", async () => {
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 5,
			backoffBaseMs: 5,
			maxAttempts: 1,
			loadHandler: async () => async () => {},
		});
		await queue.send({ n: 1 });
		await vi.waitFor(() =>
			expect(jobs(dbPath())[0]).toMatchObject({ status: "failed", attempts: 1 }),
		);
		queue.close();
	});

	it("a corrupt stored body is delivered raw so the consumer can ack it", async () => {
		const path = dbPath();
		// Create the schema first, then seed a bad row.
		const init = makeLocalQueue({ dbPath: path, pollMs: 60_000, loadHandler: async () => ackAll });
		init.close();
		const seed = new Database(path);
		seed
			.prepare(
				`INSERT INTO jobs (queue, body, status, attempts, max_attempts, run_at, created_at, updated_at)
				 VALUES ('audio', 'not json{{', 'pending', 0, 3, 0, 0, 0)`,
			)
			.run();
		seed.close();

		const seen: unknown[] = [];
		const queue = makeLocalQueue({
			dbPath: path,
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				for (const m of messages) {
					seen.push(m.body);
					m.ack();
				}
			},
		});
		await queue.send({ trigger: true });
		await vi.waitFor(() => expect(seen).toContain("not json{{"));
		queue.close();
	});

	it("does not stack polls while a delivery is in flight", async () => {
		let calls = 0;
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 5,
			loadHandler: async () => async (messages) => {
				calls++;
				await new Promise((r) => setTimeout(r, 40));
				for (const m of messages) m.ack();
			},
		});
		await queue.send({ n: 1 });
		await vi.waitFor(() => expect(jobs(dbPath())[0]).toMatchObject({ status: "done" }));
		expect(calls).toBe(1);
		queue.close();
	});

	it("logs and survives a settle failure (e.g. db closed mid-delivery)", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const queue = makeLocalQueue({
			dbPath: dbPath(),
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				await gate;
				for (const m of messages) m.ack();
			},
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await queue.send({ n: 1 });
		await tick(); // let the poll claim the row and enter the handler
		queue.close(); // closes the db under the in-flight delivery
		release();
		await vi.waitFor(() =>
			expect(errorSpy).toHaveBeenCalledWith("[dev:node] queue poll failed", expect.anything()),
		);
	});

	it("supports :memory:, a custom queue name, and close() before any send", async () => {
		const seen: unknown[] = [];
		const mem = makeLocalQueue({
			dbPath: ":memory:",
			queue: "other",
			pollMs: 10,
			loadHandler: async () => async (messages) => {
				for (const m of messages) {
					seen.push(m.body);
					m.ack();
				}
			},
		});
		await mem.send({ n: 1 });
		await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }]));
		mem.close();

		// close() with the poller never started (timer === undefined branch).
		makeLocalQueue({ dbPath: dbPath(), loadHandler: async () => ackAll }).close();
	});

	it("defaults dbPath to ./data/queue.db under the cwd", async () => {
		const cwd = process.cwd();
		process.chdir(tmpDir());
		try {
			const seen: unknown[] = [];
			const queue = makeLocalQueue({
				pollMs: 10,
				loadHandler: async () => async (messages) => {
					for (const m of messages) {
						seen.push(m.body);
						m.ack();
					}
				},
			});
			await queue.send({ n: 1 });
			await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }]));
			queue.close();
		} finally {
			process.chdir(cwd);
		}
	});
});
