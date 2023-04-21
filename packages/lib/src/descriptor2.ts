import type { Source, SourceObject } from "./index";
import { deepEqual } from "./patch/util";

export const DEBUG_STRING = Symbol("DEBUG_STRING");
export const IS = Symbol("IS");

export const ARRAY_VALUE = Symbol("ARRAY_VALUE");
export const OBJECT_VALUE = Symbol("OBJECT_VALUE");
export const STRING_BRAND = Symbol("STRING");
export const NUMBER_BRAND = Symbol("NUMBER");
export const BOOLEAN_BRAND = Symbol("BOOLEAN");
export const NULL_BRAND = Symbol("NULL");

export type Descriptor<V extends Source> = V extends readonly Source[]
  ? {
      [P in keyof V & number]: Descriptor<V[P]>;
    } & {
      [ARRAY_VALUE]: Descriptor<V[number]>;
      length: Descriptor<V["length"]>;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : V extends SourceObject
  ? {
      [P in keyof V]: Descriptor<V[P]>;
    } & {
      [OBJECT_VALUE]: Descriptor<V[keyof V]>;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : V extends string
  ? {
      [STRING_BRAND]: unknown;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : V extends number
  ? {
      [NUMBER_BRAND]: unknown;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : V extends boolean
  ? {
      [BOOLEAN_BRAND]: unknown;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : V extends null
  ? {
      [NULL_BRAND]: unknown;
      [IS](v: Source): v is V;
      [DEBUG_STRING](): string;
    }
  : never;

type A<V extends Source> = Descriptor<V>[typeof IS];

export const StringDescriptor: Descriptor<string> =
  new (class StringDescriptor {
    [STRING_BRAND]!: unknown;
    [IS](v: Source): v is string {
      return typeof v === "string";
    }
    [DEBUG_STRING](): string {
      return "string";
    }
    static {
      Object.defineProperty(this, STRING_BRAND, {});
    }
  })();
export const NumberDescriptor: Descriptor<number> =
  new (class NumberDescriptor {
    [NUMBER_BRAND]!: unknown;
    [IS](v: Source): v is number {
      return typeof v === "number";
    }
    [DEBUG_STRING](): string {
      return "number";
    }
    static {
      Object.defineProperty(this, NUMBER_BRAND, {});
    }
  })();
export const BooleanDescriptor: Descriptor<boolean> =
  new (class BooleanDescriptor {
    [BOOLEAN_BRAND]!: unknown;
    [IS](v: Source): v is boolean {
      return typeof v === "boolean";
    }
    [DEBUG_STRING](): string {
      return "boolean";
    }
    static {
      Object.defineProperty(this, BOOLEAN_BRAND, {});
    }
  })() as Descriptor<boolean>;
export const NullDescriptor: Descriptor<null> = new (class NullDescriptor {
  [NULL_BRAND]!: unknown;
  [IS](v: Source): v is null {
    return v === null;
  }
  [DEBUG_STRING](): string {
    return "null";
  }
  static {
    Object.defineProperty(this, NULL_BRAND, {});
  }
})();

const unknownProxy = new Proxy(Object.create(null), {
  get(_, p, receiver) {
    if (p === IS) {
      return () => true;
    }
    if (
      typeof p === "string" ||
      p === ARRAY_VALUE ||
      p === OBJECT_VALUE ||
      p === STRING_BRAND ||
      p === NUMBER_BRAND ||
      p === BOOLEAN_BRAND ||
      p === NULL_BRAND
    ) {
      return receiver;
    }
    return undefined;
  },
  has(_, p) {
    if (p === IS) {
      return true;
    }
    if (
      typeof p === "string" ||
      p === ARRAY_VALUE ||
      p === OBJECT_VALUE ||
      p === STRING_BRAND ||
      p === NUMBER_BRAND ||
      p === BOOLEAN_BRAND ||
      p === NULL_BRAND
    ) {
      return true;
    }
    return false;
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AnyDescriptor: Descriptor<any> = Object.create(unknownProxy, {
  [DEBUG_STRING]: { value: () => "any" },
});
export const UnknownDescriptor: Descriptor<Source> = Object.create(
  unknownProxy,
  {
    [DEBUG_STRING]: { value: () => "unknown" },
  }
);
export const NeverDescriptor: Descriptor<never> = Object.create(null, {
  [IS]: {
    value: () => false,
  },
  [DEBUG_STRING]: { value: () => "never" },
}) as Descriptor<never>;

const LITERAL_VALUE = Symbol("LITERAL_VALUE");
export class LiteralDescriptor<V extends Source> {
  [LITERAL_VALUE]: V;

  private constructor(value: V) {
    this[LITERAL_VALUE] = value;
  }

  [IS](v: Source): v is V {
    return deepEqual(v, this[LITERAL_VALUE]);
  }

  [DEBUG_STRING]() {
    return JSON.stringify(this[LITERAL_VALUE]);
  }

  static create<V extends Source>(value: V): Descriptor<V> {
    let brand: typeof STRING_BRAND | typeof NUMBER_BRAND | typeof BOOLEAN_BRAND;
    switch (typeof value) {
      case "string":
        brand = STRING_BRAND;
        break;
      case "number":
        brand = NUMBER_BRAND;
        break;
      case "boolean":
        brand = BOOLEAN_BRAND;
        break;
      case "object":
        if (value === null) {
          return NullDescriptor as Descriptor<V>;
        } else if (Array.isArray(value)) {
          return TupleDescriptor.create<Source[]>(
            value.map(this.create<Source>)
          ) as unknown as Descriptor<V>;
        } else {
          return ObjectDescriptor.create(
            Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                k,
                LiteralDescriptor.create(v),
              ])
            )
          ) as Descriptor<V>;
        }
      default:
        throw new Error("Unexpected literal type");
    }

    const desc = new LiteralDescriptor(value);
    (desc as unknown as Record<typeof brand, unknown>)[brand] = undefined;
    return desc as unknown as Descriptor<V>;
  }
}

const TUPLE_LENGTH = Symbol("TUPLE_LENGTH");
export class TupleDescriptor<V extends readonly Source[]> {
  length: Descriptor<V["length"]>;
  [ARRAY_VALUE]: Descriptor<V[number]>;
  private [TUPLE_LENGTH]: V["length"];

  private constructor(props: { [I in keyof V]: Descriptor<V[I]> }) {
    Object.assign(this, props);
    this.length = LiteralDescriptor.create<V["length"]>(props.length);
    this[ARRAY_VALUE] = UnionDescriptor.create<V[number]>(
      props as Descriptor<V[number]>[]
    );
    this[TUPLE_LENGTH] = props.length;
  }

  [IS](v: Source): v is V {
    if (!Array.isArray(v)) {
      return false;
    }
    return v.every((i, idx) =>
      (this as { [I in keyof V]: Descriptor<V[I]> })[idx][IS](i)
    );
  }

  [DEBUG_STRING]() {
    return `[${Array.from({ length: this[TUPLE_LENGTH] }, (_, i) => {
      return (this as { [I in keyof V]: Descriptor<V[I]> })[i][DEBUG_STRING]();
    }).join(", ")}]`;
  }

  static create<V extends readonly Source[]>(props: {
    [I in keyof V]: Descriptor<V[I]>;
  }): Descriptor<V> {
    return new TupleDescriptor(props) as unknown as Descriptor<V>;
  }
}

export class ObjectDescriptor<V extends SourceObject> {
  [OBJECT_VALUE]: Descriptor<V[keyof V]>;

  private constructor(props: { [P in keyof V]: Descriptor<V[P]> }) {
    Object.assign(this, props);
    this[OBJECT_VALUE] = UnionDescriptor.create(Object.values(props));
  }

  [IS](v: Source): v is V {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    return Object.entries(this as unknown as Descriptor<V>).every(
      ([k, d]) => k in v && d[IS]((v as Record<string, Source>)[k])
    );
  }

  [DEBUG_STRING]() {
    return `{ ${Object.entries(this as unknown as Descriptor<V>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${v[DEBUG_STRING]()}`)
      .join(", ")} }`;
  }

  static create<V extends SourceObject>(props: {
    [P in keyof V]: Descriptor<V[P]>;
  }): Descriptor<V> {
    return new ObjectDescriptor(props) as Descriptor<V>;
  }
}

export class ArrayDescriptor<V extends Source> {
  [index: number]: Descriptor<V>;
  [ARRAY_VALUE]: Descriptor<V>;
  length!: Descriptor<number>;

  private constructor(value: Descriptor<V>) {
    this[ARRAY_VALUE] = value;
    return new Proxy<ArrayDescriptor<V>>(this, ArrayDescriptor.proxyHandler);
  }

  [IS](v: Source): v is V[] {
    return Array.isArray(v) && v.every((i) => this[ARRAY_VALUE][IS](i));
  }

  [DEBUG_STRING]() {
    return `${this[ARRAY_VALUE][DEBUG_STRING]}`;
  }

  static {
    Object.defineProperty(this, "length", {
      get() {
        return NumberDescriptor;
      },
    });
  }

  private static readonly proxyHandler = {
    get<V extends Source>(desc: ArrayDescriptor<V>, p: string | symbol) {
      if (
        p === ARRAY_VALUE ||
        p === DEBUG_STRING ||
        p === IS ||
        p === "length"
      ) {
        return desc[
          p as typeof ARRAY_VALUE | typeof DEBUG_STRING | typeof IS | "length"
        ];
      }
      if (typeof p === "string") {
        if (/^(-?0|[1-9][0-9]*)$/g.test(p)) {
          return desc[ARRAY_VALUE];
        }
        if (p === "length") {
          // TODO: Indicate this is a number somehow?
          return NumberDescriptor;
        }
      }
      return undefined;
    },
    has<V extends Source>(_: ArrayDescriptor<V>, p: string | symbol) {
      if (p === ARRAY_VALUE || p === DEBUG_STRING) {
        return true;
      }
      if (typeof p === "string") {
        if (/^(-?0|[1-9][0-9]*)$/g.test(p)) {
          return true;
        }
        if (p === "length") {
          return true;
        }
      }
      return false;
    },
  };

  static create<V extends Source>(value: Descriptor<V>): Descriptor<V[]> {
    return new ArrayDescriptor(value) as Descriptor<V[]>;
  }
}

export class RecordDescriptor<V extends Source> {
  [prop: string]: Descriptor<V>;
  [OBJECT_VALUE]!: Descriptor<V>;

  private constructor(value: Descriptor<V>) {
    this[OBJECT_VALUE] = value;
    return new Proxy<RecordDescriptor<V>>(this, RecordDescriptor.proxyHandler);
  }

  [IS](v: Source): v is Record<string, V> {
    if (typeof v !== "object" || v === null) {
      return false;
    }
    return Object.values(v).every((i) => {
      return this[OBJECT_VALUE][IS](i);
    });
  }

  [DEBUG_STRING]() {
    return `{[key: string]: ${this[OBJECT_VALUE][DEBUG_STRING]()}}}`;
  }

  private static readonly proxyHandler = {
    get<V extends Source>(desc: RecordDescriptor<V>, p: string | symbol) {
      if (p === OBJECT_VALUE || p === DEBUG_STRING || p === IS) {
        return desc[p as typeof OBJECT_VALUE | typeof DEBUG_STRING | typeof IS];
      }
      if (typeof p === "string") {
        return desc[OBJECT_VALUE];
      }
      return undefined;
    },
    has<V extends Source>(_: RecordDescriptor<V>, p: string | symbol) {
      if (p === OBJECT_VALUE || p === DEBUG_STRING) {
        return true;
      }
      return typeof p === "string";
    },
  };

  static create<V extends Source>(
    value: Descriptor<V>
  ): Descriptor<Record<string, V>> {
    return new RecordDescriptor(value) as Descriptor<Record<string, V>>;
  }
}

export const UNION_OPTIONS = Symbol("UNION_OPTIONS");
export class UnionDescriptor<V extends Source> {
  public readonly [UNION_OPTIONS]: Descriptor<V>[];

  private constructor(options: Descriptor<V>[]) {
    this[UNION_OPTIONS] = options;
    return new Proxy<UnionDescriptor<V>>(this, UnionDescriptor.proxyHandler);
  }

  [IS](v: Source): v is V {
    return this[UNION_OPTIONS].some((o) => o[IS](v));
  }

  [DEBUG_STRING]() {
    return this[UNION_OPTIONS].map((o) => o[DEBUG_STRING]()).join(" | ");
  }

  private static readonly proxyHandler = {
    get<V extends Source>(desc: UnionDescriptor<V>, p: string | symbol) {
      if (p === UNION_OPTIONS || p === DEBUG_STRING || p === IS) {
        return desc[
          p as typeof UNION_OPTIONS | typeof DEBUG_STRING | typeof IS
        ];
      }

      if (typeof p === "string" || p === ARRAY_VALUE || p === OBJECT_VALUE) {
        const descs: Descriptor<Source>[] = [];
        for (const option of desc[UNION_OPTIONS]) {
          if (p in option) {
            descs.push(
              (
                option as unknown as {
                  [p in
                    | string
                    | typeof ARRAY_VALUE
                    | typeof OBJECT_VALUE]: Descriptor<Source>;
                }
              )[p as string | typeof ARRAY_VALUE | typeof OBJECT_VALUE]
            );
          }
        }
        if (descs.length === 0) {
          return undefined;
        }
        return UnionDescriptor.create<Source>(descs);
      }

      return undefined;
    },
    has<V extends Source>(desc: UnionDescriptor<V>, p: string | symbol) {
      for (const option of desc[UNION_OPTIONS]) {
        if (p in option) {
          return true;
        }
      }
      return false;
    },
  };

  private static flattenUnionOptions<V extends Source>(
    options: Descriptor<V>[]
  ): Descriptor<V>[] {
    // TODO: Deduplication?
    return options
      .filter((o) => o !== NeverDescriptor)
      .flatMap((o) => {
        if (o instanceof UnionDescriptor) {
          return o[UNION_OPTIONS] as Descriptor<V>[];
        }
        return o;
      });
  }

  static create<V extends Source>(options: Descriptor<V>[]): Descriptor<V> {
    if (options.length === 0) {
      return NeverDescriptor;
    } else if (options.length === 1) {
      return options[0];
    }

    return new UnionDescriptor(
      this.flattenUnionOptions(options)
    ) as unknown as Descriptor<V>;
  }
}

export function filter<V extends Source, U extends V>(
  desc: Descriptor<V>,
  f: (desc: Descriptor<V>) => desc is Descriptor<U>
): Descriptor<U>;
export function filter<V extends Source>(
  desc: Descriptor<V>,
  f: (desc: Descriptor<V>) => boolean
): Descriptor<V> {
  if (desc instanceof UnionDescriptor) {
    return UnionDescriptor.create(
      (desc[UNION_OPTIONS] as Descriptor<V>[]).filter(f)
    ) as Descriptor<V>;
  }
  return f(desc) ? desc : NeverDescriptor;
}
