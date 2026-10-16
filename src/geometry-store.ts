/**
 * Highlight geometry, kept OUT of the excerpt notes.
 *
 * The notes the user reads stay plain prose; the rectangles needed to redraw the
 * highlights in the PDF are a derived cache and live in the plugin's own data
 * file (`<plugin dir>/geometry.json`). The trade-off is deliberate: the geometry
 * does not travel with a note that is copied to another vault, in exchange for
 * notes that contain nothing but the excerpts themselves.
 *
 * Layout:
 *   { "version": 1,
 *     "notes": { "<note path>": { "<excerpt id>": { page, rects, selection } } } }
 */

import type { DataAdapter } from "obsidian";
import type { ExcerptRect } from "./excerpt-markdown";

/** Everything needed to redraw one excerpt's highlight, and nothing else. */
export interface ExcerptGeometry {
	page: number;
	rects: ExcerptRect[];
	selection: string | null;
}

/** excerpt id -> geometry, for a single note. */
export type NoteGeometry = Record<string, ExcerptGeometry>;

interface GeometryFile {
	version: number;
	notes: Record<string, NoteGeometry>;
}

const FILE_VERSION = 1;
const WRITE_DEBOUNCE_MS = 400;

export class GeometryStore {
	private data: GeometryFile = { version: FILE_VERSION, notes: {} };
	private loaded = false;
	private writeTimer: number | null = null;
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private adapter: DataAdapter,
		private filePath: string,
	) {}

	/** Reads the file once. A missing or corrupt file simply starts out empty. */
	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			if (!(await this.adapter.exists(this.filePath))) return;
			const raw = await this.adapter.read(this.filePath);
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object") return;
			const notes = (parsed as Partial<GeometryFile>).notes;
			if (!notes || typeof notes !== "object") return;
			this.data = { version: FILE_VERSION, notes: coerceNotes(notes as Record<string, unknown>) };
		} catch (error) {
			console.error("[pdf-excerpt] 高亮数据读取失败，将从空数据开始", error);
			this.data = { version: FILE_VERSION, notes: {} };
		}
	}

	get(notePath: string, excerptId: string): ExcerptGeometry | undefined {
		return this.data.notes[notePath]?.[excerptId];
	}

	/** All geometry for one note, as a copy safe for the caller to re-key. */
	getNote(notePath: string): NoteGeometry | undefined {
		const entries = this.data.notes[notePath];
		if (!entries) return undefined;
		return { ...entries };
	}

	/**
	 * Replaces every entry for one note. Because this is a wholesale replace,
	 * deleting an excerpt from the note drops its geometry with no extra work.
	 */
	setNote(notePath: string, geometry: NoteGeometry): void {
		if (Object.keys(geometry).length === 0) {
			delete this.data.notes[notePath];
		} else {
			this.data.notes[notePath] = geometry;
		}
		this.schedule();
	}

	deleteNote(notePath: string): void {
		if (!(notePath in this.data.notes)) return;
		delete this.data.notes[notePath];
		this.schedule();
	}

	/** Drops entries whose note no longer exists. Returns how many were removed. */
	prune(existingNotePaths: Set<string>): number {
		let removed = 0;
		for (const notePath of Object.keys(this.data.notes)) {
			if (existingNotePaths.has(notePath)) continue;
			delete this.data.notes[notePath];
			removed++;
		}
		if (removed) this.schedule();
		return removed;
	}

	/** Debounced write, so a burst of excerpts costs one file write. */
	schedule(): void {
		if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
		this.writeTimer = window.setTimeout(() => {
			this.writeTimer = null;
			void this.flush();
		}, WRITE_DEBOUNCE_MS);
	}

	/** Writes immediately; safe to call when nothing is pending. */
	async flush(): Promise<void> {
		if (this.writeTimer !== null) {
			window.clearTimeout(this.writeTimer);
			this.writeTimer = null;
		}
		const payload = JSON.stringify(this.data);
		this.writeChain = this.writeChain
			.then(() => this.adapter.write(this.filePath, payload))
			.catch((error: unknown) => {
				console.error("[pdf-excerpt] 高亮数据写入失败", error);
			});
		return this.writeChain;
	}
}

function coerceRect(raw: unknown): ExcerptRect | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const x = Number(obj.x);
	const y = Number(obj.y);
	const w = Number(obj.w);
	const h = Number(obj.h);
	if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
	return { x, y, w, h };
}

function coerceGeometry(raw: unknown): ExcerptGeometry | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const page = Number(obj.page);
	if (!Number.isFinite(page) || page < 1) return null;
	const rects = (Array.isArray(obj.rects) ? obj.rects : [])
		.map(coerceRect)
		.filter((r): r is ExcerptRect => r !== null);
	if (!rects.length) return null;
	return {
		page,
		rects,
		selection: typeof obj.selection === "string" && obj.selection ? obj.selection : null,
	};
}

function coerceNotes(raw: Record<string, unknown>): Record<string, NoteGeometry> {
	const notes: Record<string, NoteGeometry> = {};
	for (const [notePath, value] of Object.entries(raw)) {
		if (!value || typeof value !== "object") continue;
		const entries: NoteGeometry = {};
		for (const [id, geometry] of Object.entries(value as Record<string, unknown>)) {
			const parsed = coerceGeometry(geometry);
			if (parsed) entries[id] = parsed;
		}
		if (Object.keys(entries).length) notes[notePath] = entries;
	}
	return notes;
}
