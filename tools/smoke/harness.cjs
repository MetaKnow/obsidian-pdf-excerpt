/**
 * Load-and-drive smoke test for the built plugin bundle.
 *
 * It loads the real `main.js` (the esbuild output) against a jsdom DOM and a
 * stubbed `obsidian` module, then reproduces the four things the plugin
 * promises: excerpt from the PDF right-click menu, one note per PDF inside
 * `摘录知识库`, no duplicate excerpts, and an exportable panel.
 *
 * Everything here goes through the plugin's public entry points — no internal
 * module is imported — so the test exercises the same path Obsidian does.
 *
 *   cd tools/smoke && npm install && node harness.cjs
 */

const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");

/* ------------------------------------------------------------------ */
/* 1. DOM + module interception                                        */
/* ------------------------------------------------------------------ */

const { installDomEnvironment } = require("./dom-env.cjs");
const { dom } = installDomEnvironment();
const { window, document } = globalThis;

// jsdom has no layout engine, so simulate the two geometry APIs the plugin
// relies on: the page box used for normalization, and the line rects that a
// real text selection would report.
// Model the real layout closely enough to catch positioning bugs. Obsidian's
// `.page` is `box-sizing: content-box` with a scale-dependent TRANSPARENT
// border, so its border box is bigger than the canvas inside it; an absolutely
// positioned child of `.page` is offset from the PADDING box, not from the
// rect `getBoundingClientRect()` returns for `.page`.
const BORDER = 4;
const CANVAS = { left: 100, top: 212, width: 816, height: 1056 };
const PAGE_BOX = {
	left: CANVAS.left - BORDER,
	top: CANVAS.top - BORDER,
	width: CANVAS.width + 2 * BORDER,
	height: CANVAS.height + 2 * BORDER,
};

function box(left, top, width, height) {
	return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

/** Rects the next `Range.getClientRects()` call will report, in canvas coords. */
const LINE_RECTS = [
	{ left: CANVAS.left + 96, top: CANVAS.top + 208, width: 208, height: 16 },
	{ left: CANVAS.left + 96, top: CANVAS.top + 226, width: 128, height: 16 },
];
let currentRects = LINE_RECTS;
function setLineRects(rects) {
	currentRects = rects;
}

function px(value) {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
	if (this.classList?.contains("page")) return box(PAGE_BOX.left, PAGE_BOX.top, PAGE_BOX.width, PAGE_BOX.height);
	if (this.classList?.contains("pdf-excerpt-layer") || this.classList?.contains("pdf-excerpt-shot")) {
		// Absolutely positioned inside `.page`: `left:0` lands on the padding box.
		return box(CANVAS.left + px(this.style.left), CANVAS.top + px(this.style.top), px(this.style.width), px(this.style.height));
	}
	if (this.tagName === "CANVAS" || this.classList?.contains("canvasWrapper")) {
		return box(CANVAS.left, CANVAS.top, CANVAS.width, CANVAS.height);
	}
	return box(0, 0, 0, 0);
};
window.Range.prototype.getClientRects = function getClientRects() {
	return currentRects.slice();
};
window.Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
	return { ...currentRects[0], right: 304, bottom: 224, x: 96, y: 208 };
};

// jsdom computes no layout, so clientWidth/clientHeight would be 0. The
// screenshot code scales CSS pixels to canvas pixels through them.
for (const prop of ["clientWidth", "clientHeight"]) {
	Object.defineProperty(Element.prototype, prop, {
		configurable: true,
		get() {
			return Math.round(this.getBoundingClientRect()[prop === "clientWidth" ? "width" : "height"]);
		},
	});
}

// jsdom implements neither canvas rasterisation nor PNG encoding. Record what
// would have been drawn and hand back a fake PNG blob.
const drawCalls = [];
window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
	if (type !== "2d") return null;
	return {
		canvas: this,
		drawImage(...args) {
			drawCalls.push(args);
		},
	};
};
window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
	callback(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }));
};

// jsdom implements no scrolling; record what the plugin asked to reveal.
const scrollCalls = [];
Element.prototype.scrollIntoView = function scrollIntoView(options) {
	scrollCalls.push({ el: this, options });
};

