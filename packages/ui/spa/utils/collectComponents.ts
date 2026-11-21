import type {
  Json,
  JsonObject,
  ModuleFilePath,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { sourcePathOfItem } from "./sourcePathOfItem";

/**
 * EXPERIMENTAL: a component the project links to an object
 * (`s.object(...).component(() => import(...))`), as the Studio's Components
 * view shows it: one entry per component, with every place it is used.
 */
export type StudioComponent = {
  /**
   * Which component this is, stable while its schema is: see
   * {@link componentIdOf}. What the view's address names.
   */
  id: string;
  /** What the Studio calls it. See {@link componentNameOf}. */
  name: string;
  /** Whether {@link name} was given (`.component(load, { name })`). */
  named: boolean;
  /** Whether `.component(load, { example })` gave it one to preview with. */
  hasExample: boolean;
  /**
   * Where the schemas link it, whether or not any content uses it: the
   * module, and the way down to the object in its schema with `*` for an
   * item of a list. What the assistant is told, so it can find the
   * `.component(...)` call and, through its `import()`, the component.
   */
  linkedAt: ComponentLink[];
  /** Every value of it in the content, in module and document order. */
  instances: SourcePath[];
};

export type ComponentLink = {
  moduleFilePath: ModuleFilePath;
  /** `sections.*.cards.*`: the schema path, `""` for the module's root. */
  at: string;
};

/** How deep a schema is walked before it is taken to be a mistake. */
const MAX_DEPTH = 64;

/**
 * EXPERIMENTAL: every component the project links, and where the content
 * uses each one.
 *
 * Read off the serialized schemas, which carry the marker
 * (`render: { as: "component" }`) and not the component itself, and the
 * sources, which say how many items a list has and which variant of a union
 * each one is.
 *
 * A component is the same one wherever its schema is: the same `hero`
 * reused in two modules serializes the same way, and is one entry with the
 * instances of both. Two that are written alike are one entry too, which is
 * a fair reading of "the same component".
 *
 * Instances are collected only from sources that are loaded: a
 * `.jsonValues()` entry the Studio has not fetched has none yet.
 */
export function collectComponents(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>,
): StudioComponent[] {
  const byId = new Map<string, Building>();
  const entryOf = (schema: SerializedObjectSchema): Building => {
    const id = componentIdOf(schema);
    let entry = byId.get(id);
    if (entry === undefined) {
      entry = {
        id,
        schema,
        linkedAt: [],
        instances: [],
        usedUnder: [],
      };
      byId.set(id, entry);
    }
    return entry;
  };

  const moduleFilePaths = (Object.keys(schemas) as ModuleFilePath[]).sort();
  for (const moduleFilePath of moduleFilePaths) {
    const schema = schemas[moduleFilePath];
    walkSchema(schema, [], 0, (object, at, under) => {
      const entry = entryOf(object);
      const joined = at.join(".");
      if (
        !entry.linkedAt.some(
          (link) =>
            link.moduleFilePath === moduleFilePath && link.at === joined,
        )
      ) {
        entry.linkedAt.push({ moduleFilePath, at: joined });
      }
      if (under !== null) {
        entry.usedUnder.push(under);
      }
    });
    if (moduleFilePath in sources) {
      walkSource(
        schema,
        sources[moduleFilePath],
        moduleFilePath,
        0,
        (object, path) => {
          entryOf(object).instances.push(path);
        },
      );
    }
  }

  const named = [...byId.values()].map((entry) => ({
    entry,
    ...componentNameOf(entry.schema, entry.usedUnder),
  }));
  // Two that would be called the same are told apart by a number, in the
  // order they were found, so the names are stable while the schemas are.
  const seen = new Map<string, number>();
  return named.map(({ entry, name, named }) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return {
      id: entry.id,
      name: count === 1 ? name : `${name} ${count}`,
      named,
      hasExample: entry.schema.render?.example === true,
      linkedAt: entry.linkedAt,
      instances: entry.instances,
    };
  });
}

/**
 * Whether any schema links a component, read off the schemas alone: what
 * decides whether the Studio offers its Components view at all.
 */
export function hasLinkedComponents(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): boolean {
  let found = false;
  for (const schema of Object.values(schemas)) {
    walkSchema(schema, [], 0, () => {
      found = true;
    });
    if (found) return true;
  }
  return false;
}

