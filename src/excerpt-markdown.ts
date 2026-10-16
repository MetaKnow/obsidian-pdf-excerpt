/**
 * Pure, dependency-free (de)serialization of a per-PDF excerpt markdown note.
 *
 * Keeping this module free of any `obsidian` import means it can be unit tested
 * in plain Node and reused by the exporter.
 *
 * On-disk format
 * --------------
 *   ---
 *   type: pdf-excerpt
 *   source: "papers/Attention.pdf"
 *   ...
 *   ---
 *
 *   # 摘录 · Attention
 *
 *   > [!quote] 第 1 页 · 2025-01-01 10:00
 *   > Attention is all you need.
 *   >
 *   > [[papers/Attention.pdf#page=1|Attention, 第 1 页]]
 *
 *   <!-- pdf-excerpt {"id":"e1a2b3","page":1,"rects":[[0.1,0.2,0.3,0.02]],"created":1730000000000} -->
 *
 * The human readable blockquote carries the text; the trailing HTML comment
 * carries the machine readable geometry. A user may freely edit the text of the
 * quote without breaking the highlight geometry, and vice versa.
 */

export interface ExcerptRect {
	/** normalized 0..1 offset from the left edge of the page content box */
	x: number;
	/** normalized 0..1 offset from the top edge of the page content box */
	y: number;
	/** normalized 0..1 width of the page content box */
	w: number;
	/** normalized 0..1 height of the page content box */
	h: number;
}

export interface Excerpt {
	id: string;
	/** 1-based page number */
	page: number;
	text: string;
	rects: ExcerptRect[];
	/** epoch milliseconds */
	created: number;
	/**
	 * Obsidian's native PDF selection subpath (`idx,start,idx,end`). When present
	 * the generated link also triggers Obsidian's own in-PDF text highlight.
	 */
	selection?: string | null;
}

export interface ExcerptFileData {
	source: string;
	title: string;
	created: number;
	updated: number;
	tags: string[];
	excerpts: Excerpt[];
}

export interface SerializeOptions {
	/** Vault-relative path of the PDF the excerpts came from. */
	source?: string;
	/** Display title of the PDF. */
	title?: string;
	/** Builds the back-link placed inside each quote. Return "" to omit it. */
	linkBuilder?: (excerpt: Excerpt, source: string, title: string) => string;
	tags?: string[];
}

export const EXCERPT_TYPE = "pdf-excerpt";
export const COMMENT_PREFIX = "pdf-excerpt";

/** `<!-- pdf-excerpt {json} -->` on a single line. */
const COMMENT_RE = /<!--\s*pdf-excerpt\s+(\{[^\n]*?\})\s*-->/;
const COMMENT_RE_G = /<!--\s*pdf-excerpt\s+(\{[^\n]*?\})\s*-->/g;
const CALLOUT_RE = /^\s*\[![^\]]+\]\s*/;
const WIKILINK_ONLY_RE = /^\s*!?\[\[[^\]]+\]\]\s*$/;
const QUOTE_PREFIX_RE = /^\s*>\s?/;

/**
 * Collapses the ragged line breaks produced by PDF text extraction into a single
 * clean paragraph, matching what Obsidian's own "copy as quote" produces.
 */
export function normalizeExcerptText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[\t\u00a0\u2000-\u200b]+/g, " ")
		.replace(/ *\n */g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
}

/** Identity of an excerpt for duplicate detection: same page + same words. */
export function excerptKey(page: number, text: string): string {
	return `${page}\u0000${normalizeExcerptText(text).toLocaleLowerCase()}`;
}

export function rectOverlapRatio(a: ExcerptRect, b: ExcerptRect): number {
	const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
	const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
	const inter = ix * iy;
	if (inter <= 0) return 0;
	const areaA = a.w * a.h;
	const areaB = b.w * b.h;
	const smallest = Math.min(areaA, areaB);
	if (smallest <= 0) return 0;
	return inter / smallest;
}

