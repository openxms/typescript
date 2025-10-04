import type { InferMetaEntries } from "./inference";

/** biome-ignore-all lint/suspicious/noExplicitAny: any needed for generic metadata */
export * from "./inference";

export interface XMSParseOptions {
	/** If true (default), interprets bare tokens (no '=') as boolean true. If false, interprets bare tokens as empty string values. Ignored if transformBareToken is provided. */
	coerceBooleans?: boolean;
	/** If true, attempts to coerce numeric-looking values into numbers. If false (default), leaves all non-boolean values as strings or null. */
	coerceNumbers?: boolean;
	/** If true (default), enforces key/value length limits and nesting depth. If false, no limits are enforced. */
	enforceLimits?: boolean;
	/** Maximum allowed nesting depth for keys with dot notation. Default is 5. Ignored if enforceLimits is false. */
	maxNestingDepth?: number;
	/** If true, creates flat keys in the root object. If false (default), only nested keys are created. */
	createFlatKeys?: boolean;
	/** If true (default), creates nested keys in the root object. If false, only flat keys are created. */
	createNestedKeys?: boolean;
	/** If true (default), keeps keys that do not match the allowed pattern. If false, such keys are discarded. */
	keepInvalidKeys?: boolean;
	/** If true (default), attempts to re-parse the input as CommonMeta if XMS parsing fails. If false, returns an empty document on XMS parse failure. */
	reparseOnFallback?: boolean;
	/** Custom boolean literal mappings. Keys are case-insensitive. If a value matches a key here, it is coerced to the corresponding boolean value. */
	customBooleanLiterals?: Record<string, boolean>;
	/** If true, defers parsing until parse() is called. If false (default), parses immediately in the constructor. */
	defer?: boolean;
	/** Maximum allowed size for indexed arrays when allowIndexedCoercion is true. Default is unlimited. */
	maxIndexedArraySize?: number;

	/** If true, allows overwriting scalar values when creating nested structures. If false (default), nested creation is skipped when a non-object exists at any segment. */
	overwriteScalarsForNested?: boolean;
	/** Custom bare token mapping. Return null or string. Return value overrides both spec and legacy behavior. */
	transformBareToken?: (
		token: string,
		ctx: { endedWithSeparator: boolean },
	) => string | null;
	/** Optional callback for receiving warnings during parsing. */
	onWarning?: (warning: string) => void;
	/** Predicate function to further filter which numeric strings are coerced to numbers.
	 * If provided, the function is called with the raw string and should return true to allow coercion.
	 * If not provided, all numeric-looking strings are coerced (if coerceNumbers is true).
	 */
	numberPredicate?: (raw: string) => boolean;
}

export interface XMSRawEntry {
	name: string;
	value: string | null;
}

export type XMSPrimitive = string | number | boolean | null;
export type XMSPrimativeArray = XMSValue[];
export type XMSPrimativeRecord = Record<string, XMSPrimitive>;
export type XMSValue =
	| XMSPrimitive
	| XMSNode
	| XMSPrimativeArray
	| XMSPrimativeRecord;

export interface XMSNode {
	[key: string]: XMSValue;
}

export interface XMSParsedLikeGeneric<
	Meta extends object = Record<string, any>,
> {
	version: XMSVersionType;
	isFallback: boolean;
	entries: InferMetaEntries<Meta>;
	data: Meta;
	warnings?: string[];
	errors?: string[];
}

export interface XMSParsedLike {
	version: XMSVersionType;
	isFallback: boolean;
	entries: XMSRawEntry[];
	data: XMSNode;
	warnings?: string[];
	errors?: string[];
}

export interface InternalState {
	warnings: string[];
	errors: string[];
}

export type XMSVersionType = 0 | 1;
