import type {
  SketchError,
  SketchpadSummaryT,
  SketchpadT,
  ValClient,
} from "@valbuild/shared/internal";

/**
 * What the Studio does with `/sketchpads` and `/sketchpad`, as results the
 * callers can switch on rather than HTTP statuses: the AI tools, which have
 * to tell the model exactly what went wrong, and the Sketchpad view, which
 * has to tell a person.
 */
export type SketchpadResult =
  | { status: "ok"; sketchpad: SketchpadT }
  /** Not a sketch in the one spelling: which lines, and why. */
  | { status: "refused"; message: string; errors: SketchError[] }
  /** Changed since the version the change was made on: here it is now. */
  | { status: "conflict"; message: string; sketchpad: SketchpadT }
  | { status: "not-found"; message: string }
  | { status: "failed"; message: string };

export type SketchpadListResult =
  | { status: "ok"; sketchpads: SketchpadSummaryT[] }
  | { status: "failed"; message: string };

export type SketchpadClient = {
  list(filter?: {
    archived?: "exclude" | "include" | "only";
    page?: string;
  }): Promise<SketchpadListResult>;
  get(id: string): Promise<SketchpadResult>;
  create(input: {
    text: string;
    page: string | null;
  }): Promise<SketchpadResult>;
  update(change: {
    id: string;
    baseVersion: number;
    text?: string;
    page?: string | null;
    archived?: boolean;
  }): Promise<SketchpadResult>;
};

/**
 * An app on a Val release from before sketchpads answers 404 for the route
 * itself -- told apart from "no such sketchpad" by the `path` the client
 * puts on a 404 it made up.
 */
const NO_ROUTE =
  "This site's Val server has no sketchpads yet. Updating @valbuild in the site adds them.";

function failedMessage(res: { status: number | null; json: unknown }): string {
  const json = res.json;
  if (
    typeof json === "object" &&
    json !== null &&
    "message" in json &&
    typeof json.message === "string"
  ) {
    return json.message;
  }
  return `The sketchpads could not be reached (${res.status ?? "no answer"}).`;
}

export function createSketchpadClient(client: ValClient): SketchpadClient {
  return {
    async list(filter = {}) {
      const res = await client("/sketchpads", "GET", {
        query: { archived: filter.archived, page: filter.page },
      });
      if (res.status === 200) {
        return { status: "ok", sketchpads: res.json.sketchpads };
      }
      if (res.status === 404) {
        return { status: "failed", message: NO_ROUTE };
      }
      return { status: "failed", message: failedMessage(res) };
    },
    async get(id) {
      const res = await client("/sketchpad", "GET", { query: { id } });
      if (res.status === 200) {
        return { status: "ok", sketchpad: res.json.sketchpad };
      }
      return failure(res);
    },
    async create(input) {
      const res = await client("/sketchpads", "POST", { body: input });
      if (res.status === 201) {
        return { status: "ok", sketchpad: res.json.sketchpad };
      }
      return failure(res);
    },
    async update(change) {
      const res = await client("/sketchpad", "PATCH", { body: change });
      if (res.status === 200) {
        return { status: "ok", sketchpad: res.json.sketchpad };
      }
      if (res.status === 409) {
        return {
          status: "conflict",
          message: res.json.message,
          sketchpad: res.json.sketchpad,
        };
      }
      return failure(res);
    },
  };
}

function failure(res: {
  status: number | null;
  json: unknown;
}): SketchpadResult {
  const json = res.json;
  if (res.status === 400) {
    const errors =
      typeof json === "object" &&
      json !== null &&
      "errors" in json &&
      Array.isArray(json.errors)
        ? json.errors.filter(isSketchError)
        : [];
    return { status: "refused", message: failedMessage(res), errors };
  }
  if (res.status === 404) {
    const routeMissing =
      typeof json === "object" && json !== null && "path" in json;
    return routeMissing
      ? { status: "failed", message: NO_ROUTE }
      : { status: "not-found", message: failedMessage(res) };
  }
  return { status: "failed", message: failedMessage(res) };
}

function isSketchError(value: unknown): value is SketchError {
  return (
    typeof value === "object" &&
    value !== null &&
    "line" in value &&
    typeof value.line === "number" &&
    "message" in value &&
    typeof value.message === "string"
  );
}
