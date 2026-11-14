import { EmailSendError, type EmailMessage } from "@ktb/email";

// Runtime-agnostic SMTP client. The socket surface matches the
// `cloudflare:sockets` connect() contract — workerd provides the real
// one; dev:node and tests inject the node:net stand-in
// (./node-connect.ts) through the driver's env. No platform imports:
// transport arrives as a parameter.

/**
 * The slice of a `cloudflare:sockets` Socket this client uses. The
 * dev:node stand-in implements the same shape over node:net/node:tls.
 */
export interface SmtpSocket {
	readonly opened: Promise<unknown>;
	readonly readable: ReadableStream<Uint8Array>;
	readonly writable: WritableStream<Uint8Array>;
	/** Upgrade the live connection to TLS — call after a 220 STARTTLS reply. */
	startTls(): SmtpSocket;
	close(): Promise<void>;
	readonly closed: Promise<void>;
}

/** `connect()` as `cloudflare:sockets` exports it (address + secureTransport). */
export type SmtpConnect = (
	address: { readonly hostname: string; readonly port: number },
	options?: { readonly secureTransport?: "off" | "on" | "starttls" },
) => SmtpSocket;

export interface SmtpConfig {
	readonly host: string;
	readonly port: number;
	readonly user: string | null;
	readonly pass: string | null;
	/** `on` = implicit TLS (smtps), `starttls` = upgrade after EHLO, `off` = plain. */
	readonly secure: "off" | "on" | "starttls";
}

const DEFAULT_PORT = { smtp: 25, smtps: 465 } as const;

/**
 * `smtp://[user[:pass]@]host[:port][?starttls]` → plain connection, TLS
 * upgrade only when the `starttls` flag is present; `smtps://` → implicit
 * TLS (default port 465). Credentials are percent-decoded; a password
 * without a user is meaningless and dropped.
 */
export const parseSmtpUrl = (raw: string): SmtpConfig => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch (cause) {
		throw new EmailSendError(`invalid SMTP_URL: ${JSON.stringify(raw)}`, { cause });
	}
	const scheme = url.protocol.slice(0, -1);
	if (scheme !== "smtp" && scheme !== "smtps") {
		throw new EmailSendError(
			`invalid SMTP_URL scheme ${JSON.stringify(url.protocol)} — want smtp:// or smtps://`,
		);
	}
	if (url.hostname === "") throw new EmailSendError("invalid SMTP_URL: missing host");
	const port = url.port === "" ? DEFAULT_PORT[scheme] : Number(url.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new EmailSendError(`invalid SMTP_URL port ${JSON.stringify(url.port)}`);
	}
	return {
		host: url.hostname,
		port,
		user: url.username === "" ? null : decodeURIComponent(url.username),
		pass: url.password === "" ? null : decodeURIComponent(url.password),
		secure:
			scheme === "smtps"
				? "on"
				: url.searchParams.has("starttls") && url.searchParams.get("starttls") !== "0"
					? "starttls"
					: "off",
	};
};

// ---------- wire encoding ----------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 → base64 (chunked: String.fromCharCode spread has an arity cap). */
const b64encode = (text: string): string => {
	const bytes = encoder.encode(text);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
};

/** base64 wrapped at 76 columns, per MIME. */
const wrap76 = (b64: string): string => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** Header value: CRLF is folded away (injection guard), then raw when
 * printable ASCII and RFC 2047 B-encoding otherwise. */
const headerValue = (value: string): string => {
	const folded = value.replace(/[\r\n]+/g, " ");
	return /^[\x20-\x7e]*$/.test(folded) ? folded : `=?UTF-8?B?${b64encode(folded)}?=`;
};

const BOUNDARY = "----ktb-boundary";

/** RFC 5322 message: headers + plain body, or multipart/alternative when html is set. */
const mimeMessage = (message: EmailMessage & { readonly from: string }): string => {
	const headers = [
		`From: <${message.from}>`,
		`To: <${message.to}>`,
		`Subject: ${headerValue(message.subject)}`,
		"MIME-Version: 1.0",
	];
	if (message.html === undefined) {
		return [
			...headers,
			`Content-Type: text/plain; charset="utf-8"`,
			"Content-Transfer-Encoding: base64",
			"",
			wrap76(b64encode(message.text)),
		].join("\r\n");
	}
	const part = (type: string, body: string) =>
		[
			`--${BOUNDARY}`,
			`Content-Type: text/${type}; charset="utf-8"`,
			"Content-Transfer-Encoding: base64",
			"",
			wrap76(b64encode(body)),
		].join("\r\n");
	return [
		...headers,
		`Content-Type: multipart/alternative; boundary="${BOUNDARY}"`,
		"",
		part("plain", message.text),
		part("html", message.html),
		`--${BOUNDARY}--`,
	].join("\r\n");
};

