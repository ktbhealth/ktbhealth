import net from "node:net";
import tls from "node:tls";
import { Readable, Writable } from "node:stream";

import type { SmtpConnect, SmtpSocket } from "./smtp.ts";

// Node stand-in for the `cloudflare:sockets` connect() contract — used by
// the dev:node shim (node-cloudflare-workers.ts injects it as
// env.SMTP_CONNECT) and by this package's tests. Never reaches the
// workerd bundle: the deploy target passes the real cloudflare:sockets
// connect instead.
//
// TLS verification is OFF: this only ever talks to local-dev SMTP
// servers (mailpit, test fakes) which present self-signed certs.

const wrap = (
	raw: net.Socket | tls.TLSSocket,
	hostname: string,
	ready: "connect" | "secureConnect",
): SmtpSocket => ({
	opened: new Promise<unknown>((resolve, reject) => {
		raw.once(ready, resolve);
		raw.once("error", reject);
	}),
	readable: Readable.toWeb(raw) as ReadableStream<Uint8Array>,
	writable: Writable.toWeb(raw) as WritableStream<Uint8Array>,
	closed: new Promise<void>((resolve) => raw.once("close", resolve)),
	close: () =>
		new Promise<void>((resolve) => {
			if (raw.destroyed) return resolve();
			raw.once("close", resolve);
			raw.destroy();
		}),
	startTls: () =>
		wrap(
			tls.connect({
				socket: raw,
				// RFC 6066: SNI must be a name, not an IP literal.
				servername: net.isIP(hostname) === 0 ? hostname : undefined,
				rejectUnauthorized: false,
			}),
			hostname,
			"secureConnect",
		),
});

export const connect: SmtpConnect = (address, options) => {
	const secure = options?.secureTransport === "on";
	const raw = secure
		? tls.connect({
				host: address.hostname,
				port: address.port,
				servername: net.isIP(address.hostname) === 0 ? address.hostname : undefined,
				rejectUnauthorized: false,
			})
		: net.connect({ host: address.hostname, port: address.port });
	return wrap(raw, address.hostname, secure ? "secureConnect" : "connect");
};
