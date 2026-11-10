import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	NOTIFICATION_LOCALES,
	isNotificationLocale,
	notificationMessages,
	type NotificationMessages,
} from "./i18n.ts";

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

/** Every function leaf of a catalog. */
const functionsOf = (
	node: unknown,
	out: Array<(...args: any[]) => unknown> = [],
): Array<(...args: any[]) => unknown> => {
	if (typeof node === "function") out.push(node as (...args: any[]) => unknown);
	else if (node !== null && typeof node === "object")
		for (const value of Object.values(node)) functionsOf(value, out);
	return out;
};

describe("notification catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isNotificationLocale("pt-BR")).toBe(true);
		expect(isNotificationLocale("es")).toBe(true);
		expect(isNotificationLocale("fr")).toBe(false);
		expect(notificationMessages("fr")).toBe(notificationMessages(BASE_LOCALE));
		expect(notificationMessages("pt-BR").label).toBe("Notificações");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of NOTIFICATION_LOCALES) {
			expect(leaves(notificationMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("pluralizes unread counts and interpolates mark-as-read in every locale", () => {
		const m = (locale: string) => notificationMessages(locale) as NotificationMessages;
		expect(m("en").unreadCount(1)).toBe("1 unread");
		expect(m("pt-BR").unreadCount(1)).toBe("1 não lida");
		expect(m("pt-BR").unreadCount(3)).toBe("3 não lidas");
		expect(m("es").unreadCount(2)).toBe("2 sin leer");
		expect(m("pt-BR").markAsRead("Paciente criado")).toBe(
			'Marcar "Paciente criado" como lida',
		);
		expect(m("es").markAsRead("Aviso")).toBe('Marcar "Aviso" como leída');
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of NOTIFICATION_LOCALES) {
			for (const fn of functionsOf(notificationMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
