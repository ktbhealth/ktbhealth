import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
	ArrowRightIcon,
	AudioLinesIcon,
	BotIcon,
	CheckIcon,
	ClipboardCheckIcon,
	FileTextIcon,
	LockIcon,
	MicIcon,
	ShieldCheckIcon,
	SparklesIcon,
	StethoscopeIcon,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

const STEPS = [
	{
		icon: MicIcon,
		title: "Talk",
		desc: "Record the microphone, capture the video call tab, or paste the transcript. Doctor and patient come out separated.",
	},
	{
		icon: SparklesIcon,
		title: "Generate the anamnesis",
		desc: "In seconds, the text becomes 8 medical record sections, each with the consultation sentence that grounds it.",
	},
	{
		icon: ClipboardCheckIcon,
		title: "Review and save",
		desc: "Edit whatever you want, check the evidence for each section, confirm, and download the PDF.",
	},
];

const FAQ = [
	{
		q: "Does the consultation audio leave my computer?",
		a: "Transcription runs in your browser with local Whisper. The audio never leaves the machine. Only the resulting text is sent to structure the anamnesis, and you can point to your own model (including a local one via Ollama) to keep everything in your environment.",
	},
	{
		q: "Does the AI diagnose or prescribe?",
		a: "No. KTB Health generates a structured draft from what was said in the consultation. Each field shows the confidence and the source sentences, and the final record is always reviewed and approved by a physician.",
	},
	{
		q: "Does it work for teleconsultations?",
		a: "Yes. The bot joins Meet, Zoom, Teams, and WhatsApp Web calls, or you can capture the browser tab audio directly. For in-person visits, dictation mode transcribes your narration with the same Whisper.",
	},
	{
		q: "How does patient consent work?",
		a: "Every consultation requires an explicit declaration that the patient was informed and consented to the recording. The consent record stays linked to the consultation and the generated anamnesis.",
	},
	{
		q: "Can I choose which AI model to use?",
		a: "Yes. Extraction supports Anthropic, OpenAI, Cloudflare Workers AI, local Ollama, and a heuristic fallback engine. The choice is configuration, not code.",
	},
];

const STATS = [
	{ value: "8", label: "medical record sections" },
	{ value: "pt-BR", label: "local transcription" },
	{ value: "100%", label: "human review" },
];

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

function ProductMock() {
	return (
		<BrowserFrame>
			<div className="grid gap-0 sm:grid-cols-[1fr_1.2fr]">
				{/* transcript column */}
				<div className="border-b border-border p-5 sm:border-b-0 sm:border-r">
					<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
						<AudioLinesIcon className="size-3.5" />
						Live transcription
					</div>
					<div className="mt-4 space-y-3 text-sm">
						<div>
							<span className="text-xs font-semibold text-primary">Dr. Ana</span>
							<p className="mt-0.5 text-muted-foreground">When did the pain start?</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-primary">Patient</span>
							<p className="mt-0.5 text-muted-foreground">
								Suddenly, in the frontal region. It gets worse at night and knocks me down.
							</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-primary">Dr. Ana</span>
							<p className="mt-0.5 text-muted-foreground">Do you take any medication?</p>
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="size-2 animate-pulse rounded-full bg-red-500" />
							<span className="text-xs text-muted-foreground">recording…</span>
						</div>
					</div>
				</div>
				{/* anamnesis column */}
				<div className="bg-muted/30 p-5">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
							<FileTextIcon className="size-3.5" />
							Anamnesis
						</div>
						<Badge variant="outline" className="text-[10px] font-normal">
							sample
						</Badge>
					</div>
					<div className="mt-4 space-y-3">
						<div className="rounded-lg border border-border border-l-4 border-l-primary bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">Chief complaint</span>
								<Badge className="bg-primary/10 text-[10px] text-primary ring-1 ring-primary/20 hover:bg-primary/15">
									high confidence
								</Badge>
							</div>
							<p className="mt-1 text-sm">Intense frontal headache for 3 days, worse at night.</p>
							<p className="mt-1 text-[11px] text-muted-foreground">
								“The pain started suddenly, in the frontal region…”
							</p>
						</div>
						<div className="rounded-lg border border-border border-l-4 border-l-amber-400 bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">Current medications</span>
								<Badge className="bg-amber-50 text-[10px] text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">
									medium confidence
								</Badge>
							</div>
							<p className="mt-1 text-sm">Losartan 50 mg, once daily.</p>
						</div>
						<div className="flex items-start gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
							<CheckIcon className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-semibold">You review:</span> each section shows the source
								sentence before saving.
							</span>
						</div>
					</div>
				</div>
			</div>
		</BrowserFrame>
	);
}

