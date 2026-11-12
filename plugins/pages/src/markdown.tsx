import type { ReactNode } from "react";

/**
 * Minimal markdown-subset renderer for custom page content (T-083).
 * No raw HTML and no dangerouslySetInnerHTML — everything is built as
 * React elements, so stored content can never inject markup. Supported:
 * fenced code blocks, ATX headings (#..###), unordered (-/*) and ordered
 * (1.) lists, blockquotes, paragraphs, and inline **bold**, *italic*,
 * `code` and [links](url). Link targets are restricted to http(s),
 * mailto: and site-relative "/" paths — anything else renders as text.
 */

type Block =
	| { readonly kind: "code"; readonly text: string }
	| { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
	| { readonly kind: "ul"; readonly items: readonly string[] }
	| { readonly kind: "ol"; readonly items: readonly string[] }
	| { readonly kind: "quote"; readonly text: string }
	| { readonly kind: "p"; readonly text: string };

const FENCE = /^```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const UL_ITEM = /^\s*[-*]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** Split source into block-level tokens. Line-oriented and forgiving:
 * unrecognized lines join the surrounding paragraph. */
export const markdownBlocks = (source: string): readonly Block[] => {
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		/* v8 ignore next -- i is bounds-checked by the loop condition */
		const line = lines[i] ?? "";
		if (line.trim() === "") {
			i++;
			continue;
		}
		if (FENCE.test(line.trim())) {
			const buf: string[] = [];
			i++;
			while (
				i < lines.length &&
				!FENCE.test(/* v8 ignore next -- in-bounds */ (lines[i] ?? "").trim())
			) {
				/* v8 ignore next -- in-bounds */
				buf.push(lines[i] ?? "");
				i++;
			}
			i++; // closing fence (or EOF)
			blocks.push({ kind: "code", text: buf.join("\n") });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({
				kind: "heading",
				level: heading[1]!.length as 1 | 2 | 3,
				text: heading[2]!.trim(),
			});
			i++;
			continue;
		}
		if (UL_ITEM.test(line)) {
			const items: string[] = [];
			while (i < lines.length) {
				/* v8 ignore next -- in-bounds */
				const m = UL_ITEM.exec(lines[i] ?? "");
				if (!m) break;
				items.push(m[1]!);
				i++;
			}
			blocks.push({ kind: "ul", items });
			continue;
		}
		if (OL_ITEM.test(line)) {
			const items: string[] = [];
			while (i < lines.length) {
				/* v8 ignore next -- in-bounds */
				const m = OL_ITEM.exec(lines[i] ?? "");
				if (!m) break;
				items.push(m[1]!);
				i++;
			}
			blocks.push({ kind: "ol", items });
			continue;
		}
		if (QUOTE.test(line)) {
			const buf: string[] = [];
			while (i < lines.length) {
				/* v8 ignore next -- in-bounds */
				const m = QUOTE.exec(lines[i] ?? "");
				if (!m) break;
				buf.push(m[1]!);
				i++;
			}
			blocks.push({ kind: "quote", text: buf.join(" ") });
			continue;
		}
		// Paragraph: consecutive plain lines joined with a space.
		const buf: string[] = [];
		while (i < lines.length) {
			/* v8 ignore next -- in-bounds */
			const l = lines[i] ?? "";
			if (
				l.trim() === "" ||
				FENCE.test(l.trim()) ||
				HEADING.test(l) ||
				UL_ITEM.test(l) ||
				OL_ITEM.test(l) ||
				QUOTE.test(l)
			) {
				break;
			}
			buf.push(l.trim());
			i++;
		}
		blocks.push({ kind: "p", text: buf.join(" ") });
	}
	return blocks;
};

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

/** Only these link targets render as anchors — everything else stays
 * literal text (no javascript:/data: URLs from stored content). */
const safeHref = (href: string): string | null =>
	/^(https?:\/\/|mailto:|\/)/i.test(href) ? href : null;

/** Inline markup → React nodes. Text outside matches renders verbatim,
 * so stored HTML is never interpreted. */
export const renderInline = (text: string): ReactNode[] => {
	const out: ReactNode[] = [];
	let last = 0;
	let key = 0;
	for (const m of text.matchAll(INLINE)) {
		/* v8 ignore next -- matchAll always sets index */
		const idx = m.index ?? 0;
		if (idx > last) out.push(text.slice(last, idx));
		const token = m[0];
		if (token.startsWith("**")) {
			out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
		} else if (token.startsWith("*")) {
			out.push(<em key={key++}>{token.slice(1, -1)}</em>);
		} else if (token.startsWith("`")) {
			out.push(
				<code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
					{token.slice(1, -1)}
				</code>,
			);
		} else {
			const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(token);
			const href = link?.[2];
			const target =
				href === undefined
					? /* v8 ignore next -- the INLINE token always re-matches the link regex */ null
					: safeHref(href);
			if (link && target !== null) {
				const external = !target.startsWith("/");
				out.push(
					<a
						key={key++}
						href={target}
						className="text-primary underline underline-offset-2 hover:text-primary/80"
						{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
					>
						{link[1]}
					</a>,
				);
			} else {
				out.push(token);
			}
		}
		last = idx + token.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
};

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
	1: "mt-6 text-2xl font-bold tracking-tight first:mt-0",
	2: "mt-5 text-xl font-semibold tracking-tight first:mt-0",
	3: "mt-4 text-lg font-semibold first:mt-0",
};

/** Render the block list to React elements (keys are positional —
 * content is static per render). */
export const renderMarkdown = (source: string): ReactNode[] =>
	markdownBlocks(source).map((block, i) => {
		switch (block.kind) {
			case "code":
				return (
					<pre key={i} className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-sm">
						<code>{block.text}</code>
					</pre>
				);
			case "heading": {
				const Tag = `h${block.level + 1}` as "h2" | "h3" | "h4";
				return (
					<Tag key={i} className={HEADING_CLASS[block.level]}>
						{renderInline(block.text)}
					</Tag>
				);
			}
			case "ul":
				return (
					<ul key={i} className="my-3 list-disc space-y-1 pl-6">
						{block.items.map((item, j) => (
							<li key={j}>{renderInline(item)}</li>
						))}
					</ul>
				);
			case "ol":
				return (
					<ol key={i} className="my-3 list-decimal space-y-1 pl-6">
						{block.items.map((item, j) => (
							<li key={j}>{renderInline(item)}</li>
						))}
					</ol>
				);
			case "quote":
				return (
					<blockquote key={i} className="my-3 border-l-2 border-border pl-4 text-muted-foreground">
						{renderInline(block.text)}
					</blockquote>
				);
			case "p":
				return (
					<p key={i} className="my-3 leading-7 first:mt-0">
						{renderInline(block.text)}
					</p>
				);
		}
	});
