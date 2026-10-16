/**
 * Region screenshot: the user drags a box over a rendered PDF page and the
 * pixels are lifted straight off that page's canvas, so the result is a
 * full-resolution crop with no OS-level screen capture involved.
 *
 * The overlay is injected per page (like the highlight layer) and therefore
 * scrolls with the document. A capture is limited to the page the drag started
 * on, which keeps the page number unambiguous.
 */

import { alignOverlayToCanvas, pageNumberOf } from "./pdf-view";

export const SHOT_LAYER_CLASS = "pdf-excerpt-shot";
export const SHOT_BOX_CLASS = "pdf-excerpt-shot-box";

/** Anything smaller than this in CSS pixels is treated as a stray click. */
const MIN_SIZE = 8;

export interface ScreenshotCapture {
	/** 1-based page number the crop came from. */
	page: number;
	data: ArrayBuffer;
	width: number;
	height: number;
}

interface ActiveDrag {
	pageEl: HTMLElement;
	overlay: HTMLElement;
	canvas: HTMLCanvasElement;
	scaleX: number;
	scaleY: number;
}

function pageCanvas(pageEl: HTMLElement): HTMLCanvasElement | null {
	return pageEl.querySelector<HTMLCanvasElement>("canvas");
}

/**
 * Installs the selection overlays and resolves with the cropped PNG, or null if
 * the user cancelled / the drag was too small / nothing was rendered.
 */
export function startScreenshot(
	host: HTMLElement,
	onHint?: (message: string) => void,
): Promise<ScreenshotCapture | null> {
	const doc = host.ownerDocument;
	const pages = Array.from(host.querySelectorAll<HTMLElement>(":scope > .page")).filter(
		(page) => page.dataset.loaded === "true" && pageCanvas(page),
	);
	if (!pages.length) {
		onHint?.("PDF 还没有渲染完成，请稍候再截图。");
		return Promise.resolve(null);
	}

	return new Promise<ScreenshotCapture | null>((resolve) => {
		const overlays: HTMLElement[] = [];
		let drag: ActiveDrag | null = null;
		let box: HTMLElement | null = null;
		let startX = 0;
		let startY = 0;
		let settled = false;

		const cleanup = () => {
			doc.removeEventListener("keydown", onKey, true);
			for (const overlay of overlays) overlay.remove();
			overlays.length = 0;
		};

		const finish = (value: ScreenshotCapture | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		const onKey = (evt: KeyboardEvent) => {
			if (evt.key !== "Escape") return;
			evt.preventDefault();
			evt.stopPropagation();
			onHint?.("已取消截图。");
			finish(null);
		};

		const bounds = (evt: PointerEvent) => {
			if (!drag) return null;
			const rect = drag.overlay.getBoundingClientRect();
			return {
				x: Math.min(Math.max(0, evt.clientX - rect.left), rect.width),
				y: Math.min(Math.max(0, evt.clientY - rect.top), rect.height),
			};
		};

		const onPointerMove = (evt: PointerEvent) => {
			const point = bounds(evt);
			if (!point || !box) return;
			evt.preventDefault();
			const x = Math.min(startX, point.x);
			const y = Math.min(startY, point.y);
			const w = Math.abs(point.x - startX);
			const h = Math.abs(point.y - startY);
			box.style.left = `${x}px`;
			box.style.top = `${y}px`;
			box.style.width = `${w}px`;
			box.style.height = `${h}px`;
		};

		const onPointerUp = (evt: PointerEvent) => {
			const point = bounds(evt);
			const current = drag;
			if (!point || !current) {
				finish(null);
				return;
			}
			evt.preventDefault();

			const x = Math.min(startX, point.x);
			const y = Math.min(startY, point.y);
			const w = Math.abs(point.x - startX);
			const h = Math.abs(point.y - startY);
			if (w < MIN_SIZE || h < MIN_SIZE) {
				onHint?.("截图区域太小，已取消。");
				finish(null);
				return;
			}

			const canvas = current.canvas;
			const scaleX = canvas.width / Math.max(1, current.overlay.clientWidth);
			const scaleY = canvas.height / Math.max(1, current.overlay.clientHeight);
			const sx = Math.max(0, Math.round(x * scaleX));
			const sy = Math.max(0, Math.round(y * scaleY));
			const sw = Math.min(canvas.width - sx, Math.max(1, Math.round(w * scaleX)));
			const sh = Math.min(canvas.height - sy, Math.max(1, Math.round(h * scaleY)));
			if (sw < 1 || sh < 1) {
				finish(null);
				return;
			}

			const out = doc.createElement("canvas");
			out.width = sw;
			out.height = sh;
			const ctx = out.getContext("2d");
			if (!ctx) {
				onHint?.("当前环境不支持截图。");
				finish(null);
				return;
			}
			ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

			const page = pageNumberOf(current.pageEl) ?? 1;
			// Hide the rubber band before the browser paints, so it is never
			// baked into the crop.
			box?.remove();
			box = null;
			out.toBlob((blob) => {
				if (!blob) {
					finish(null);
					return;
				}
				void blob.arrayBuffer().then(
					(data) => finish({ page, data, width: sw, height: sh }),
					() => finish(null),
				);
			}, "image/png");
		};

		const onPointerDown = (evt: PointerEvent) => {
			if (drag || evt.button !== 0) return;
			const pageEl = (evt.currentTarget as HTMLElement | null)?.closest<HTMLElement>(".page");
			if (!pageEl) return;
			const canvas = pageCanvas(pageEl);
			const overlay = overlays.find((o) => o.parentElement === pageEl);
			if (!canvas || !overlay) return;
			const point = bounds(evt);
			if (!point) return;

			evt.preventDefault();
			evt.stopPropagation();
			drag = {
				pageEl,
				overlay,
				canvas,
				scaleX: canvas.width / Math.max(1, overlay.clientWidth),
				scaleY: canvas.height / Math.max(1, overlay.clientHeight),
			};
			startX = point.x;
			startY = point.y;
			box = doc.createElement("div");
			box.className = SHOT_BOX_CLASS;
			box.style.left = `${startX}px`;
			box.style.top = `${startY}px`;
			box.style.width = "0px";
			box.style.height = "0px";
			overlay.appendChild(box);
		};

		for (const pageEl of pages) {
			const overlay = doc.createElement("div");
			overlay.className = SHOT_LAYER_CLASS;
			pageEl.appendChild(overlay);
			// Park-then-measure: `.page` is a content-box element with a border, so
			// an inline offset cannot be computed from the border-box rect.
			if (!alignOverlayToCanvas(overlay, pageEl)) {
				overlay.remove();
				continue;
			}
			overlay.addEventListener("pointerdown", onPointerDown);
			overlay.addEventListener("pointermove", onPointerMove);
			overlay.addEventListener("pointerup", onPointerUp);
			overlays.push(overlay);
		}

		if (!overlays.length) {
			onHint?.("PDF 还没有渲染完成，请稍候再截图。");
			finish(null);
			return;
		}

		doc.addEventListener("keydown", onKey, true);
		onHint?.("拖动框选截图区域，按 Esc 取消。");
	});
}
