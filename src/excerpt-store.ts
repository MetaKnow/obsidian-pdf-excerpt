/**
 * Persistence layer: one markdown note per PDF.
 *
 * Every PDF gets a folder of its own under `<excerptFolder>`, named after the
 * PDF's basename, and holds `<pdf name>.md` plus everything that belongs to that
 * PDF (screenshots today). When two PDFs share a basename the folder is
 * disambiguated with the PDF's own parent folder name, then with a short path
 * hash, so the mapping stays deterministic and collision-free.
 */

import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
	LEGACY_COMMENT_RE_G,
	excerptIdFor,
	excerptKey,
	isImageExcerpt,
	normalizeExcerptText,
	parseExcerptFile,
	rectOverlapRatio,
	serializeExcerptFile,
	shortHash,
	type Excerpt,
	type ExcerptFileData,
	type SerializeOptions,
} from "./excerpt-markdown";
import type { PageExcerptSlice } from "./pdf-view";

/**
 * PDFs opened from outside the vault arrive as a synthetic `file:` TFile that
 * Obsidian's own adapter may not be able to read back; those bytes come from
 * the desktop file system instead.
 */
function externalPdfPath(path: string): string | null {
	const raw = path.startsWith("file:") ? path.slice("file:".length) : path;
	if (!raw.startsWith("/")) return null;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function nodeFs(): typeof import("fs") | null {
	if (typeof require !== "function") return null;
	try {
		return require("fs") as typeof import("fs");
	} catch (error) {
		console.warn("[pdf-excerpt] require('fs') 不可用", error);
		return null;
	}
}

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
	/** True when this call pulled the PDF itself into the note's folder. */
	pdfCopied: boolean;
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
		if (e.page !== slice.page || isImageExcerpt(e)) continue;
		if (excerptKey(e.page, e.text) === key) return true;
	}
	const samePage = existing.filter((e) => e.page === slice.page && !isImageExcerpt(e));
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
	/** notePath -> pdfPath, so notePathFor() is stable between load() and save(). */
	private readonly claimed = new Map<string, string>();

	constructor(
		private app: App,
		private getSettings: () => ExcerptStoreSettings,
		private linkBuilder?: SerializeOptions["linkBuilder"],
	) {}

	/* ---------------- paths ---------------- */

	/**
	 * `<excerptFolder>/<pdf name>/<pdf name>.md` — every PDF gets its own folder,
	 * which also holds that PDF's screenshots. Same-basename PDFs are
	 * disambiguated by folder name, so no two PDFs share a note.
	 */
	notePathFor(pdf: TFile): string {
		const normalizedFolder = this.excerptFolder();
		const name = sanitizeFileName(baseName(pdf.path)) || "PDF";
		const dirs = this.folderCandidates(pdf, name);

		for (const dir of dirs) {
			const path = this.joinNotePath(normalizedFolder, dir, name);
			if (this.ownsNotePath(path, pdf)) return path;
		}
		// Unreachable in practice: the hash candidate is unique to this PDF.
		return this.joinNotePath(normalizedFolder, dirs[dirs.length - 1], name);
	}

	/**
	 * The folder that holds this PDF's note — screenshots and any other file that
	 * belongs to the PDF go here too, so a PDF's material stays together.
	 */
	noteFolderFor(pdf: TFile): string {
		const path = this.notePathFor(pdf);
		const cut = path.lastIndexOf("/");
		return cut === -1 ? "" : path.slice(0, cut);
	}

	private excerptFolder(): string {
		const folder = (this.getSettings().excerptFolder ?? "").trim();
		return folder ? normalizePath(folder) : "";
	}

	private joinNotePath(folder: string, dir: string, name: string): string {
		return normalizePath([folder, dir, `${name}.md`].filter(Boolean).join("/"));
	}

	/** Folder names to try, most readable first; the last is unique to this PDF. */
	private folderCandidates(pdf: TFile, name: string): string[] {
		const hint = this.folderHint(pdf);
		const hash = shortHash(pdf.path);
		const dirs = [name];
		if (hint && hint !== name) dirs.push(`${name} (${hint})`, `${name} (${hint}-${hash})`);
		dirs.push(`${name} (${hash})`);
		return dirs;
	}

	/** The PDF's own parent folder name, used only to disambiguate a clash. */
	private folderHint(pdf: TFile): string {
		const parts = pdf.path.split("/").filter(Boolean);
		parts.pop();
		return sanitizeFileName(parts.pop() ?? "");
	}

	/**
	 * True when `path` is free, already backs this PDF, or holds a note with no
	 * `source` at all (hand-created) — reusing a free/own path every call is what
	 * keeps the mapping stable between load() and save().
	 */
	private ownsNotePath(path: string, pdf: TFile): boolean {
		const aliases = this.sourceAliases(path, pdf);
		const claimedBy = this.claimed.get(path);
		if (claimedBy !== undefined) return aliases.includes(normalizePath(claimedBy));

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile)) return true;

		const fromCache = this.cache.get(path)?.data.source;
		const fromVault = this.app.metadataCache.getFileCache(existing)?.frontmatter?.source;
		const source = fromCache || (typeof fromVault === "string" ? fromVault : "");
		return !source || aliases.includes(normalizePath(source));
	}

	/**
	 * Every path that legitimately stands in for `pdf` as the `source` of the
	 * note at `notePath`: the PDF itself, and its copy inside that note's folder.
	 * Both must resolve to one note, however the user reaches the PDF.
	 */
	private sourceAliases(notePath: string, pdf: TFile): string[] {
		const dir = notePath.split("/").slice(0, -1).join("/");
		const own = normalizePath(pdf.path);
		const copy = this.pdfCopyPath(dir, pdf.name);
		return copy === own ? [own] : [own, copy];
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

	/**
	 * The path a note should cite: this PDF's copy inside its own excerpt folder
	 * once that copy exists, otherwise the PDF's original location.
	 */
	private pdfCopyPath(folder: string, name: string): string {
		return normalizePath([folder, name].filter(Boolean).join("/"));
	}
	private citePathFor(pdf: TFile): string {
		const folder = this.noteFolderFor(pdf);
		const own = normalizePath(pdf.path);
		const copy = this.pdfCopyPath(folder, pdf.name);
		if (copy === own) return pdf.path;
		return this.app.vault.getAbstractFileByPath(copy) instanceof TFile ? copy : own;
	}

	/** Copies `pdf` into `folder` unless it is already there. Returns its path. */
	private async copyPdfTo(pdf: TFile, folder: string): Promise<string> {
		const from = normalizePath(pdf.path);
		const target = this.pdfCopyPath(folder, pdf.name);
		if (!target || target === from) return from;
		if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) return target;

		try {
			await ensureVaultFolder(this.app, folder);
			await this.app.vault.createBinary(target, await this.readPdfBytes(pdf));
			return target;
		} catch (error) {
			console.error(`[pdf-excerpt] 复制 PDF 到摘录文件夹失败：${from} → ${target}`, error);
			return from;
		}
	}

	/**
	 * Makes sure the PDF itself lives in its own excerpt folder, so the note and
	 * the document it quotes always travel together. Returns the path to cite.
	 */
	private async readPdfBytes(pdf: TFile): Promise<ArrayBuffer> {
		try {
			return await this.app.vault.readBinary(pdf);
		} catch (error) {
			const absolute = externalPdfPath(pdf.path);
			const fs = nodeFs();
			if (!absolute || !fs) throw error;
			const buffer = await fs.promises.readFile(absolute);
			return buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength,
			) as ArrayBuffer;
		}
	}

	/**
	 * The same, for a note whose `source` points outside the vault (a `file:`
	 * path). There is no TFile to read, so the bytes come from the disk.
	 */
	private async copyExternalPdfTo(source: string, folder: string): Promise<string> {
		const from = normalizePath(source);
		const absolute = externalPdfPath(source);
		const fs = nodeFs();
		const name = absolute ? absolute.split("/").pop() ?? "" : "";
		if (!absolute || !fs || !name) return from;

		const target = this.pdfCopyPath(folder, name);
		if (!target || target === from) return from;
		if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) return target;

		try {
			await ensureVaultFolder(this.app, folder);
			const buffer = await fs.promises.readFile(absolute);
			await this.app.vault.createBinary(
				target,
				buffer.buffer.slice(
					buffer.byteOffset,
					buffer.byteOffset + buffer.byteLength,
				) as ArrayBuffer,
			);
			return target;
		} catch (error) {
			console.error(`[pdf-excerpt] 复制 PDF 到摘录文件夹失败：${from} → ${target}`, error);
			return from;
		}
	}

	/**
	 * Makes sure the note's own folder holds a copy of the PDF, and reports
	 * whether THIS call was the one that created it.
	 */
	async ensurePdfInFolder(pdf: TFile): Promise<boolean> {
		const folder = this.noteFolderFor(pdf);
		const from = normalizePath(pdf.path);
		const target = this.pdfCopyPath(folder, pdf.name);
		if (!target || target === from) return false;
		if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) return false;
		return (await this.copyPdfTo(pdf, folder)) !== from;
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

		this.claimed.set(path, pdf.path);
		this.cache.set(path, { mtime: file.stat.mtime, size: file.stat.size, data });
		return data;
	}

	async excerptsFor(pdf: TFile): Promise<Excerpt[]> {
		return (await this.load(pdf)).excerpts;
	}

	async save(pdf: TFile, data: ExcerptFileData): Promise<TFile> {
		const path = this.notePathFor(pdf);
		const source = this.citePathFor(pdf);
		// The serializer reads `data.source`, not opts.source — both the
		// frontmatter and every back-link follow this one value.
		data.source = source;
		this.cache.delete(path);
		const content = serializeExcerptFile(data, {
			source,
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

		const stored = { ...data, source, updated: Date.now() };
		this.claimed.set(path, pdf.path);
		this.cache.set(path, { mtime: file.stat.mtime, size: file.stat.size, data: stored });
		return file;
	}

	/* ---------------- mutations ---------------- */

	async addSlices(pdf: TFile, slices: PageExcerptSlice[]): Promise<AddResult> {
		const usable = slices.filter((s) => normalizeExcerptText(s.text).length > 0);
		if (!usable.length) {
			return {
				status: "empty",
				noteFile: null,
				noteCreated: false,
				added: [],
				duplicates: 0,
				pdfCopied: false,
			};
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
				id: excerptIdFor(slice.page, text),
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
				pdfCopied: false,
			};
		}

		const pdfCopied = await this.ensurePdfInFolder(pdf);
		data.updated = Date.now();
		if (!data.created) data.created = data.updated;
		const noteFile = await this.save(pdf, data);
		return { status: "added", noteFile, noteCreated: !existedBefore, added, duplicates, pdfCopied };
	}

	/**
	 * A screenshot excerpt: an image embed with no text, no geometry and no
	 * duplicate rule. `imagePath` is a vault path.
	 */
	async addImage(pdf: TFile, page: number, imagePath: string): Promise<AddResult> {
		const path = this.notePathFor(pdf);
		const existedBefore = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
		const data = await this.load(pdf, { fresh: true });

		// Screenshots are never deduplicated, so the id must be unique even when
		// the same PNG is inserted twice in the same millisecond.
		let id = `e${shortHash(`${page}\u0000${imagePath}\u0000${Date.now()}`)}`;
		let salt = 1;
		while (data.excerpts.some((e) => e.id === id)) id = `e${shortHash(`${page}\u0000${imagePath}\u0000${Date.now()}\u0000${salt++}`)}`;

		const excerpt: Excerpt = {
			id,
			page,
			text: "",
			rects: [],
			created: Date.now(),
			selection: null,
			image: imagePath,
		};
		data.excerpts.push(excerpt);
		const pdfCopied = await this.ensurePdfInFolder(pdf);
		data.updated = Date.now();
		if (!data.created) data.created = data.updated;

		const noteFile = await this.save(pdf, data);
		return {
			status: "added",
			noteFile,
			noteCreated: !existedBefore,
			added: [excerpt],
			duplicates: 0,
			pdfCopied,
		};
	}

	/** Removes one excerpt and returns it, so the caller can clean up its file. */
	async removeExcerpt(pdf: TFile, id: string): Promise<Excerpt | null> {
		const data = await this.load(pdf, { fresh: true });
		const index = data.excerpts.findIndex((e) => e.id === id);
		if (index < 0) return null;
		const [removed] = data.excerpts.splice(index, 1);
		data.updated = Date.now();
		await this.save(pdf, data);
		return removed;
	}

	/**
	 * Moves notes written by the older flat layout into their per-PDF folder, and
	 * brings each PDF along so the note cites the copy. Only notes sitting
	 * directly in the excerpt folder are touched.
	 */
	async migrateFlatNotes(): Promise<{ moved: number; copied: number; skipped: number }> {
		const folder = this.excerptFolder();
		if (!folder) return { moved: 0, copied: 0, skipped: 0 };

		let moved = 0;
		let copied = 0;
		let skipped = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(`${folder}/`)) continue;
			if (file.path.slice(folder.length + 1).includes("/")) continue; // already nested

			let data: ExcerptFileData;
			try {
				data = parseExcerptFile(await this.app.vault.cachedRead(file));
			} catch {
				continue;
			}
			if (!data.excerpts.length || !data.source) {
				skipped++;
				continue;
			}

			const name = sanitizeFileName(file.basename) || "PDF";
			const target = normalizePath(`${folder}/${name}/${name}.md`);
			if (target === file.path) continue;
			if (this.app.vault.getAbstractFileByPath(target) instanceof TFile) {
				skipped++;
				continue;
			}

			try {
				await ensureVaultFolder(this.app, `${folder}/${name}`);
				await this.app.fileManager.renameFile(file, target);
				this.cache.delete(file.path);
				this.invalidate(target);
				moved++;

				// Bring the PDF along, then repoint every back-link at the copy.
				const pdf = this.app.vault.getAbstractFileByPath(normalizePath(data.source));
				const pdfFolder = `${folder}/${name}`;
				const cited =
					pdf instanceof TFile && pdf.extension === "pdf"
						? await this.copyPdfTo(pdf, pdfFolder)
						: await this.copyExternalPdfTo(data.source, pdfFolder);
				if (cited !== normalizePath(data.source)) {
					const rewritten = serializeExcerptFile(
						{ ...data, source: cited },
						{
							source: cited,
							title: data.title,
							linkBuilder: this.linkBuilder,
							tags: data.tags?.length ? data.tags : this.getSettings().tags,
						},
					);
					const movedFile = this.app.vault.getAbstractFileByPath(target);
					if (movedFile instanceof TFile) {
						await this.app.vault.modify(movedFile, rewritten);
						this.invalidate(target);
						copied++;
					}
				}
			} catch (error) {
				console.error(`[pdf-excerpt] 移动摘录笔记失败：${file.path}`, error);
				skipped++;
			}
		}
		return { moved, copied, skipped };
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
		this.claimed.clear();
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	/**
	 * 1.0.0 and 1.0.1 kept each excerpt's geometry in a trailing HTML comment,
	 * which is visible in source mode. Rewrite those notes in place so the same
	 * data is carried by the hidden `%%` marker instead.
	 */
	async migrateLegacyNotes(): Promise<{ scanned: number; migrated: number }> {
		let scanned = 0;
		let migrated = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			let content: string;
			try {
				content = await this.app.vault.cachedRead(file);
			} catch {
				continue;
			}
			LEGACY_COMMENT_RE_G.lastIndex = 0;
			if (!LEGACY_COMMENT_RE_G.test(content)) continue;
			scanned++;

			const data = parseExcerptFile(content);
			if (!data.excerpts.length) continue;
			try {
				const rewritten = serializeExcerptFile(data, {
					source: data.source,
					title: data.title,
					linkBuilder: this.linkBuilder,
					tags: data.tags?.length ? data.tags : this.getSettings().tags,
				});
				await this.app.vault.modify(file, rewritten);
				this.cache.delete(file.path);
				migrated++;
			} catch (error) {
				console.error(`[pdf-excerpt] 迁移失败：${file.path}`, error);
			}
		}
		return { scanned, migrated };
	}
}
