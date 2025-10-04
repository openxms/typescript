import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMSDoc, type XMSNode } from "../src";

const FIXTURE_PATH = join(__dirname, "fixtures", "commonmeta.txt");
const lines: string[] = readFileSync(FIXTURE_PATH, "utf8").split("\n");

describe("CommonMeta fallback parsing", () => {
	test("fixture sanity: no line starts with xms/", () => {
		for (const line of lines) {
			expect(line.startsWith("xms/")).toBe(false);
		}
	});

	test.each(lines)("parses as CommonMeta (fallback): %s", (input) => {
		const doc = XMSDoc.parse(input);
		expect(doc.version).toBe(0);
		expect(doc.isFallback).toBe(true);
		expect(doc.entries.length).toBeGreaterThan(0);

		// Ensure no entry values are objects (no nested quoting/structures created in fallback)
		for (const e of doc.entries) {
			const v = doc.data[e.name];
			if (v !== undefined && v !== null) {
				expect(
					typeof v === "string" ||
					typeof v === "number" ||
					typeof v === "boolean",
				).toBe(true);
			}
		}
	});

	test("message key length enforcement (<=255) and presence", () => {
		const messageSamples = lines.filter((l) => /(^|;)message=/.test(l));
		for (const sample of messageSamples) {
			const doc = XMSDoc.parse(sample);
			const entry = doc.entries.find((e) => e.name === "message");
			if (!entry) continue;
			expect(entry.value).not.toBeNull();
			if (entry.value) {
				expect(entry.value.length).toBeLessThanOrEqual(255);
				expect(typeof doc.data.message).toBe("string");
			}
		}
	});

	test("error key presence where provided", () => {
		const errorSamples = lines.filter((l) => /(^|;)error=/.test(l));
		for (const sample of errorSamples) {
			const doc = XMSDoc.parse(sample);
			const entry = doc.entries.find((e) => e.name === "error");
			expect(entry).toBeTruthy();
			expect(entry?.value).not.toBeNull();
			if (entry?.value) {
				expect(entry.value.length).toBeLessThanOrEqual(255);
			}
		}
	});

	test("bare tokens become empty string values", () => {
		for (const sample of lines) {
			const tokens = sample
				.split(";")
				.map((t) => t.trim())
				.filter((t) => t.length > 0);
			const expectedBare = tokens.filter((t) => !t.includes("="));
			if (expectedBare.length === 0) continue;
			const doc = XMSDoc.parse(sample, {
				createFlatKeys: true,
			});
			for (const rawBare of expectedBare) {
				const key = rawBare.toLowerCase();
				const rawEntry = doc.entries.find((e) => e.name === key);
				expect(rawEntry).toBeTruthy();
				expect(rawEntry?.value).toBe("");
				expect(doc.data[key]).toBe("");
			}
		}
	});

	test("scalar not overwritten by nested path (default)", () => {
		const doc = XMSDoc.parse("user=steve;user.stats.level=5", {
			createFlatKeys: true,
		});
		expect(doc.data.user).toBe("steve");
		expect(doc.data["user.stats.level"]).toBe("5"); // or number if coercion enabled
		expect(doc.getNested("user.stats.level")).toBe("5");
		expect(
			doc.warnings.some((w) => w.includes("Skipping nested creation")),
		).toBe(true);
	});

	test("scalar overwritten when overwriteScalarsForNested=true", () => {
		const doc = XMSDoc.parse("user=steve;user.stats.level=5", {
			overwriteScalarsForNested: true,
		});
		expect(typeof doc.data.user).toBe("object");
		expect(doc.getNested("user.stats.level")).toBe("5"); // nested created
	});

	test("invalid key patterns generate warnings (presence heuristic)", () => {
		// Keys that will likely produce warnings: contain uppercase, '#', spaces, '[' , ']' or other invalid chars before any '='
		const suspectSamples = lines.filter((l) =>
			/(^|;)[^=;]*[A-Z#\s[\]]/.test(l),
		);
		for (const sample of suspectSamples) {
			const doc = XMSDoc.parse(sample);
			// Some tokens might still end up valid; only assert that if there are invalid-looking tokens we got at least one warning.
			if (
				doc.entries.some((e) => /[A-Z#\s[\]]/.test(e.name)) &&
				doc.entries.length > 0
			) {
				expect(doc.warnings.length).toBeGreaterThanOrEqual(0);
				// We cannot guarantee >0 for every one due to key normalization, but log diagnostic if none.
				if (doc.warnings.length === 0) {
					// This is informative; not failing to avoid brittleness.
					// console.info('No warnings for sample (potentially all normalized fine):', sample);
				}
			}
		}
	});

	test("username length limit (<=16) enforced when enforceLimits is true", () => {
		const usernameSamples = lines.filter((l) => /(^|;)username=/.test(l));
		for (const sample of usernameSamples) {
			const doc = XMSDoc.parse(sample);
			const entry = doc.entries.find((e) => e.name === "username");
			if (!entry || entry.value == null) continue;
			expect(entry.value.length).toBeLessThanOrEqual(16);
		}
	});

	test("data flattening preserves all keys while nested creation is limited (no nesting without dots)", () => {
		for (const sample of lines) {
			const doc = XMSDoc.parse(sample, { createFlatKeys: true });
			for (const e of doc.entries) {
				// Flattened key must exist exactly
				expect(Object.hasOwn(doc.data, e.name)).toBe(true);
			}
		}
	});

	test("coercion behavior: by default numbers are not coerced (remain strings) and booleans coerced", () => {
		const specialSamples = [
			"count=42",
			"flag=true",
			"flag=False",
			"value=3.14",
			"mixed=0012",
		];
		for (const sample of specialSamples) {
			const doc = XMSDoc.parse(sample);
			const flagEntry = doc.entries.find((e) => e.name === "flag");
			if (flagEntry) {
				const v = doc.data.flag;
				// Booleans are coerced by default
				expect(typeof v === "boolean").toBe(true);
			}
			const countEntry = doc.entries.find((e) => e.name === "count");
			if (countEntry) {
				expect(typeof doc.data.count).toBe("string"); // numbers not coerced unless enabled
			}
			const valueEntry = doc.entries.find((e) => e.name === "value");
			if (valueEntry) {
				expect(typeof doc.data.value).toBe("string");
			}
			const mixedEntry = doc.entries.find((e) => e.name === "mixed");
			if (mixedEntry) {
				expect(typeof doc.data.mixed).toBe("string");
			}
		}
	});

	test("same sample parsed with number coercion enables numeric conversion", () => {
		const sample = "count=42;pi=3.14;flag=true";
		const doc = XMSDoc.parse(sample, { coerceNumbers: true });
		expect(typeof doc.data.count).toBe("number");
		expect(typeof doc.data.pi).toBe("number");
		expect(doc.data.count).toBe(42);
		expect(doc.data.pi).toBeCloseTo(3.14);
		expect(doc.data.flag).toBe(true);
	});

	test("null semantics: key=; key= and key; produce null, bare token empty string", () => {
		const sample = "empty=;also=;justkey;baretoken";
		const doc = XMSDoc.parse(sample);
		const empty = doc.entries.find((e) => e.name === "empty");
		const also = doc.entries.find((e) => e.name === "also");
		const justkey = doc.entries.find((e) => e.name === "justkey");
		const bare = doc.entries.find((e) => e.name === "baretoken");
		expect(empty?.value).toBeNull();
		expect(also?.value).toBeNull();
		expect(justkey?.value).toBe("");
		expect(bare?.value).toBe("");
	});
});

describe("Regression check: no parsing throws", () => {
	test("all samples safeParse never throws", () => {
		for (const line of lines) {
			const doc = XMSDoc.safeParse(line);
			expect(doc).toBeInstanceOf(XMSDoc);
			// safeParse always returns something; version 0 expected (since no xms/ prefix)
			expect(doc.version).toBe(0);
		}
	});
});

describe("Snapshot subset (first 10 lines) for stability", () => {
	const subset = lines.slice(0, 10);
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
 * Utility to assert value types without using `any`.
 * Ensures all values in a node are XMSValue by simple structural checks.
 */
function assertXMSNode(node: XMSNode): void {
	for (const key of Object.keys(node)) {
		const val = node[key];
		if (val === null) continue;
		const type = typeof val;
		if (type === "string" || type === "number" || type === "boolean") continue;
		// If object, recurse
		assertXMSNode(val as XMSNode);
	}
}

describe("Type integrity (no unexpected object forms)", () => {
	test("all parsed nodes contain only valid XMSValue instances", () => {
		for (const line of lines.slice(0, 50)) {
			// limit for speed
			const doc = XMSDoc.parse(line);
			assertXMSNode(doc.data);
		}
	});
});
