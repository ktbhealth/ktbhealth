import type * as Layer from "effect/Layer";

/**
 * A driver binds one service port — a `Context.Service` identifier such as
 * `"@ktb/bot/Bot"` — to the layer that implements it, plus an optional env
 * predicate deciding eligibility. Port→impl selection is data: the
 * composition root registers descriptors and resolves them per port, so
 * impl packages never hardcode each other's env checks.
 *
 * `E` is the env slice the driver inspects (platform bindings, injected
 * config, ...). A driver without `when` is always eligible.
 */
export interface Driver<E = unknown> {
	/** Unique driver name, e.g. "captcha-turnstile". */
	readonly id: string;
	/** Service tag identifier this driver provides — `SomeService.key`. */
	readonly port: string;
	/** Build the layer, given the env the registry was resolved with. */
	provides(env: E): Layer.Any;
	/** Eligibility predicate; absent means always enabled. */
	when?(env: E): boolean;
}

const enabled = <E>(driver: Driver<E>, env: E): boolean =>
	driver.when === undefined || driver.when(env);

/** Drivers currently eligible for `env`, in registration order. */
export const enabledDrivers = <E>(drivers: readonly Driver<E>[], env: E): Driver<E>[] =>
	drivers.filter((d) => enabled(d, env));

/** All drivers registered for a port, in registration order. */
export const driversForPort = <E>(drivers: readonly Driver<E>[], port: string): Driver<E>[] =>
	drivers.filter((d) => d.port === port);

/**
 * Resolve the implementation for `port`: the first enabled driver in
 * registration order — array order is the deterministic tie-break.
 * Returns undefined when no registered driver is eligible.
 */
export const resolveDriver = <E>(
	drivers: readonly Driver<E>[],
	port: string,
	env: E,
): Driver<E> | undefined => drivers.find((d) => d.port === port && enabled(d, env));

/** Like {@link resolveDriver}, but throws when nothing is eligible. */
export const requireDriver = <E>(
	drivers: readonly Driver<E>[],
	port: string,
	env: E,
): Driver<E> => {
	const driver = resolveDriver(drivers, port, env);
	if (driver === undefined) throw new Error(`no enabled driver for port "${port}"`);
	return driver;
};
