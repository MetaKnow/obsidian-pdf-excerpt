/**
 * Persistence layer: one markdown note per PDF.
 *
 * The note lives at `<excerptFolder>/<pdf path without extension>.md`, so the
 * mapping is deterministic and two PDFs sharing a basename never collide.
 */

import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
	createExcerptId,
	excerptKey,
	normalizeExcerptText,
	parseExcerptFile,
	rectOverlapRatio,
	serializeExcerptFile,
	type Excerpt,
	type ExcerptFileData,
	type SerializeOptions,
} from "./excerpt-markdown";
import type { PageExcerptSlice } from "./pdf-view";

export interface ExcerptStoreSettings {
	excerptFolder: string;
	tags: string[];
}

export interface AddResult {
	status: "added" | "duplicate" | "empty" | "error";
	noteFile: TFile | null;
	noteCreated: boolean;
	added: Excerpt[];
	duplicates: number;
	message?: string;
}

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeFileName(name: string): string {
	const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "_").replace(/\.+$/, "").trim();
	return cleaned.length ? cleaned : "untitled";
}

function baseName(path: string): string {
	const last = path.split("/").pop() ?? path;
	return last.replace(/\.pdf$/i, "");
}

/** Weighted geometric overlap between two rect sets on the same page. */
export function rectSetCoverage(a: Excerpt["rects"], b: Excerpt["rects"]): number {
	if (!a.length || !b.length) return 0;
	let covered = 0;
	let total = 0;
	for (const rect of a) {
		const area = rect.w * rect.h;
		total += area;
		let best = 0;
		for (const other of b) {
			const ratio = rectOverlapRatio(rect, other);
			if (ratio > best) best = ratio;
		}
		covered += area * best;
	}
	return total > 0 ? covered / total : 0;
}

export function isDuplicateSlice(existing: Excerpt[], slice: PageExcerptSlice): boolean {
	const key = excerptKey(slice.page, slice.text);
	for (const e of existing) {
		if (e.page !== slice.page) continue;
		if (excerptKey(e.page, e.text) === key) return true;
	}
	const samePage = existing.filter((e) => e.page === slice.page);
	if (samePage.length && rectSetCoverage(slice.rects, samePage.map((e) => e.rects).flat()) >= 0.8) return true;
	return false;
}

/** Creates `folderPath` and every missing ancestor. Silent when they exist. */
export async function ensureVaultFolder(app: App, folderPath: string): Promise<void> {
	const dir = normalizePath(folderPath ?? "");
	if (!dir || dir === "/" || dir === ".") return;
	const segments = dir.split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) continue;
		if (existing) return;
		try {
			await app.vault.createFolder(current);
		} catch (err) {
			if (!/exist/i.test(String((err as Error)?.message ?? err))) throw err;
		}
	}
}

interface CacheEntry {
	mtime: number;
	size: number;
	data: ExcerptFileData;
}

export class ExcerptStore {
	private cache = new Map<string, CacheEntry>();

	constructor(
		private app: App,
		private getSettings: () => ExcerptStoreSettings,
		private linkBuilder?: SerializeOptions["linkBuilder"],
	) {}

	/* ---------------- paths ---------------- */

	notePathFor(pdf: TFile): string {
		const folder = (this.getSettings().excerptFolder ?? "").trim();
		let rel = pdf.path.replace(/\.pdf$/i, "");
		const normalizedFolder = folder ? normalizePath(folder) : "";
		if (normalizedFolder && (rel === normalizedFolder || rel.startsWith(normalizedFolder + "/"))) {
			rel = rel.slice(normalizedFolder.length + 1);
		}
		const parts = rel.split("/").filter(Boolean).map(sanitizeFileName);
		const name = parts.pop() ?? baseName(pdf.path);
		const segments = [normalizedFolder, ...parts, `${name}.md`].filter((s) => s && s.length);
		return normalizePath(segments.join("/"));
	}

	titleFor(pdf: TFile): string {
		return baseName(pdf.path);
	}

	getNoteFile(pdf: TFile): TFile | null {
		const found = this.app.vault.getAbstractFileByPath(this.notePathFor(pdf));
		return found instanceof TFile ? found : null;
	}

	/** Resolves the PDF a note belongs to, via its `source` frontmatter. */
	getPdfForNote(noteFile: TFile): TFile | null {
		const cached = this.app.metadataCache.getFileCache(noteFile);
		const source = cached?.frontmatter?.source;
		if (typeof source !== "string" || !source) return null;
		const found = this.app.vault.getAbstractFileByPath(normalizePath(source));
		return found instanceof TFile ? found : null;
	}

