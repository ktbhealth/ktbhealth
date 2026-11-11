import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import { getLocale } from "#/paraglide/runtime.js";
import { plugins } from "#/plugins.ts";
import { validateAudienceSearch } from "@ktb/audience";

// A plugin may own the whole landing page (`landing.page`); the first
// contribution in topo order wins. The audience plugin (P-056) owns it —
// the fallback only renders if no landing plugin is registered.
function MissingLanding() {
	return (
		<section className="mx-auto flex max-w-2xl flex-col items-center px-6 pt-24 text-center">
			<h1 className="text-3xl font-bold tracking-tight">KTB Health</h1>
			<Link to="/consultations" className={buttonVariants() + " mt-8"}>
				Consultations
			</Link>
		</section>
	);
}

function Landing() {
	const Page = plugins.find((p) => p.landing !== undefined)?.landing?.page;
	// `locale` is injected by the host — plugins cannot import the host's
	// i18n runtime (see LandingPageProps in @ktb/kernel).
	return Page === undefined ? <MissingLanding /> : <Page locale={getLocale()} />;
}

export const Route = createFileRoute("/")({
	component: Landing,
	// ?audience=doctors|patients|developers|business — unknown or missing → doctors.
	validateSearch: validateAudienceSearch,
});
