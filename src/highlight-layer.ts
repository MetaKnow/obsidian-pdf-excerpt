/**
 * Renders excerpts as a translucent highlight overlay inside Obsidian's PDF
 * pages.
 *
 * Geometry is stored normalized (0..1) against the page's canvas box, so the
 * overlay survives zooming, window resizing and re-rendering: the layer element
 * is re-sized to the live canvas rectangle on every render pass and each rect is
 * placed with percentages.
 */

import type { Excerpt } from "./excerpt-markdown";
import { alignOverlayToCanvas, isPageRendered, pageNumberOf } from "./pdf-view";

const LAYER_CLASS = "pdf-excerpt-layer";
const HL_CLASS = "pdf-excerpt-hl";
const FLASH_CLASS = "is-flashing";
const PAGE_FLASH_CLASS = "is-page-flashing";

export interface HighlightLayerOptions {
	color: string;
	onActivate?: (excerpt: Excerpt) => void;
}

function toCssColor(color: string, alpha: number): string {
	const hex = color.trim();
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
	if (m) {
		let body = m[1];
		if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
		const r = parseInt(body.slice(0, 2), 16);
		const g = parseInt(body.slice(2, 4), 16);
		const b = parseInt(body.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return hex;
}

export class PdfHighlightLayer {
	private readonly host: HTMLElement;
	private color: string;
	private onActivate?: (excerpt: Excerpt) => void;
	private byPage = new Map<number, Excerpt[]>();
	private resizeObserver: ResizeObserver | null = null;
	private loadObserver: MutationObserver | null = null;
	private pendingRender: number | null = null;
	private destroyed = false;

	constructor(host: HTMLElement, opts: HighlightLayerOptions) {
		this.color = opts.color;
		this.onActivate = opts.onActivate;
		this.host = host;

		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.render());
			this.resizeObserver.observe(this.host);
		}

		// pdf.js renders pages lazily, so on a freshly opened PDF no `.page` is
		// ready when the first render pass runs. Watch `data-loaded` and re-render
		// as pages come in, otherwise reopened notes would never get highlights.
		if (typeof MutationObserver !== "undefined") {
			this.loadObserver = new MutationObserver((records) => {
				for (const record of records) {
					const target = record.target as HTMLElement;
					if (target.classList?.contains(LAYER_CLASS)) continue;
					if (record.attributeName === "data-loaded") {
						this.scheduleRender();
						return;
					}
				}
			});
			this.loadObserver.observe(this.host, {
				subtree: true,
				attributes: true,
				attributeFilter: ["data-loaded"],
			});
		}
	}

	/** Coalesces bursts of page-load notifications into one render pass. */
	private scheduleRender(): void {
		if (this.destroyed || this.pendingRender !== null) return;
		const win = this.host.ownerDocument?.defaultView ?? window;
		this.pendingRender = win.requestAnimationFrame(() => {
			this.pendingRender = null;
			this.render();
		});
	}

	/** Every live `.page` element, in document order. */
	private pages(): HTMLElement[] {
		return Array.from(this.host.querySelectorAll<HTMLElement>(":scope > .page"));
	}

	private findPage(page: number): HTMLElement | null {
		for (const el of this.pages()) {
			if (pageNumberOf(el) === page) return el;
		}
		return null;
	}

	/** True while the host element is still attached to a live document. */
	isConnected(): boolean {
		return !this.destroyed && this.host.isConnected;
	}

	setColor(color: string): void {
		this.color = color;
		this.render();
	}

	setExcerpts(excerpts: Excerpt[]): void {
		const byPage = new Map<number, Excerpt[]>();
		for (const e of excerpts) {
			const list = byPage.get(e.page);
			if (list) list.push(e);
			else byPage.set(e.page, [e]);
		}
		this.byPage = byPage;
		this.render();
	}

	/** Re-attaches and re-positions every overlay for currently known pages. */
	render(): void {
		if (this.destroyed) return;
		for (const pageEl of this.pages()) {
			const page = pageNumberOf(pageEl);
			if (page === null) continue;
			if (!isPageRendered(pageEl)) {
				this.detachLayer(pageEl);
				continue;
			}
			this.renderPage(pageEl, page);
		}
	}

	private detachLayer(pageEl: HTMLElement): void {
		pageEl.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`)?.remove();
	}

	private ensureLayer(pageEl: HTMLElement): HTMLElement {
		let layer = pageEl.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
		if (!layer) {
			layer = pageEl.ownerDocument.createElement("div");
			layer.className = LAYER_CLASS;
			pageEl.appendChild(layer);
		}
		return layer;
	}

	private renderPage(pageEl: HTMLElement, page: number): void {
		const excerpts = this.byPage.get(page);
		const layer = this.ensureLayer(pageEl);

		// Align the layer with the canvas box (the page div itself carries a
		// scale-dependent transparent border, so its rect is not the content box).
		if (!alignOverlayToCanvas(layer, pageEl)) return;

		if (layer.dataset.renderedFor === this.signature(excerpts)) return;
		layer.dataset.renderedFor = this.signature(excerpts);

		const doc = pageEl.ownerDocument;
		const frag = doc.createDocumentFragment();
		if (excerpts) {
			for (const excerpt of excerpts) {
				for (const rect of excerpt.rects) {
					const hl = doc.createElement("div");
					hl.className = HL_CLASS;
					hl.dataset.excerptId = excerpt.id;
					hl.style.left = `${rect.x * 100}%`;
					hl.style.top = `${rect.y * 100}%`;
					hl.style.width = `${rect.w * 100}%`;
					hl.style.height = `${rect.h * 100}%`;
					hl.style.backgroundColor = toCssColor(this.color, 0.42);
					if (this.onActivate) {
						hl.addEventListener("click", () => {
							if (excerpt) this.onActivate?.(excerpt);
						});
					}
					frag.appendChild(hl);
				}
			}
		}
		layer.replaceChildren(frag);
	}

	private signature(excerpts: Excerpt[] | undefined): string {
		if (!excerpts) return `${this.color}|`;
		return (
			this.color +
			"|" +
			excerpts.map((e) => `${e.id}:${e.rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(";")}`).join("|")
		);
	}

	/** Scrolls to an excerpt, forcing a render/flash once the page exists. */
	async scrollTo(excerpt: Excerpt, flash = true): Promise<boolean> {
		if (this.destroyed) return false;
		let pageEl = this.findPage(excerpt.page);
		if (!pageEl) return false;

		if (!isPageRendered(pageEl)) {
			pageEl.scrollIntoView({ block: "center" });
			await this.waitForPageLoad(pageEl, 4000);
			pageEl = this.findPage(excerpt.page) ?? pageEl;
			this.render();
		}

		const node = pageEl.querySelector<HTMLElement>(
			`.${HL_CLASS}[data-excerpt-id="${CSS.escape(excerpt.id)}"]`,
		);
		// A screenshot excerpt has no rectangles, so there is nothing inside the
		// page to scroll to; centring the page and flashing its frame is the cue.
		(node ?? pageEl).scrollIntoView({ block: "center", behavior: "smooth" });
		if (!flash) return true;
		if (node) this.flash(pageEl, excerpt.id);
		else this.flashPage(pageEl);
		return true;
	}

	/** Page-level cue for excerpts that have no rectangle of their own. */
	flashPage(pageEl: HTMLElement): void {
		pageEl.classList.remove(PAGE_FLASH_CLASS);
		// Force a reflow so the animation restarts on repeated flashes.
		void pageEl.offsetWidth;
		pageEl.classList.add(PAGE_FLASH_CLASS);
		window.setTimeout(() => pageEl.classList.remove(PAGE_FLASH_CLASS), 900);
	}

	flash(pageEl: HTMLElement, excerptId: string): void {
		const nodes = pageEl.querySelectorAll<HTMLElement>(
			`.${HL_CLASS}[data-excerpt-id="${CSS.escape(excerptId)}"]`,
		);
		for (const node of Array.from(nodes)) {
			node.classList.remove(FLASH_CLASS);
			// Force a reflow so the animation restarts on repeated flashes.
			void node.offsetWidth;
			node.classList.add(FLASH_CLASS);
			window.setTimeout(() => node.classList.remove(FLASH_CLASS), 1200);
		}
	}

	flashExcerpt(excerpt: Excerpt): void {
		const pageEl = this.findPage(excerpt.page);
		if (!pageEl || !isPageRendered(pageEl)) return;
		this.render();
		this.flash(pageEl, excerpt.id);
	}

	private waitForPageLoad(pageEl: HTMLElement, timeoutMs: number): Promise<void> {
		if (isPageRendered(pageEl)) return Promise.resolve();
		return new Promise((resolve) => {
			const win = pageEl.ownerDocument.defaultView ?? window;
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				observer.disconnect();
				win.clearTimeout(timer);
				resolve();
			};
			const observer = new MutationObserver(() => {
				if (isPageRendered(pageEl)) finish();
			});
			observer.observe(pageEl, { attributes: true, attributeFilter: ["data-loaded"] });
			const timer = win.setTimeout(finish, timeoutMs);
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.loadObserver?.disconnect();
		this.loadObserver = null;
		if (this.pendingRender !== null) {
			const win = this.host.ownerDocument?.defaultView ?? window;
			win.cancelAnimationFrame(this.pendingRender);
			this.pendingRender = null;
		}
		for (const pageEl of Array.from(this.host.querySelectorAll<HTMLElement>(`:scope > .page`))) {
			this.detachLayer(pageEl);
		}
		this.byPage.clear();
	}
}
