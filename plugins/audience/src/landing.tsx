import { Link, useSearch } from "@tanstack/react-router";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import { Badge } from "@ktbhealth/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ktbhealth/ui/components/card";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@ktbhealth/ui/components/accordion";
import type { LandingPageProps } from "@ktb/kernel";
import {
	ArrowRightIcon,
	AudioLinesIcon,
	BanIcon,
	CheckIcon,
	ClipboardCheckIcon,
	ClipboardListIcon,
	FileTextIcon,
	LockIcon,
	MicIcon,
	PenLineIcon,
	ServerIcon,
	ShieldCheckIcon,
	StethoscopeIcon,
} from "lucide-react";

import { docsHref, parseAudience, type Audience } from "./audience.ts";
import { BASE_LOCALE, audienceMessages, type AudienceMessages } from "./i18n.ts";
import { AudienceSelect } from "./select.tsx";

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
	return (
		<div className="mx-auto max-w-2xl text-center">
			<span className="text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</span>
			<h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">{title}</h2>
		</div>
	);
}

/** Browser-chrome frame around the product mock, in the style of shadcn hero screenshot blocks. */
function BrowserFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
			<div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
				<div className="flex gap-1.5">
					<span className="size-2.5 rounded-full bg-red-400" />
					<span className="size-2.5 rounded-full bg-amber-400" />
					<span className="size-2.5 rounded-full bg-primary" />
				</div>
				<div className="mx-auto flex w-full max-w-xs items-center justify-center rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
					ktb.health/consultations/new
				</div>
				<div className="w-10" />
			</div>
			{children}
		</div>
	);
}

function ProductMock({ t }: { readonly t: AudienceMessages }) {
	return (
		<BrowserFrame>
			<div className="grid gap-0 sm:grid-cols-[1fr_1.2fr]">
				{/* transcript column */}
				<div className="border-b border-border p-5 sm:border-b-0 sm:border-r">
					<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
						<AudioLinesIcon className="size-3.5" />
						{t.mock_live_transcription}
					</div>
					<div className="mt-4 space-y-3 text-sm">
						<div>
							<span className="text-xs font-semibold text-primary">{t.mock_dr_ana}</span>
							<p className="mt-0.5 text-muted-foreground">{t.mock_q1}</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-primary">{t.mock_patient}</span>
							<p className="mt-0.5 text-muted-foreground">{t.mock_a1}</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-primary">{t.mock_dr_ana}</span>
							<p className="mt-0.5 text-muted-foreground">{t.mock_q2}</p>
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="size-2 animate-pulse rounded-full bg-red-500" />
							<span className="text-xs text-muted-foreground">{t.mock_recording}</span>
						</div>
					</div>
				</div>
				{/* anamnesis column */}
				<div className="bg-muted/30 p-5">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
							<FileTextIcon className="size-3.5" />
							{t.mock_anamnesis}
						</div>
						<Badge variant="outline" className="text-[10px] font-normal">
							{t.mock_sample}
						</Badge>
					</div>
					<div className="mt-4 space-y-3">
						<div className="rounded-lg border border-border border-l-4 border-l-primary bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">{t.mock_cc}</span>
								<Badge className="bg-primary/10 text-[10px] text-primary ring-1 ring-primary/20 hover:bg-primary/15">
									{t.mock_conf_high}
								</Badge>
							</div>
							<p className="mt-1 text-sm">{t.mock_cc_text}</p>
							<p className="mt-1 text-[11px] text-muted-foreground">{t.mock_cc_evidence}</p>
						</div>
						<div className="rounded-lg border border-border border-l-4 border-l-amber-400 bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">{t.mock_meds}</span>
								<Badge className="bg-amber-50 text-[10px] text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">
									{t.mock_conf_med}
								</Badge>
							</div>
							<p className="mt-1 text-sm">{t.mock_meds_text}</p>
						</div>
						<div className="flex items-start gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
							<CheckIcon className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-semibold">{t.mock_review_lead}</span> {t.mock_review_rest}
							</span>
						</div>
					</div>
				</div>
			</div>
		</BrowserFrame>
	);
}

type AudienceCopy = {
	badge: string;
	titleA: string;
	titleB: string;
	subtitle: string;
	forYouTitle: string;
	forYou: string[];
};

