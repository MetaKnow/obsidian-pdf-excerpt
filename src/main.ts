/**
 * PDF 摘录 — excerpt PDFs into per-document markdown notes.
 *
 * Entry point: wires the settings, the excerpt store, the in-PDF highlight
 * overlays, the side panel and the PDF right-click menu together.
 */

import { Menu, Notice, Plugin, TFile, normalizePath, setIcon } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PdfExcerptSettingTab,
	type PdfExcerptSettings,
} from "./settings";
import { ExcerptStore, ensureVaultFolder, sanitizeFileName } from "./excerpt-store";
import {
	captureSelection,
	getPdfLeafViews,
	pdfPagesHostFrom,
	pdfViewerContainerFrom,
	resolvePdfViewer,
	type PdfLeafView,
	type PdfSelection,
	type PdfViewer,
	type PageExcerptSlice,
} from "./pdf-view";
import { PdfHighlightLayer } from "./highlight-layer";
import { VIEW_TYPE_PDF_EXCERPT, PdfExcerptSidebarView } from "./sidebar";
import { buildExport, countExcerpts, type ExportFormat } from "./export";
import { startScreenshot, type ScreenshotCapture } from "./screenshot";
import {
	defaultLinkBuilder,
	formatTimestamp,
	isImageExcerpt,
	normalizeExcerptText,
	type Excerpt,
} from "./excerpt-markdown";

interface PdfLeafInfo {
	file: TFile;
	viewer: PdfViewer;
}

interface HighlightTarget {
	host: HTMLElement;
	file: TFile;
}

interface LayerEntry {
	layer: PdfHighlightLayer;
	file: TFile;
}

interface MenuContext {
	container: HTMLElement;
	file: TFile;
	viewer: PdfViewer | null;
	view: PdfLeafView | null;
}

interface SaveDialogResult {
	canceled: boolean;
	filePath?: string;
}

interface SaveFilter {
	name: string;
	extensions: string[];
}

interface SaveDialogLike {
	showSaveDialog(options: {
		title?: string;
		defaultPath?: string;
		filters?: SaveFilter[];
	}): Promise<SaveDialogResult>;
}

/**
 * Obsidian runs plugins inside the Electron renderer, where `require` is
 * available. `electron.remote` was removed in Electron 14, so fall back to
 * `@electron/remote` — the same pair Obsidian itself uses.
 */
