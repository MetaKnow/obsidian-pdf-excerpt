/**
 * Integration with Obsidian's built-in PDF viewer.
 *
 * Obsidian does not expose a public API for PDF views, so this module reaches
 * into the internals of the (already reverse engineered) viewer:
 *
 *   leaf.view                     -> PDFView        (`View.viewer` is a thenable `Child`)
 *   await view.viewer             -> Viewer         (`Viewer.pdfViewer`, `.containerEl`, `.eventBus`)
 *   viewer.containerEl            -> `<div>` holding `.pdf-toolbar` + `.pdf-container`
 *   viewer.pdfViewer.dom          -> { pdfContainerEl, contentEl, viewerContainerEl, viewerEl, ... }
 *   viewer.pdfViewer.dom.viewerEl -> `.pdfViewer`, the element holding every `.page`
 *   viewer.getPage(n)             -> PDFPageView { div, canvas, textLayer, viewport }
 *   page.div.dataset.pageNumber   -> "1".."N"
 *   page.div.dataset.loaded       -> "true" once rendered
 *   page.textLayer.textLayer      -> { textDivs, textContentItems }  (native text layer)
 *
 * Everything below degrades gracefully: every access is guarded and every entry
 * point returns `null` rather than throwing when the DOM does not have the shape
 * we expect (e.g. after an Obsidian update).
 */

import { App, TFile } from "obsidian";
import type { ExcerptRect } from "./excerpt-markdown";

export interface PdfTextLayer {
	textDivs: HTMLElement[];
	textContentItems: { str: string; chars?: { u: string; r: number[] }[] }[];
}

export interface PdfPageView {
	div: HTMLElement;
	canvas?: HTMLCanvasElement;
	textLayer?: { textLayer?: PdfTextLayer; div?: HTMLElement };
	annotationLayer?: { div?: HTMLElement; annotationLayer?: unknown };
	viewport?: { width: number; height: number; scale: number };
	pdfPage?: unknown;
}

export interface PdfJsViewer {
	pagesCount: number;
	currentPageNumber: number;
	currentScale: number;
	currentScaleValue: string | number;
	viewer: HTMLElement;
	container: HTMLElement;
	eventBus: EventBusLike;
	dom?: {
		containerEl?: HTMLElement;
		contentEl?: HTMLElement;
		pdfContainerEl?: HTMLElement;
		viewerContainerEl?: HTMLElement;
		viewerEl?: HTMLElement;
		sidebarContainerEl?: HTMLElement;
	};
	getPageView(index: number): PdfPageView;
}

export interface EventBusLike {
	on?(name: string, cb: (...args: unknown[]) => void): void;
	off?(name: string, cb: (...args: unknown[]) => void): void;
}

/** The `Viewer` instance Obsidian creates for one PDF leaf. */
export interface PdfViewer {
	containerEl: HTMLElement;
	pdfViewer: PdfJsViewer;
	eventBus?: EventBusLike;
	getPage(pageNumber: number): PdfPageView | undefined;
	on?(name: string, cb: (...args: unknown[]) => void): void;
	off?(name: string, cb: (...args: unknown[]) => void): void;
}

/** The `ItemView` Obsidian registers under the `pdf` view type. */
export interface PdfLeafView {
	file?: TFile;
	containerEl: HTMLElement;
	viewer?: PromiseLike<PdfViewer> & { then?: unknown };
	allowNoFile?: boolean;
	getViewType?: () => string;
}

export interface PageExcerptSlice {
	page: number;
	text: string;
	rects: ExcerptRect[];
	/** Obsidian native selection subpath (`idx,start,idx,end`), when derivable. */
	selection: string | null;
}

export interface PdfSelection {
	view: PdfLeafView | null;
	viewer: PdfViewer | null;
	/** The `.pdf-viewer-container` the selection was taken from. */
	container: HTMLElement;
	slices: PageExcerptSlice[];
}

const isEl = (v: unknown): v is HTMLElement => v instanceof HTMLElement;