/** 64 bits of randomness, so ids never collide inside one note. */
export function createExcerptId(rand: () => number = Math.random): string {
	const a = Math.floor(rand() * 0xffffffff).toString(36);
	const b = Math.floor(rand() * 0xffffffff).toString(36);
	return `e${a}${b}`;
}

export function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function sanitizeForWikilink(s: string): string {
	return s.replace(/[[\]|#^]/g, "");
}

export function defaultLinkBuilder(excerpt: Excerpt, source: string, title: string): string {
	const subpath = `#page=${excerpt.page}${excerpt.selection ? `&selection=${excerpt.selection}` : ""}`;
	const target = `${sanitizeForWikilink(source)}${subpath}`;
	const alias = `${sanitizeForWikilink(title)}, 第 ${excerpt.page} 页`;
	return `[[${target}|${alias}]]`;
}

/** Renders one excerpt as a blockquote followed by its geometry comment. */
export function formatExcerptEntry(excerpt: Excerpt, opts: SerializeOptions = {}): string {
	const linkBuilder = opts.linkBuilder ?? defaultLinkBuilder;
	const header = `[!quote] 第 ${excerpt.page} 页 · ${formatTimestamp(excerpt.created)}`;
	const lines: string[] = [`> ${header}`];

	const text = excerpt.text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
	for (const line of text.split("\n")) {
		lines.push(line.length ? `> ${line}` : ">");
	}

	const link = linkBuilder(excerpt, opts.source ?? "", opts.title ?? "");
	if (link) {
		lines.push(">");
		lines.push(`> ${link}`);
	}

	lines.push("");
	const payload: Record<string, unknown> = {
		id: excerpt.id,
		page: excerpt.page,
		rects: excerpt.rects.map((r) => [round4(r.x), round4(r.y), round4(r.w), round4(r.h)]),
		created: excerpt.created,
	};
	if (excerpt.selection) payload.sel = excerpt.selection;
	lines.push(`<!-- ${COMMENT_PREFIX} ${JSON.stringify(payload)} -->`);
	return lines.join("\n");
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

export function serializeExcerptFile(data: ExcerptFileData, opts: SerializeOptions = {}): string {
	const tags = opts.tags ?? data.tags ?? [];
	const fm: string[] = ["---"];
	fm.push(`type: ${EXCERPT_TYPE}`);
	fm.push(`source: ${yamlString(data.source)}`);
	fm.push(`title: ${yamlString(data.title)}`);
	fm.push(`count: ${data.excerpts.length}`);
	fm.push(`created: ${yamlString(new Date(data.created).toISOString())}`);
	fm.push(`updated: ${yamlString(new Date(data.updated).toISOString())}`);
	if (tags.length) {
		fm.push("tags:");
		for (const t of tags) fm.push(`  - ${t}`);
	}
	fm.push("---");

	const entries = data.excerpts
		.slice()
		.sort((a, b) => a.page - b.page || a.created - b.created)
		.map((e) => formatExcerptEntry(e, { ...opts, source: data.source, title: data.title }));

	const head = `# 摘录 · ${data.title}`;
	return [fm.join("\n"), "", head, "", entries.join("\n\n"), ""].join("\n");
}

interface ParsedFrontmatter {
	data: Record<string, string | number | string[]>;
	body: string;
	bodyOffset: number;
}

function parseScalar(raw: string): string | number {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
		return trimmed.slice(1, -1);
	}
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
	const result: ParsedFrontmatter = { data: {}, body: content, bodyOffset: 0 };
	if (!content.startsWith("---")) return result;
	const end = content.indexOf("\n---", 3);
	if (end < 0) return result;

	const rawFm = content.slice(content.indexOf("\n") + 1, end);
	const bodyStart = content.indexOf("\n", end + 1);
	let body = bodyStart < 0 ? "" : content.slice(bodyStart + 1);
	let bodyOffset = bodyStart < 0 ? content.length : bodyStart + 1;
	// Drop the single blank separator line so `body` starts at the first real
	// line of the note (matches what gray-matter and friends return).
	const lead = /^(?:\r\n|\n)/.exec(body);
	if (lead) {
		body = body.slice(lead[0].length);
		bodyOffset += lead[0].length;
	}
	result.body = body;
	result.bodyOffset = bodyOffset;

	const lines = rawFm.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (!m) continue;
		const key = m[1];
		const rest = m[2];
		if (rest.trim() === "") {
			const items: string[] = [];
			let j = i + 1;
			while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
				items.push(String(parseScalar(lines[j].replace(/^\s*-\s+/, ""))));
				j++;
			}
			if (items.length) {
				result.data[key] = items;
				i = j - 1;
				continue;
			}
		}
		result.data[key] = parseScalar(rest);
	}
	return result;
}