/** Hero and "for you" copy per audience; everything else is shared. */
function audienceCopy(t: AudienceMessages): Record<Audience, AudienceCopy> {
	return {
		doctors: {
			badge: t.hero_doctors_badge,
			titleA: t.hero_doctors_title_a,
			titleB: t.hero_doctors_title_b,
			subtitle: t.hero_doctors_subtitle,
			forYouTitle: t.foryou_doctors_title,
			forYou: [t.foryou_doctors_p1, t.foryou_doctors_p2, t.foryou_doctors_p3],
		},
		patients: {
			badge: t.hero_patients_badge,
			titleA: t.hero_patients_title_a,
			titleB: t.hero_patients_title_b,
			subtitle: t.hero_patients_subtitle,
			forYouTitle: t.foryou_patients_title,
			forYou: [t.foryou_patients_p1, t.foryou_patients_p2, t.foryou_patients_p3],
		},
		developers: {
			badge: t.hero_developers_badge,
			titleA: t.hero_developers_title_a,
			titleB: t.hero_developers_title_b,
			subtitle: t.hero_developers_subtitle,
			forYouTitle: t.foryou_developers_title,
			forYou: [t.foryou_developers_p1, t.foryou_developers_p2, t.foryou_developers_p3],
		},
		business: {
			badge: t.hero_business_badge,
			titleA: t.hero_business_title_a,
			titleB: t.hero_business_title_b,
			subtitle: t.hero_business_subtitle,
			forYouTitle: t.foryou_business_title,
			forYou: [t.foryou_business_p1, t.foryou_business_p2, t.foryou_business_p3],
		},
	};
}

const audienceLabels = (t: AudienceMessages): Record<Audience, string> => ({
	doctors: t.audience_doctors,
	patients: t.audience_patients,
	developers: t.audience_developers,
	business: t.audience_business,
});

/**
 * The audience landing page — contributed as `landing.page` by this
 * plugin (P-056). `locale` is injected by the host; the audience itself
 * comes from the `?audience=` search param of `/`.
 */
