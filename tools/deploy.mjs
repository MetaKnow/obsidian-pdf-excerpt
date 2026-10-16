#!/usr/bin/env node
/**
 * Copies the freshly built plugin into the vault's plugin folder — a local
 * `npm run build` writes to the repo root, which is NOT what Obsidian loads.
 *
 * Target resolution order: `--to <dir>`, $OBSIDIAN_PLUGIN_DIR, then the
 * gitignored `.deploy-target` file at the repo root.
 */
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["main.js", "manifest.json", "styles.css"];

function pickTarget() {
	const flag = process.argv.indexOf("--to");
	if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
	if (process.env.OBSIDIAN_PLUGIN_DIR) return process.env.OBSIDIAN_PLUGIN_DIR;
	const file = join(root, ".deploy-target");
	if (existsSync(file)) {
		const value = readFileSync(file, "utf8").trim();
		if (value) return value;
	}
	return null;
}

const target = pickTarget();
if (!target) {
	console.error(
		"没有部署目标。请用 --to <仓库插件目录>、环境变量 OBSIDIAN_PLUGIN_DIR，" +
			"或在仓库根目录写一个 .deploy-target 文件（已 gitignore）。",
	);
	process.exit(1);
}
if (!existsSync(target) || !statSync(target).isDirectory()) {
	console.error(`部署目标不是目录：${target}`);
	process.exit(1);
}

for (const name of FILES) {
	const from = join(root, name);
	if (!existsSync(from)) {
		console.error(`缺少构建产物 ${name}，先跑一次 \`npm run build\`。`);
		process.exit(1);
	}
	copyFileSync(from, join(target, name));
	console.log(`\u2192 ${join(target, name)}`);
}
console.log(`已部署 ${FILES.length} 个文件。回到 Obsidian 执行「重新加载应用」（Ctrl/Cmd+P）。`);