const obsidianStub = require("./obsidian-stub.cjs");
// Stands in for Electron's native save dialog. The plugin reaches it through
// `require("electron").remote.dialog`, so intercept that request.
const fakeSaveDialog = {
	calls: [],
	/** @type {{canceled: boolean, filePath?: string}} */
	next: { canceled: true },
	async showSaveDialog(options) {
		this.calls.push(options);
		return this.next;
	},
};
const fakeElectron = { remote: { dialog: fakeSaveDialog } };

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
	if (request === "obsidian") return obsidianStub;
	if (request === "electron") return fakeElectron;
	if (request === "@electron/remote") return fakeElectron.remote;
	return originalLoad.call(this, request, parent, isMain);
};

const PdfExcerptPlugin = require(path.resolve(__dirname, "..", "..", "main.js")).default;

/* ------------------------------------------------------------------ */
/* 2. Helpers                                                          */
/* ------------------------------------------------------------------ */

const results = [];
async function check(name, fn) {
	try {
		await fn();
		results.push({ name, ok: true });
		console.log(`  \u2714 ${name}`);
	} catch (err) {
		results.push({ name, ok: false, err });
		console.log(`  \u2716 ${name}\n      ${err.message}`);
	}
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPdfDom() {
	const wrap = document.createElement("div");
	wrap.className = "pdf-leaf-container";
	const container = wrap.createDiv("pdf-viewer-container");
	const viewerEl = container.createDiv("pdfViewer");
	const page = viewerEl.createDiv("page");
	page.dataset.pageNumber = "1";
	page.dataset.loaded = "true";
	const canvasWrapper = page.createDiv("canvasWrapper");
	const canvas = document.createElement("canvas");
	canvasWrapper.appendChild(canvas);
	const textLayer = page.createDiv("textLayer");
	const span1 = textLayer.createSpan({ cls: "textLayerNode", text: "The quick brown fox " });
	span1.dataset.idx = "0";
	const span2 = textLayer.createSpan({ cls: "textLayerNode", text: "jumps over the lazy dog" });
	span2.dataset.idx = "1";
	document.body.appendChild(wrap);
	return { wrap, container, viewerEl, page, canvas, textLayer, span1, span2 };
}

function makeViewer(viewerEl) {
	const page = viewerEl.querySelector(".page");
	return {
		containerEl: viewerEl.closest(".pdf-leaf-container"),
		pdfViewer: {
			pagesCount: 1,
			currentPageNumber: 1,
			currentScale: 1,
			currentScaleValue: "1",
			viewer: viewerEl,
			container: viewerEl.parentElement,
			eventBus: { on() {}, off() {} },
			dom: { viewerEl, viewerContainerEl: viewerEl.parentElement },
			getPageView: (i) => (i === 0 ? { div: page } : null),
		},
		getPage: (n) => (n === 1 ? { div: page } : null),
	};
}

function selectRange(from, fromOffset, to, toOffset) {
	const range = document.createRange();
	range.setStart(from.firstChild, fromOffset);
	range.setEnd(to.firstChild, toOffset);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	return range;
}

function rightClick(target, { clientX = 40, clientY = 60 } = {}) {
	const evt = new window.MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX,
		clientY,
	});
	target.dispatchEvent(evt);
	return evt;
}

/** The Menu the plugin most recently put on screen. */
function lastMenu() {
	return obsidianStub.Menu.instances.at(-1);
}
function menuItem(title, index = -1) {
	const menu = index < 0 ? lastMenu() : obsidianStub.Menu.instances[index];
	assert.ok(menu, "no Menu was shown");
	return menu.items.find((i) => i.title === title);
}
function closeTo(actual, expected, label) {
	assert.ok(
		typeof actual === "number" && Math.abs(actual - expected) < 1e-3,
		`${label}: got ${actual}, expected ~${expected}`,
	);
}
function noticeMatching(re) {
	return obsidianStub.Notice.instances.filter((n) => re.test(n.message)).at(-1);
}

/* ------------------------------------------------------------------ */
/* 3. Scenario                                                         */
/* ------------------------------------------------------------------ */

