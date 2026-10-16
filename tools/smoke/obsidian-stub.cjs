/**
 * A minimal stand-in for the `obsidian` module, good enough to load the built
 * `main.js` under jsdom and drive the plugin's real code paths.
 *
 * It is intentionally strict about the API surface the plugin actually uses:
 * if the plugin starts calling something new, the harness fails loudly instead
 * of silently succeeding.
 */

class TAbstractFile {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").pop();
		this.parent = null;
	}
}

class TFile extends TAbstractFile {
	constructor(path, content = "") {
		super(path);
		this.basename = this.name.replace(/\.[^.]+$/, "");
		this.extension = this.name.includes(".") ? this.name.split(".").pop() : "";
		this._content = content;
		this.stat = { ctime: 1, mtime: 1, size: content.length };
	}
}

class TFolder extends TAbstractFile {
	constructor(path) {
		super(path);
		this.children = [];
	}
}

class Emitter {
	constructor() {
		this._handlers = new Map();
	}
	on(name, cb) {
		const list = this._handlers.get(name) ?? [];
		list.push(cb);
		this._handlers.set(name, list);
		return { name, cb };
	}
	off(name, cb) {
		const list = this._handlers.get(name) ?? [];
		this._handlers.set(
			name,
			list.filter((h) => h !== cb),
		);
	}
	trigger(name, ...args) {
		for (const cb of this._handlers.get(name) ?? []) cb(...args);
	}
}

class Vault extends Emitter {
	constructor() {
		super();
		this.files = new Map();
		this.folders = new Map([["", new TFolder("")]]);
	}

	getAbstractFileByPath(path) {
		const key = normalizePath(path);
		if (this.files.has(key)) return this.files.get(key);
		if (this.folders.has(key)) return this.folders.get(key);
		return null;
	}

	getMarkdownFiles() {
		return [...this.files.values()].filter((f) => f.extension === "md");
	}

	getFiles() {
		return [...this.files.values()];
	}

	async createFolder(path) {
		const key = normalizePath(path);
		const segments = key.split("/").filter(Boolean);
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (this.folders.has(current)) continue;
			if (this.files.has(current)) throw new Error(`File exists: ${current}`);
			this.folders.set(current, new TFolder(current));
		}
		return this.folders.get(key);
	}

	async create(path, content) {
		const key = normalizePath(path);
		if (this.files.has(key)) throw new Error(`File already exists: ${key}`);
		const dir = key.split("/").slice(0, -1).join("/");
		if (dir && !this.folders.has(dir)) throw new Error(`Folder does not exist: ${dir}`);
		const file = new TFile(key, content);
		this.files.set(key, file);
		this.trigger("create", file);
		return file;
	}

	async modify(file, content) {
		file._content = content;
		file.stat = { ...file.stat, mtime: file.stat.mtime + 1, size: content.length };
		this.trigger("modify", file);
	}

	async read(file) {
		if (!this.files.has(file.path)) throw new Error(`ENOENT: ${file.path}`);
		return file._content;
	}

	async cachedRead(file) {
		return this.read(file);
	}

	async createBinary(path, data) {
		const key = normalizePath(path);
		if (this.files.has(key)) throw new Error(`File already exists: ${key}`);
		const dir = key.split("/").slice(0, -1).join("/");
		if (dir && !this.folders.has(dir)) throw new Error(`Folder does not exist: ${dir}`);
		const file = new TFile(key, "");
		file.binary = data;
		file.stat = { ...file.stat, size: data.byteLength ?? 0 };
		this.files.set(key, file);
		this.trigger("create", file);
		return file;
	}

	getResourcePath(file) {
		return `app://local/${encodeURIComponent(file.path)}`;
	}

	async delete(file) {
		this.files.delete(file.path);
		this.trigger("delete", file);
	}
}

class MetadataCache extends Emitter {
	constructor(vault) {
		super();
		this.vault = vault;
		this.frontmatter = new Map();
	}
	getFileCache(file) {
		const fm = this.frontmatter.get(file?.path);
		return fm ? { frontmatter: fm } : null;
	}
	getFirstLinkpathDest(linkpath) {
		const key = normalizePath(linkpath);
		if (this.vault.files.has(key)) return this.vault.files.get(key);
		for (const file of this.vault.files.values()) {
			if (file.path.endsWith(`/${key}`) || file.name === key) return file;
		}
		return null;
	}
}

