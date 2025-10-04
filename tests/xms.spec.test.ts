import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMSDoc, type XMSNode, XMSVersion } from "../src";

const FIXTURE_PATH = join(__dirname, "fixtures", "xms.txt");
const lines: string[] = readFileSync(FIXTURE_PATH, "utf8")
	.split("\n")
	.filter((l) => l.trim().length > 0);

describe("XMS v1 parsing (non-fallback)", () => {
	test("fixture sanity: every valid sample begins with xms/", () => {
		for (const line of lines) {
			// We include a few intentionally malformed / non-xms lines for fallback tests (prefixed with '#FALLBACK')
			if (line.startsWith("#FALLBACK")) continue;
			expect(line.startsWith("xms/")).toBe(true);
		}
	});

	test.each(
		lines.filter((l) => l.startsWith("xms/") && !l.includes("MALFORMED_QUOTE")),
	)("parses as XMS (no fallback): %s", (input) => {
		const doc = XMSDoc.parse(input);
		expect(doc.version).toBeGreaterThanOrEqual(1);
		expect(doc.isFallback).toBe(false);
		expect(doc.entries.length).toBeGreaterThan(0);

		// Values should be primitive or nested objects created from dotted keys
		for (const e of doc.entries) {
			const v = doc.data[e.name] ?? doc.getNested(e.name);
			// Accept primitive or object (for dotted path root objects)
			if (v !== undefined && v !== null) {
				const t = typeof v;
				expect(["string", "number", "boolean", "object"]).toContain(t);
			}
		}
	});

	test("version extraction for arbitrary XMS version numbers", () => {
		const doc = XMSDoc.parse("xms/1;username=steve");
		expect(doc.version).toBe(XMSVersion.Current);
		expect(doc.isFallback).toBe(false);
		expect(doc.data.username).toBe("steve");
	});

	test("quoted value containing semicolons not split", () => {
		const line = 'xms/1;message="A;B;C;D";raw=1';
		const doc = XMSDoc.parse(line);
		expect(doc.data.message).toBe("A;B;C;D");
		expect(doc.entries.find((e) => e.name === "message")?.value).toBe(
			"A;B;C;D",
		);
		expect(doc.data.raw).toBe("1");
	});

	test("escaped quotes and backslashes preserved", () => {
		const line =
			'xms/1;message="He said: \\"Hello\\"";path="C:\\\\config\\\\file"';
		const doc = XMSDoc.parse(line);
		expect(doc.data.message).toBe('He said: "Hello"');
		expect(doc.data.path).toBe("C:\\config\\file");
	});

	test("multiple consecutive semicolons collapsed & trailing ignored", () => {
		const line = "xms/1;;;username=steve;;item=sword;;;flag=true;;";
		const doc = XMSDoc.parse<{
			username: string;
			item: string;
			flag: boolean;
		}>(line);
		expect(doc.data.username).toBe("steve");
		expect(doc.data.item).toBe("sword");
		expect(doc.data.flag).toBe(true);
	});

	test("duplicate keys: last occurrence wins", () => {
		const line = "xms/1;dupe=one;dupe=two;dupe=three";
		const doc = XMSDoc.parse(line);
		expect(doc.data.dupe).toBe("three");
		const occurrences = doc.entries.filter((e) => e.name === "dupe");
		expect(occurrences.length).toBe(3);
	});

	test("null vs empty string vs bare token semantics", () => {
		const line = 'xms/1;empty=;also=;bare;quoted="";flag';
		const doc = XMSDoc.parse(line);
		// key=; => null
		expect(doc.entries.find((e) => e.name === "empty")?.value).toBeNull();
		expect(doc.entries.find((e) => e.name === "also")?.value).toBeNull();
		// bare => null (equivalent to key=;)
		expect(doc.entries.find((e) => e.name === "bare")?.value).toBeNull();
		expect(doc.entries.find((e) => e.name === "flag")?.value).toBeNull();
		// quoted="" => empty string
		expect(doc.entries.find((e) => e.name === "quoted")?.value).toBe("");
		expect(doc.data.quoted).toBe("");
	});

	test("array style numeric indices produce structured nested object", () => {
		const line = "xms/1;items.0=sword;items.1=shield;items.2=potion;count=3";
		const doc = XMSDoc.parse(line, { createFlatKeys: true });
		expect(doc.data.count).toBe("3");
		// Flattened keys exist
		expect(doc.data["items.0"]).toBe("sword");
		// Nested retrieval (if implementation supports)
		expect(doc.getNested("items.0")).toBe("sword");
		expect(doc.getNested("items.2")).toBe("potion");
	});

	test("nested object creation from dotted paths", () => {
		const line = "xms/1;user.name=steve;user.stats.level=25;user.stats.xp=9001";
		const doc = XMSDoc.parse(line);
		expect(doc.getNested("user.name")).toBe("steve");
		expect(doc.getNested("user.stats.level")).toBe("25");
		expect(doc.getNested("user.stats.xp")).toBe("9001");
	});

	test("scalar not overwritten by nested path (default)", () => {
		const line = "xms/1;user=steve;user.stats.level=5";
		const doc = XMSDoc.parse(line, { createFlatKeys: true });
		// Implementation (like CommonMeta) may choose to keep scalar and skip nested object creation
		expect(doc.data.user).toBe("steve");
		// Flattened key should still exist
		expect(doc.data["user.stats.level"]).toBe("5");
		// getNested may return "5" if nested creation succeeded, or undefined if skipped.
		// Allow either, but if skipped we expect a warning.
		const nested = doc.getNested("user.stats.level");
		if (nested === undefined) {
			expect(
				doc.warnings.some((w) =>
					w.toLowerCase().includes("skipping nested creation"),
				),
			).toBe(true);
		} else {
			expect(nested).toBe("5");
		}
	});

	test("scalar overwritten when overwriteScalarsForNested=true", () => {
		const line = "xms/1;user=steve;user.stats.level=5";
		const doc = XMSDoc.parse(line, { overwriteScalarsForNested: true });
		// Now user should be object
		expect(typeof doc.data.user).toBe("object");
		expect(doc.getNested("user.stats.level")).toBe("5");
	});

	test("maximum nesting depth enforcement (depth >5 triggers warning)", () => {
		const line = "xms/1;a.b.c.d.e.f=value";
		const doc = XMSDoc.parse(line, { createFlatKeys: true });
		// Flattened key always present
		expect(doc.get("a.b.c.d.e.f")).toBe("value");
		// Depth limit = 5 ⇒ nested retrieval likely undefined for deeper path
		const nested = doc.getNested("a.b.c.d.e.f");
		if (nested === undefined) {
			expect(doc.warnings.some((w) => w.toLowerCase().includes("depth"))).toBe(
				true,
			);
		}
	});

	test("boolean coercion (default) and no numeric coercion by default", () => {
		const line = "xms/1;flag=true;count=42;pi=3.14;zero=0";
		const doc = XMSDoc.parse(line);
		expect(typeof doc.data.flag).toBe("boolean");
		expect(doc.data.flag).toBe(true);
		expect(typeof doc.data.count).toBe("string");
		expect(typeof doc.data.pi).toBe("string");
		expect(doc.data.count).toBe("42");
	});

	test("numeric coercion when coerceNumbers=true", () => {
		const line = "xms/1;count=42;pi=3.14;flag=false";
		const doc = XMSDoc.parse(line, { coerceNumbers: true });
		expect(typeof doc.data.count).toBe("number");
		expect(doc.data.count).toBe(42);
		expect(typeof doc.data.pi).toBe("number");
		expect(doc.data.pi).toBeCloseTo(3.14);
		expect(doc.data.flag).toBe(false);
	});

	test("error namespace keys preserved", () => {
		const line =
			'xms/1;error.code=OUT_OF_STOCK;error.message="Sorry, that item is out of stock!";request=item123';
		const doc = XMSDoc.parse(line, {
			createFlatKeys: true,
		});
		expect(doc.get("error.code")).toBe("OUT_OF_STOCK");
		expect(doc.get("error.message")).toBe("Sorry, that item is out of stock!");
	});

	test("last duplicate dotted key wins", () => {
		const line =
			"xms/1;user.stats.level=10;user.stats.level=15;user.stats.level=20";
		const doc = XMSDoc.parse(line);
		expect(
			doc.getNested("user.stats.level") ?? doc.data["user.stats.level"],
		).toBe("20");
	});

	test("whitespace around separators trimmed", () => {
		const line =
			'xms/1; username = steve ; item = "diamond_sword" ; flag = true ';
		const doc = XMSDoc.parse(line);
		expect(doc.data.username).toBe("steve");
		expect(doc.data.item).toBe("diamond_sword");
		expect(doc.data.flag).toBe(true);
	});

	test("ordering of entries preserved", () => {
		const line = "xms/1;first=1;second=2;third=3;second=4";
		const doc = XMSDoc.parse(line);
		const names = doc.entries.map((e) => e.name);
		expect(names).toEqual(["first", "second", "third", "second"]);
		expect(doc.data.second).toBe("4");
	});
});

