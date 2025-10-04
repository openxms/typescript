/** biome-ignore-all lint/suspicious/noExplicitAny: any needed for generic metadata */

import type {
	InferDataFromString,
	InferMetaEntries,
	InferMetaFromNode,
	InferXMS,
	InternalState,
	XMSNode,
	XMSParsedLike,
	XMSParsedLikeGeneric,
	XMSParseOptions,
	XMSPrimativeArray,
	XMSPrimitive,
	XMSRawEntry,
	XMSValue,
	XMSVersionType,
} from "./index";

export const XMSVersion = {
	CommonMeta: 0,
	Current: 1,
} as const satisfies Record<string, XMSVersionType>;

const KEY_PATTERN = /^[a-z0-9_.]+$/;

const DEFAULT_OPTIONS: Required<
	Omit<
		XMSParseOptions,
		| "customBooleanLiterals"
		| "numberPredicate"
		| "defer"
		| "onWarning"
		| "overwriteScalarsForNested"
		| "legacyBareTokenSemantics"
		| "transformBareToken"
		| "maxIndexedArraySize"
	>
> = {
	coerceBooleans: true,
	coerceNumbers: false,
	enforceLimits: true,
	maxNestingDepth: 5,
	createFlatKeys: false,
	createNestedKeys: true,
	keepInvalidKeys: true,
	reparseOnFallback: true,
};

function deepClone<T extends XMSValue>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		const src = value as XMSPrimativeArray;
		const out: XMSPrimativeArray = new Array(src.length);
		for (let i = 0; i < src.length; i++) {
			if (Object.hasOwn(src, i)) {
				const v = src[i] ?? null;
				out[i] =
					v && typeof v === "object"
						? (deepClone(v) as XMSValue)
						: (v as XMSPrimitive);
			} else {
				out[i] = null;
			}
		}
		return out as T;
	}
	const src = value as XMSNode;
	const out: XMSNode = {};
	for (const k of Object.keys(src)) {
		const v = src[k] ?? null;
		out[k] =
			v && typeof v === "object"
				? (deepClone(v) as XMSValue)
				: (v as XMSPrimitive);
	}
	return out as T;
}

// minimal guards
function isParsedLike(o: any): o is XMSParsedLike {
	return o && typeof o === "object" && Array.isArray(o.entries) && o.data;
}
function isEntriesArray(o: any): o is XMSRawEntry[] {
	return Array.isArray(o) && o.every((e) => e && typeof e.name === "string");
}
function isNode(o: any): o is XMSNode {
	return o && typeof o === "object" && !Array.isArray(o) && !isParsedLike(o);
}

export class XMSDoc<
	Meta extends object = Record<string, any>,
	Options extends XMSParseOptions = XMSParseOptions,
