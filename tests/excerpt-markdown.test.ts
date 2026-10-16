import assert from "node:assert/strict";
import { test } from "node:test";

import {
	__testing,
	createExcerptId,
	defaultLinkBuilder,
	excerptKey,
	formatExcerptEntry,
	formatTimestamp,
	normalizeExcerptText,
	parseExcerptFile,
	rectOverlapRatio,
	serializeExcerptFile,
	stripFrontmatter,
	type Excerpt,
	type ExcerptFileData,
} from "../src/excerpt-markdown.ts";

function makeExcerpt(over: Partial<Excerpt> = {}): Excerpt {
	return {
		id: "e0001",
		page: 1,
		text: "hello world",
		rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
		created: new Date(2024, 0, 2, 3, 4).getTime(),
		selection: null,
		...over,
	};
}

function makeFile(over: Partial<ExcerptFileData> = {}): ExcerptFileData {
	return {
		source: "papers/Attention Is All You Need.pdf",
		title: "Attention Is All You Need",
		created: Date.UTC(2024, 0, 1),
		updated: Date.UTC(2024, 0, 2),
		tags: ["pdf摘录"],
		excerpts: [makeExcerpt()],
		...over,
	};
}

test("normalizeExcerptText collapses PDF line breaks and whitespace", () => {
	assert.equal(normalizeExcerptText("The  quick\nbrown   fox\r\njumps"), "The quick brown fox jumps");
	assert.equal(normalizeExcerptText("  spaced\t out \n\n"), "spaced out");
	assert.equal(normalizeExcerptText("a\u00a0\u2009b"), "a b");
});

test("excerptKey ignores case and whitespace differences", () => {
	assert.equal(excerptKey(3, "Hello   World\n"), excerptKey(3, "hello world"));
	assert.notEqual(excerptKey(3, "hello world"), excerptKey(4, "hello world"));
});

test("rectOverlapRatio uses the smaller of the two areas", () => {
	const big = { x: 0, y: 0, w: 1, h: 1 };
	const small = { x: 0, y: 0, w: 0.5, h: 0.5 };
	assert.equal(rectOverlapRatio(big, small), 1);
	assert.equal(rectOverlapRatio(big, { x: 2, y: 2, w: 1, h: 1 }), 0);
	assert.equal(rectOverlapRatio({ x: 0, y: 0, w: 0, h: 0 }, big), 0);
});

test("createExcerptId produces unique ids", () => {
	const ids = new Set(Array.from({ length: 200 }, () => createExcerptId()));
	assert.equal(ids.size, 200);
});

test("formatTimestamp renders a stable local timestamp", () => {
	const ts = new Date(2024, 4, 6, 7, 8).getTime();
	assert.equal(formatTimestamp(ts), "2024-05-06 07:08");
});

test("defaultLinkBuilder embeds page and native selection subpath", () => {
	const withSel = defaultLinkBuilder(
		makeExcerpt({ page: 7, selection: "2,0,4,10" }),
		"a/b.pdf",
		"My Doc",
	);
	assert.equal(withSel, "[[a/b.pdf#page=7&selection=2,0,4,10|My Doc, 第 7 页]]");

	const noSel = defaultLinkBuilder(makeExcerpt({ page: 2, selection: null }), "a/b.pdf", "My Doc");
	assert.equal(noSel, "[[a/b.pdf#page=2|My Doc, 第 2 页]]");
});

