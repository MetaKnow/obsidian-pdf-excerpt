import assert from "node:assert/strict";
import { test } from "node:test";

import {
	__testing,
	defaultLinkBuilder,
	excerptIdFor,
	excerptKey,
	formatExcerptEntry,
	formatTimestamp,
	normalizeExcerptText,
	parseExcerptFile,
	rectOverlapRatio,
	serializeExcerptFile,
	shortHash,
	stripFrontmatter,
	type Excerpt,
	type ExcerptFileData,
} from "../src/excerpt-markdown.ts";

/** Minute-aligned, so a rendered timestamp round-trips exactly. */
const T1 = new Date(2024, 0, 2, 3, 4).getTime();
const T2 = new Date(2024, 1, 3, 4, 5).getTime();

function makeExcerpt(over: Partial<Excerpt> = {}): Excerpt {
	return {
		id: "e0001",
		page: 1,
		text: "hello world",
		rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
		created: T1,
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

test("shortHash is stable, base36 and collision-free over a sample", () => {
	assert.equal(shortHash("papers/a.pdf"), shortHash("papers/a.pdf"));
	assert.notEqual(shortHash("papers/a.pdf"), shortHash("papers/b.pdf"));
	assert.match(shortHash("x"), /^[0-9a-z]+$/);
	assert.equal(new Set(Array.from({ length: 500 }, (_, i) => shortHash(`papers/${i}.pdf`))).size, 500);
});

test("excerptIdFor depends only on page + normalized text", () => {
	assert.equal(excerptIdFor(4, "Hello  World"), excerptIdFor(4, "hello world"));
	assert.notEqual(excerptIdFor(4, "hello world"), excerptIdFor(5, "hello world"));
	assert.notEqual(excerptIdFor(4, "hello world"), excerptIdFor(4, "hello worlds"));
	// Deriving the id is what lets the geometry file be keyed without the note
	// storing an id at all.
	assert.match(excerptIdFor(4, "hello world"), /^e[0-9a-z]+$/);
});

test("formatTimestamp renders a stable local timestamp", () => {
	assert.equal(formatTimestamp(new Date(2024, 4, 6, 7, 8).getTime()), "2024-05-06 07:08");
});

test("defaultLinkBuilder embeds page and native selection subpath", () => {
	const withSel = defaultLinkBuilder(makeExcerpt({ page: 7, selection: "2,0,4,10" }), "a/b.pdf", "My Doc");
	assert.equal(withSel, "[[a/b.pdf#page=7&selection=2,0,4,10|My Doc, 第 7 页]]");

	const noSel = defaultLinkBuilder(makeExcerpt({ page: 2, selection: null }), "a/b.pdf", "My Doc");
	assert.equal(noSel, "[[a/b.pdf#page=2|My Doc, 第 2 页]]");
});

test("serializeExcerptFile writes frontmatter and callouts", () => {
	const out = serializeExcerptFile(makeFile());
	assert.match(out, /^---\ntype: pdf-excerpt\n/);
	assert.match(out, /source: "papers\/Attention Is All You Need\.pdf"/);
	assert.match(out, /count: 1/);
	assert.match(out, /tags:\n {2}- pdf摘录\n/);
	assert.match(out, /# 摘录 · Attention Is All You Need/);
	assert.match(out, /> \[!quote\] 第 1 页 · 2024-01-02 03:04/);
	assert.match(out, /> hello world/);
});

test("the note carries no machine metadata at all", () => {
	const out = serializeExcerptFile(
		makeFile({
			excerpts: [
				makeExcerpt({ page: 26, rects: [{ x: 0.1354, y: 0.4583, w: 0.7609, h: 0.0171 }], selection: "36,0,48,21" }),
			],
		}),
	);
	assert.ok(!out.includes("<!--"), "no HTML comment may appear");
	assert.ok(!out.includes("pdf-excerpt {"), "no geometry payload may appear");
	assert.ok(!/\brects?\b/.test(stripFrontmatter(out)), "no rect data in the body");
	assert.ok(!out.includes("0.1354"), "no raw geometry numbers anywhere");
	// The one thing that legitimately stays is the native selection subpath,
	// because it lives inside the wikilink the user clicks.
	assert.match(out, /#page=26&selection=36,0,48,21\|/);
});

test("serialize -> parse round-trips the human-readable fields", () => {
	const original = makeFile({
		excerpts: [
			makeExcerpt({ page: 12, text: "second page text", created: T1 }),
			makeExcerpt({
				page: 3,
				text: "line one\nline two\n\nline three after a blank",
				rects: [
					{ x: 0.25, y: 0.5, w: 0.125, h: 0.0625 },
					{ x: 0.3, y: 0.6, w: 0.2, h: 0.05 },
				],
				created: T2,
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

	const [first, second] = parsed.excerpts;
	assert.equal(first.page, 3, "serialization sorts by page");
	assert.equal(first.text, "line one\nline two\n\nline three after a blank");
	assert.equal(first.created, T2);
	assert.equal(second.page, 12);
	assert.equal(second.text, "second page text");
	assert.equal(second.created, T1);
});

test("geometry is absent from a freshly parsed note (it lives in the plugin data file)", () => {
	const parsed = parseExcerptFile(serializeExcerptFile(makeFile()));
	assert.deepEqual(parsed.excerpts[0].rects, []);
	assert.equal(parsed.excerpts[0].selection, null);
});

test("parse tolerates excerpts whose text contains quote markers", () => {
	const text = "> quoted inside the source\nnormal line";
	const parsed = parseExcerptFile(serializeExcerptFile(makeFile({ excerpts: [makeExcerpt({ text })] })));
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].text, text);
});

test("parse reads excerpts written before the metadata was moved out", () => {
	// Exactly what 1.0.0 wrote: a callout blockquote followed by a geometry
	// comment. Parsing must still recover the geometry so it can be migrated.
	const content = [
		"---",
		"type: pdf-excerpt",
		'source: "papers/x.pdf"',
		'title: "x"',
		"---",
		"",
		"# 摘录 · x",
		"",
		"> [!quote] 第 26 页 · 2024-01-02 11:04",
		"> legacy text",
		">",
		"> [[papers/x.pdf#page=26|X, 第 26 页]]",
		"",
		'<!-- pdf-excerpt {"id":"ea50","page":26,"rects":[[0.1354,0.4583,0.7609,0.0171]],"created":1704164640000,"sel":"36,0,48,21"} -->',
		"",
	].join("\n");

	const parsed = parseExcerptFile(content);
	assert.equal(parsed.excerpts.length, 1);
	const [excerpt] = parsed.excerpts;
	assert.equal(excerpt.id, "ea50", "the stored id is reused so geometry keys still match");
	assert.equal(excerpt.page, 26);
	assert.equal(excerpt.text, "legacy text");
	assert.equal(excerpt.created, 1704164640000);
	assert.equal(excerpt.selection, "36,0,48,21");
	assert.deepEqual(excerpt.rects, [{ x: 0.1354, y: 0.4583, w: 0.7609, h: 0.0171 }]);
});

test("parse skips blocks with no text and de-duplicates repeated content", () => {
	const content = [
		"---",
		"type: pdf-excerpt",
		"source: a.pdf",
		"---",
		"",
		"> [!quote] 第 1 页 · 2024-01-02 03:04",
		"> repeated",
		"",
		"> [!quote] 第 1 页 · 2024-01-02 03:04",
		"> repeated",
		"",
		"> [!quote] 第 1 页 · 2024-01-02 03:04",
		"",
		"> [!quote] 第 2 页 · 2024-01-02 03:04",
		"> different page",
		"",
	].join("\n");

	const parsed = parseExcerptFile(content);
	assert.deepEqual(
		parsed.excerpts.map((e) => [e.page, e.text]),
		[
			[1, "repeated"],
			[2, "different page"],
		],
	);
});

test("parse ignores a callout with an unparseable page number", () => {
	const content = [
		"---",
		"type: pdf-excerpt",
		"source: a.pdf",
		"---",
		"",
		"> [!quote] 第 页 · 2024-01-02 03:04",
		"> orphaned",
		"",
		"> [!quote] 第 7 页 · 2024-01-02 03:04",
		"> kept",
		"",
	].join("\n");
	const parsed = parseExcerptFile(content);
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].page, 7);
});

test("parse returns empty data for content without frontmatter", () => {
	const parsed = parseExcerptFile("just a note\n\n> [!quote] 第 1 页\n> quote\n");
	assert.equal(parsed.source, "");
	assert.equal(parsed.excerpts.length, 1);
	assert.equal(parsed.excerpts[0].text, "quote");
});

test("title falls back to the source file name", () => {
	const parsed = parseExcerptFile('---\nsource: "dir/deep/My Paper.pdf"\n---\n');
	assert.equal(parsed.title, "My Paper");
});

test("stripFrontmatter removes the YAML block", () => {
	const body = stripFrontmatter(serializeExcerptFile(makeFile()));
	assert.ok(!body.startsWith("---"));
	assert.match(body, /^# 摘录/);
});

test("formatExcerptEntry can omit the back-link", () => {
	const entry = formatExcerptEntry(makeExcerpt({ text: "abc" }), {
		source: "a.pdf",
		title: "A",
		linkBuilder: () => "",
	});
	assert.equal(entry.includes("[["), false, "nothing but the quote and its text");
	assert.match(entry, /> abc/);
});

test("frontmatter parsing handles scalar types", () => {
	const { data } = __testing.parseFrontmatter('---\ncount: 3\nflag: true\nname: "x: y"\n---\nbody');
	assert.equal(data.count, 3);
	assert.equal(data.flag, "true");
	assert.equal(data.name, "x: y");
});
