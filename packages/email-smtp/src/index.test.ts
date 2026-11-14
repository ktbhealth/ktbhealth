import net from "node:net";
import tls from "node:tls";

import { afterEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

import { Email, EmailSendError } from "@ktb/email";
import {
	makeSmtpEmailSender,
	parseSmtpUrl,
	sendSmtpMessage,
	smtpEmailDriver,
	type SmtpConnect,
	type SmtpSocket,
} from "./index.ts";
import { dotStuff } from "./smtp.ts";
import { connect } from "./node-connect.ts";

// Self-signed localhost fixture (test-only; the node stand-in skips
// verification by design — see node-connect.ts).
const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCxTr2IE748EaDk
XU1ohn1AqRMuXzeeqS1JHZ4S4oYDgC6i/XM5+lCfLjwYyffapwO42vsbKeRQHDFu
4OJi5QwFB56N5T5n5gHs96Mil0RETVE6IqMtgp5NqHY6rpTDYVaXnn8Q1Um6rxWw
C6AYuHL/URmbS9yR46Pf5YCQrwexXraC89X5rmVUbmLQUjWK3dALMi3pBE2u4P4e
ucB2MmChJnL5dbMznDy+vpTUk6Q5ALlhp0d80IciCL+OkwebdUjo66oSh8lg7qjn
Qzgd+AyZJ/nxl86uNMwmRiOk+XsoYMt4VdxHW2pqauic3nLEojnx261MtkwL5uUg
xyN0pgVPAgMBAAECggEAAMxufRjoVUPtD2o+KYIwOToptx6VqmDFA/HJXvi8isfT
2Jxp8vEQ1jldQEKp8PGp9MtZBdfL9Ue95JZzCT1ShF6dlQewdBkB7uEfT84SRXkl
rFcwmJ610NAOlu1nXR6TRxk0evfC8791ymEFsRF6RHJx5OmpY3zSJaAr0pBUlAoW
Y259b4EeOq6GCXibGIn4jURNkhgwRCNOkQ4wZKMviC/+cLGZ4xY6K0bxUllu7bdH
LsbnagFfzCBc6LdZ3p28YgUT0nKB8pjM+GFpPpqq6mPxvazka+fc1KjwSViZuj+j
i2EwQPScYDFVXde1X7bdn0kYSS6FSms/utQKIiBVeQKBgQD46GSoD3Cud6WTJse/
2VW1Xr0MQZGtQhZXpgOhYQF9S0pKD4B31TnvpfGFi9lAt6nndD+Ul0YgnaErPcB9
3Adk22t89/mw3k8omEC7N8aV/SjUM7u4ADE9mB8VDm/PMgESPL7F9bAfvZCVUa2W
l6xZyc5ZJY7xncc5cMewSswHKQKBgQC2XBL7CbTpMf6u/5HGFTbJqdZEJWqCE0BI
MvXpv9ZliplEN0HGHomvrU163a8EZ90NJUVrRybUzySfFqG/+52X8Q78OVj99358
P6VJ3AGZilahqabPTVoVHOFJB2K5P1fz54xrVbB/UVCpSyAxhxjarUjSZTB737Tc
6ZWr+QWPtwKBgQCRv0qJWhkqH+c1JiUawoE8ZZAfKBnMMQFyK0S+71V272o9uZwJ
DzMQj8O/5ia9jY4QeHJuaLHokUR5VHxtdjRiK1ViZLWxikshwx1MQxmmZAnPT8eg
s4Qhw/yXUM/JrEcSTb2LnxSVUWPi+2PA5WlHXjLU4ng0JKYujUpwgSu9GQKBgGt2
Pskooy94grjlaiXsgmi8aMOnuOgGKC9juH6Syej0j/UfCueRP1oDKlFpKaXS/vSs
LghV2ZA2sUH+uDrGL8xGBaqksMiYfDUD3Id12ot8dii2LNKkpp0ic6/xZj/8D/xv
StRFnsioRnw9BS+qiP70dqFld/jHj3FPRSAekyRpAoGAP5RM2NwbYY+CzZ+snWZV
kZkEwHRTNsICLPOWrn21VpwB0IbSO6L7D2CQ/Q/MutQZaf2Tri33yXNW2RHQHFyf
GyW7OOSo0iPA6MeDaGQslHlt2lW8r15/F7/lF3Lm3ikYLJZ9+TflVPkpBZba6kCL
ZJs3qnun2dtqOn2N4JnH2cg=
-----END PRIVATE KEY-----`;
const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIC6DCCAdCgAwIBAgIUJnX16VM+paJR5WkWSWEL+2uJHk4wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTExMzAxNTYwNVoXDTM2MTEx
MDAxNTYwNVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAsU69iBO+PBGg5F1NaIZ9QKkTLl83nqktSR2eEuKGA4Au
ov1zOfpQny48GMn32qcDuNr7GynkUBwxbuDiYuUMBQeejeU+Z+YB7PejIpdERE1R
OiKjLYKeTah2Oq6Uw2FWl55/ENVJuq8VsAugGLhy/1EZm0vckeOj3+WAkK8HsV62
gvPV+a5lVG5i0FI1it3QCzIt6QRNruD+HrnAdjJgoSZy+XWzM5w8vr6U1JOkOQC5
YadHfNCHIgi/jpMHm3VI6OuqEofJYO6o50M4HfgMmSf58ZfOrjTMJkYjpPl7KGDL
eFXcR1tqamronN5yxKI58dutTLZMC+blIMcjdKYFTwIDAQABozIwMDAdBgNVHQ4E
FgQU0KfBWbhLRX+/aanAc5k0/6rCKlkwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG
9w0BAQsFAAOCAQEAWUxeB8SHONOHGaPqgn7dFjIHdZJNB+TaG8MIHTpb+vgOaRXH
JoQJR1PNKOmFJz6MsYH9MC5+qGT12CgSgy9TLYwkqsAIzp+Eon7oQ9SSGyuMX/b4
OZrJadnveMFbF0NwPyjweONlLlelGTV3MY9eVyFAoTRny5HLEgJC6W5FQcJCVhy+
mpRvU+vog9HogiUh1kWUCLZTRCvR7axjRi4AA4F8V8JNBrD4Y3O72FloNqkJxemM
62S6JM7F4+WQdk1BWzCZqYmlp1M3XD8pr0KPtklp3nOrvijwWCIHBZKSmJsIi4J6
sdzte5Po/M4jOhUxGkaSPwGMvU/XmbIQIrCksw==
-----END CERTIFICATE-----`;

// ---------- scripted fake SMTP server (node:net / node:tls) ----------

interface FakeServer {
	readonly port: number;
	readonly commands: string[];
	readonly dataLines: string[];
	readonly authPayloads: string[];
	readonly tlsUpgraded: { value: boolean };
	close(): Promise<void>;
}

interface FakeOptions {
	readonly tls?: boolean;
	readonly starttls?: boolean;
	readonly authAd?: string | null;
	readonly overrides?: Record<string, string>;
}

const tlsContext = tls.createSecureContext({ key: TLS_KEY, cert: TLS_CERT });

/** Minimal scripted responder — enough SMTP to exercise the client for real. */
const startFakeSmtp = async (options: FakeOptions = {}): Promise<FakeServer> => {
	const commands: string[] = [];
	const dataLines: string[] = [];
	const authPayloads: string[] = [];
	const tlsUpgraded = { value: false };
	const overrides = options.overrides ?? {};

	const onConnection = (raw: net.Socket) => {
		let socket: net.Socket | tls.TLSSocket = raw;
		let buffer = "";
		let inData = false;
		const write = (line: string) => socket.write(`${line}\r\n`);
		const onLine = (line: string) => {
			if (inData) {
				if (line === ".") {
					inData = false;
					write("250 queued");
				} else {
					dataLines.push(line);
				}
				return;
			}
			commands.push(line);
			const cmd = line.split(" ", 1)[0].toUpperCase();
			const overridden = overrides[cmd];
			if (overridden !== undefined) {
				if (overridden === "CLOSE") return void socket.destroy();
				return write(overridden);
			}
			switch (cmd) {
				case "EHLO": {
					const caps: string[] = ["250-fake greets you"];
					if (options.starttls !== false) caps.push("250-STARTTLS");
					if (options.authAd !== null) caps.push(`250-${options.authAd ?? "AUTH PLAIN"}`);
					caps.push("250 OK");
					write(caps.join("\r\n"));
					return;
				}
				case "STARTTLS": {
					write("220 ready for TLS");
					raw.removeAllListeners("data");
					socket = new tls.TLSSocket(socket as net.Socket, {
						isServer: true,
						secureContext: tlsContext,
					});
					tlsUpgraded.value = true;
					socket.on("data", onData);
					socket.on("error", () => {});
					return;
				}
				case "AUTH":
					authPayloads.push(line.slice("AUTH PLAIN ".length));
					return write("235 authenticated");
				case "MAIL":
				case "RCPT":
					return write("250 ok");
				case "DATA":
					inData = true;
					return write("354 send it");
				case "QUIT":
					return write("221 bye");
				default:
					return write("502 unsupported");
			}
		};
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const nl = buffer.indexOf("\n");
				if (nl === -1) return;
				const line = buffer.slice(0, nl).replace(/\r$/, "");
				buffer = buffer.slice(nl + 1);
				onLine(line);
			}
		};
		socket.on("data", onData);
		// Clients may abort mid-session (destroy, RST) — a server-side
		// socket error is not a test failure.
		socket.on("error", () => {});
		write("220 fake ESMTP");
	};

	const server =
		options.tls === true
			? tls.createServer({ key: TLS_KEY, cert: TLS_CERT }, onConnection)
			: net.createServer(onConnection);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as net.AddressInfo).port;
	return {
		port,
		commands,
		dataLines,
		authPayloads,
		tlsUpgraded,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
};