type Building = {
  id: string;
  schema: SerializedObjectSchema;
  linkedAt: ComponentLink[];
  instances: SourcePath[];
  /** The field names it was found under, nearest first: for its name. */
  usedUnder: string[];
};

function isComponentObject(
  schema: SerializedSchema,
): schema is SerializedObjectSchema {
  return schema.type === "object" && schema.render?.as === "component";
}

/**
 * Every linked object in a schema, with the schema path down to it and the
 * nearest field name above it (`null` at the root).
 */
function walkSchema(
  schema: SerializedSchema,
  at: string[],
  depth: number,
  found: (
    object: SerializedObjectSchema,
    at: string[],
    under: string | null,
  ) => void,
  under: string | null = null,
) {
  if (depth > MAX_DEPTH) return;
  if (isComponentObject(schema)) {
    found(schema, at, under);
  }
  switch (schema.type) {
    case "object":
      for (const [key, item] of Object.entries(schema.items)) {
        walkSchema(item, [...at, key], depth + 1, found, key);
      }
      return;
    case "array":
    case "record":
      walkSchema(schema.item, [...at, "*"], depth + 1, found, under);
      return;
    case "discriminated-union":
      // The variants share the union's path
      for (const variant of schema.items) {
        walkSchema(variant, at, depth + 1, found, under);
      }
      return;
    default:
      return;
  }
}

/** Every value of a linked object in a module's source, by its path. */
function walkSource(
  schema: SerializedSchema,
  source: Json | undefined,
  path: string,
  depth: number,
  found: (object: SerializedObjectSchema, path: SourcePath) => void,
) {
  if (depth > MAX_DEPTH || source === null || source === undefined) return;
  switch (schema.type) {
    case "object": {
      if (!isJsonObject(source)) return;
      if (isComponentObject(schema)) {
        found(schema, path as SourcePath);
      }
      for (const [key, item] of Object.entries(schema.items)) {
        walkSource(
          item,
          source[key],
          sourcePathOfItem(path, key),
          depth + 1,
          found,
        );
      }
      return;
    }
    case "array": {
      if (!Array.isArray(source)) return;
      source.forEach((item, index) => {
        walkSource(
          schema.item,
          item,
          sourcePathOfItem(path, index),
          depth + 1,
          found,
        );
      });
      return;
    }
    case "record": {
      if (!isJsonObject(source)) return;
      for (const [key, item] of Object.entries(source)) {
        walkSource(
          schema.item,
          item,
          sourcePathOfItem(path, key),
          depth + 1,
          found,
        );
      }
      return;
    }
    case "discriminated-union": {
      if (!isJsonObject(source)) return;
      const tag = source[schema.key];
      const variant = schema.items.find((item) => {
        const tagSchema = item.items[schema.key];
        return tagSchema?.type === "literal" && tagSchema.value === tag;
      });
      if (variant !== undefined) {
        walkSource(variant, source, path, depth + 1, found);
      }
      return;
    }
    default:
      return;
  }
}

function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Which component an object schema links, as a short string: a hash of its
 * serialized form, keys sorted.
 *
 * From the serialized schema because that is all the Studio has - the
 * component is a closure in the host app. So it changes when the fields do,
 * which leaves a link to the view pointing at nothing until it is followed
 * again from the list.
 */
export function componentIdOf(schema: SerializedObjectSchema): string {
  return fnv1a(stableStringify(schema));
}

/**
 * What the Studio calls a component: the name it was given; else the value
 * of its object's literal field, which in a list of sections is the kind
 * (`type: s.literal("hero")` is "Hero"); else the field it is used in,
 * singular when it is a list of them (`cards` is "Card").
 */
export function componentNameOf(
  schema: SerializedObjectSchema,
  usedUnder: readonly string[],
): { name: string; named: boolean } {
  const given = schema.render?.name?.trim();
  if (given) {
    return { name: given, named: true };
  }
  for (const item of Object.values(schema.items)) {
    if (item.type === "literal" && typeof item.value === "string") {
      return { name: humanize(item.value), named: false };
    }
  }
  const field = usedUnder[0];
  if (field !== undefined) {
    return { name: humanize(singular(field)), named: false };
  }
  return { name: "Component", named: false };
}

/** `callToAction`, `call-to-action` and `call_to_action` are "Call to action". */
function humanize(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return identifier;
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 1) {
    return word.slice(0, -1);
  }
  return word;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a, 32 bits, in base 36: short enough for an address. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
