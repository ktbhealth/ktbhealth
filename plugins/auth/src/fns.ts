import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";

import { Email } from "@ktb/email";
import { getLocale, run } from "@ktb/server-fns";

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

/**
 * True when this deployment can send email (an Email driver other than
 * the disabled one is bound). The login view uses it to skip the
 * post-sign-up verification step when no message could ever arrive —
 * mirrors the host's emailEnabledFn, which plugins cannot import.
 */
export const emailEnabledFn = createServerFn({ method: "GET" }).handler(() =>
	run(Effect.map(Effect.service(Email), (sender) => sender !== null)),
);