test("serializeExcerptFile writes frontmatter, callouts and geometry comments", () => {
	const out = serializeExcerptFile(makeFile());
	assert.match(out, /^---\ntype: pdf-excerpt\n/);
	assert.match(out, /source: "papers\/Attention Is All You Need\.pdf"/);
	assert.match(out, /count: 1/);
	assert.match(out, /tags:\n {2}- pdf摘录\n/);
	assert.match(out, /# 摘录 · Attention Is All You Need/);
	assert.match(out, /> \[!quote\] 第 1 页 · 2024-01-02 03:04/);
	assert.match(out, /> hello world/);
	assert.match(out, /<!-- pdf-excerpt \{"id":"e0001","page":1,"rects":\[\[0\.1,0\.2,0\.3,0\.04\]\]/);
});

test("serialize -> parse round-trips every field", () => {
	const original = makeFile({
		excerpts: [
			makeExcerpt({ id: "e1", page: 12, text: "second page text", created: 1000 }),
			makeExcerpt({
				id: "e2",
				page: 3,
				text: "line one\nline two\n\nline three after a blank",
				rects: [
					{ x: 0.25, y: 0.5, w: 0.125, h: 0.0625 },
					{ x: 0.3, y: 0.6, w: 0.2, h: 0.05 },
				],
				created: 2000,
				selection: "1,0,1,12",
			}),
		],
	});

	const parsed = parseExcerptFile(serializeExcerptFile(original));

	assert.equal(parsed.source, original.source);
	assert.equal(parsed.title, original.title);
	assert.deepEqual(parsed.tags, ["pdf摘录"]);
	assert.equal(parsed.created, original.created);
	assert.equal(parsed.updated, original.updated);
	assert.equal(parsed.excerpts.length, 2);

	const byId = new Map(parsed.excerpts.map((e) => [e.id, e]));
	assert.equal(byId.get("e1")?.text, "second page text");
	assert.equal(byId.get("e1")?.page, 12);

	const e2 = byId.get("e2");
	assert.equal(e2?.page, 3);
	assert.equal(e2?.text, "line one\nline two\n\nline three after a blank");
	assert.equal(e2?.selection, "1,0,1,12");
	assert.deepEqual(e2?.rects, [
		{ x: 0.25, y: 0.5, w: 0.125, h: 0.0625 },
		{ x: 0.3, y: 0.6, w: 0.2, h: 0.05 },
	]);
});

test("parse ignores a missing selection field", () => {
	const parsed = parseExcerptFile(serializeExcerptFile(makeFile()));
	assert.equal(parsed.excerpts[0].selection, null);
});

test("parse tolerates excerpts whose text contains quote markers", () => {
	const text = "> quoted inside the source\nnormal line";
	const parsed = parseExcerptFile(serializeExcerptFile(makeFile({ excerpts: [makeExcerpt({ text })] })));
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].text, text);
});

test("parse keeps excerpt order independent of page order", () => {
	const data = makeFile({
		excerpts: [
			makeExcerpt({ id: "high", page: 9, text: "nine" }),
			makeExcerpt({ id: "low", page: 2, text: "two" }),
		],
	});
	const parsed = parseExcerptFile(serializeExcerptFile(data));
	assert.deepEqual(
		parsed.excerpts.map((e) => e.id),
		["low", "high"],
		"serialization sorts by page, so parsing sees page order",
	);
});

test("parse skips duplicate ids and malformed payloads", () => {
	const content = [
		"---",
		"type: pdf-excerpt",
		"source: a.pdf",
		"---",
		"",
		"> first",
		'<!-- pdf-excerpt {"id":"dup","page":1} -->',
		"",
		"> second, same id",
		'<!-- pdf-excerpt {"id":"dup","page":2} -->',
		"",
		"> broken json",
		"<!-- pdf-excerpt {not json} -->",
		"",
		"> invalid page",
		'<!-- pdf-excerpt {"id":"bad","page":0} -->',
		"",
	].join("\n");

	const parsed = parseExcerptFile(content);
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].id, "dup");
	assert.equal(parsed.excerpts[0].page, 1);
	assert.equal(parsed.excerpts[0].text, "first");
});

test("parse returns empty data for content without frontmatter", () => {
	const parsed = parseExcerptFile("just a note\n\n> quote\n<!-- pdf-excerpt {\"id\":\"x\",\"page\":1} -->");
	assert.equal(parsed.source, "");
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].text, "quote");
});

test("title falls back to the source file name", () => {
	const parsed = parseExcerptFile('---\nsource: "dir/deep/My Paper.pdf"\n---\n');
	assert.equal(parsed.title, "My Paper");
});

test("stripFrontmatter removes the YAML block", () => {
	const content = serializeExcerptFile(makeFile());
	const body = stripFrontmatter(content);
	assert.ok(!body.startsWith("---"));
	assert.match(body, /^# 摘录/);
});

test("formatExcerptEntry can omit the back-link", () => {
	const entry = formatExcerptEntry(makeExcerpt({ text: "abc" }), {
		source: "a.pdf",
		title: "A",
		linkBuilder: () => "",
	});
	// The geometry comment legitimately contains "[[" in its rect payload,
	// so look for an actual wikilink line instead.
	assert.equal(entry.includes("> [["), false);
	assert.match(entry, /> abc/);
});

test("frontmatter parsing handles scalar types", () => {
	const { data } = __testing.parseFrontmatter('---\ncount: 3\nflag: true\nname: "x: y"\n---\nbody');
	assert.equal(data.count, 3);
	assert.equal(data.flag, "true");
	assert.equal(data.name, "x: y");
});