> implements XMSParsedLikeGeneric<Meta> {
	version = 0 as XMSVersionType;
	isFallback = false;
	entries: InferMetaEntries<Meta> = [];
	data: Meta = {} as Meta;
	warnings: string[] = [];
	errors: string[] = [];

	private readonly input: string;
	private readonly opts: Options;

	constructor(input: string, options: Options) {
		if (typeof input !== "string")
			throw new TypeError("Input must be a string.");
		this.input = input;
		this.opts = { ...DEFAULT_OPTIONS, ...options };
		if (!options.defer) this.parse();
	}

	toJSON(): XMSParsedLikeGeneric<Meta> {
		return {
			version: this.version,
			isFallback: this.isFallback,
			entries: this.entries.slice(),
			data: deepClone(this.data as XMSNode) as Meta,
			warnings: this.warnings.slice(),
			errors: this.errors.slice(),
		};
	}

	get raw(): string {
		return this.input;
	}

	get<K extends keyof Meta & string>(path: K): Meta[K] | XMSValue | undefined {
		return this.getNested(path);
	}

	contains<K extends keyof Meta & string>(path: K): boolean {
		return this.get(path) !== undefined;
	}

	getNested(path: string): XMSValue | undefined {
		const segs = path.split(".");
		let cur: any = this.data;
		for (const s of segs) {
			if (cur && typeof cur === "object" && s in cur) cur = cur[s];
			else return (this.data as any)[path];
		}
		return cur;
	}

	private ingest(entries: XMSRawEntry[], warn: (w: string) => void) {
		for (const e of entries) {
			let { name: key, value } = e;
			if ((this.opts.enforceLimits ?? true) && value !== null) {
				value = this.enforceLength(key, value, warn);
				e.value = value;
			}
			const coerced = this.coerceValue(value);
			this.assignNested(
				this.data as any,
				key,
				coerced,
				{
					maxNestingDepth:
						this.opts.maxNestingDepth ?? DEFAULT_OPTIONS.maxNestingDepth,
					createFlatKeys: this.opts.createFlatKeys ?? true,
					createNestedKeys: this.opts.createNestedKeys ?? true,
				},
				warn,
			);
		}
	}

	parse(): this {
		this.version = 0;
		this.isFallback = false;
		this.entries = [];
		this.data = {} as Meta;
		this.warnings = [];
		this.errors = [];
		const state: InternalState = { warnings: [], errors: [] };
		const warn = (w: string) => {
			state.warnings.push(w);
			this.opts.onWarning?.(w);
		};
		let body = this.input;
		let xmsCandidate = false;
		const m = /^xms\/(\d+)/.exec(this.input);
		if (m?.[1]) {
			this.version = parseInt(m[1], 10) as XMSVersionType;
			xmsCandidate = true;
			body = this.input.slice(m[0].length);
		}
		try {
			if (xmsCandidate) {
				this.entries = this.parseXMSCore(body, state) as any;
			} else {
				this.isFallback = true;
				this.entries = this.parseCommonMeta(this.input, state) as any;
			}
		} catch {
			this.isFallback = true;
			this.version = 0;
			this.entries =
				(this.opts.reparseOnFallback ?? true)
					? this.parseCommonMeta(this.input, state) as any
					: [];
		}
		this.ingest(this.entries as any, warn);
		if (state.warnings.length) this.warnings = state.warnings;
		if (state.errors.length) this.errors = state.errors;
		return this;
	}

	/* Overloads with inference */
	static parse<const S extends string, O extends XMSParseOptions>(
		input: S,
		options?: O,
	): XMSDoc<InferDataFromString<S>>;
	static parse(input: string, options?: XMSParseOptions): XMSDoc;
	static parse(input: string, options?: XMSParseOptions): XMSDoc {
		return new XMSDoc(input, { ...options, defer: false }) as any;
	}

	static safeParse<const S extends string, O extends XMSParseOptions>(
		input: S,
		options?: O,
	): XMSDoc<InferDataFromString<S>>;
	static safeParse(input: string, options?: XMSParseOptions): XMSDoc;
	static safeParse(input: string, options?: XMSParseOptions): XMSDoc {
		try {
			return new XMSDoc(input, options ?? {}) as any;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			const doc = new XMSDoc("", { defer: true });
			doc.version = 0;
			doc.isFallback = true;
			doc.errors = [`Unexpected parser failure: ${msg}`];
			return doc;
		}
	}

	static isProbablyXMS(input: string): boolean {
		return /^xms\/\d+;/.test(input);
	}

	static from<
		const S extends string,
		O extends XMSParseOptions & {
			version?: XMSVersionType;
			isFallback?: boolean;
		},
	>(source: S, options?: O): InferXMS<S, O>;
	static from<
		N extends XMSNode,
		O extends XMSParseOptions & {
			version?: XMSVersionType;
			isFallback?: boolean;
		},
	>(source: N, options?: O): XMSDoc<InferMetaFromNode<N>, O>;
	static from<
		E extends XMSRawEntry[],
		O extends XMSParseOptions & {
			version?: XMSVersionType;
			isFallback?: boolean;
		},
	>(source: E, options?: O): XMSDoc;
	static from<
		P extends XMSParsedLike,
		O extends XMSParseOptions & {
			version?: XMSVersionType;
			isFallback?: boolean;
		},
	>(source: P, options?: O): XMSDoc<P["data"]>;
	static from(
		source: string | XMSParsedLike | XMSNode | XMSRawEntry[],
		options: XMSParseOptions & {
			version?: XMSVersionType;
			isFallback?: boolean;
			preserveWarnings?: boolean;
			preserveErrors?: boolean;
		} = {},
	): XMSDoc {
		if (typeof source === "string") {
			return XMSDoc.parse(source, options) as any;
		}
		if (isParsedLike(source)) {
			const doc = new XMSDoc("", { ...options, defer: true }) as XMSDoc<any>;
			doc.version =
				typeof options.version === "number" ? options.version : source.version;
			doc.isFallback =
				typeof options.isFallback === "boolean"
					? options.isFallback
					: source.isFallback;
			doc.entries = source.entries.map((e) => ({
				name: e.name,
				value: e.value,
			}));
			doc.data = deepClone(source.data) as any;
			if (options.preserveWarnings !== false && source.warnings)
				doc.warnings = source.warnings.slice();
			if (options.preserveErrors !== false && source.errors)
				doc.errors = source.errors.slice();
			return doc;
		}
		if (isEntriesArray(source)) {
			const doc = new XMSDoc("", { ...options, defer: true }) as XMSDoc<any>;
			doc.version = (
				typeof options.version === "number" ? options.version : 1
			) as XMSVersionType;
			doc.isFallback = options.isFallback ?? false;
			const warn = (w: string) => {
				doc.warnings.push(w);
				options.onWarning?.(w);
			};
			doc.entries = source.map((e) => ({
				name: e.name.toLowerCase(),
				value: e.value,
			}));
			doc.ingest(doc.entries, warn);
			return doc;
		}
		if (isNode(source)) {
			const doc = new XMSDoc("", { ...options, defer: true }) as XMSDoc<any>;
			doc.version = (
				typeof options.version === "number" ? options.version : 1
			) as XMSVersionType;
			doc.isFallback = options.isFallback ?? false;
			const entries = flattenNodeToEntries(source);
			doc.entries = entries;
			const warn = (w: string) => {
				doc.warnings.push(w);
				options.onWarning?.(w);
			};
			doc.ingest(entries, warn);
			return doc;
		}
		throw new TypeError("Unsupported source type for XMSDoc.from()");
	}

	private enforceLength(
		key: string,
		value: string,
		warn: (w: string) => void,
	): string {
		let limit: number | undefined;
		if (key === "username") limit = 16;
		else if (key === "message" || key === "error.message" || key === "error")
			limit = 255;
		if (limit !== undefined && value.length > limit) {
			warn(`Value for key "${key}" exceeded limit ${limit} and was truncated.`);
			return value.slice(0, limit);
		}
		return value;
	}

	private coerceValue(raw: string | null): XMSValue {
		if (raw === null) return null;
		const o = this.opts;
		const lower = raw.toLowerCase();
		if (o.coerceBooleans ?? true) {
			if (lower === "true") return true;
			if (lower === "false") return false;
			if (o.customBooleanLiterals) {
				for (const lit in o.customBooleanLiterals) {
					if (lit.toLowerCase() === lower)
						return o.customBooleanLiterals[lit] === true;
				}
			}
		}
		if (o.coerceNumbers) {
			const pat = /^-?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
			if (pat.test(raw) && (!o.numberPredicate || o.numberPredicate(raw))) {
				const n = Number(raw);
				if (!Number.isNaN(n)) return n;
			}
		}
		return raw;
	}

	private assignNested(
		root: any,
		key: string,
		value: XMSValue,
		cfg: {
			maxNestingDepth: number;
			createFlatKeys: boolean;
			createNestedKeys: boolean;
		},
		warn: (w: string) => void,
	): void {
		if (cfg.createFlatKeys) root[key] = value;
		if (!cfg.createNestedKeys) return;
		const segs = key.split(".");
		if (segs.some((s) => s.length === 0)) return;
		if (segs.length > cfg.maxNestingDepth) {
			warn(
				`Key "${key}" exceeds max nesting depth (${cfg.maxNestingDepth}); nested object not created.`,
			);
			return;
		}
		let cur = root;
		for (let i = 0; i < segs.length; i++) {
			const seg = segs[i] as string;
			const last = i === segs.length - 1;
			if (last) {
				cur[seg] = value;
			} else {
				const exist = cur[seg];
				if (
					exist === null ||
					typeof exist !== "object" ||
					Array.isArray(exist)
				) {
					if (exist !== undefined) {
						if (this.opts.overwriteScalarsForNested) cur[seg] = {};
						else {
							warn(
								`Skipping nested creation for "${key}" due to existing non-object at segment "${seg}".`,
							);
							return;
						}
					} else cur[seg] = {};
				}
				cur = cur[seg];
			}
		}
	}

	private parseXMSCore(body: string, state: InternalState): XMSRawEntry[] {
		const out: XMSRawEntry[] = [];
		const len = body.length;
		let i = 0;
		while (i < len) {
			while (i < len && body[i] === ";") i++;
			if (i >= len) break;
			const start = i;
			let inQuote = false;
			let esc = false;
			for (; i < len; i++) {
				const ch = body[i];
				if (esc) {
					esc = false;
					continue;
				}
				if (ch === "\\") {
					esc = true;
					continue;
				}
				if (ch === '"') {
					inQuote = !inQuote;
					continue;
				}
				if (ch === ";" && !inQuote) break;
			}
			if (inQuote) {
				state.errors.push("Unterminated quote; fallback.");
				throw new Error("Malformed quotes");
			}
			const end = i;
			const token = body.slice(start, end).trim();
			if (!token) {
				if (i < len && body[i] === ";") i++;
				continue;
			}
			let eqIndex = -1;
			{
				let q = false;
				let e = false;
				for (let k = 0; k < token.length; k++) {
					const c = token[k];
					if (e) {
						e = false;
						continue;
					}
					if (c === "\\") {
						e = true;
						continue;
					}
					if (c === '"') {
						q = !q;
						continue;
					}
					if (c === "=" && !q) {
						eqIndex = k;
						break;
					}
				}
			}
			let key: string;
			let valuePart: string | null;
			if (eqIndex === -1) {
				key = token;
				valuePart = null;
			} else {
				key = token.slice(0, eqIndex).trim();
				valuePart = token.slice(eqIndex + 1).trim();
				if (valuePart === "") valuePart = null;
			}
			const originalKey = key;
			key = key.toLowerCase();
			let finalValue: string | null;
			if (valuePart === null) {
				finalValue = null;
			} else if (valuePart.startsWith('"')) {
				if (valuePart.length < 2 || !valuePart.endsWith('"')) {
					state.errors.push("Malformed quoted value.");
					throw new Error("Malformed quotes");
				}
				const inner = valuePart.slice(1, -1);
				let outStr = "";
				let esc2 = false;
				for (let p = 0; p < inner.length; p++) {
					const c = inner[p];
					if (esc2) {
						esc2 = false;
						outStr += c;
						continue;
					}
					if (c === "\\") {
						esc2 = true;
						continue;
					}
					outStr += c;
				}
				if (esc2) {
					state.errors.push("Dangling backslash.");
					throw new Error("Malformed quotes");
				}
				finalValue = outStr;
			} else {
				finalValue = valuePart;
			}
			if (!KEY_PATTERN.test(key)) {
				if (!(this.opts.keepInvalidKeys ?? true)) {
					if (i < len && body[i] === ";") i++;
					continue;
				}
				state.warnings.push(
					`Invalid key pattern for "${originalKey}" (accepted).`,
				);
			}
			out.push({ name: key, value: finalValue });
			if (i < len && body[i] === ";") i++;
		}
		return out;
	}

	private parseCommonMeta(input: string, state: InternalState): XMSRawEntry[] {
		interface Tok {
			text: string;
		}
		const toks: Tok[] = [];
		let cur = "";
		for (let i = 0; i < input.length; i++) {
			const ch = input[i];
			if (ch === ";") {
				if (cur.length) {
					toks.push({ text: cur });
					cur = "";
				}
			} else cur += ch;
		}
		if (cur.length) toks.push({ text: cur });
		const out: XMSRawEntry[] = [];
		for (const tk of toks) {
			const raw = tk.text.trim();
			if (!raw) continue;
			const eq = raw.indexOf("=");
			let key: string;
			let val: string | null;
			if (eq === -1) {
				key = raw.toLowerCase();
				val = "";
			} else {
				key = raw.slice(0, eq).trim().toLowerCase();
				const right = raw.slice(eq + 1).trim();
				val = right === "" ? null : right;
			}
			if (!KEY_PATTERN.test(key)) {
				if (!(this.opts.keepInvalidKeys ?? true)) continue;
				state.warnings.push(
					`Invalid key pattern for "${key}" (kept in fallback).`,
				);
			}
			out.push({ name: key, value: val });
		}
		return out;
	}

	toXMS(): string {
		const tokens: string[] = [];
		for (const { name: key, value } of this.entries) {
			if (!KEY_PATTERN.test(key)) continue;
			if (value === null) tokens.push(key);
			else if (value === "") tokens.push(`${key}=`);
			else {
				const needsQuotes = /[\s;="\\]/.test(value as string);
				if (needsQuotes) {
					let buf = '"';
					for (let i = 0; i < (value as string).length; i++) {
						const ch = (value as string)[i];
						if (ch === '"' || ch === "\\") buf += "\\";
						buf += ch;
					}
					buf += '"';
					tokens.push(`${key}=${buf}`);
				} else tokens.push(`${key}=${value}`);
			}
		}
		if (!this.version) return tokens.join(";");
		return tokens.length
			? `xms/${this.version};${tokens.join(";")}`
			: `xms/${this.version};`;
	}

	toObject(): Meta {
		return deepClone(this.data as XMSNode) as Meta;
	}
}

function flattenNodeToEntries(node: XMSNode, prefix = ""): XMSRawEntry[] {
	const entries: XMSRawEntry[] = [];
	const pushPrim = (full: string, v: XMSPrimitive) => {
		let value: string | null;
		if (v === null) value = null;
		else if (typeof v === "string") value = v;
		else if (typeof v === "number") value = String(v);
		else if (typeof v === "boolean") value = v ? "true" : "false";
		else value = String(v);
		entries.push({ name: full.toLowerCase(), value });
	};
	const walk = (val: XMSValue, cur: string) => {
		if (val === null || typeof val !== "object") {
			pushPrim(cur, val as XMSPrimitive);
			return;
		}
		if (Array.isArray(val)) {
			for (let i = 0; i < val.length; i++) {
				const c = val[i];
				const key = cur ? `${cur}.${i}` : String(i);
				if (c === undefined) pushPrim(key, null);
				else walk(c, key);
			}
			return;
		}
		for (const k of Object.keys(val)) {
			const child = (val as XMSNode)[k];
			const full = cur ? `${cur}.${k}` : k;
			if (child === null || typeof child !== "object") {
				pushPrim(full, child as XMSPrimitive);
			} else walk(child as XMSValue, full);
		}
	};
	walk(node, prefix);
	return entries;
}
