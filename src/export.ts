/**
 * Exporting every excerpt in the vault into a single standalone document.
 * Pure rendering: reading the vault is separated from formatting so the
 * formatters can be unit tested without Obsidian.
 */

import { App } from "obsidian";
import { EXCERPT_TYPE, formatTimestamp, normalizeExcerptText, parseExcerptFile } from "./excerpt-markdown";

export type ExportFormat = "md" | "csv" | "json" | "html";

export const EXPORT_FORMATS: ExportFormat[] = ["md", "csv", "json", "html"];

export interface ExportExcerpt {
	page: number;
	text: string;
	created: number;
}

export interface ExportRecord {
	source: string;
	title: string;
	excerpts: ExportExcerpt[];
}

export function renderExportFileName(format: ExportFormat, now = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
	return `PDF摘录汇总-${stamp}.${format}`;
}

/** Reads every `type: pdf-excerpt` note in the vault. */
export async function collectExportRecords(app: App): Promise<ExportRecord[]> {
	const records: ExportRecord[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter || frontmatter.type !== EXCERPT_TYPE) continue;
		let content: string;
		try {
			content = await app.vault.cachedRead(file);
		} catch {
			continue;
		}
		const data = parseExcerptFile(content);
		if (!data.excerpts.length) continue;
		records.push({
			source: data.source || file.path,
			title: data.title || file.basename,
			excerpts: data.excerpts
				.slice()
				.sort((a, b) => a.page - b.page || a.created - b.created)
				.map((e) => ({ page: e.page, text: e.text, created: e.created })),
		});
	}

	records.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
	return records;
}

export function countExcerpts(records: ExportRecord[]): number {
	return records.reduce((sum, r) => sum + r.excerpts.length, 0);
}

/* ------------------------------- markdown ------------------------------- */

function mdQuote(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => (line.length ? `> ${line}` : ">"))
		.join("\n");
}

export function renderMarkdown(records: ExportRecord[], now = new Date()): string {
	const out: string[] = [];
	out.push("---");
	out.push("type: pdf-excerpt-export");
	out.push(`count: ${countExcerpts(records)}`);
	out.push(`sources: ${records.length}`);
	out.push(`created: ${JSON.stringify(now.toISOString())}`);
	out.push("---");
	out.push("");
	out.push("# PDF 摘录汇总");
	out.push("");

	if (!records.length) {
		out.push("_仓库中没有任何 PDF 摘录。_");
		return out.join("\n");
	}

	for (const record of records) {
		out.push(`## ${record.title}`);
		out.push("");
		out.push(`来源：[[${record.source}]] · 共 ${record.excerpts.length} 条`);
		out.push("");
		for (const excerpt of record.excerpts) {
			out.push(`> [!quote] 第 ${excerpt.page} 页 · ${formatTimestamp(excerpt.created)}`);
			out.push(mdQuote(excerpt.text));
			out.push("");
		}
	}
	return out.join("\n");
}

/* ---------------------------------- csv ---------------------------------- */

function csvCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

export function renderCsv(records: ExportRecord[]): string {
	const rows: string[] = [];
	rows.push(["来源文件", "标题", "页码", "摘录", "摘录时间"].map(csvCell).join(","));
	for (const record of records) {
		for (const excerpt of record.excerpts) {
			rows.push(
				[
					csvCell(record.source),
					csvCell(record.title),
					csvCell(String(excerpt.page)),
					csvCell(normalizeExcerptText(excerpt.text)),
					csvCell(formatTimestamp(excerpt.created)),
				].join(","),
			);
		}
	}
	// BOM so Excel opens the Chinese headers correctly.
	return `\uFEFF${rows.join("\r\n")}\r\n`;
}

/* ---------------------------------- json --------------------------------- */

export function renderJson(records: ExportRecord[], now = new Date()): string {
	return `${JSON.stringify(
		{
			type: EXCERPT_TYPE,
			exported: now.toISOString(),
			sources: records.length,
			count: countExcerpts(records),
			records,
		},
		null,
		2,
	)}\n`;
}

/* ---------------------------------- html --------------------------------- */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function renderHtml(records: ExportRecord[], now = new Date()): string {
	const body: string[] = [];
	for (const record of records) {
		body.push('<section class="source">');
		body.push(`<h2>${escapeHtml(record.title)}</h2>`);
		body.push(
			`<p class="meta">${escapeHtml(record.source)} · ${record.excerpts.length} 条摘录</p>`,
		);
		for (const excerpt of record.excerpts) {
			body.push('<blockquote class="excerpt">');
			body.push(
				`<div class="head">第 ${excerpt.page} 页 · ${escapeHtml(formatTimestamp(excerpt.created))}</div>`,
			);
			body.push(`<p>${escapeHtml(excerpt.text).replace(/\n/g, "<br>")}</p>`);
			body.push("</blockquote>");
		}
		body.push("</section>");
	}

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF 摘录汇总</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0 auto; padding: 3rem 1.25rem 6rem; max-width: 46rem;
         font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 1.9rem; margin: 0 0 0.25rem; }
  .generated { color: #888; font-size: 0.875rem; margin: 0 0 2.5rem; }
  h2 { font-size: 1.25rem; margin: 2.5rem 0 0.25rem; padding-top: 1.25rem; border-top: 1px solid #8883; }
  .meta { color: #888; font-size: 0.8125rem; margin: 0 0 1rem; word-break: break-all; }
  .excerpt { margin: 0 0 1rem; padding: 0.25rem 0 0.25rem 1rem; border-left: 3px solid #ffd400; }
  .excerpt .head { color: #888; font-size: 0.75rem; margin-bottom: 0.25rem; }
  .excerpt p { margin: 0; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>PDF 摘录汇总</h1>
<p class="generated">${escapeHtml(formatTimestamp(now.getTime()))} · ${countExcerpts(records)} 条摘录，来自 ${records.length} 个 PDF</p>
${body.join("\n")}
</body>
</html>
`;
}

export function renderExport(records: ExportRecord[], format: ExportFormat, now = new Date()): string {
	switch (format) {
		case "csv":
			return renderCsv(records);
		case "json":
			return renderJson(records, now);
		case "html":
			return renderHtml(records, now);
		case "md":
		default:
			return renderMarkdown(records, now);
	}
}

/** Convenience helper used by the command palette entry. */
export async function buildExport(
	app: App,
	format: ExportFormat,
	now = new Date(),
): Promise<{ content: string; fileName: string; records: ExportRecord[] }> {
	const records = await collectExportRecords(app);
	return {
		content: renderExport(records, format, now),
		fileName: renderExportFileName(format, now),
		records,
	};
}