function closestEl(node: Node | null, selector: string): HTMLElement | null {
	let cur: Node | null = node;
	while (cur) {
		if (isEl(cur) && cur.matches(selector)) return cur;
		cur = cur.parentNode;
	}
	return null;
}

export function getPdfLeafViews(app: App): PdfLeafView[] {
	const out: PdfLeafView[] = [];
	for (const leaf of app.workspace.getLeavesOfType("pdf")) {
		const view = leaf.view as unknown as PdfLeafView;
		if (view && view.containerEl && view.file) out.push(view);
	}
	return out;
}

export function findPdfViewForFile(app: App, file: TFile): PdfLeafView | null {
	for (const view of getPdfLeafViews(app)) {
		if (view.file?.path === file.path) return view;
	}
	return null;
}

/** Resolves the (lazily constructed, thenable) `Viewer` of a PDF leaf. */
export async function resolvePdfViewer(view: PdfLeafView): Promise<PdfViewer | null> {
	const raw = view.viewer as { then?: (cb: (v: PdfViewer) => unknown) => unknown } | undefined;
	if (!raw) return null;
	try {
		if (typeof raw.then === "function") {
			const resolved = await Promise.resolve(raw as unknown as PromiseLike<PdfViewer>);
			return resolved && (resolved as PdfViewer).pdfViewer ? resolved : null;
		}
		const direct = raw as unknown as PdfViewer;
		return direct.pdfViewer ? direct : null;
	} catch {
		return null;
	}
}

/** The `.pdf-container` element: the coordinate space for everything visual. */
export function pdfContainerEl(viewer: PdfViewer): HTMLElement | null {
	const dom = viewer.pdfViewer?.dom;
	if (isEl(dom?.pdfContainerEl)) return dom.pdfContainerEl;
	return viewer.containerEl?.querySelector<HTMLElement>(".pdf-container") ?? null;
}

/** The `.pdfViewer` element that holds every `.page`. */
export function pdfPagesHostEl(viewer: PdfViewer): HTMLElement | null {
	const dom = viewer.pdfViewer?.dom;
	if (isEl(dom?.viewerEl)) return dom.viewerEl;
	const container = pdfContainerEl(viewer);
	return container?.querySelector<HTMLElement>(".pdfViewer") ?? null;
}

/**
 * DOM-only lookup used for embedded PDFs, where no `Viewer` instance is
 * reachable: finds the `.pdfViewer` page host below the given element.
 */
export function pdfPagesHostFrom(node: Element | null): HTMLElement | null {
	if (!node) return null;
	if (node.matches(".pdfViewer")) return node as HTMLElement;
	return node.querySelector<HTMLElement>(".pdfViewer");
}

/**
 * The scroll container of every PDF (owned or embedded) related to `node`.
 * Works both from a descendant (a text span) and from an ancestor (a leaf
 * `containerEl`), which is why it tries `closest` before `querySelector`.
 */
export function pdfViewerContainerFrom(node: Element | null): HTMLElement | null {
	if (!node) return null;
	const closest = node.closest?.(".pdf-viewer-container");
	if (closest instanceof HTMLElement) return closest;
	if (node.matches(".pdfViewer") || node.matches(".pdf-container")) {
		return node.querySelector<HTMLElement>(".pdf-viewer-container");
	}
	return null;
}

export function pageElements(viewer: PdfViewer): HTMLElement[] {
	const host = pdfPagesHostEl(viewer);
	if (!host) return [];
	return Array.from(host.querySelectorAll<HTMLElement>(":scope > .page"));
}