class FileManager {
	constructor(app) {
		this.app = app;
	}
	/**
	 * Mirrors Obsidian: returns a path inside the configured attachment folder
	 * that does not exist yet, creating the folder as a side effect.
	 */
	async getAvailablePathForAttachment(filename, sourcePath = "") {
		const folder = "attachments";
		if (!this.app.vault.folders.has(folder)) await this.app.vault.createFolder(folder);
		const dot = filename.lastIndexOf(".");
		const stem = dot > 0 ? filename.slice(0, dot) : filename;
		const ext = dot > 0 ? filename.slice(dot) : "";
		let candidate = `${folder}/${filename}`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${folder}/${stem} ${n}${ext}`;
			n++;
		}
		return candidate;
	}

	generateMarkdownLink(file, sourcePath, subpath = "", alias = "") {
		const target = file.path.replace(/\.md$/, "");
		const body = alias ? `[[${target}${subpath}|${alias}]]` : `[[${target}${subpath}]]`;
		return body;
	}
}

class WorkspaceRibbon {
	/** Mirrors Obsidian: only the primary (left) ribbon gets an action row. */
	constructor(workspace, side) {
		this.side = side;
		this.containerEl = document.querySelector(`.workspace-ribbon.mod-${side}`);
		this.ribbonItemsEl = null;
		this.ribbonSettingEl = null;
		if (side === "left") {
			this.ribbonItemsEl = this.containerEl.createDiv("side-dock-actions");
			this.ribbonSettingEl = this.containerEl.createDiv("side-dock-settings");
		}
	}
}

class Workspace extends Emitter {
	constructor(app) {
		super();
		this.app = app;
		this.leaves = [];
		this.rightRibbon = new WorkspaceRibbon(this, "right");
		this.leftRibbon = new WorkspaceRibbon(this, "left");
		this.activeFile = null;
	}
	getLeavesOfType(type) {
		return this.leaves.filter((l) => l.view?.getViewType?.() === type);
	}
	getRightLeaf() {
		return this._newLeaf("right");
	}
	getLeaf() {
		return this._newLeaf("tab");
	}
	_newLeaf() {
		const leaf = {
			view: { getViewType: () => "empty", containerEl: document.createElement("div") },
			openFile: async (file) => {
				leaf._openPath = file.path;
				this.activeFile = file;
			},
			setViewState: async (state) => {
				leaf._state = state;
			},
		};
		this.leaves.push(leaf);
		return leaf;
	}
	revealLeaf() {}
	setActiveLeaf(leaf) {
		this.activeLeaf = leaf;
		if (leaf?.view?.file) this.activeFile = leaf.view.file;
	}
	detachLeavesOfType(type) {
		this.leaves = this.leaves.filter((l) => l.view?.getViewType?.() !== type);
	}
	getActiveFile() {
		return this.activeFile;
	}
	getMostRecentLeaf() {
		return this.leaves[this.leaves.length - 1] ?? null;
	}
}

/**
 * DataAdapter stub. The plugin only ever writes inside its own folder, and this
 * keeps an in-memory map so the harness can inspect geometry.json directly.
 */
class DataAdapter {
	constructor() {
		this.files = new Map();
	}
	async exists(path) {
		return this.files.has(normalizePath(path));
	}
	async read(path) {
		const key = normalizePath(path);
		if (!this.files.has(key)) throw new Error(`ENOENT: ${key}`);
		return this.files.get(key);
	}
	async write(path, data) {
		this.files.set(normalizePath(path), String(data));
	}
	async remove(path) {
		this.files.delete(normalizePath(path));
	}
}

class App {
	constructor() {
		this.vault = new Vault();
		this.metadataCache = new MetadataCache(this.vault);
		this.fileManager = new FileManager(this);
		this.vault.adapter = new DataAdapter();
		this.vault.configDir = ".obsidian";
		this.workspace = new Workspace(this);
		this.keymap = { pushScope() {}, popScope() {} };
		this.scope = {};
	}
}

/* ------------------------------------------------------------------ */
/* Public API surface used by the plugin                               */
/* ------------------------------------------------------------------ */

class Events {
	constructor() {
		this._registered = [];
	}
	registerEvent(ref) {
		this._registered.push(ref);
	}
	registerDomEvent(el, type, cb, opts) {
		el.addEventListener(type, cb, opts);
		this._registered.push({ el, type, cb, opts });
	}
	registerInterval(id) {
		this._registered.push(id);
		return id;
	}
}

class Component extends Events {}

class Plugin extends Component {
	constructor(app, manifest) {
		super();
		this.app = app;
		this.manifest = manifest;
		this.commands = [];
		this.views = [];
		this.ribbonIcons = [];
		this.settingTabs = [];
		this._data = null;
	}
	async loadData() {
		return this._data;
	}
	async saveData(data) {
		this._data = data;
	}
	addRibbonIcon(icon, title, callback) {
		const el = document.querySelector(".workspace-ribbon.mod-left .side-dock-actions").createDiv("clickable-icon");
		el.setAttribute("aria-label", title);
		el.setAttribute("data-icon", icon);
		el.addEventListener("click", callback);
		this.ribbonIcons.push({ icon, title, el, callback });
		return el;
	}
	registerView(type, factory) {
		this.views.push({ type, factory });
	}
	addSettingTab(tab) {
		this.settingTabs.push(tab);
	}
	addCommand(command) {
		this.commands.push(command);
	}
}

class MarkdownView {}

class ItemView extends Component {
	constructor(leaf) {
		super();
		this.leaf = leaf;
		this.containerEl = document.createElement("div");
		this.contentEl = this.containerEl.createDiv();
		this.actionsEl = this.containerEl.createDiv("view-actions");
	}
	addAction(icon, title, callback) {
		const el = this.actionsEl.createEl("button", { cls: "clickable-icon view-action" });
		el.setAttribute("aria-label", title);
		el.setAttribute("data-icon", icon);
		el.addEventListener("click", callback);
		return el;
	}
	getViewType() {
		return "item";
	}
	getDisplayText() {
		return "";
	}
	getIcon() {
		return "";
	}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}
	display() {}
}

function chainable(target, key) {
	return (...args) => {
		const record = { method: key, args };
		target._calls.push(record);
		return target;
	};
}

class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl;
		this._calls = [];
		for (const method of [
			"setName",
			"setDesc",
			"setClass",
			"setHeading",
			"setTooltip",
			"setDisabled",
			"setValue",
			"setPlaceholder",
			"setLimits",
			"addText",
			"addTextArea",
			"addToggle",
			"addColorPicker",
			"addDropdown",
			"addButton",
			"addExtraButton",
			"addSlider",
			"onChange",
		]) {
			this[method] = chainable(this, method);
		}
	}
}

class MenuItem {
	constructor() {
		this.title = "";
		this.icon = "";
		this.callback = null;
	}
	setTitle(title) {
		this.title = title;
		return this;
	}
	setIcon(icon) {
		this.icon = icon;
		return this;
	}
	setSection() {
		return this;
	}
	setChecked() {
		return this;
	}
	setDisabled() {
		return this;
	}
	onClick(cb) {
		this.callback = cb;
		return this;
	}
}

class Menu {
	constructor() {
		this.items = [];
		this.shownAt = null;
	}
	addItem(build) {
		const item = new MenuItem();
		build?.(item);
		this.items.push(item);
		return this;
	}
	addSeparator() {
		this.items.push({ separator: true });
		return this;
	}
	showAtMouseEvent(evt) {
		// Mirrors Obsidian: delegates to showAtPosition with `evt.doc`, which a
		// real MouseEvent does not carry.
		return this.showAtPosition({ x: evt?.clientX ?? 0, y: evt?.clientY ?? 0 }, evt?.doc);
	}
	showAtPosition(position, doc) {
		this.shownAt = { x: position?.x ?? 0, y: position?.y ?? 0 };
		this.shownIn = doc ?? null;
		Menu.instances.push(this);
		return this;
	}
}
Menu.instances = [];

class Notice {
	constructor(message) {
		this.message = message;
		Notice.instances.push(this);
	}
}
Notice.instances = [];

function normalizePath(path) {
	return String(path ?? "")
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/^\.\//, "");
}

function setIcon(el, icon) {
	el.setAttribute("data-icon", icon);
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "svg-icon");
	el.appendChild(svg);
}

module.exports = {
	App,
	Component,
	Events,
	FileManager,
	ItemView,
	MarkdownView,
	Menu,
	MetadataCache,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	Workspace,
	WorkspaceRibbon,
	normalizePath,
	setIcon,
	reset() {
		Menu.instances.length = 0;
		Notice.instances.length = 0;
	},
};
