/**
 * jsdom-backed browser environment with Obsidian's DOM helper extensions.
 *
 * Obsidian patches `HTMLElement.prototype` (and the global scope) with
 * `createDiv`, `createEl`, `empty`, `addClass`, … so plugin code may use them
 * freely. jsdom knows nothing about them, so we install a faithful-enough
 * subset here before loading the bundle.
 */

const { JSDOM } = require("jsdom");

function installDomEnvironment() {
	const dom = new JSDOM(
		`<!doctype html><html><head></head><body>
			<div class="workspace">
				<div class="workspace-ribbon side-dock-ribbon mod-left">
					<div class="side-dock-actions"></div>
					<div class="side-dock-settings"></div>
				</div>
				<div class="workspace-split mod-right-split"></div>
				<div class="workspace-ribbon side-dock-ribbon mod-right"></div>
			</div>
		</body></html>`,
		{ pretendToBeVisual: true, url: "app://obsidian.md" },
	);

	const { window } = dom;

	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLDivElement",
		"HTMLInputElement",
		"HTMLButtonElement",
		"SVGElement",
		"Event",
		"MouseEvent",
		"CustomEvent",
		"KeyboardEvent",
		"MutationObserver",
		"DOMParser",
		"NodeFilter",
		"Range",
		"getComputedStyle",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	]) {
		if (key in window) globalThis[key] = window[key];
	}
	globalThis.window = window;
	globalThis.document = window.document;
	globalThis.navigator = window.navigator;

	// jsdom has no ResizeObserver; the highlight layer only needs it as a no-op.
	if (!window.ResizeObserver) {
		class ResizeObserverStub {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
		window.ResizeObserver = ResizeObserverStub;
		globalThis.ResizeObserver = ResizeObserverStub;
	}

	const proto = window.HTMLElement.prototype;

	function applyInfo(el, info) {
		if (info === undefined || info === null) return;
		if (typeof info === "string") {
			el.className = info;
			return;
		}
		if (typeof info !== "object") return;
		if (info.cls) el.className = info.cls;
		if (info.text) el.textContent = info.text;
		if (info.attr) {
			for (const [k, v] of Object.entries(info.attr)) {
				if (v === null || v === false) el.removeAttribute(k);
				else el.setAttribute(k, String(v));
			}
		}
		if (info.title) el.setAttribute("title", info.title);
		if (info.type) el.setAttribute("type", info.type);
		if (info.placeholder) el.setAttribute("placeholder", info.placeholder);
		if (info.value !== undefined) el.value = info.value;
		if (info.href) el.setAttribute("href", info.href);
	}

	if (!proto.createEl) {
		proto.createEl = function createEl(tag, info, callback) {
			const el = this.ownerDocument.createElement(tag);
			applyInfo(el, info);
			this.appendChild(el);
			if (typeof callback === "function") callback(el);
			return el;
		};
		proto.createDiv = function createDiv(info, callback) {
			return this.createEl("div", info, callback);
		};
		proto.createSpan = function createSpan(info, callback) {
			return this.createEl("span", info, callback);
		};
		proto.empty = function empty() {
			while (this.firstChild) this.removeChild(this.firstChild);
			return this;
		};
		proto.detach = function detach() {
			this.parentNode?.removeChild(this);
			return this;
		};
		proto.setText = function setText(text) {
			this.textContent = text;
			return this;
		};
		proto.appendText = function appendText(text) {
			this.appendChild(this.ownerDocument.createTextNode(text));
			return this;
		};
		proto.addClass = function addClass(...classes) {
			this.classList.add(...classes.filter(Boolean));
			return this;
		};
		proto.removeClass = function removeClass(...classes) {
			this.classList.remove(...classes.filter(Boolean));
			return this;
		};
		proto.toggleClass = function toggleClass(classes, value) {
			const list = Array.isArray(classes) ? classes : [classes];
			for (const cls of list) this.classList.toggle(cls, value);
			return this;
		};
		proto.hasClass = function hasClass(cls) {
			return this.classList.contains(cls);
		};
		proto.setAttr = function setAttr(key, value) {
			if (value === null || value === false) this.removeAttribute(key);
			else this.setAttribute(key, String(value));
			return this;
		};
	}

	// Obsidian also exposes the helpers globally.
	globalThis.createEl = (tag, info, cb) => document.body.createEl(tag, info, cb);
	globalThis.createDiv = (info, cb) => document.body.createDiv(info, cb);
	globalThis.createSpan = (info, cb) => document.body.createSpan(info, cb);

	// jsdom ships no `CSS` object, but the highlight layer escapes excerpt ids
	// with `CSS.escape` (a real browser has it).
	if (!window.CSS) {
		window.CSS = {
			escape: (value) => String(value).replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (ch) => `\\${ch}`),
		};
	}
	globalThis.CSS = window.CSS;

	// The highlight layer schedules work on animation frames.
	if (!window.requestAnimationFrame) {
		window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
		window.cancelAnimationFrame = (id) => window.clearTimeout(id);
	}

	return { dom, window };
}

module.exports = { installDomEnvironment };