function Home() {
	return (
		<div className="space-y-24">
			{/* ---------- hero ---------- */}
			<section className="mx-auto max-w-6xl px-6 pt-16 text-center">
				<Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
					<span className="size-1.5 rounded-full bg-primary" />
					Clinical documentation by voice
				</Badge>
				<h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
					Your consultation, <span className="text-primary">documented.</span>
				</h1>
				<p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					Talk to the patient, not to the screen. The conversation becomes a structured anamnesis.
					You only review and approve. Each consultation context is kept for the next one.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Link to="/consultations/new" className={buttonVariants({ size: "lg" })}>
						Start consultation
						<ArrowRightIcon />
					</Link>
					<Link to="/consultations" className={buttonVariants({ variant: "outline", size: "lg" })}>
						View consultations
					</Link>
				</div>
				<dl className="mx-auto mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-border pt-8">
					{STATS.map((s) => (
						<div key={s.label}>
							<dt className="text-2xl font-bold tracking-tight">{s.value}</dt>
							<dd className="mt-1 text-xs text-muted-foreground">{s.label}</dd>
						</div>
					))}
				</dl>
			</section>

			{/* product mock, full width */}
			<section className="mx-auto max-w-6xl px-6">
				<div className="relative">
					<div className="absolute -inset-x-8 -top-8 -z-10 h-40 bg-gradient-to-b from-primary/15 to-transparent blur-2xl" />
					<ProductMock />
				</div>
			</section>

			{/* ---------- how it works ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-6xl px-6">
					<SectionHeading
						eyebrow="How it works"
						title="From conversation to medical record in three steps"
					/>
					<ol className="relative mt-12 grid gap-8 sm:grid-cols-3">
						<span
							aria-hidden
							className="absolute top-5 right-[16%] left-[16%] hidden border-t border-dashed border-border sm:block"
						/>
						{STEPS.map((s, i) => (
							<li key={s.title} className="relative">
								<span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
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
				<SectionHeading eyebrow="Why KTB" title="Built for the exam room, not the paperwork" />
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{/* flagship tile */}
					<Card className="sm:col-span-2 transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<AudioLinesIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">Transcription in your browser</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								Whisper runs locally in pt-BR, separating doctor and patient by voice. The audio
								does not leave your computer. Only the text is processed.
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
							<CardTitle className="mt-3 text-base">Anamnesis with evidence</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								Each field shows the confidence and the source sentences. You review the text
								without re-listening to the consultation.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{[
								{ t: "Chief complaint", c: "high", cls: "border-l-primary" },
								{ t: "History of illness", c: "medium", cls: "border-l-amber-400" },
							].map((s) => (
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
							<CardTitle className="mt-3 text-base">Review and approval</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								You edit each section, check the evidence, and approve. Nothing enters the record
								without your ok.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{[
								"Free editing per section",
								"Sentence-by-sentence evidence",
								"PDF ready to export",
							].map((s) => (
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
								<CardTitle className="mt-3 text-base">Privacy by design</CardTitle>
								<CardDescription className="text-sm leading-relaxed">
									Local transcription, recorded patient consent, and the option to run 100% in your
									environment, with your own model on your GPU.
								</CardDescription>
							</div>
							<LockIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-2">
								{[
									{ icon: MicIcon, t: "Audio never leaves the machine" },
									{ icon: LockIcon, t: "Consent per consultation" },
									{ icon: BotIcon, t: "Bot with its own identifier" },
								].map((p) => (
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
					Every consultation becomes lasting context. The next one already starts with the history
					on screen.
				</p>
			</section>

			{/* ---------- FAQ ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-3xl px-6">
					<SectionHeading eyebrow="Questions" title="Frequently asked questions" />
					<Accordion multiple className="mt-10">
						{FAQ.map((f, i) => (
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
						<h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
							End the day with no pending paperwork.
						</h2>
						<p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/75">
							Try it with the sample transcript, no microphone needed.
						</p>
						<Link
							to="/consultations/new"
							className={buttonVariants({ variant: "secondary", size: "lg" }) + " mt-8"}
						>
							Start now
							<ArrowRightIcon />
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}