const servers: FakeServer[] = [];
const fake = async (options?: FakeOptions) => {
	const server = await startFakeSmtp(options);
	servers.push(server);
	return server;
};

afterEach(async () => {
	while (servers.length > 0) await servers.pop()!.close();
});

const send = (
	url: string,
	message: Parameters<ReturnType<typeof makeSmtpEmailSender>["send"]>[0],
) => sendSmtpMessage(connect, parseSmtpUrl(url), { from: "noreply@ktb.test", ...message });

const TEXT = { to: "a@ktb.test", subject: "Hi", text: "body" };

describe("parseSmtpUrl", () => {
	it("defaults smtp:// to plain on port 25", () => {
		expect(parseSmtpUrl("smtp://localhost")).toEqual({
			host: "localhost",
			port: 25,
			user: null,
			pass: null,
			secure: "off",
		});
	});

	it("parses credentials and the starttls flag", () => {
		expect(parseSmtpUrl("smtp://u%40x:p%2Fa@smtp.test:587?starttls")).toEqual({
			host: "smtp.test",
			port: 587,
			user: "u@x",
			pass: "p/a",
			secure: "starttls",
		});
	});

	it("treats starttls=0 as off and smtps:// as implicit TLS on 465", () => {
		expect(parseSmtpUrl("smtp://h:1025?starttls=0").secure).toBe("off");
		expect(parseSmtpUrl("smtps://h").secure).toBe("on");
		expect(parseSmtpUrl("smtps://h").port).toBe(465);
	});

	it("rejects bad urls, schemes, missing hosts and bad ports", () => {
		expect(() => parseSmtpUrl("not a url")).toThrow(EmailSendError);
		expect(() => parseSmtpUrl("http://h")).toThrow(/scheme/);
		expect(() => parseSmtpUrl("smtp://")).toThrow(/host/);
		expect(() => parseSmtpUrl("smtp://h:0")).toThrow(/port/);
	});
});

