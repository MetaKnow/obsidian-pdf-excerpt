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
 * The note is a plain, human readable document: nothing but the frontmatter,
 * the heading and one blockquote per excerpt. The machine readable geometry
 * (highlight rectangles and the native selection subpath) is NOT written here —
 * it lives in the plugin's own data file, keyed by note path + excerpt id, so
 * the user can freely edit the note without being confronted with metadata.
 *
 * An excerpt's id is derived from its page + normalized text, which is why the
 * id survives a reload even though it is never stored in the note.
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

/** Legacy geometry comments still found in notes written by 1.0.0. */
const LEGACY_COMMENT_RE = /^<!--\s*pdf-excerpt\s+(\{[^\n]*?\})\s*-->\s*$/;
const LEGACY_COMMENT_RE_G = /<!--\s*pdf-excerpt\s+(\{[^\n]*?\})\s*-->/g;
/** `> [!quote] 第 12 页 · 2025-01-01 10:00` (the timestamp is optional). */
const CALLOUT_HEADER_RE = /^>\s*\[![^\]]+\]\s*第\s*(\d+)\s*页\s*(?:[·・]\s*(.*?))?\s*$/;
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;
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

/** FNV-1a, base36. Short, stable and good enough to key notes and excerpts. */
export function shortHash(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/**
 * An excerpt's identity, derived from its page + normalized text. Deriving it
 * (rather than storing it) is what lets the geometry file be keyed by id even
 * though the note carries no id at all. Two excerpts on one page can never share
 * a key, because that is exactly the duplicate rule.
 */
export function excerptIdFor(page: number, text: string): string {
	return `e${shortHash(excerptKey(page, text))}`;
}

export function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function round4(n: number): number {
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

/** Renders one excerpt as a plain, metadata-free blockquote. */
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

function rectsFromPayload(raw: unknown): ExcerptRect[] {
	if (!Array.isArray(raw)) return [];
	const rects: ExcerptRect[] = [];
	for (const r of raw) {
		if (!Array.isArray(r) || r.length < 4) continue;
		const [x, y, w, h] = r.map(Number);
		if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
		rects.push({ x, y, w, h });
	}
	return rects;
}

function parseTimestamp(raw: string | undefined): number | null {
	if (!raw) return null;
	const m = TIMESTAMP_RE.exec(raw.trim());
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** The text of one quote block: no callout header, no back-link, no blank edges. */
function quoteText(block: string[]): string {
	const stripped = block.map((line) => line.replace(QUOTE_PREFIX_RE, ""));
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

	for (let i = 0; i < lines.length; i++) {
		const header = CALLOUT_HEADER_RE.exec(lines[i]);
		if (!header) continue;
		const page = Number(header[1]);
		if (!Number.isFinite(page) || page < 1) continue;

		// The block is simply the contiguous run of `>` lines after the header.
		let j = i + 1;
		const block: string[] = [];
		while (j < lines.length && /^\s*>/.test(lines[j])) {
			block.push(lines[j]);
			j++;
		}
		i = j - 1;

		// 1.0.0 wrote a geometry comment after each block. Absorb it so the store
		// can migrate the geometry into the plugin data file and drop the comment.
		let k = j;
		while (k < lines.length && lines[k].trim() === "") k++;
		const legacy = LEGACY_COMMENT_RE.exec(lines[k] ?? "")?.[1];
		let payload: Record<string, unknown> = {};
		if (legacy) {
			try {
				const parsed: unknown = JSON.parse(legacy);
				if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
			} catch {
				payload = {};
			}
		}

		const text = quoteText(block);
		if (!text) continue;
		const key = excerptKey(page, text);
		if (seen.has(key)) continue;
		seen.add(key);

		const fromHeader = parseTimestamp(header[2]);
		excerpts.push({
			id: typeof payload.id === "string" && payload.id ? payload.id : excerptIdFor(page, text),
			page,
			text,
			rects: rectsFromPayload(payload.rects),
			created:
				fromHeader ?? (Number.isFinite(Number(payload.created)) ? Number(payload.created) : Date.now()),
			selection: typeof payload.sel === "string" && payload.sel ? payload.sel : null,
		});
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

export const __testing = { LEGACY_COMMENT_RE, LEGACY_COMMENT_RE_G, CALLOUT_HEADER_RE, parseFrontmatter };