/** CRLF-normalize, then transparency-stuff lines starting with '.'. */
export const dotStuff = (data: string): string =>
	data
		.replace(/\r\n|\r|\n/g, "\r\n")
		.split("\r\n")
		.map((line) => (line.startsWith(".") ? `.${line}` : line))
		.join("\r\n");

// ---------- protocol ----------

interface Reply {
	readonly code: number;
	readonly lines: string[];
}

/** Line-buffered command/reply channel over a live socket. */
class Conn {
	private socket: SmtpSocket;
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private buffer = "";
	private pending: string[] = [];

	constructor(socket: SmtpSocket) {
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	async send(line: string): Promise<void> {
		await this.writer.write(encoder.encode(line));
	}

	/** One complete reply: `NNN-...` continuation lines until the `NNN ` terminator. */
	async reply(): Promise<Reply> {
		for (;;) {
			const nl = this.buffer.indexOf("\n");
			if (nl !== -1) {
				const line = this.buffer.slice(0, nl).replace(/\r$/, "");
				this.buffer = this.buffer.slice(nl + 1);
				const m = /^(\d{3})([ -])(.*)$/.exec(line);
				if (m === null) {
					throw new EmailSendError(`malformed smtp reply: ${JSON.stringify(line)}`);
				}
				this.pending.push(m[3]);
				if (m[2] === " ") {
					const reply = { code: Number(m[1]), lines: this.pending };
					this.pending = [];
					return reply;
				}
				continue;
			}
			const { value, done } = await this.reader.read();
			if (done) throw new EmailSendError("smtp connection closed by the server");
			this.buffer += decoder.decode(value, { stream: true });
		}
	}

	/** STARTTLS: swap the channel onto the TLS-upgraded socket. */
	async upgrade(): Promise<void> {
		const socket = this.socket.startTls();
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
		this.buffer = "";
		this.pending = [];
		await socket.opened;
	}
}

const expect = async (conn: Conn, command: string, code: number): Promise<Reply> => {
	const reply = await conn.reply();
	if (reply.code !== code) {
		throw new EmailSendError(`smtp ${command} rejected: ${reply.code} ${reply.lines.join(" | ")}`);
	}
	return reply;
};

/** EHLO → the server's capability lines, upper-cased. */
const ehlo = async (conn: Conn): Promise<Set<string>> => {
	await conn.send("EHLO localhost\r\n");
	const reply = await expect(conn, "EHLO", 250);
	return new Set(reply.lines.slice(1).map((line) => line.trim().toUpperCase()));
};

/**
 * Deliver one message over SMTP. Connection lifecycle: greeting → EHLO →
 * optional STARTTLS upgrade → optional AUTH PLAIN → envelope → DATA →
 * QUIT. The socket is always closed; provider failures surface as
 * {@link EmailSendError}.
 */
export const sendSmtpMessage = async (
	connect: SmtpConnect,
	config: SmtpConfig,
	message: EmailMessage & { readonly from: string },
): Promise<void> => {
	let socket: SmtpSocket | undefined;
	try {
		socket = connect(
			{ hostname: config.host, port: config.port },
			{ secureTransport: config.secure === "on" ? "on" : "off" },
		);
		await socket.opened;
		const conn = new Conn(socket);
		await expect(conn, "greeting", 220);
		let caps = await ehlo(conn);
		if (config.secure === "starttls") {
			if (!caps.has("STARTTLS")) {
				throw new EmailSendError("smtp server does not advertise STARTTLS");
			}
			await conn.send("STARTTLS\r\n");
			await expect(conn, "STARTTLS", 220);
			await conn.upgrade();
			caps = await ehlo(conn);
		}
		if (config.user !== null) {
			if (![...caps].some((cap) => cap === "AUTH" || cap.startsWith("AUTH "))) {
				throw new EmailSendError("smtp server does not advertise AUTH");
			}
			const credential = b64encode(`${config.user}\0${config.pass ?? ""}`);
			await conn.send(`AUTH PLAIN ${credential}\r\n`);
			await expect(conn, "AUTH", 235);
		}
		await conn.send(`MAIL FROM:<${message.from}>\r\n`);
		await expect(conn, "MAIL FROM", 250);
		await conn.send(`RCPT TO:<${message.to}>\r\n`);
		await expect(conn, "RCPT TO", 250);
		await conn.send("DATA\r\n");
		await expect(conn, "DATA", 354);
		await conn.send(`${dotStuff(mimeMessage(message))}\r\n.\r\n`);
		await expect(conn, "DATA end", 250);
		await conn.send("QUIT\r\n");
		await expect(conn, "QUIT", 221);
	} catch (cause) {
		if (cause instanceof EmailSendError) throw cause;
		throw new EmailSendError(
			`smtp send failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	} finally {
		try {
			await socket?.close();
		} catch {
			// Already closed or a closing failure — delivery outcome stands.
		}
	}
};