export function AudienceLanding({ locale }: LandingPageProps) {
	const t = audienceMessages(locale ?? BASE_LOCALE);
	// The host route validates `?audience=`; reading it loosely here
	// keeps the plugin independent of the host's route-tree types.
	const audience = parseAudience(
		useSearch({ strict: false, select: (s: Record<string, unknown>) => s.audience }),
	);
	const copy = audienceCopy(t)[audience];
	const docs = docsHref(audience, locale ?? BASE_LOCALE);
	const labels = audienceLabels(t);
	const steps = [
		{ icon: MicIcon, title: t.step1_title, desc: t.step1_desc },
		{ icon: AudioLinesIcon, title: t.step2_title, desc: t.step2_desc },
		{ icon: ClipboardListIcon, title: t.step3_title, desc: t.step3_desc },
		{ icon: PenLineIcon, title: t.step4_title, desc: t.step4_desc },
	];
	// Sinsky et al., Annals of Internal Medicine 2016 — see home_stats_source.
	const stats = [
		{ value: "27%", label: t.home_stats_1 },
		{ value: "49%", label: t.home_stats_2 },
		{ value: "~2h", label: t.home_stats_3 },
	];
	const never = [t.never_1, t.never_2, t.never_3, t.never_4];
	const faq = [
		{ q: t.faq1_q, a: t.faq1_a },
		{ q: t.faq2_q, a: t.faq2_a },
		{ q: t.faq3_q, a: t.faq3_a },
		{ q: t.faq4_q, a: t.faq4_a },
		{ q: t.faq5_q, a: t.faq5_a },
	];
	const reviewItems = [t.feat_review_i1, t.feat_review_i2, t.feat_review_i3];
	const privacyItems = [
		{ icon: MicIcon, t: t.feat_privacy_p1 },
		{ icon: LockIcon, t: t.feat_privacy_p2 },
		{ icon: ServerIcon, t: t.feat_privacy_p3 },
	];
	const anamChips = [
		{ t: t.mock_cc, c: t.mock_conf_high_short, cls: "border-l-primary" },
		{ t: t.feat_hpi, c: t.mock_conf_med_short, cls: "border-l-amber-400" },
	];
	return (
		<div className="space-y-24">
			{/* ---------- hero ---------- */}
			<section className="mx-auto max-w-6xl px-6 pt-16 text-center">
				<div className="flex justify-center">
					<AudienceSelect t={t} />
				</div>
				<Badge variant="secondary" className="mt-6 gap-1.5 rounded-full px-3 py-1">
					<span className="size-1.5 rounded-full bg-primary" />
					{copy.badge}
				</Badge>
				<h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
					{copy.titleA} <span className="text-primary">{copy.titleB}</span>
				</h1>
				<p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					{copy.subtitle}
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					{audience === "doctors" ? (
						<>
							<Link to="/consultations/new" className={buttonVariants({ size: "lg" })}>
								{t.home_cta_start}
								<ArrowRightIcon />
							</Link>
							<Link
								to="/consultations"
								className={buttonVariants({ variant: "outline", size: "lg" })}
							>
								{t.home_cta_view}
							</Link>
						</>
					) : (
						<>
							<a href={docs} className={buttonVariants({ size: "lg" })}>
								{t.hero_docs_cta}
								<ArrowRightIcon />
							</a>
							<a href="#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
								{t.hero_how_cta}
							</a>
						</>
					)}
				</div>
				<dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-6 border-t border-border pt-8">
					{stats.map((s) => (
						<div key={s.label}>
							<dt className="text-2xl font-bold tracking-tight">{s.value}</dt>
							<dd className="mt-1 text-xs text-muted-foreground">{s.label}</dd>
						</div>
					))}
				</dl>
				<p className="mx-auto mt-4 max-w-2xl text-[11px] leading-relaxed text-muted-foreground/80">
					{t.home_stats_source}
				</p>
			</section>

			{/* ---------- for you (audience) ---------- */}
			<section className="mx-auto max-w-3xl px-6">
				<div className="border-l-4 border-primary pl-6">
					<span className="text-xs font-semibold tracking-wide text-primary uppercase">
						{t.foryou_eyebrow} · {labels[audience]}
					</span>
					<h2 className="mt-2 text-2xl font-bold tracking-tight">{copy.forYouTitle}</h2>
					<ul className="mt-4 space-y-2">
						{copy.forYou.map((point) => (
							<li key={point} className="flex items-start gap-2 text-sm text-muted-foreground">
								<CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
								{point}
							</li>
						))}
					</ul>
					<a
						href={docs}
						className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
					>
						{t.hero_docs_cta}
						<ArrowRightIcon className="size-4" />
					</a>
				</div>
			</section>

			{/* product mock, full width */}
			<section className="mx-auto max-w-6xl px-6">
				<div className="relative">
					<div className="absolute -inset-x-8 -top-8 -z-10 h-40 bg-gradient-to-b from-primary/15 to-transparent blur-2xl" />
					<ProductMock t={t} />
				</div>
			</section>

			{/* ---------- how it works ---------- */}
			<section id="how" className="scroll-mt-20 border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-6xl px-6">
					<SectionHeading eyebrow={t.home_steps_eyebrow} title={t.home_steps_title} />
					<ol className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
						<span
							aria-hidden
							className="absolute top-5 right-[12%] left-[12%] hidden border-t border-dashed border-border lg:block"
						/>
						{steps.map((s, i) => (
							<li key={s.title} className="relative">
								<span
									className={`flex size-10 items-center justify-center rounded-full text-sm font-bold ${i === steps.length - 1 ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"}`}
								>
									{i + 1}
								</span>
								<Card className="mt-4 h-full">
									<CardHeader>
										<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
											<s.icon className="size-4.5" />
										</span>
										<CardTitle className="mt-2 text-base">{s.title}</CardTitle>
										<CardDescription className="text-sm leading-relaxed">{s.desc}</CardDescription>
									</CardHeader>
								</Card>
							</li>
						))}
					</ol>
				</div>
			</section>

			{/* ---------- features (bento) ---------- */}
			<section className="mx-auto max-w-6xl px-6 py-16">
				<SectionHeading eyebrow={t.home_features_eyebrow} title={t.home_features_title} />
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{/* flagship tile */}
					<Card className="sm:col-span-2 transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<AudioLinesIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">{t.feat_trans_title}</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								{t.feat_trans_desc}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex h-24 items-end gap-1 rounded-xl bg-muted/60 p-4">
								{[
									40, 70, 55, 90, 35, 65, 80, 45, 75, 60, 30, 85, 50, 95, 40, 70, 55, 80, 45, 65,
								].map((h, i) => (
									<span
										key={i}
										className={`w-1.5 rounded-full ${i % 5 === 0 ? "bg-primary" : "bg-primary/30"}`}
										style={{ height: `${h}%` }}
									/>
								))}
							</div>
						</CardContent>
					</Card>

					<Card className="transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<FileTextIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">{t.feat_anam_title}</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								{t.feat_anam_desc}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{anamChips.map((s) => (
								<div
									key={s.t}
									className={`flex items-center justify-between rounded-lg border border-l-4 border-border bg-muted/40 px-3 py-2 text-xs ${s.cls}`}
								>
									<span className="font-medium">{s.t}</span>
									<Badge variant="outline" className="text-[10px] font-normal">
										{s.c}
									</Badge>
								</div>
							))}
						</CardContent>
					</Card>

					<Card className="transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<ClipboardCheckIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">{t.feat_review_title}</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								{t.feat_review_desc}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{reviewItems.map((s) => (
								<div
									key={s}
									className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
								>
									<CheckIcon className="size-3.5 shrink-0 text-primary" />
									{s}
								</div>
							))}
						</CardContent>
					</Card>

					<Card className="sm:col-span-2 transition hover:ring-foreground/20">
						<CardHeader className="flex-row items-start justify-between gap-4">
							<div>
								<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<ShieldCheckIcon className="size-5" />
								</span>
								<CardTitle className="mt-3 text-base">{t.feat_privacy_title}</CardTitle>
								<CardDescription className="text-sm leading-relaxed">
									{t.feat_privacy_desc}
								</CardDescription>
							</div>
							<LockIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-2">
								{privacyItems.map((p) => (
									<span
										key={p.t}
										className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
									>
										<p.icon className="size-3.5" />
										{p.t}
									</span>
								))}
							</div>
						</CardContent>
					</Card>
				</div>
				<p className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2 text-center text-sm text-muted-foreground">
					<StethoscopeIcon className="size-4 shrink-0" />
					{t.home_context_note}
				</p>
			</section>

			{/* ---------- what it never does ---------- */}
			<section className="mx-auto max-w-3xl px-6">
				<SectionHeading eyebrow={t.never_eyebrow} title={t.never_title} />
				<ul className="mx-auto mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
					{never.map((item) => (
						<li key={item} className="flex items-center gap-2.5 text-base">
							<BanIcon className="size-4 shrink-0 text-primary" />
							{item}
						</li>
					))}
				</ul>
				<div className="mx-auto mt-10 max-w-2xl border-l-4 border-primary pl-6">
					<p className="text-xl font-semibold leading-snug">{t.never_quote_a}</p>
					<p className="text-xl font-semibold leading-snug text-primary">{t.never_quote_b}</p>
				</div>
			</section>

			{/* ---------- FAQ ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-3xl px-6">
					<SectionHeading eyebrow={t.home_faq_eyebrow} title={t.home_faq_title} />
					<Accordion multiple className="mt-10">
						{faq.map((f, i) => (
							<AccordionItem key={f.q} value={`faq-${i}`}>
								<AccordionTrigger className="py-4 text-base">{f.q}</AccordionTrigger>
								<AccordionContent className="text-muted-foreground leading-relaxed">
									{f.a}
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</div>
			</section>

			{/* ---------- final CTA ---------- */}
			<section className="mx-auto max-w-6xl px-6 pb-8">
				<div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
					<div
						aria-hidden
						className="absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl"
					/>
					<div className="relative">
						<h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.home_cta_title}</h2>
						<p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/75">
							{t.home_cta_sub}
						</p>
						<Link
							to="/consultations/new"
							className={buttonVariants({ variant: "secondary", size: "lg" }) + " mt-8"}
						>
							{t.home_cta_button}
							<ArrowRightIcon />
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}