describe("sendSmtpMessage", () => {
	it("runs the full envelope over a plain connection", async () => {
		const server = await fake({ starttls: false });
		await send(`smtp://127.0.0.1:${server.port}`, TEXT);
		expect(server.commands.map((line) => line.split(" ", 1)[0])).toEqual([
			"EHLO",
			"MAIL",
			"RCPT",
			"DATA",
			"QUIT",
		]);
		expect(server.commands[1]).toBe("MAIL FROM:<noreply@ktb.test>");
		expect(server.commands[2]).toBe("RCPT TO:<a@ktb.test>");
		const body = server.dataLines.join("\n");
		expect(body).toContain("From: <noreply@ktb.test>");
		expect(body).toContain("To: <a@ktb.test>");
		expect(body).toContain("Subject: Hi");
		expect(body).toContain("Content-Transfer-Encoding: base64");
		expect(body).toContain(Buffer.from("body", "utf8").toString("base64"));
	});

	it.each(["127.0.0.1", "localhost"])(
		"upgrades with STARTTLS and authenticates (%s)",
		async (host) => {
			const server = await fake();
			await send(`smtp://user:pass@${host}:${server.port}?starttls`, TEXT);
			expect(server.tlsUpgraded.value).toBe(true);
			expect(server.commands.map((line) => line.split(" ", 1)[0])).toEqual([
				"EHLO",
				"STARTTLS",
				"EHLO",
				"AUTH",
				"MAIL",
				"RCPT",
				"DATA",
				"QUIT",
			]);
			expect(atob(server.authPayloads[0])).toBe("user\0pass");
		},
	);

	it("authenticates against a bare AUTH capability and tolerates a missing password", async () => {
		const server = await fake({ authAd: "AUTH", starttls: false });
		await send(`smtp://user@127.0.0.1:${server.port}`, TEXT);
		expect(atob(server.authPayloads[0])).toBe("user\0");
	});

	it.each(["127.0.0.1", "localhost"])(
		"sends implicit-TLS (smtps://) traffic encrypted end to end (%s)",
		async (host) => {
			const server = await fake({ tls: true, starttls: false });
			await send(`smtps://${host}:${server.port}`, TEXT);
			expect(server.commands.at(-1)).toBe("QUIT");
		},
	);

	it("sends multipart/alternative when html is set", async () => {
		const server = await fake({ starttls: false });
		await send(`smtp://127.0.0.1:${server.port}`, { ...TEXT, html: "<p>oi</p>" });
		const body = server.dataLines.join("\n");
		expect(body).toContain('Content-Type: multipart/alternative; boundary="----ktb-boundary"');
		expect(body).toContain("Content-Type: text/plain");
		expect(body).toContain("Content-Type: text/html");
		expect(body).toContain(Buffer.from("<p>oi</p>", "utf8").toString("base64"));
	});

	it("B-encodes non-ASCII headers and folds CRLF out of them", async () => {
		const server = await fake({ starttls: false });
		await send(`smtp://127.0.0.1:${server.port}`, {
			to: "a@ktb.test",
			subject: "Confirmação",
			text: "body",
		});
		const body = server.dataLines.join("\n");
		expect(body).toContain("Subject: =?UTF-8?B?");
		await send(`smtp://127.0.0.1:${server.port}`, {
			to: "a@ktb.test",
			subject: "ok\r\nX-Injected: evil",
			text: "body",
		});
		expect(server.dataLines.join("\n")).not.toContain("\nX-Injected:");
	});

	it("fails when the server does not advertise STARTTLS", async () => {
		const server = await fake({ starttls: false });
		await expect(send(`smtp://127.0.0.1:${server.port}?starttls`, TEXT)).rejects.toThrow(
			/does not advertise STARTTLS/,
		);
	});

	it("fails when credentials are configured but AUTH is not advertised", async () => {
		const server = await fake({ authAd: null, starttls: false });
		await expect(send(`smtp://u@127.0.0.1:${server.port}`, TEXT)).rejects.toThrow(
			/does not advertise AUTH/,
		);
	});

	it("fails on a rejected recipient with the server reply", async () => {
		const server = await fake({ starttls: false, overrides: { RCPT: "550 no such user" } });
		await expect(send(`smtp://127.0.0.1:${server.port}`, TEXT)).rejects.toThrow(
			/RCPT TO rejected: 550 no such user/,
		);
	});

	it("fails when the server closes before the greeting", async () => {
		const server = await fake({ starttls: false, overrides: { EHLO: "CLOSE" } });
		await expect(send(`smtp://127.0.0.1:${server.port}`, TEXT)).rejects.toThrow(/closed/);
	});

	it("fails on a malformed reply line", async () => {
		const server = await fake({ starttls: false, overrides: { EHLO: "garbage" } });
		await expect(send(`smtp://127.0.0.1:${server.port}`, TEXT)).rejects.toThrow(/malformed/);
	});

	it("wraps non-smtp failures in EmailSendError", async () => {
		const boom = new Error("boom");
		const badConnect: SmtpConnect = () => {
			throw boom;
		};
		const error = await sendSmtpMessage(badConnect, parseSmtpUrl("smtp://h:1"), {
			from: "f@x",
			...TEXT,
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EmailSendError);
		expect((error as EmailSendError).message).toBe("smtp send failed: boom");
		expect((error as EmailSendError).cause).toBe(boom);
		const stringError = await sendSmtpMessage(
			() => {
				throw "nope";
			},
			parseSmtpUrl("smtp://h:1"),
			{ from: "f@x", ...TEXT },
		).catch((e: unknown) => e);
		expect((stringError as EmailSendError).message).toBe("smtp send failed: nope");
	});

	it("survives a close() failure after a protocol error", async () => {
		const socket: SmtpSocket = {
			opened: Promise.resolve({}),
			readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
			writable: new WritableStream<Uint8Array>(),
			startTls: () => socket,
			close: () => Promise.reject(new Error("close failed")),
			closed: Promise.resolve(),
		};
		await expect(
			sendSmtpMessage(() => socket, parseSmtpUrl("smtp://h:1"), { from: "f@x", ...TEXT }),
		).rejects.toThrow(/closed/);
	});
});

describe("dotStuff", () => {
	it("CRLF-normalizes and stuffs leading periods", () => {
		expect(dotStuff("a\rb\n.c\n\nd.")).toBe("a\r\nb\r\n..c\r\n\r\nd.");
	});
});

describe("node connect", () => {
	it("rejects opened when the connection fails", async () => {
		const socket = connect({ hostname: "127.0.0.1", port: 1 });
		await expect(socket.opened).rejects.toThrow();
	});

	it("close() is idempotent", async () => {
		const server = await fake({ starttls: false });
		const socket = connect({ hostname: "127.0.0.1", port: server.port });
		await socket.opened;
		await socket.close();
		await socket.close();
		await socket.closed;
	});
});

describe("smtpEmailDriver", () => {
	it("is eligible only with SMTP_URL and EMAIL_FROM", () => {
		expect(smtpEmailDriver.id).toBe("email-smtp");
		expect(smtpEmailDriver.port).toBe(Email.key);
		expect(smtpEmailDriver.when?.({})).toBe(false);
		expect(smtpEmailDriver.when?.({ SMTP_URL: "smtp://h" })).toBe(false);
		expect(smtpEmailDriver.when?.({ EMAIL_FROM: "f@x" })).toBe(false);
		expect(smtpEmailDriver.when?.({ SMTP_URL: "smtp://h", EMAIL_FROM: "f@x" })).toBe(true);
	});

	it("throws when no socket transport is bound", () => {
		expect(() => smtpEmailDriver.provides({ SMTP_URL: "smtp://h", EMAIL_FROM: "f@x" })).toThrow(
			/SMTP_CONNECT/,
		);
	});

	it("provides a sender that delivers through the configured server", async () => {
		const server = await fake({ starttls: false });
		const layer = smtpEmailDriver.provides({
			SMTP_URL: `smtp://127.0.0.1:${server.port}`,
			EMAIL_FROM: "noreply@ktb.test",
			SMTP_CONNECT: connect,
		}) as Layer.Layer<Email, never, never>;
		const email = await Effect.runPromise(Effect.service(Email).pipe(Effect.provide(layer)));
		await email?.send(TEXT);
		expect(server.commands.at(-1)).toBe("QUIT");
	});

	it("fails loudly on a misconfigured URL", () => {
		expect(() => smtpEmailDriver.provides({ SMTP_CONNECT: connect })).toThrow(EmailSendError);
	});
});

describe("makeSmtpEmailSender", () => {
	it("accepts a pre-parsed config", async () => {
		const server = await fake({ starttls: false });
		const sender = makeSmtpEmailSender({
			url: parseSmtpUrl(`smtp://127.0.0.1:${server.port}`),
			from: "noreply@ktb.test",
			connect,
		});
		await sender.send(TEXT);
		expect(server.commands.at(-1)).toBe("QUIT");
	});
});
