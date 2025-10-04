/** biome-ignore-all lint/suspicious/noExplicitAny: any needed for generic metadata */

import type { XMSParseOptions } from ".";

export type Trim<S extends string> = S extends ` ${infer R}`
	? Trim<R>
	: S extends `${infer R} `
		? Trim<R>
		: S;

export type StripVersionPrefix<S extends string> =
	S extends `xms/${number};${infer Rest}` ? Rest : S;

export type SplitSemicolons<S extends string> = S extends ""
	? []
	: S extends `${infer H};${infer T}`
		? [H, ...SplitSemicolons<T>]
		: [S];

export type NormalizeKey<K extends string> = Lowercase<K>;

export type ParseToken<
	T extends string,
	Opts extends XMSParseOptions = {},
> = T extends ""
	? never
	: T extends `${infer K}=${infer V}`
		? [NormalizeKey<Trim<K>>, Trim<V> extends "" ? null : Trim<V>]
		: [NormalizeKey<Trim<T>>, null];

export type InferValueType<
	Raw extends string | null,
	Opts extends XMSParseOptions = {},
> = Raw extends null
	? Opts["coerceBooleans"] extends false
		? ""
		: true
	: Raw extends string
		? Lowercase<Raw> extends "true" | "false"
			? boolean
			: Raw extends `"${string}"`
				? string
				: Opts["coerceNumbers"] extends true
					? Raw extends `${number}`
						? number
						: string
					: string
		: never;

export type Assign<Obj, K extends string, V> = Omit<Obj, K> & { [P in K]: V };

export type TokensToFlat<
	Tokens extends readonly any[],
	Opts extends XMSParseOptions = {},
	Acc extends Record<string, any> = {},
> = Tokens extends readonly [infer F, ...infer R]
	? F extends readonly [infer K, infer V]
		? K extends string
			? V extends string | null
				? TokensToFlat<R, Opts, Assign<Acc, K, InferValueType<V, Opts>>>
				: TokensToFlat<R, Opts, Acc>
			: TokensToFlat<R, Opts, Acc>
		: TokensToFlat<R, Opts, Acc>
	: Acc;

export type ParseTokens<
	Tokens extends readonly string[],
	Opts extends XMSParseOptions = {},
> = Tokens extends readonly [
	infer F extends string,
	...infer R extends string[],
]
	? [ParseToken<F, Opts>, ...ParseTokens<R, Opts>]
	: [];

export type InferFlatFromString<
	S extends string,
	Opts extends XMSParseOptions = {},
> = TokensToFlat<
	ParseTokens<SplitSemicolons<StripVersionPrefix<Trim<S>>>, Opts>,
	Opts
>;

export type SplitDots<S extends string> = S extends `${infer A}.${infer B}`
	? [A, ...SplitDots<B>]
	: [S];

export type UnionToIntersection<U> = (
	U extends any
		? (x: U) => void
		: never
) extends (x: infer I) => void
	? I
	: never;

type BuildPath<Path extends string[], Value> = Path extends [
	infer First extends string,
	...infer Rest extends string[],
]
	? { [K in First]: BuildPath<Rest, Value> }
	: Value;

type DeepMerge<T> = T extends Record<string, any>
	? {
			[K in keyof T]: T[K] extends Record<string, any>
				? DeepMerge<UnionToIntersection<T[K]>>
				: T[K];
		}
	: T;

type BuildNestedFromFlat<Flat extends Record<string, any>> = DeepMerge<
	UnionToIntersection<
		{
			[K in keyof Flat & string]: K extends `${infer First}.${infer Rest}`
				? { [P in First]: BuildPath<SplitDots<Rest>, Flat[K]> }
				: { [P in K]: Flat[K] };
		}[keyof Flat & string]
	>
>;

export type HasOnlyNumericKeys<T extends Record<string, any>> =
	keyof T extends never ? false : keyof T extends `${number}` ? true : false;

type GetArrayValues<T extends Record<string, any>> = T[keyof T];

export type CoerceToArray<T extends Record<string, any>> =
	HasOnlyNumericKeys<T> extends true ? GetArrayValues<T>[] : T;

export type CoerceIndexedToArrays<
	T,
	Opts extends XMSParseOptions,
> = T extends Record<string, any>
	? T extends any[]
		? T
		: HasOnlyNumericKeys<T> extends true
			? CoerceToArray<T>
			: {
					[K in keyof T]: CoerceIndexedToArrays<T[K], Opts>;
				}
	: T;

export type FilterFlatKeys<
	Flat extends Record<string, any>,
	Opts extends XMSParseOptions,
> = Opts["createFlatKeys"] extends true ? Flat : Record<string, never>;

export type FilterNestedKeys<
	Flat extends Record<string, any>,
	Opts extends XMSParseOptions,
> = Opts["createNestedKeys"] extends false
	? Record<string, never>
	: BuildNestedFromFlat<Flat>;

export type InferDataFromString<
	S extends string,
	Opts extends XMSParseOptions = Record<string, any>,
> = string extends S
	? any
	: CoerceIndexedToArrays<
			FilterFlatKeys<InferFlatFromString<S, Opts>, Opts> &
				FilterNestedKeys<InferFlatFromString<S, Opts>, Opts>,
			Opts
		>;

export type InferMetaFromNode<N> = N extends null
	? null
	: N extends string | number | boolean
		? N
		: N extends readonly (infer E)[]
			? InferMetaFromNode<E>[]
			: N extends Record<string, any>
				? { [K in keyof N]: InferMetaFromNode<N[K]> }
				: unknown;

export type InferXMS<
	S extends string,
	Opts extends XMSParseOptions = {
		coerceBooleans: true;
		coerceNumbers: false;
		createFlatKeys: false;
		createNestedKeys: true;
	},
> = InferDataFromString<S, Opts>;

type GetNestedPath<T, Path extends readonly string[]> = Path extends readonly [
	infer First extends string,
	...infer Rest extends string[],
]
	? First extends keyof T
		? Rest extends readonly string[]
			? Rest["length"] extends 0
				? T[First]
				: GetNestedPath<NonNullable<T[First]>, Rest>
			: T[First]
		: never
	: T;

export type InferGetReturnType<
	Meta extends Record<string, any>,
	Path extends readonly string[],
> = Path extends readonly [] ? undefined : GetNestedPath<Meta, Path>;

// inferred entries type
export type InferMetaEntries<Meta extends object> = {
	[name in keyof Meta & string]: {
		name: name;
		value: Meta[name] extends null | undefined ? "" : Meta[name];
	};
}[keyof Meta & string][];