export function pageNumberOf(pageEl: HTMLElement): number | null {
	const raw = pageEl.dataset?.pageNumber;
	if (!raw) return null;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function findPageElement(viewer: PdfViewer, page: number): HTMLElement | null {
	for (const el of pageElements(viewer)) {
		if (pageNumberOf(el) === page) return el;
	}
	return null;
}

export function isPageRendered(pageEl: HTMLElement): boolean {
	return pageEl.dataset?.loaded === "true";
}

/** The element the normalized excerpt coordinates are relative to. */
export function pageReferenceEl(pageEl: HTMLElement): HTMLElement {
	return (
		pageEl.querySelector<HTMLCanvasElement>("canvas") ??
		pageEl.querySelector<HTMLElement>(".canvasWrapper") ??
		pageEl
	);
}

/* ------------------------------------------------------------------ */
/* Selection capture                                                   */
/* ------------------------------------------------------------------ */

interface TextSegment {
	node: Text;
	start: number;
	end: number;
	pageEl: HTMLElement;
}

function collectSegments(range: Range): TextSegment[] {
	const startC = range.startContainer;
	const doc = startC.ownerDocument;
	if (!doc) return [];
	let root: Node = range.commonAncestorContainer;
	if (root.nodeType === Node.TEXT_NODE && root.parentNode) root = root.parentNode;

	let walker: TreeWalker;
	try {
		walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	} catch {
		return [];
	}

	const segments: TextSegment[] = [];
	let node = walker.nextNode();
	while (node) {
		const text = node as Text;
		const pageEl = closestEl(text.parentNode, ".page");
		// `intersectsNode` already excludes text outside the range, but a text
		// node that merely touches a boundary can still report zero characters.
		if (pageEl && range.intersectsNode(text)) {
			let start = 0;
			let end = text.data.length;
			if (text === startC) start = range.startOffset;
			if (text === range.endContainer) end = range.endOffset;
			if (end > start) segments.push({ node: text, start, end, pageEl });
		}
		node = walker.nextNode();
	}
	return segments;
}

interface RawRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

function mergeLineRects(rects: RawRect[]): RawRect[] {
	const usable = rects.filter((r) => r.width > 0.5 && r.height > 0.5);
	usable.sort((a, b) => a.top - b.top || a.left - b.left);

	const merged: RawRect[] = [];
	for (const rect of usable) {
		let target: RawRect | null = null;
		for (const candidate of merged) {
			const overlapY =
				Math.min(candidate.top + candidate.height, rect.top + rect.height) -
				Math.max(candidate.top, rect.top);
			const minH = Math.min(candidate.height, rect.height);
			if (overlapY < minH * 0.5) continue;

			const gap = rect.left - (candidate.left + candidate.width);
			const alreadyInside =
				rect.left >= candidate.left && rect.left + rect.width <= candidate.left + candidate.width;
			if (alreadyInside || (gap >= -1 && gap <= minH * 1.2)) {
				const left = Math.min(candidate.left, rect.left);
				const top = Math.min(candidate.top, rect.top);
				const right = Math.max(candidate.left + candidate.width, rect.left + rect.width);
				const bottom = Math.max(candidate.top + candidate.height, rect.top + rect.height);
				candidate.left = left;
				candidate.top = top;
				candidate.width = right - left;
				candidate.height = bottom - top;
				target = candidate;
				break;
			}
		}
		if (!target) merged.push({ ...rect });
	}
	return merged;
}

function normalizeRects(raw: RawRect[], ref: DOMRect): ExcerptRect[] {
	if (ref.width <= 0 || ref.height <= 0) return [];
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	const out: ExcerptRect[] = [];
	for (const r of raw) {
		const x = clamp((r.left - ref.left) / ref.width);
		const y = clamp((r.top - ref.top) / ref.height);
		const w = clamp((r.left + r.width - ref.left) / ref.width) - x;
		const h = clamp((r.top + r.height - ref.top) / ref.height) - y;
		if (w <= 0.0005 || h <= 0.0005) continue;
		if (x >= 1 || y >= 1) continue;
		out.push({ x, y, w, h });
	}
	return out;
}

function characterOffsetWithin(el: HTMLElement, node: Node, offset: number): number | null {
	if (!el.contains(node)) return null;
	let total = 0;
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let cur = walker.nextNode();
	while (cur) {
		if (cur === node) return total + offset;
		total += cur.textContent?.length ?? 0;
		cur = walker.nextNode();
	}
	return null;
}

/**
 * Reproduces Obsidian's own `#page=N&selection=a,b,c,d` subpath so that links
 * written by this plugin trigger Obsidian's native PDF text highlight too.
 */
function selectionRangeString(pageView: PdfPageView | undefined, range: Range): string | null {
	const textDivs = pageView?.textLayer?.textLayer?.textDivs;
	if (!Array.isArray(textDivs) || !textDivs.length) return null;
	try {
		const startEl = closestEl(range.startContainer, "[data-idx], .textLayerNode");
		const endEl = closestEl(range.endContainer, "[data-idx], .textLayerNode");
		const startIdx = startEl ? textDivs.indexOf(startEl) : -1;
		const endIdx = endEl ? textDivs.indexOf(endEl) : -1;
		if (startIdx < 0 || endIdx < 0) return null;
		const startOff = characterOffsetWithin(startEl as HTMLElement, range.startContainer, range.startOffset);
		const endOff = characterOffsetWithin(endEl as HTMLElement, range.endContainer, range.endOffset);
		if (startOff === null || endOff === null) return null;
		return `${startIdx},${startOff},${endIdx},${endOff}`;
	} catch {
		return null;
	}
}

/**
 * Snapshots the current PDF text selection into per-page slices with normalized
 * geometry. Returns `null` when there is no usable PDF text selection.
 *
 * Works for both PDF leaves and embedded PDFs: `container` is the
 * `.pdf-viewer-container`; `viewer` is only needed to derive the optional
 * Obsidian-native `selection` subpath.
 */
export function captureSelection(
	container: HTMLElement,
	viewer?: PdfViewer | null,
	view?: PdfLeafView | null,
): PdfSelection | null {
	const doc = container.ownerDocument;
	const selection = doc.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

	const range = selection.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return null;

	const textLayer = closestEl(range.commonAncestorContainer, ".textLayer");
	if (!textLayer) return null;

	const segments = collectSegments(range);
	if (!segments.length) return null;

	const byPage = new Map<number, TextSegment[]>();
	for (const seg of segments) {
		const page = pageNumberOf(seg.pageEl);
		if (page === null) continue;
		const list = byPage.get(page);
		if (list) list.push(seg);
		else byPage.set(page, [seg]);
	}
	if (!byPage.size) return null;

	const slices: PageExcerptSlice[] = [];
	for (const [page, segs] of Array.from(byPage.entries()).sort((a, b) => a[0] - b[0])) {
		const pageEl = segs[0].pageEl;
		const sub = doc.createRange();
		sub.setStart(segs[0].node, segs[0].start);
		const last = segs[segs.length - 1];
		sub.setEnd(last.node, last.end);

		const text = sub.toString().replace(/\u00a0/g, " ").trim();
		if (!text) continue;

		const ref = pageReferenceEl(pageEl).getBoundingClientRect();
		const rawRects: RawRect[] = [];
		for (const r of Array.from(sub.getClientRects())) {
			rawRects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
		}

		const pageView = viewer?.getPage?.(page);
		slices.push({
			page,
			text,
			rects: normalizeRects(mergeLineRects(rawRects), ref),
			selection: selectionRangeString(pageView, sub),
		});
	}

	if (!slices.length) return null;
	return { view: view ?? null, viewer: viewer ?? null, container, slices };
}

/**
 * Picks the PDF view the user is most plausibly acting on: a view containing
 * the event target, else the active view, else the only open PDF.
 */
export function resolveTargetPdfView(app: App, target?: EventTarget | null): PdfLeafView | null {
	const views = getPdfLeafViews(app);
	if (!views.length) return null;

	if (isEl(target)) {
		for (const view of views) {
			if (view.containerEl.contains(target)) return view;
		}
	}

	const active = app.workspace.getActiveFile();
	if (active) {
		for (const view of views) {
			if (view.file?.path === active.path) return view;
		}
	}

	const mostRecent = app.workspace.getMostRecentLeaf?.();
	if (mostRecent) {
		const view = mostRecent.view as unknown as PdfLeafView;
		for (const candidate of views) {
			if (candidate === view) return view;
		}
	}

	return views.length === 1 ? views[0] : null;
}
