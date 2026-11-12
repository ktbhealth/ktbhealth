import { createServerFn } from "@tanstack/react-start";

import { getLocale } from "@ktb/server-fns";

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());