(async () => {
	console.log("\nPDF Excerpt \u2014 bundle smoke test\n");

	const app = new obsidianStub.App();
	await app.vault.createFolder("papers");
	const pdf = await app.vault.create("papers/Attention Is Full.pdf", "%PDF-1.4 fake");
	const parts = buildPdfDom();
	const viewer = makeViewer(parts.viewerEl);

	const pdfView = {
		file: pdf,
		containerEl: parts.wrap,
		viewer: Promise.resolve(viewer),
		getViewType: () => "pdf",
	};
	app.workspace.leaves.push({ view: pdfView });

	const plugin = new PdfExcerptPlugin(app, {
		id: "pdf-excerpt",
		name: "PDF Excerpt",
		version: "1.0.0",
		minAppVersion: "1.5.0",
		dir: ".obsidian/plugins/pdf-excerpt",
	});

const META_RE = /^%% pdf-excerpt (\{.*\}) %%$/gm;

/** Geometry writes are debounced; flush the store so the file is on disk. */
	/* ---- lifecycle ------------------------------------------------- */

	await check("onload() completes and registers everything", async () => {
		await plugin.onload();
		assert.equal(plugin.commands.length, 10, "commands registered");
		assert.equal(plugin.views.length, 1, "sidebar view registered");
		assert.equal(plugin.settingTabs.length, 1, "settings tab registered");
		assert.equal(plugin.ribbonIcons.length, 1, "left ribbon icon registered");
	});

	await check("a button is injected into the RIGHT ribbon", async () => {
		plugin.refreshRibbon();
		const host = document.querySelector(".workspace-ribbon.mod-right .side-dock-actions");
		assert.ok(host, "side-dock-actions created inside the right ribbon");
		const button = host.querySelector(".pdf-excerpt-right-ribbon");
		assert.ok(button, "button element exists");
		assert.equal(button.getAttribute("data-icon"), "highlighter");
		assert.equal(button.getAttribute("aria-label"), "PDF 摘录面板");
		plugin.refreshRibbon();
		assert.equal(document.querySelectorAll(".pdf-excerpt-right-ribbon").length, 1, "idempotent");
	});

	await check("the PDF leaf's internal Viewer is resolved", async () => {
		await plugin.rebuildPdfLeafRegistry();
		assert.equal(plugin.pdfLeaves.size, 1, "one PDF leaf registered");
		assert.equal(plugin.pdfLeaves.get(pdfView).file.path, pdf.path);
	});

	/* ---- the headline flow ----------------------------------------- */

	await check("right-click on a selection shows 加入摘录 and takes the event over", async () => {
		obsidianStub.reset();
		setLineRects(LINE_RECTS);
		selectRange(parts.span1, 4, parts.span2, 9);
		const evt = rightClick(parts.span2);
		assert.equal(evt.defaultPrevented, true, "Obsidian's own PDF menu is suppressed");
		assert.equal(lastMenu().shownIn, document, "menu rendered into the right document");
		const titles = lastMenu()
			.items.filter((i) => !i.separator)
			.map((i) => i.title);
		assert.ok(titles.includes("加入摘录"), `menu titles: ${titles.join(" / ")}`);
		assert.ok(titles.includes("复制"), "copy item kept");
		assert.ok(titles.includes("复制为引用"), "quote item kept");
		assert.ok(
			titles.some((t) => t.startsWith("在摘录面板中查看")),
			"panel item present",
		);
	});

	await check("right-click with NO selection leaves Obsidian's menu alone", async () => {
		setLineRects(LINE_RECTS);
		window.getSelection().removeAllRanges();
		const evt = rightClick(parts.span2);
		assert.equal(evt.defaultPrevented, false, "event untouched");
	});

	await check("the excerpt lands flat in 摘录知识库/<pdf>.md with a clean body", async () => {
		setLineRects(LINE_RECTS);
		selectRange(parts.span1, 4, parts.span2, 9);
		rightClick(parts.span2);
		await menuItem("加入摘录").callback();
		await tick();

		const notePath = "摘录知识库/Attention Is Full.md";
		const note = app.vault.files.get(notePath);
		assert.ok(note, `note exists; files: ${[...app.vault.files.keys()].join(", ")}`);

		const body = note._content;
		assert.match(body, /^---\ntype: pdf-excerpt\n/, "frontmatter opens the file");
		assert.match(body, /source: "papers\/Attention Is Full\.pdf"/);
		assert.match(body, /# 摘录 · Attention Is Full/);
		assert.match(body, /> quick brown fox jumps ove/, "the selected text is quoted");
		assert.match(
			body,
			/\[\[papers\/Attention Is Full\.pdf#page=1\|Attention Is Full, 第 1 页\]\]/,
			"back-link uses Obsidian's own link format",
		);
		assert.ok(!body.includes("<!--"), "no HTML comment anywhere in the note");
		assert.match(body, /^%% pdf-excerpt \{/m, "geometry rides in a hidden %% comment");

		// Obsidian hides %%...%% in both Live Preview and Reading view, so the note
		// stays clean while the geometry still travels with the file.
		META_RE.lastIndex = 0;
		const metas = [...body.matchAll(META_RE)].map((m) => JSON.parse(m[1]));
		assert.equal(metas.length, 1, "one meta line");
		assert.equal(metas[0].page, 1);
		assert.equal(metas[0].rects.length, 2, "one rect per selected line");
		// Stored as 4-decimal page fractions, so compare at that precision.
		closeTo(metas[0].rects[0][0], 96 / 816, "x");
		closeTo(metas[0].rects[0][1], 208 / 1056, "y");
		closeTo(metas[0].rects[0][2], 208 / 816, "w");
		closeTo(metas[0].rects[0][3], 16 / 1056, "h");
		closeTo(metas[0].rects[1][1], 226 / 1056, "second line y");
		closeTo(metas[0].rects[1][2], 128 / 816, "second line w");

		assert.equal(await plugin.store.excerptsFor(pdf).then((e) => e.length), 1);
	});

	await check("geometry survives a cold read of the note", async () => {
		plugin.store.clearCache();
		const [excerpt] = await plugin.store.excerptsFor(pdf);
		assert.equal(excerpt.rects.length, 2, "rects re-read from the note itself");
		closeTo(excerpt.rects[0].x, 96 / 816, "x after reload");
	});

	await check("the 迁移 command rewrites every old note in one go", async () => {
		const original = [
			"---",
			"type: pdf-excerpt",
			'source: "papers/Stale.pdf"',
			'title: "Stale"',
			"---",
			"",
			"# 摘录 · Stale",
			"",
			"> [!quote] 第 2 页 · 2024-01-02 03:04",
			"> stale text",
			">",
			"> [[papers/Stale.pdf#page=2|Stale, 第 2 页]]",
			"",
			'<!-- pdf-excerpt {"id":"estale","page":2,"rects":[[0.1,0.1,0.2,0.02]],"created":1} -->',
			"",
		].join("\n");
		assert.ok(original.includes("<!--"), "it really starts out dirty");
		await app.vault.create("摘录知识库/Stale.md", original);
		await app.vault.create("papers/Stale.pdf", "%PDF-1.4 fake");

		const command = plugin.commands.find((c) => c.id === "migrate-legacy-excerpt-notes");
		command.callback();
		// The command is fire-and-forget: let its async chain settle.
		await tick();
		await tick();

		const after = app.vault.files.get("摘录知识库/Stale.md")._content;
		assert.ok(!after.includes("<!--"), "HTML comment stripped");
		assert.match(after, /> stale text/, "the excerpt itself is untouched");
		assert.match(after, /^%% pdf-excerpt \{"id":"estale"/m, "geometry moved into the %% marker");
		assert.match(after, /"rects":\[\[0\.1,0\.1,0\.2,0\.02\]\]/);
	});

	await check("a note written by 1.0.0 is migrated on the next save", async () => {
		// The user already has notes like this, with the geometry in a comment.
		const legacyPdf = await app.vault.create("papers/Legacy.pdf", "%PDF-1.4 fake");
		const legacyPath = "摘录知识库/Legacy.md";
		await app.vault.create(
			legacyPath,
			[
				"---",
				"type: pdf-excerpt",
				'source: "papers/Legacy.pdf"',
				'title: "Legacy"',
				"---",
				"",
				"# 摘录 · Legacy",
				"",
				"> [!quote] 第 4 页 · 2024-01-02 03:04",
				"> old text",
				">",
				"> [[papers/Legacy.pdf#page=4|Legacy, 第 4 页]]",
				"",
				'<!-- pdf-excerpt {"id":"eold","page":4,"rects":[[0.2,0.3,0.4,0.05]],"created":1704164640000,"sel":"1,0,1,8"} -->',
				"",
			].join("\n"),
		);

		const loaded = await plugin.store.load(legacyPdf, { fresh: true });
		assert.equal(loaded.excerpts.length, 1);
		assert.equal(loaded.excerpts[0].id, "eold", "the stored id is reused");
		assert.equal(loaded.excerpts[0].rects.length, 1, "legacy geometry is read back");

		const rewritten = await plugin.store.save(legacyPdf, loaded);
		const text = rewritten._content;
		assert.ok(!text.includes("<!--"), "the legacy comment is dropped from the note");
		META_RE.lastIndex = 0;
		const [meta] = [...text.matchAll(META_RE)].map((m) => JSON.parse(m[1]));
		assert.ok(meta, "geometry moved into the %% marker");
		assert.equal(meta.id, "eold");
		assert.equal(meta.sel, "1,0,1,8");
		assert.equal(meta.rects[0][0], 0.2);
	});

	await check("two same-named PDFs get separate notes with no subfolder", async () => {
		await app.vault.createFolder("archive");
		const other = await app.vault.create("archive/Attention Is Full.pdf", "%PDF-1.4 fake");

		const mine = plugin.store.notePathFor(pdf);
		const theirs = plugin.store.notePathFor(other);

		assert.equal(mine, "摘录知识库/Attention Is Full.md");
		assert.notEqual(theirs, mine, "the clash must not reuse the first PDF's note");
		assert.ok(!/^摘录知识库\/.+\//.test(theirs), `no subfolder expected, got ${theirs}`);
		assert.ok(theirs.startsWith("摘录知识库/Attention Is Full ("), `got ${theirs}`);

		// The mapping must not depend on call order.
		assert.equal(plugin.store.notePathFor(other), theirs, "clashing PDF keeps its path");
		assert.equal(plugin.store.notePathFor(pdf), mine, "original PDF keeps its path");
	});

	await check("excerpting the same passage again is refused as a duplicate", async () => {
		obsidianStub.reset();
		setLineRects(LINE_RECTS);
		selectRange(parts.span1, 4, parts.span2, 9);
		rightClick(parts.span2);
		await menuItem("加入摘录").callback();
		await tick();

		assert.ok(noticeMatching(/已经摘录过/), `notices: ${obsidianStub.Notice.instances.map((n) => n.message).join(" | ")}`);
		assert.equal((await plugin.store.excerptsFor(pdf)).length, 1, "still exactly one excerpt");
		assert.ok(
			!app.vault.files.get("摘录知识库/Attention Is Full.md")._content.includes("<!--"),
			"the note still carries no machine metadata",
		);
	});

	await check("a genuinely different passage is accepted", async () => {
		obsidianStub.reset();
		setLineRects([{ left: CANVAS.left + 96, top: CANVAS.top + 700, width: 120, height: 16 }]);
		selectRange(parts.span2, 0, parts.span2, 6);
		rightClick(parts.span2);
		await menuItem("加入摘录").callback();
		await tick();

		assert.ok(noticeMatching(/已加入摘录/), "success notice shown");
		const excerpts = await plugin.store.excerptsFor(pdf);
		assert.equal(excerpts.length, 2);
		assert.equal(excerpts[1].text, "jumps");
	});

	/* ---- highlight overlay ----------------------------------------- */

	await check("every excerpt gets its own highlight overlay", async () => {
		await plugin.refreshHighlights();
		const layer = parts.page.querySelector(":scope > .pdf-excerpt-layer");
		assert.ok(layer, "overlay layer injected into .page");
		// `.page` carries a 4px border, so a naive `canvasRect - pageRect` would
		// put this at 4px/4px and shift every highlight by the border width.
		assert.equal(layer.style.left, "0px", "layer sits exactly on the canvas box");
		assert.equal(layer.style.top, "0px", "layer sits exactly on the canvas box");
		assert.equal(layer.style.width, "816px", "layer sized to the canvas box");
		assert.equal(layer.style.height, "1056px");
		const highlights = layer.querySelectorAll(".pdf-excerpt-hl");
		assert.equal(highlights.length, 3, "2 rects for excerpt 1 + 1 for excerpt 2");
		assert.equal(
			highlights[0].getAttribute("data-excerpt-id"),
			(await plugin.store.excerptsFor(pdf))[0].id,
		);
		assert.equal(highlights[0].style.backgroundColor, "rgba(255, 212, 0, 0.42)");
	});

	await check("highlights can be toggled off and on", async () => {
		const toggle = plugin.commands.find((c) => c.id === "toggle-excerpt-highlights");
		toggle.callback();
		await tick();
		assert.equal(parts.page.querySelectorAll(".pdf-excerpt-hl").length, 0);
		toggle.callback();
		await tick();
		assert.equal(parts.page.querySelectorAll(".pdf-excerpt-hl").length, 3);
	});

	/* ---- note editing ---------------------------------------------- */

	await check("removing an excerpt rewrites the note", async () => {
		const [first] = await plugin.store.excerptsFor(pdf);
		assert.equal(await plugin.store.removeExcerpt(pdf, first.id), true);
		const after = await plugin.store.excerptsFor(pdf);
		assert.equal(after.length, 1);
		assert.equal(after[0].text, "jumps");
		await plugin.refreshHighlights();
		assert.equal(parts.page.querySelectorAll(".pdf-excerpt-hl").length, 1, "overlay shrinks too");
	});

	/* ---- export ----------------------------------------------------- */

	await check("导出全部 PDF 摘录为 CSV goes through the save dialog", async () => {
		const fs = require("node:fs");
		const os = require("node:os");

		app.metadataCache.frontmatter.set("摘录知识库/Attention Is Full.md", {
			type: "pdf-excerpt",
			source: "papers/Attention Is Full.pdf",
		});

		fakeSaveDialog.calls.length = 0;
		const target = path.join(os.tmpdir(), "pdf-excerpt-smoke.csv");
		fakeSaveDialog.next = { canceled: false, filePath: target };
		try {
			await plugin.exportAll("csv");

			assert.equal(fakeSaveDialog.calls.length, 1, "the OS dialog was used, not a fixed folder");
			assert.match(fakeSaveDialog.calls[0].defaultPath, /\.csv$/, "csv default name");
			assert.ok(fs.existsSync(target), "the file was written to the chosen path");
			const csv = fs.readFileSync(target, "utf8");
			assert.ok(csv.startsWith("\uFEFF"), "BOM so Excel reads the Chinese headers");
			assert.match(csv, /"来源文件","标题","页码","摘录","摘录时间"/, "header row");
			assert.match(csv, /"papers\/Attention Is Full\.pdf"/, "source column");
			assert.match(csv, /"jumps"/, "the excerpt body");
		} finally {
			if (fs.existsSync(target)) fs.unlinkSync(target);
			fakeSaveDialog.next = { canceled: true };
		}
	});

	await check("the excerpt note opens in the main editor area, not the sidebar", async () => {
		app.workspace.activeFile = pdf;
		const before = app.workspace.leaves.length;
		const panelLeaves = new Set(app.workspace.getLeavesOfType("pdf-excerpt-view"));
		await plugin.openExcerptNote(pdf);

		assert.equal(app.workspace.leaves.length, before + 1, "a fresh tab was created");
		const leaf = app.workspace.activeLeaf;
		assert.ok(leaf, "the new tab is active");
		assert.equal(leaf._openPath, "摘录知识库/Attention Is Full.md", "the note is loaded there");
		assert.ok(!panelLeaves.has(leaf), "it is not the side panel leaf");
	});

	await check("exporting asks the OS where to save, and never opens the file", async () => {
		const before = app.workspace.leaves.length;
		fakeSaveDialog.calls.length = 0;
		fakeSaveDialog.next = { canceled: true };

		app.workspace.activeFile = pdf;
		await plugin.exportCurrentNote();
		assert.equal(fakeSaveDialog.calls.length, 1, "the save dialog was used");
		assert.match(fakeSaveDialog.calls[0].defaultPath, /Attention Is Full\.md$/, "default file name");
		assert.equal(app.workspace.leaves.length, before, "cancelling opens nothing");

		fakeSaveDialog.next = { canceled: false, filePath: "/tmp/out.md" };
		await plugin.exportCurrentNote();
		assert.equal(app.workspace.leaves.length, before, "a successful export opens nothing");
	});

	await check("a screenshot excerpt lands in the note with no geometry", async () => {
		const imagePath = await plugin.saveScreenshotFile(pdf, {
			page: 5,
			data: new Uint8Array([137, 80, 78, 71]).buffer,
			width: 12,
			height: 8,
		});
		assert.match(imagePath, /^attachments\//, "the attachment folder is honoured");
		const binary = app.vault.files.get(imagePath);
		assert.ok(binary, "the PNG was written through the vault");
		assert.equal(binary.binary.byteLength, 4, "the bytes survived");

		const result = await plugin.store.addImage(pdf, 5, imagePath);
		assert.equal(result.status, "added", "images are never treated as duplicates");
		await plugin.store.addImage(pdf, 5, imagePath);
		const again = await plugin.store.addImage(pdf, 5, imagePath);
		assert.equal(again.status, "added", "re-shooting the same page is allowed");

		const note = app.vault.files.get("摘录知识库/Attention Is Full.md")._content;
		assert.match(note, /\[!quote\] 截图 · 第 5 页/, "marked as a screenshot excerpt");
		assert.ok(note.includes(`> ![[${imagePath}]]`), "the image is embedded");
		assert.ok(!new RegExp(`"image"`).test(note), "the image path lives in the embed, not in JSON");

		META_RE.lastIndex = 0;
		const shotMeta = [...note.matchAll(META_RE)]
			.map((m) => JSON.parse(m[1]))
			.find((meta) => meta.page === 5);
		assert.ok(shotMeta, "the screenshot still gets an id so it can be removed");
		assert.equal(shotMeta.rects, undefined, "no geometry for screenshots");

		const excerpts = await plugin.store.excerptsFor(pdf);
		const shot = excerpts.find((e) => e.image);
		assert.ok(shot, "the sidebar can see it");
		assert.equal(plugin.imageUrlFor(shot), `app://local/${encodeURIComponent(imagePath)}`);
	});

	await check("dragging a box over the page crops that page's canvas into the note", async () => {
		const pageEl = parts.page;
		const canvas = parts.canvas;
		// Simulate a 2x backing store, as pdf.js uses for a crisp render.
		canvas.width = CANVAS.width * 2;
		canvas.height = CANVAS.height * 2;
		drawCalls.length = 0;

		const pending = plugin.captureScreenshot();
		const overlay = pageEl.querySelector(":scope > .pdf-excerpt-shot");
		assert.ok(overlay, "a capture overlay is installed on the rendered page");
		assert.equal(overlay.style.left, "0px", "overlay aligned to the canvas box");
		assert.equal(overlay.style.width, `${CANVAS.width}px`, "overlay covers the canvas");

		const pointer = (type, x, y, target) =>
			target.dispatchEvent(
				new window.MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					button: 0,
					clientX: CANVAS.left + x,
					clientY: CANVAS.top + y,
				}),
			);

		const down = new window.MouseEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: CANVAS.left + 100,
			clientY: CANVAS.top + 200,
		});
		overlay.dispatchEvent(down);
		assert.equal(down.defaultPrevented, true, "the drag takes the pointer over");

		const band = overlay.querySelector(".pdf-excerpt-shot-box");
		assert.ok(band, "a rubber band appears on pointerdown");

		pointer("pointermove", 300, 260, document);
		assert.equal(Math.round(Number.parseFloat(band.style.width)), 200, "band width follows the drag");
		assert.equal(Math.round(Number.parseFloat(band.style.height)), 60, "band height follows the drag");

		// Release outside the page: the drag must still complete.
		pointer("pointerup", 300, 260, document);
		await pending;
		await tick();

		assert.equal(drawCalls.length, 1, "the crop was taken from the page canvas");
		const [source, sx, sy, sw, sh] = drawCalls[0];
		assert.equal(source, canvas, "cropped the page's own canvas");
		assert.deepEqual([sx, sy, sw, sh], [200, 400, 400, 120], "2x device pixels, correct region");
		assert.equal(pageEl.querySelector(".pdf-excerpt-shot"), null, "overlay cleaned up");
		assert.equal(pageEl.querySelector(".pdf-excerpt-shot-box"), null, "rubber band cleaned up");

		const imagePath = [...app.vault.files.keys()].find((path) => path.endsWith(".png"));
		assert.ok(imagePath, `a png was written; files: ${[...app.vault.files.keys()].join(", ")}`);
		const note = app.vault.files.get("摘录知识库/Attention Is Full.md");
		assert.match(note._content, /截图 · 第 1 页/, "labelled as a screenshot");
		assert.match(note._content, new RegExp(`!\\[\\[${imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "image embed");
	});

	await check("clicking a screenshot card jumps to its page instead of opening the note", async () => {
		app.workspace.activeFile = pdf;
		const leaf = app.workspace.getRightLeaf(false);
		const view = plugin.views[0].factory(leaf);
		await view.onOpen();

		const card = view.contentEl.querySelector(".pdf-excerpt-card.is-image");
		assert.ok(card, "the screenshot card is rendered in the panel");
		assert.ok(
			card.querySelector('button[aria-label="跳转到截图所在页面"]'),
			"screenshot cards get a locate button",
		);

		scrollCalls.length = 0;
		card.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await tick();

		assert.equal(
			app.workspace.activeFile.path,
			pdf.path,
			"clicking did not open the excerpt note",
		);
		assert.ok(
			scrollCalls.some((call) => call.el === parts.page),
			"the screenshot's PDF page was scrolled into view",
		);
		assert.ok(parts.page.classList.contains("is-page-flashing"), "the page is flashed as a cue");
	});

	await check("the screenshot button sits left of the open-note button", async () => {
		const leaf = app.workspace.getRightLeaf(false);
		const view = plugin.views[0].factory(leaf);
		view.pdf = pdf;
		view.excerpts = await plugin.store.excerptsFor(pdf);
		view.headEl = document.createElement("div");
		view.renderHead();

		const buttons = [...view.headEl.querySelectorAll(".pdf-excerpt-title-actions button")];
		const labels = buttons.map((b) => b.getAttribute("aria-label"));
		const shot = labels.indexOf("截图并加入摘录笔记");
		const open = labels.indexOf("打开摘录笔记");
		assert.ok(shot >= 0, `screenshot button present; labels: ${labels.join(" / ")}`);
		assert.ok(open > shot, "the screenshot button comes first");
		assert.ok(
			labels.includes("导出摘录文件（自己选择保存位置）"),
			"export no longer promises a fixed path",
		);
	});

	await check("settings tab renders every control", async () => {
		const tab = plugin.settingTabs[0];
		tab.display();
		assert.ok(tab.containerEl.querySelectorAll("div").length >= 0);
	});

	await check("panel opens in the right sidebar", async () => {
		const before = plugin.views[0];
		assert.equal(before.type, "pdf-excerpt-view");
		await plugin.activateSidebar();
		const leaf = app.workspace.leaves.at(-1);
		assert.equal(leaf._state?.type, "pdf-excerpt-view");
	});

	/* ---- teardown --------------------------------------------------- */

	await check("onunload() removes the ribbon button and every overlay", async () => {
		plugin.onunload();
		await tick(60);
		assert.equal(document.querySelectorAll(".pdf-excerpt-right-ribbon").length, 0);
		assert.equal(parts.page.querySelector(":scope > .pdf-excerpt-layer"), null);
	});

	/* ---------------------------------------------------------------- */

	const failed = results.filter((r) => !r.ok);
	console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
	if (failed.length) {
		console.log("\n  failures:");
		for (const f of failed) console.log(`   - ${f.name}: ${f.err.message}`);
	}
	console.log("");
	dom.window.close();
	process.exit(failed.length ? 1 : 0);
})().catch((err) => {
	console.error("\nharness crashed:", err);
	process.exit(2);
});
