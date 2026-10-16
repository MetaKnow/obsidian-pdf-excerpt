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
}

function pageCanvas(pageEl: HTMLElement): HTMLCanvasElement | null {
	return pageEl.querySelector<HTMLCanvasElement>("canvas");
}

/**
 * Pointer position in overlay-local CSS pixels, clamped to the overlay box.
 * Deliberately takes the overlay as an argument: the pointerdown handler needs a
 * point BEFORE the drag state exists.
 */
function localPoint(evt: PointerEvent, overlay: HTMLElement): { x: number; y: number } {
	const rect = overlay.getBoundingClientRect();
	const width = rect.width || overlay.clientWidth;
	const height = rect.height || overlay.clientHeight;
	return {
		x: Math.min(Math.max(0, evt.clientX - rect.left), width),
		y: Math.min(Math.max(0, evt.clientY - rect.top), height),
	};
}

/**
 * CSS pixels -> canvas backing-store pixels. pdf.js renders the canvas at
 * `viewport.width * outputScale`, so this is the device pixel ratio (and any
 * extra resolution the viewer chose), which is what makes the crop sharp.
 */
function cropScale(canvas: HTMLCanvasElement, overlay: HTMLElement): { x: number; y: number } {
	return {
		x: canvas.width / Math.max(1, overlay.clientWidth),
		y: canvas.height / Math.max(1, overlay.clientHeight),
	};
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

		const detachDrag = () => {
			doc.removeEventListener("pointermove", onPointerMove, true);
			doc.removeEventListener("pointerup", onPointerUp, true);
			doc.removeEventListener("pointercancel", onPointerCancel, true);
		};

		const cleanup = () => {
			detachDrag();
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

		const onPointerCancel = () => {
			onHint?.("已取消截图。");
			finish(null);
		};

		const onPointerMove = (evt: PointerEvent) => {
			if (!drag || !box) return;
			evt.preventDefault();
			const point = localPoint(evt, drag.overlay);
			const x = Math.min(startX, point.x);
			const y = Math.min(startY, point.y);
			box.style.left = `${x}px`;
			box.style.top = `${y}px`;
			box.style.width = `${Math.abs(point.x - startX)}px`;
			box.style.height = `${Math.abs(point.y - startY)}px`;
		};

		const onPointerUp = (evt: PointerEvent) => {
			const current = drag;
			if (!current) {
				finish(null);
				return;
			}
			evt.preventDefault();

			const point = localPoint(evt, current.overlay);
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
			const scale = cropScale(canvas, current.overlay);
			const sx = Math.min(Math.max(0, Math.round(x * scale.x)), Math.max(0, canvas.width - 1));
			const sy = Math.min(Math.max(0, Math.round(y * scale.y)), Math.max(0, canvas.height - 1));
			const sw = Math.max(1, Math.min(canvas.width - sx, Math.round(w * scale.x)));
			const sh = Math.max(1, Math.min(canvas.height - sy, Math.round(h * scale.y)));
			if (sw < 1 || sh < 1) {
				onHint?.("截图区域太小，已取消。");
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
			// Drop the rubber band before the crop is finalised so it can never
			// end up inside the image.
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
			const overlay = evt.currentTarget as HTMLElement | null;
			if (!overlay) return;
			const pageEl = overlay.parentElement;
			if (!pageEl || !pageEl.classList.contains("page")) return;
			const canvas = pageCanvas(pageEl);
			if (!canvas) return;

			evt.preventDefault();
			evt.stopPropagation();

			// Set the drag state BEFORE reading the point: the helpers below are
			// written to work off the live drag.
			drag = { pageEl, overlay, canvas };
			const point = localPoint(evt, overlay);
			startX = point.x;
			startY = point.y;

			box = doc.createElement("div");
			box.className = SHOT_BOX_CLASS;
			box.style.left = `${startX}px`;
			box.style.top = `${startY}px`;
			box.style.width = "0px";
			box.style.height = "0px";
			overlay.appendChild(box);

			// Track on the document, not the overlay, so a drag that leaves the
			// page still updates and still ends cleanly.
			doc.addEventListener("pointermove", onPointerMove, true);
			doc.addEventListener("pointerup", onPointerUp, true);
			doc.addEventListener("pointercancel", onPointerCancel, true);
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
