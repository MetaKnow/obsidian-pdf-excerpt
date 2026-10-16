import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfExcerptPlugin from "./main";

export interface PdfExcerptSettings {
	/** Folder for the per-PDF markdown notes. Empty string = vault root. */
	excerptFolder: string;
	/** Folder for exported standalone notes. Empty string = vault root. */
	exportFolder: string;
	/** Open the note in the main area right after the first excerpt of a PDF. */
	openNoteOnFirstExcerpt: boolean;
	/** Open the excerpt note in reading view instead of the editor. */
	openNoteInReadingView: boolean;
	/** Briefly flash the excerpted region in the PDF as confirmation. */
	flashOnExcerpt: boolean;
	/** Colour of the in-PDF highlight. */
	highlightColor: string;
	/** Show a ribbon icon for the excerpt panel. */
	showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: PdfExcerptSettings = {
	excerptFolder: "摘录知识库",
	exportFolder: "摘录知识库/导出",
	openNoteOnFirstExcerpt: true,
	openNoteInReadingView: true,
	flashOnExcerpt: true,
	highlightColor: "#ffd400",
	showRibbonIcon: true,
};

export class PdfExcerptSettingTab extends PluginSettingTab {
	plugin: PdfExcerptPlugin;

	constructor(app: App, plugin: PdfExcerptPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("摘录文件夹")
			.setDesc("每个 PDF 对应的 Markdown 摘录笔记存放位置。留空表示仓库根目录。")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.excerptFolder)
					.setValue(this.plugin.settings.excerptFolder)
					.onChange(async (value) => {
						this.plugin.settings.excerptFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("导出文件夹")
			.setDesc("「导出摘录」功能生成的独立笔记存放位置。")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.exportFolder)
					.setValue(this.plugin.settings.exportFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("首次摘录时自动打开笔记")
			.setDesc("当某个 PDF 还没有摘录笔记时，第一次摘录后自动在主编辑区打开该笔记。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openNoteOnFirstExcerpt).onChange(async (value) => {
					this.plugin.settings.openNoteOnFirstExcerpt = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("以阅读视图打开摘录笔记")
			.setDesc("打开摘录笔记时默认使用阅读视图，而不是编辑模式。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openNoteInReadingView).onChange(async (value) => {
					this.plugin.settings.openNoteInReadingView = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("摘录后闪烁提示")
			.setDesc("摘录成功后在 PDF 中闪烁一下对应的位置。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.flashOnExcerpt).onChange(async (value) => {
					this.plugin.settings.flashOnExcerpt = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("高亮颜色")
			.setDesc("PDF 中摘录文本的高亮颜色。")
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.highlightColor).onChange(async (value) => {
					this.plugin.settings.highlightColor = value;
					await this.plugin.saveSettings();
					this.plugin.refreshHighlights();
				}),
			);

		new Setting(containerEl)
			.setName("显示侧边栏图标")
			.setDesc("在右侧边栏显示「PDF 摘录」面板按钮（左侧功能区也会保留一个图标）。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (value) => {
					this.plugin.settings.showRibbonIcon = value;
					await this.plugin.saveSettings();
					this.plugin.refreshRibbon();
				}),
			);
	}
}
