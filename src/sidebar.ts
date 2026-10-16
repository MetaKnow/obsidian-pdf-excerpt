/**
 * The side panel: the excerpt list of the active PDF.
 */

import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type PdfExcerptPlugin from "./main";
import { formatTimestamp, type Excerpt } from "./excerpt-markdown";

export const VIEW_TYPE_PDF_EXCERPT = "pdf-excerpt-view";

export class PdfExcerptSidebarView extends ItemView {
	private readonly plugin: PdfExcerptPlugin;
	private pdf: TFile | null = null;
	private excerpts: Excerpt[] = [];
	private filter = "";
	private listEl: HTMLElement | null = null;
	private headEl: HTMLElement | null = null;
	private footEl: HTMLElement | null = null;
	private refreshToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: PdfExcerptPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_PDF_EXCERPT;
	}

	getDisplayText(): string {
		return "PDF 摘录";
	}

	getIcon(): string {
		return "bookmark";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("pdf-excerpt-sidebar");

		this.headEl = this.contentEl.createDiv({ cls: "pdf-excerpt-sidebar-head" });
		this.listEl = this.contentEl.createDiv({ cls: "pdf-excerpt-list" });
		this.footEl = this.contentEl.createDiv({ cls: "pdf-excerpt-sidebar-foot" });

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.listEl = null;
		this.headEl = null;
		this.footEl = null;
	}

	/** Re-reads the store for whichever PDF is currently in focus. */
	async refresh(): Promise<void> {
		const token = ++this.refreshToken;
		const file = this.plugin.getActivePdfFile();
		this.pdf = file;
		let excerpts: Excerpt[] = [];
		if (file) {
			try {
				excerpts = await this.plugin.store.excerptsFor(file);
			} catch {
				excerpts = [];
			}
		}
		// A newer refresh started while we were reading.
		if (token !== this.refreshToken) return;
		this.excerpts = excerpts;
		this.render();
	}

	/** Re-renders without touching the vault. */
	render(): void {
		this.renderHead();
		this.renderList();
		this.renderFoot();
	}

	private renderHead(): void {
		const head = this.headEl;
		if (!head) return;
		head.empty();

		const titleRow = head.createDiv({ cls: "pdf-excerpt-title-row" });
		const title = titleRow.createDiv({ cls: "pdf-excerpt-title" });
		title.setText(this.pdf ? this.pdf.basename : "未打开 PDF");
		title.setAttr("aria-label", this.pdf ? this.pdf.path : "");
		if (this.pdf) title.setAttr("title", this.pdf.path);

		const actions = titleRow.createDiv({ cls: "pdf-excerpt-title-actions" });

		if (this.pdf) {
			const openNote = actions.createEl("button", { cls: "clickable-icon" });
			setIcon(openNote, "file-text");
			openNote.setAttr("aria-label", "打开摘录笔记");
			openNote.addEventListener("click", () => {
				if (this.pdf) void this.plugin.openExcerptNote(this.pdf);
			});
		}

		const exportBtn = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(exportBtn, "download");
		exportBtn.setAttr("aria-label", "导出全部摘录");
		exportBtn.addEventListener("click", () => void this.plugin.exportAll());

		const refreshBtn = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.setAttr("aria-label", "刷新");
		refreshBtn.addEventListener("click", () => void this.refresh());

		if (this.pdf && this.excerpts.length) {
			const search = head.createEl("input", { cls: "pdf-excerpt-search" });
			search.type = "search";
			search.placeholder = "筛选摘录…";
			search.value = this.filter;
			search.addEventListener("input", () => {
				this.filter = search.value;
				this.renderList();
			});
		}
	}

	private visibleExcerpts(): Excerpt[] {
		const needle = this.filter.trim().toLocaleLowerCase();
		const sorted = this.excerpts
			.slice()
			.sort((a, b) => a.page - b.page || a.created - b.created);
		if (!needle) return sorted;
		return sorted.filter(
			(e) => e.text.toLocaleLowerCase().includes(needle) || String(e.page) === needle,
		);
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();

		if (!this.pdf) {
			list.createDiv({
				cls: "pdf-excerpt-empty",
				text: "打开一个 PDF，选中文字后右键选择「加入摘录」。",
			});
			return;
		}

		if (!this.excerpts.length) {
			list.createDiv({
				cls: "pdf-excerpt-empty",
				text: "这个 PDF 还没有摘录。选中文字后右键即可加入。",
			});
			return;
		}

		const visible = this.visibleExcerpts();
		if (!visible.length) {
			list.createDiv({ cls: "pdf-excerpt-empty", text: "没有匹配的摘录。" });
			return;
		}

		for (const excerpt of visible) {
			list.appendChild(this.buildCard(excerpt));
		}
	}

	private buildCard(excerpt: Excerpt): HTMLElement {
		const card = createDiv({ cls: "pdf-excerpt-card" });
		card.dataset.excerptId = excerpt.id;

		const head = card.createDiv({ cls: "pdf-excerpt-card-head" });
		head.createSpan({ cls: "pdf-excerpt-page", text: `第 ${excerpt.page} 页` });
		head.createSpan({ cls: "pdf-excerpt-time", text: formatTimestamp(excerpt.created) });

		const actions = head.createDiv({ cls: "pdf-excerpt-card-actions" });

		const locate = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(locate, "crosshair");
		locate.setAttr("aria-label", "在 PDF 中定位");
		locate.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.plugin.locateExcerpt(excerpt);
		});

		const copy = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(copy, "copy");
		copy.setAttr("aria-label", "复制摘录文本");
		copy.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.plugin.copyExcerpt(excerpt);
		});

		const remove = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(remove, "trash-2");
		remove.setAttr("aria-label", "删除这条摘录");
		remove.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if (this.pdf) void this.plugin.removeExcerptFrom(this.pdf, excerpt.id);
		});

		const body = card.createDiv({ cls: "pdf-excerpt-card-text" });
		body.setText(excerpt.text);

		card.addEventListener("click", () => void this.plugin.locateExcerpt(excerpt));
		return card;
	}

	private renderFoot(): void {
		const foot = this.footEl;
		if (!foot) return;
		foot.empty();
		if (!this.pdf || !this.excerpts.length) return;
		const pages = new Set(this.excerpts.map((e) => e.page)).size;
		foot.setText(`共 ${this.excerpts.length} 条摘录 · 覆盖 ${pages} 页`);
	}
}
