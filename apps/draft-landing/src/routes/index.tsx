import { createFileRoute } from "@tanstack/react-router";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import * as m from "#/paraglide/messages.js";

export const Route = createFileRoute("/")({ component: Landing });

const REPO_URL = "https://github.com/ktbhealth/ktbhealth";

function Landing() {
	return (
		<main>
			{/* Hero */}
			<section className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
				<span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
					{m.hero_badge()}
				</span>
				<h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
					{m.hero_title()}
				</h1>
				<p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					{m.hero_subtitle()}
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-3">
					<a
						href={REPO_URL}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "default", size: "lg" })}
					>
						{m.hero_cta_primary()}
					</a>
					<a href="#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
						{m.hero_cta_secondary()}
					</a>
				</div>
			</section>

			{/* Problem */}
			<section className="border-t border-border bg-muted/40">
				<div className="mx-auto max-w-6xl px-6 py-16">
					<h2 className="text-sm font-semibold tracking-wide text-primary uppercase">
						{m.problem_title()}
					</h2>
					<p className="mt-4 max-w-3xl text-xl leading-relaxed font-medium sm:text-2xl">
						{m.problem_body()}
					</p>
					<dl className="mt-10 grid gap-6 sm:grid-cols-3">
						{[
							[m.problem_stat1_num(), m.problem_stat1_label()],
							[m.problem_stat2_num(), m.problem_stat2_label()],
							[m.problem_stat3_num(), m.problem_stat3_label()],
						].map(([num, label]) => (
							<div key={label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
								<dt className="order-2 mt-1 text-sm text-muted-foreground">{label}</dt>
								<dd className="text-2xl font-bold tracking-tight">{num}</dd>
							</div>
						))}
					</dl>
				</div>
			</section>

			{/* How it works */}
			<section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
				<h2 className="text-sm font-semibold tracking-wide text-primary uppercase">
					{m.steps_title()}
				</h2>
				<p className="mt-3 max-w-2xl text-lg text-muted-foreground">{m.steps_subtitle()}</p>
				<ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
					{[
						[m.step1_title(), m.step1_body()],
						[m.step2_title(), m.step2_body()],
						[m.step3_title(), m.step3_body()],
						[m.step4_title(), m.step4_body()],
					].map(([title, body], i) => (
						<li key={title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
							<span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
								{i + 1}
							</span>
							<h3 className="mt-4 text-base font-semibold">{title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
						</li>
					))}
				</ol>
			</section>

			{/* Principles */}
			<section id="principles" className="scroll-mt-20 border-t border-border bg-muted/40">
				<div className="mx-auto max-w-6xl px-6 py-16">
					<h2 className="text-sm font-semibold tracking-wide text-primary uppercase">
						{m.principles_title()}
					</h2>
					<div className="mt-10 grid gap-6 sm:grid-cols-3">
						{[
							[m.principle1_title(), m.principle1_body()],
							[m.principle2_title(), m.principle2_body()],
							[m.principle3_title(), m.principle3_body()],
						].map(([title, body]) => (
							<div key={title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
								<h3 className="text-base font-semibold">{title}</h3>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Who + vision */}
			<section id="vision" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
				<div className="grid gap-10 sm:grid-cols-2">
					<div>
						<h2 className="text-sm font-semibold tracking-wide text-primary uppercase">
							{m.who_title()}
						</h2>
						<p className="mt-4 leading-relaxed text-muted-foreground">{m.who_body()}</p>
					</div>
					<div>
						<h2 className="text-sm font-semibold tracking-wide text-primary uppercase">
							{m.vision_title()}
						</h2>
						<p className="mt-4 leading-relaxed text-muted-foreground">{m.vision_body()}</p>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="border-t border-border">
				<div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm font-medium">{m.footer_tagline()}</p>
						<p className="mt-1 text-xs text-muted-foreground">{m.footer_disclaimer()}</p>
					</div>
					<a
						href={REPO_URL}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{m.footer_repo()}
					</a>
				</div>
			</footer>
		</main>
	);
}