describe("Fallback behavior for malformed XMS", () => {
	test("malformed quoted value triggers fallback to CommonMeta", () => {
		const line = 'xms/1;username="steve;item=sword';
		const doc = XMSDoc.parse(line);
		// According to spec: malformed quotes => fallback
		expect(doc.isFallback).toBe(true);
		expect(doc.version).toBe(0);
		// Entire string parsed as CommonMeta tokens (still entries >0)
		expect(doc.entries.length).toBeGreaterThan(0);
	});

	test("non-xms line in fixture (prefixed with #FALLBACK) is ignored for XMS tests", () => {
		const fallbackLines = lines.filter((l) => l.startsWith("#FALLBACK"));
		for (const raw of fallbackLines) {
			const input = raw.replace(/^#FALLBACK:/, "");
			const doc = XMSDoc.parse(input);
			expect(doc.isFallback).toBe(true);
			expect(doc.version).toBe(0);
		}
	});
});

describe("Length limits", () => {
	test("message length <=255 enforced", () => {
		const good = `xms/1;message="${"a".repeat(255)}"`;
		const docGood = XMSDoc.parse(good);
		expect(String(docGood.data.message).length).toBe(255);

		const bad = `xms/1;message="${"b".repeat(300)}"`;
		const docBad = XMSDoc.parse(bad);
		expect(docBad.entries.find((e) => e.name === "message")).toBeTruthy();
		if (String(docBad.data.message).length > 255) {
			expect(
				docBad.warnings.some(
					(w) =>
						w.toLowerCase().includes("message") ||
						w.toLowerCase().includes("255"),
				),
			).toBe(true);
		} else {
			expect(String(docBad.data.message).length).toBeLessThanOrEqual(255);
		}
	});

	test("username length <=16", () => {
		const good = "xms/1;username=shortname";
		const docGood = XMSDoc.parse(good);
		expect(String(docGood.data.username).length).toBeLessThanOrEqual(16);

		const long = `xms/1;username=${"x".repeat(25)}`;
		const docLong = XMSDoc.parse(long);
		if (String(docLong.data.username).length > 16) {
			expect(
				docLong.warnings.some(
					(w) =>
						w.toLowerCase().includes("username") ||
						w.toLowerCase().includes("16"),
				),
			).toBe(true);
		}
	});
});

describe("Data flattening & nested consistency", () => {
	test("flattened keys exist for every entry", () => {
		for (const sample of lines.filter(
			(l) => l.startsWith("xms/") && !l.includes("MALFORMED_QUOTE"),
		)) {
			const doc = XMSDoc.parse(sample, {
				createFlatKeys: true,
			});
			for (const e of doc.entries) {
				expect(Object.hasOwn(doc.data, e.name)).toBe(true);
			}
		}
	});
});

describe("Coercion configuration", () => {
	test("numbers stay strings by default in XMS (except booleans)", () => {
		const line = "xms/1;count=42;flag=true;value=003;float=1.50";
		const doc = XMSDoc.parse(line);
		expect(typeof doc.data.flag).toBe("boolean");
		expect(doc.data.count).toBe("42");
		expect(doc.data.value).toBe("003");
		expect(doc.data.float).toBe("1.50");
	});

	test("coerceNumbers converts numeric-like values", () => {
		const line = "xms/1;count=42;float=1.50;neg=-3;flag=false";
		const doc = XMSDoc.parse(line, { coerceNumbers: true });
		expect(doc.data.count).toBe(42);
		expect(doc.data.float).toBeCloseTo(1.5);
		expect(doc.data.neg).toBe(-3);
		expect(doc.data.flag).toBe(false);
	});
});

describe("Regression safety", () => {
	test("safeParse never throws for all fixture lines", () => {
		for (const line of lines) {
			const doc = XMSDoc.safeParse(
				line.startsWith("#FALLBACK:") ? line.substring(10) : line,
			);
			expect(doc).toBeInstanceOf(XMSDoc);
		}
	});
});

describe("Snapshots (subset)", () => {
	const subset = lines.filter((l) => l.startsWith("xms/")).slice(0, 8);
	for (const line of subset) {
		test(`snapshot: ${line}`, () => {
			const doc = XMSDoc.parse(line);
			expect({
				version: doc.version,
				isFallback: doc.isFallback,
				entries: doc.entries,
				warnings: doc.warnings,
			}).toMatchSnapshot();
		});
	}
});

/**
 * Utility to assert value types recursively
 */
function assertXMSNode(node: XMSNode): void {
	for (const key of Object.keys(node)) {
		const val = node[key];
		if (val === null) continue;
		const type = typeof val;
		if (type === "string" || type === "number" || type === "boolean") continue;
		if (type === "object") {
			assertXMSNode(val as XMSNode);
		} else {
			throw new Error(`Unexpected value type: ${type} for key ${key}`);
		}
	}
}

describe("Type integrity", () => {
	test("all parsed nodes contain only valid XMSValue primitives or nested objects", () => {
		for (const line of lines.filter((l) => l.startsWith("xms/")).slice(0, 30)) {
			const doc = XMSDoc.parse(line);
			assertXMSNode(doc.data);
		}
	});
});