function coerceExcerpt(raw: unknown): Excerpt | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const page = Number(obj.page);
	if (!Number.isFinite(page) || page < 1) return null;
	const rectsRaw = Array.isArray(obj.rects) ? obj.rects : [];
	const rects: ExcerptRect[] = [];
	for (const r of rectsRaw) {
		if (!Array.isArray(r) || r.length < 4) continue;
		const [x, y, w, h] = r.map(Number);
		if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
		rects.push({ x, y, w, h });
	}
	return {
		id: typeof obj.id === "string" && obj.id ? obj.id : createExcerptId(),
		page,
		text: "",
		rects,
		created: Number.isFinite(Number(obj.created)) ? Number(obj.created) : Date.now(),
		selection: typeof obj.sel === "string" && obj.sel ? obj.sel : null,
	};
}

/** Recovers the quote text that sits directly above a geometry comment. */
function quoteAbove(lines: string[], commentLine: number): string {
	let j = commentLine - 1;
	while (j >= 0 && lines[j].trim() === "") j--;
	const block: string[] = [];
	while (j >= 0 && /^\s*>/.test(lines[j])) {
		block.unshift(lines[j]);
		j--;
	}
	if (!block.length) return "";

	const stripped = block.map((l) => l.replace(QUOTE_PREFIX_RE, ""));
	if (stripped.length && CALLOUT_RE.test(stripped[0])) stripped.shift();

	while (stripped.length && stripped[stripped.length - 1].trim() === "") stripped.pop();
	if (stripped.length && WIKILINK_ONLY_RE.test(stripped[stripped.length - 1])) {
		stripped.pop();
		while (stripped.length && stripped[stripped.length - 1].trim() === "") stripped.pop();
	}
	return stripped.join("\n").trim();
}

export function parseExcerptFile(content: string): ExcerptFileData {
	const { data, body } = parseFrontmatter(content);
	const lines = body.split("\n");

	const excerpts: Excerpt[] = [];
	const seen = new Set<string>();
	COMMENT_RE_G.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = COMMENT_RE_G.exec(body)) !== null) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(match[1]);
		} catch {
			continue;
		}
		const excerpt = coerceExcerpt(parsed);
		if (!excerpt) continue;

		// Map the byte offset of the match back to a line index.
		const lineIndex = body.slice(0, match.index).split("\n").length - 1;
		excerpt.text = quoteAbove(lines, lineIndex);

		const key = excerpt.id;
		if (seen.has(key)) continue;
		seen.add(key);
		excerpts.push(excerpt);
	}

	const now = Date.now();
	const source = typeof data.source === "string" ? data.source : "";
	const title =
		typeof data.title === "string" && data.title
			? data.title
			: source.split("/").pop()?.replace(/\.pdf$/i, "") || "PDF";
	const tags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
	const createdRaw = typeof data.created === "string" ? Date.parse(data.created) : NaN;
	const updatedRaw = typeof data.updated === "string" ? Date.parse(data.updated) : NaN;

	return {
		source,
		title,
		tags,
		created: Number.isFinite(createdRaw) ? createdRaw : now,
		updated: Number.isFinite(updatedRaw) ? updatedRaw : now,
		excerpts,
	};
}

/** Strips frontmatter so the caller can write body-only content if needed. */
export function stripFrontmatter(content: string): string {
	return parseFrontmatter(content).body;
}

export const __testing = { COMMENT_RE, parseFrontmatter };