	private async ensureFolderFor(path: string): Promise<void> {
		const dir = path.split("/").slice(0, -1).join("/");
		if (!dir) return;
		await ensureVaultFolder(this.app, dir);
	}

	/* ---------------- read / write ---------------- */

	emptyData(pdf: TFile): ExcerptFileData {
		const now = Date.now();
		return {
			source: pdf.path,
			title: this.titleFor(pdf),
			created: now,
			updated: now,
			tags: this.getSettings().tags,
			excerpts: [],
		};
	}

	async load(pdf: TFile, opts: { fresh?: boolean } = {}): Promise<ExcerptFileData> {
		const path = this.notePathFor(pdf);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			this.cache.delete(path);
			return this.emptyData(pdf);
		}

		const cached = this.cache.get(path);
		if (!opts.fresh && cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
			return cached.data;
		}

		const content = await this.app.vault.cachedRead(file);
		const data = parseExcerptFile(content);
		// Frontmatter may be missing/edited; keep the authoritative values.
		data.source = data.source || pdf.path;
		data.title = data.title || this.titleFor(pdf);
		if (!data.tags?.length) data.tags = this.getSettings().tags;

		this.cache.set(path, { mtime: file.stat.mtime, size: file.stat.size, data });
		return data;
	}

	async excerptsFor(pdf: TFile): Promise<Excerpt[]> {
		return (await this.load(pdf)).excerpts;
	}

	async save(pdf: TFile, data: ExcerptFileData): Promise<TFile> {
		const path = this.notePathFor(pdf);
		this.cache.delete(path);
		const content = serializeExcerptFile(data, {
			source: pdf.path,
			title: data.title,
			linkBuilder: this.linkBuilder,
			tags: data.tags?.length ? data.tags : this.getSettings().tags,
		});

		const existing = this.app.vault.getAbstractFileByPath(path);
		let file: TFile;
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			file = existing;
		} else {
			await this.ensureFolderFor(path);
			file = await this.app.vault.create(path, content);
		}

		const stored = { ...data, source: pdf.path, updated: Date.now() };
		this.cache.set(path, { mtime: file.stat.mtime, size: file.stat.size, data: stored });
		return file;
	}

	/* ---------------- mutations ---------------- */

	async addSlices(pdf: TFile, slices: PageExcerptSlice[]): Promise<AddResult> {
		const usable = slices.filter((s) => normalizeExcerptText(s.text).length > 0);
		if (!usable.length) {
			return { status: "empty", noteFile: null, noteCreated: false, added: [], duplicates: 0 };
		}

		const path = this.notePathFor(pdf);
		const existedBefore = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
		const data = await this.load(pdf, { fresh: true });

		const added: Excerpt[] = [];
		let duplicates = 0;
		for (const slice of usable) {
			const text = normalizeExcerptText(slice.text);
			if (isDuplicateSlice(data.excerpts, { ...slice, text })) {
				duplicates++;
				continue;
			}
			const excerpt: Excerpt = {
				id: createExcerptId(),
				page: slice.page,
				text,
				rects: slice.rects,
				created: Date.now(),
				selection: slice.selection ?? null,
			};
			data.excerpts.push(excerpt);
			added.push(excerpt);
		}

		if (!added.length) {
			return {
				status: "duplicate",
				noteFile: this.getNoteFile(pdf),
				noteCreated: false,
				added: [],
				duplicates,
			};
		}

		data.updated = Date.now();
		if (!data.created) data.created = data.updated;
		const noteFile = await this.save(pdf, data);
		return { status: "added", noteFile, noteCreated: !existedBefore, added, duplicates };
	}

	async removeExcerpt(pdf: TFile, id: string): Promise<boolean> {
		const data = await this.load(pdf, { fresh: true });
		const index = data.excerpts.findIndex((e) => e.id === id);
		if (index < 0) return false;
		data.excerpts.splice(index, 1);
		data.updated = Date.now();
		await this.save(pdf, data);
		return true;
	}

	async updateExcerpt(pdf: TFile, id: string, patch: Partial<Pick<Excerpt, "text" | "page">>): Promise<boolean> {
		const data = await this.load(pdf, { fresh: true });
		const excerpt = data.excerpts.find((e) => e.id === id);
		if (!excerpt) return false;
		if (typeof patch.text === "string") excerpt.text = normalizeExcerptText(patch.text);
		if (typeof patch.page === "number") excerpt.page = patch.page;
		data.updated = Date.now();
		await this.save(pdf, data);
		return true;
	}

	async clearCache(): Promise<void> {
		this.cache.clear();
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}
}