function electronSaveDialog(): SaveDialogLike | null {
	if (typeof require !== "function") return null;
	try {
		const electron = require("electron") as { remote?: { dialog?: SaveDialogLike } } | undefined;
		const dialog = electron?.remote?.dialog;
		if (dialog) return dialog;
	} catch (error) {
		console.warn("[pdf-excerpt] require('electron') 不可用", error);
	}
	try {
		const remote = require("@electron/remote") as { dialog?: SaveDialogLike } | undefined;
		return remote?.dialog ?? null;
	} catch (error) {
		console.warn("[pdf-excerpt] require('@electron/remote') 不可用", error);
		return null;
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

export default class PdfExcerptPlugin extends Plugin {
	settings: PdfExcerptSettings = { ...DEFAULT_SETTINGS };
	store!: ExcerptStore;

	/** Every live PDF leaf, with its resolved internal `Viewer`. */
	private pdfLeaves = new Map<PdfLeafView, PdfLeafInfo>();
	/** One highlight overlay per `.pdfViewer` page host (leaves and embeds). */
	private layers = new Map<HTMLElement, LayerEntry>();
	private refreshTimer: number | null = null;
	private highlightsVisible = true;
	private rightRibbonButton: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new ExcerptStore(
			this.app,
			() => ({ excerptFolder: this.settings.excerptFolder, tags: [] }),
			(excerpt, source, title) => this.buildExcerptLink(excerpt, source, title),
		);

		this.registerView(VIEW_TYPE_PDF_EXCERPT, (leaf) => new PdfExcerptSidebarView(leaf, this));
		this.addSettingTab(new PdfExcerptSettingTab(this.app, this));

		if (this.settings.showRibbonIcon) {
			this.addRibbonIcon("highlighter", "PDF 摘录面板", () => void this.activateSidebar());
		}
		this.refreshRibbon();

		this.registerCommands();
		this.registerPdfContextMenu();
		this.registerWorkspaceEvents();

		// Warm the PDF registry so the first right-click can act synchronously.
		this.scheduleRefresh();
	}

	onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.rightRibbonButton?.detach();
		this.rightRibbonButton = null;
		for (const entry of this.layers.values()) entry.layer.destroy();
		this.layers.clear();
		this.pdfLeaves.clear();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_PDF_EXCERPT);
	}

	/* ------------------------------------------------------------------ */
	/* Right-sidebar ribbon button                                         */
	/* ------------------------------------------------------------------ */

	/**
	 * Obsidian's ribbon wrapper only creates `.side-dock-actions` for the LEFT
	 * ribbon (`"primary"===side && (…createDiv("side-dock-actions")…)`), so
	 * `Plugin.addRibbonIcon` can never place a button on the right. The right
	 * ribbon element itself does exist (it is the last child of the workspace
	 * and is shown/hidden with the right sidebar), so we build its action row
	 * ourselves. Purely additive and wrapped in try/catch: if a future
	 * Obsidian release changes this DOM, only the extra button is lost.
	 */
	refreshRibbon(): void {
		if (!this.settings.showRibbonIcon) {
			this.rightRibbonButton?.detach();
			this.rightRibbonButton = null;
			return;
		}
		try {
			const ribbon = this.app.workspace.rightRibbon as
				| { containerEl?: HTMLElement; ribbonItemsEl?: HTMLElement | null }
				| undefined;
			const host = ribbon?.containerEl;
			if (!host) return;

			let actions = ribbon?.ribbonItemsEl ?? null;
			if (!actions || !actions.isConnected) {
				actions = host.querySelector<HTMLElement>(".side-dock-actions");
			}
			if (!actions) {
				actions = host.createDiv("side-dock-actions");
				const settings = host.querySelector(".side-dock-settings");
				if (settings) host.insertBefore(actions, settings);
			}

			actions.querySelectorAll(".pdf-excerpt-right-ribbon").forEach((n) => n.remove());
			const button = actions.createDiv("clickable-icon pdf-excerpt-right-ribbon");
			button.setAttribute("aria-label", "PDF 摘录面板");
			button.setAttribute("data-tooltip-position", "left");
			setIcon(button, "highlighter");
			button.addEventListener("click", (evt) => {
				evt.preventDefault();
				void this.activateSidebar();
			});
			this.rightRibbonButton = button;
		} catch (err) {
			console.error("[pdf-excerpt] 无法在右侧边栏创建按钮", err);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Settings                                                            */
	/* ------------------------------------------------------------------ */

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/* ------------------------------------------------------------------ */
	/* Commands + menu                                                     */
	/* ------------------------------------------------------------------ */

	private registerCommands(): void {
		this.addCommand({
			id: "excerpt-selection",
			name: "将选中的 PDF 文字加入摘录",
			checkCallback: (checking) => {
				const context = this.getActiveSelection();
				if (!context) return false;
				if (!checking) void this.addSelectionToExcerptNote(context.file, context.selection);
				return true;
			},
		});

		this.addCommand({
			id: "open-excerpt-note",
			name: "打开当前 PDF 的摘录笔记",
			checkCallback: (checking) => {
				const file = this.getActivePdfFile();
				if (!file) return false;
				if (!checking) void this.openExcerptNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "open-excerpt-panel",
			name: "打开 PDF 摘录面板",
			callback: () => void this.activateSidebar(),
		});

		this.addCommand({
			id: "toggle-excerpt-highlights",
			name: "显示 / 隐藏 PDF 中的摘录高亮",
			callback: () => this.toggleHighlights(),
		});

		const formats: { format: ExportFormat; label: string }[] = [
			{ format: "md", label: "Markdown" },
			{ format: "csv", label: "CSV" },
			{ format: "json", label: "JSON" },
			{ format: "html", label: "HTML" },
		];
		for (const { format, label } of formats) {
			this.addCommand({
				id: `export-excerpts-${format}`,
				name: `导出全部 PDF 摘录为 ${label}`,
				callback: () => void this.exportAll(format),
			});
		}

		this.addCommand({
			id: "screenshot-to-excerpt",
			name: "截图并加入摘录笔记",
			checkCallback: (checking) => {
				if (!this.activePdfTarget()) return false;
				if (!checking) void this.captureScreenshot();
				return true;
			},
		});

		this.addCommand({
			id: "migrate-legacy-excerpt-notes",
			name: "迁移旧版摘录笔记（改为隐藏的几何数据）",
			callback: () => void this.migrateLegacyNotes(),
		});
	}

	/**
	 * 1.0.0 stored each excerpt's geometry in a trailing HTML comment. Newer notes
	 * keep that data in the plugin's own data file; this rewrites the old ones.
	 */
	private async migrateLegacyNotes(): Promise<void> {
		try {
			const { migrated } = await this.store.migrateLegacyNotes();
			new Notice(
				migrated ? `已迁移 ${migrated} 篇摘录笔记，笔记中的几何注释已移除` : "没有需要迁移的摘录笔记",
			);
		} catch (error) {
			console.error("[pdf-excerpt] 迁移失败", error);
			new Notice("迁移摘录笔记失败，详情见控制台");
		}
	}

	private registerPdfContextMenu(): void {
		const handler = (evt: MouseEvent) => this.onPdfContextMenu(evt);
		this.registerDomEvent(document, "contextmenu", handler, true);
		// Popout windows have their own document.
		this.registerEvent(
			this.app.workspace.on("window-open", (_workspaceWindow, win) => {
				this.registerDomEvent(win.document, "contextmenu", handler, true);
			}),
		);
	}

	/**
	 * Obsidian's own PDF menu aborts when `defaultPrevented` is set, so a
	 * capture-phase listener that calls `preventDefault()` takes it over
	 * completely — but only when we actually have something to offer.
	 */
	private onPdfContextMenu(evt: MouseEvent): void {
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;

		const container = pdfViewerContainerFrom(target);
		if (!container) return;

		const context = this.resolveMenuContext(target, container);
		if (!context) return;

		const selection = captureSelection(container, context.viewer, context.view);
		if (!selection || !selection.slices.length) return;

		evt.preventDefault();

		const text = selection.slices.map((s) => s.text).join("\n\n");
		const pages = selection.slices.map((s) => s.page).join(", ");

		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("加入摘录")
				.setIcon("bookmark-plus")
				.onClick(() => void this.addSelectionToExcerptNote(context.file, selection)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("复制")
				.setIcon("copy")
				.onClick(() => void this.writeClipboard(text)),
		);
		menu.addItem((item) =>
			item
				.setTitle("复制为引用")
				.setIcon("quote")
				.onClick(() =>
					void this.writeClipboard(
						selection.slices
							.map((slice) => this.formatQuote(slice, context.file))
							.join("\n\n"),
					),
				),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(`在摘录面板中查看（第 ${pages} 页）`)
				.setIcon("list")
				.onClick(() => void this.activateSidebar()),
		);
		// `showAtMouseEvent` reads `evt.doc`, which a real MouseEvent does not
		// have, so it would bail to the main document and render a popout
		// window's menu in the wrong window. Pass the document explicitly.
		menu.showAtPosition({ x: evt.clientX, y: evt.clientY }, target.ownerDocument ?? document);
	}

	/** Resolves the PDF behind a `.pdf-viewer-container`, leaf or embed. */
	private resolveMenuContext(target: HTMLElement, container: HTMLElement): MenuContext | null {
		for (const [view, info] of this.pdfLeaves) {
			if (view.containerEl.contains(container)) {
				return { container, file: info.file, viewer: info.viewer, view };
			}
		}

		const embed = target.closest<HTMLElement>(".internal-embed[src]");
		const src = embed?.getAttribute("src");
		if (src) {
			const sourcePath = this.sourcePathForElement(container) ?? "";
			const dest = this.app.metadataCache.getFirstLinkpathDest(src.split("#")[0], sourcePath);
			if (dest instanceof TFile && /\.pdf$/i.test(dest.path)) {
				return { container, file: dest, viewer: null, view: null };
			}
		}

		// Fall back to a leaf whose DOM we have not resolved yet.
		const file = this.getActivePdfFile();
		if (file) return { container, file, viewer: null, view: null };
		return null;
	}

	private sourcePathForElement(el: HTMLElement): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as { file?: TFile; containerEl?: HTMLElement };
			if (view.containerEl?.contains(el)) return view.file?.path ?? "";
		}
		return null;
	}

	/** The markdown a user gets from "复制为引用" — no geometry comment. */
	private formatQuote(slice: PageExcerptSlice, file: TFile): string {
		const text = normalizeExcerptText(slice.text);
		const link = this.buildExcerptLink(
			{ id: "", page: slice.page, text, rects: [], created: Date.now(), selection: slice.selection },
			file.path,
			file.basename,
		);
		const lines = [`> [!quote] 第 ${slice.page} 页`, ...text.split("\n").map((l) => (l ? `> ${l}` : ">"))];
		if (link) lines.push(">", `> ${link}`);
		return lines.join("\n");
	}

	/* ------------------------------------------------------------------ */
	/* Core actions                                                        */
	/* ------------------------------------------------------------------ */

	getActivePdfFile(): TFile | null {
		const active = this.app.workspace.getActiveFile();
		if (active && /\.pdf$/i.test(active.path)) return active;

		const recent = this.app.workspace.getMostRecentLeaf?.();
		const recentView = recent?.view as unknown as PdfLeafView | undefined;
		if (recentView) {
			const info = this.pdfLeaves.get(recentView);
			if (info) return info.file;
		}

		const views = getPdfLeafViews(this.app);
		if (views.length === 1) return views[0].file ?? null;
		for (const view of views) {
			if (view.containerEl.isConnected) return view.file ?? null;
		}
		return null;
	}

	private getActiveSelection(): { file: TFile; selection: PdfSelection } | null {
		for (const [view, info] of this.pdfLeaves) {
			if (!view.containerEl.isConnected) continue;
			const container = pdfViewerContainerFrom(view.containerEl);
			if (!container) continue;
			const selection = captureSelection(container, info.viewer, view);
			if (selection && selection.slices.length) return { file: info.file, selection };
		}
		// Embedded PDFs cannot expose a Viewer, so try their containers too.
		for (const target of this.collectHighlightTargets()) {
			const container = pdfViewerContainerFrom(target.host);
			if (!container) continue;
			const selection = captureSelection(container, null, null);
			if (selection && selection.slices.length) return { file: target.file, selection };
		}
		return null;
	}

	async addSelectionToExcerptNote(file: TFile, selection: PdfSelection): Promise<void> {
		let result;
		try {
			result = await this.store.addSlices(file, selection.slices);
		} catch (err) {
			console.error("[pdf-excerpt] 写入摘录笔记失败", err);
			new Notice("摘录写入失败，请查看控制台。");
			return;
		}

		if (result.status === "empty") {
			new Notice("没有可摘录的文本。");
			return;
		}
		if (result.status === "duplicate") {
			new Notice("这段内容已经摘录过了。");
			this.scheduleRefresh();
			return;
		}

		const pages = Array.from(new Set(result.added.map((e) => e.page))).join(", ");
		const skipped = result.duplicates ? `，跳过 ${result.duplicates} 条重复` : "";
		new Notice(`已加入摘录（第 ${pages} 页，共 ${result.added.length} 条${skipped}）`);

		this.scheduleRefresh();

		if (this.settings.flashOnExcerpt) {
			const host = pdfPagesHostFrom(selection.container) ?? selection.container;
			const entry = this.layers.get(host);
			if (entry) {
				for (const excerpt of result.added) entry.layer.flashExcerpt(excerpt);
			}
		}

		if (this.settings.openNoteOnFirstExcerpt && result.noteCreated && result.noteFile) {
			await this.openNoteInMainArea(result.noteFile);
		}
	}

	async openExcerptNote(file: TFile): Promise<void> {
		const existing = this.store.getNoteFile(file);
		if (existing) {
			await this.openNoteInMainArea(existing);
			return;
		}
		const data = await this.store.load(file);
		if (!data.excerpts.length) {
			new Notice("这个 PDF 还没有摘录。选中文字后右键即可加入。");
			return;
		}
		const note = await this.store.save(file, data);
		await this.openNoteInMainArea(note);
	}

	/**
	 * Excerpt notes open as a normal tab in the main area. `getLeaf("tab")` is
	 * deliberate: `getLeaf(false)` would reuse the active leaf and replace the
	 * PDF the user is reading.
	 */
	private async openNoteInMainArea(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	async locateExcerpt(excerpt: Excerpt): Promise<void> {
		const file = this.getActivePdfFile();
		const layers = [...this.layers.entries()].filter(([host]) => host.isConnected);
		// Prefer the document the panel is showing, so locating never jumps a
		// different PDF that happens to have a page with the same number.
		const ordered = [
			...layers.filter(([, entry]) => entry.file && file && entry.file.path === file.path),
			...layers.filter(([, entry]) => !(entry.file && file && entry.file.path === file.path)),
		];
		for (const [, entry] of ordered) {
			if (await entry.layer.scrollTo(excerpt, true)) return;
		}
		if (file) new Notice("没有找到这条摘录对应的 PDF 页面，请先打开该 PDF。");
	}

	/** Resource URL for a screenshot excerpt, used by the sidebar preview. */
	imageUrlFor(excerpt: Excerpt): string {
		if (!excerpt.image) return "";
		const file = this.app.vault.getAbstractFileByPath(excerpt.image);
		return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
	}

	async copyExcerpt(excerpt: Excerpt): Promise<void> {
		await this.writeClipboard(isImageExcerpt(excerpt) ? `![[${excerpt.image}]]` : excerpt.text);
	}

	/** A region screenshot of the active PDF, appended to that PDF's note. */
	async captureScreenshot(): Promise<void> {
		const target = this.activePdfTarget();
		if (!target) {
			new Notice("请先打开一个 PDF，并等页面显示出来再截图。");
			return;
		}

		const capture = await startScreenshot(target.host, (message) => new Notice(message, 3000));
		if (!capture) return;

		try {
			const imagePath = await this.saveScreenshotFile(target.file, capture);
			const result = await this.store.addImage(target.file, capture.page, imagePath);
			if (result.status !== "added") {
				new Notice(`截图已保存到 ${imagePath}，但没能写入摘录笔记。`);
				this.scheduleRefresh();
				return;
			}
			new Notice(`已把第 ${capture.page} 页的截图加入摘录`);
			this.scheduleRefresh();
			if (this.settings.openNoteOnFirstExcerpt && result.noteCreated && result.noteFile) {
				await this.openNoteInMainArea(result.noteFile);
			}
		} catch (error) {
			console.error("[pdf-excerpt] 截图保存失败", error);
			new Notice("截图保存失败，详情见控制台。");
		}
	}

	/** Writes the PNG through the vault, honouring the user's attachment settings. */
	private async saveScreenshotFile(file: TFile, capture: ScreenshotCapture): Promise<string> {
		const stamp = formatTimestamp(Date.now()).replace(/[-: ]/g, "");
		const name = `${sanitizeFileName(file.basename)}-第${capture.page}页-${stamp}.png`;

		let path: string | null = null;
		try {
			path = await this.app.fileManager.getAvailablePathForAttachment(name, file.path);
		} catch (error) {
			console.warn("[pdf-excerpt] 无法按附件设置选择位置，改用摘录文件夹", error);
		}
		if (!path) {
			const folder = normalizePath(`${this.settings.excerptFolder.trim() || "摘录知识库"}/附件`);
			await ensureVaultFolder(this.app, folder);
			path = normalizePath(`${folder}/${name}`);
		}

		await this.app.vault.createBinary(path, capture.data);
		return path;
	}

	/** The open PDF's page host, so screenshots target what the user sees. */
	private activePdfTarget(): { file: TFile; host: HTMLElement } | null {
		const file = this.getActivePdfFile();
		if (!file) return null;
		for (const target of this.collectHighlightTargets()) {
			if (target.file?.path === file.path) return { file, host: target.host };
		}
		return null;
	}

	private async writeClipboard(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
		} catch (err) {
			console.error("[pdf-excerpt] 复制失败", err);
			new Notice("复制失败。");
		}
	}

	async removeExcerptFrom(file: TFile, id: string): Promise<void> {
		try {
			const removed = await this.store.removeExcerpt(file, id);
			if (!removed) {
				new Notice("这条摘录已经不存在了。");
			}
		} catch (err) {
			console.error("[pdf-excerpt] 删除摘录失败", err);
			new Notice("删除失败，请查看控制台。");
		}
		this.scheduleRefresh();
	}

	async exportAll(format: ExportFormat = "md"): Promise<void> {
		let payload;
		try {
			payload = await buildExport(this.app, format);
		} catch (err) {
			console.error("[pdf-excerpt] 导出失败", err);
			new Notice("导出失败，请查看控制台。");
			return;
		}

		if (!payload.records.length) {
			new Notice("仓库中还没有任何 PDF 摘录。");
			return;
		}

		try {
			const saved = await this.saveTextToDisk({
				defaultName: payload.fileName,
				content: payload.content,
			});
			if (!saved) return;
			new Notice(`已导出 ${countExcerpts(payload.records)} 条摘录 → ${saved}`);
		} catch (err) {
			console.error("[pdf-excerpt] 写出导出文件失败", err);
			new Notice("写出导出文件失败，请查看控制台。");
		}
	}

	/** Exports the open PDF's own excerpt note, wherever the user wants it. */
	async exportCurrentNote(): Promise<void> {
		const file = this.getActivePdfFile();
		if (!file) {
			new Notice("请先打开一个 PDF。");
			return;
		}
		const note = this.store.getNoteFile(file);
		if (!note) {
			new Notice("这个 PDF 还没有摘录笔记。");
			return;
		}
		try {
			const content = await this.app.vault.cachedRead(note);
			const saved = await this.saveTextToDisk({
				defaultName: `${note.basename}.md`,
				content,
				filters: [{ name: "Markdown", extensions: ["md"] }],
			});
			if (saved) new Notice(`已导出摘录文件 → ${saved}`);
		} catch (err) {
			console.error("[pdf-excerpt] 导出摘录文件失败", err);
			new Notice("导出摘录文件失败，请查看控制台。");
		}
	}

	/**
	 * Asks the OS where to put the file. Falls back to the vault export folder on
	 * platforms where Obsidian does not expose a dialog, so the feature never
	 * silently does nothing.
	 */
	private async saveTextToDisk(request: {
		defaultName: string;
		content: string;
		filters?: SaveFilter[];
	}): Promise<string | null> {
		const dialog = electronSaveDialog();
		if (dialog) {
			try {
				const result = await dialog.showSaveDialog({
					title: "选择保存位置",
					defaultPath: request.defaultName,
					filters: request.filters,
				});
				if (result.canceled || !result.filePath) return null;
				const fs = nodeFs();
				if (!fs) throw new Error("fs 不可用");
				await fs.promises.writeFile(result.filePath, request.content, "utf8");
				return result.filePath;
			} catch (err) {
				console.error("[pdf-excerpt] 写入所选位置失败，改用仓库导出文件夹", err);
			}
		}

		const folder = this.settings.exportFolder.trim();
		const path = normalizePath(folder ? `${folder}/${request.defaultName}` : request.defaultName);
		await ensureVaultFolder(this.app, folder);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, request.content);
		else await this.app.vault.create(path, request.content);
		return path;
	}

	/* ------------------------------------------------------------------ */
	/* Side panel                                                          */
	/* ------------------------------------------------------------------ */

	async activateSidebar(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_EXCERPT);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			for (const leaf of existing) void (leaf.view as PdfExcerptSidebarView).refresh?.();
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_PDF_EXCERPT, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private refreshSidebar(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_EXCERPT)) {
			void (leaf.view as PdfExcerptSidebarView).refresh?.();
		}
	}

	/* ------------------------------------------------------------------ */
	/* PDF registry + highlight overlays                                   */
	/* ------------------------------------------------------------------ */

	private registerWorkspaceEvents(): void {
		const bump = () => {
			this.refreshRibbon();
			this.scheduleRefresh();
		};
		this.registerEvent(this.app.workspace.on("layout-change", bump));
		this.registerEvent(this.app.workspace.on("active-leaf-change", bump));
		this.registerEvent(this.app.workspace.on("file-open", bump));
		this.registerEvent(this.app.workspace.on("window-open", bump));

		const onVaultChange = (file: unknown) => {
			if (file instanceof TFile) this.store.invalidate(file.path);
			this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", onVaultChange));
		this.registerEvent(this.app.vault.on("create", onVaultChange));
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.store.invalidate(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.store.invalidate(oldPath);
				this.store.invalidate(file.path);
				this.scheduleRefresh();
			}),
		);
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.pump();
		}, 250);
	}

	private async pump(): Promise<void> {
		await this.rebuildPdfLeafRegistry();
		await this.refreshHighlights();
		this.refreshSidebar();
	}

	private async rebuildPdfLeafRegistry(): Promise<void> {
		const seen = new Set<PdfLeafView>();
		for (const view of getPdfLeafViews(this.app)) {
			if (!view.containerEl.isConnected || !view.file) continue;
			seen.add(view);
			const known = this.pdfLeaves.get(view);
			if (known && known.file.path === view.file.path && known.viewer.pdfViewer) continue;
			const viewer = await resolvePdfViewer(view);
			if (!viewer) continue;
			this.pdfLeaves.set(view, { file: view.file, viewer });
		}
		for (const view of Array.from(this.pdfLeaves.keys())) {
			if (!seen.has(view)) this.pdfLeaves.delete(view);
		}
	}

	/** Every page host that should carry an overlay right now. */
	private collectHighlightTargets(): HighlightTarget[] {
		const targets: HighlightTarget[] = [];

		for (const [view, info] of this.pdfLeaves) {
			if (!view.containerEl.isConnected) continue;
			const host = pdfPagesHostFrom(view.containerEl);
			if (host) targets.push({ host, file: info.file });
		}

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as { file?: TFile; containerEl?: HTMLElement };
			if (!view.containerEl?.isConnected) continue;
			const sourcePath = view.file?.path ?? "";
			const embeds = view.containerEl.querySelectorAll<HTMLElement>(".internal-embed[src]");
			for (const embed of Array.from(embeds)) {
				const host = embed.querySelector<HTMLElement>(".pdfViewer");
				const src = embed.getAttribute("src");
				if (!host || !src) continue;
				const dest = this.app.metadataCache.getFirstLinkpathDest(src.split("#")[0], sourcePath);
				if (dest instanceof TFile && /\.pdf$/i.test(dest.path)) {
					targets.push({ host, file: dest });
				}
			}
		}

		return targets;
	}

	/** Re-reads excerpts and pushes them into every overlay. */
	async refreshHighlights(): Promise<void> {
		const targets = this.collectHighlightTargets();
		const live = new Set<HTMLElement>();

		for (const target of targets) {
			live.add(target.host);
			let entry = this.layers.get(target.host);
			if (!entry || entry.file.path !== target.file.path || !entry.layer.isConnected()) {
				entry?.layer.destroy();
				entry = {
					layer: new PdfHighlightLayer(target.host, { color: this.settings.highlightColor }),
					file: target.file,
				};
				this.layers.set(target.host, entry);
			}
			entry.layer.setColor(this.settings.highlightColor);
			if (!this.highlightsVisible) {
				entry.layer.setExcerpts([]);
				continue;
			}
			try {
				const excerpts = await this.store.excerptsFor(target.file);
				entry.layer.setExcerpts(excerpts);
			} catch (err) {
				console.error("[pdf-excerpt] 读取摘录失败", target.file.path, err);
				entry.layer.setExcerpts([]);
			}
		}

		for (const [host, entry] of Array.from(this.layers.entries())) {
			if (!live.has(host) || !host.isConnected) {
				entry.layer.destroy();
				this.layers.delete(host);
			}
		}
	}

	private toggleHighlights(): void {
		this.highlightsVisible = !this.highlightsVisible;
		if (!this.highlightsVisible) {
			for (const entry of this.layers.values()) entry.layer.setExcerpts([]);
		}
		void this.refreshHighlights();
		new Notice(this.highlightsVisible ? "已显示 PDF 摘录高亮。" : "已隐藏 PDF 摘录高亮。");
	}

	/* ------------------------------------------------------------------ */
	/* Links                                                               */
	/* ------------------------------------------------------------------ */

	/**
	 * Builds the back-link with Obsidian's own markdown-link generator so the
	 * result honours the user's "new link format" setting, and appends the
	 * native `#page=N&selection=…` subpath so Obsidian highlights the passage.
	 */
	private buildExcerptLink(excerpt: Excerpt, source: string, title: string): string {
		const dest = source ? this.app.vault.getAbstractFileByPath(normalizePath(source)) : null;
		const subpath = `#page=${excerpt.page}${excerpt.selection ? `&selection=${excerpt.selection}` : ""}`;
		if (dest instanceof TFile) {
			try {
				const alias = `${title || dest.basename}, 第 ${excerpt.page} 页`;
				return this.app.fileManager.generateMarkdownLink(dest, "", subpath, alias);
			} catch (err) {
				console.error("[pdf-excerpt] generateMarkdownLink 失败", err);
			}
		}
		return defaultLinkBuilder(excerpt, source, title);
	}
}
