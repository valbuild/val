import {
  checkSketch,
  parseSketch,
  SKETCHPAD_MAX_TEXT_LENGTH,
  sketchTitle,
  type Api,
  type ServerOf,
  type SketchError,
} from "@valbuild/shared/internal";
import type { SketchpadFilter, SketchpadStore } from "./SketchpadStore";

/**
 * `/sketchpads` and `/sketchpad`. Here rather than inline in `ValServer` so
 * the rules every mode shares are in one place: a text is a sketch in the
 * one spelling or it is refused, line by line; an archived sketchpad is
 * reopened before it is changed; a change names the version it was made on.
 */
export function createSketchpadRoutes<
  Auth extends { error?: string | null },
>(options: {
  store: () => SketchpadStore;
  /** `ValServer`'s: an `error` is a reason to answer 401. */
  getAuth: (cookies: Partial<Record<"val_session", string>>) => Auth;
  profileOf: (auth: Auth) => string | null;
}): Pick<ServerOf<Api>, "/sketchpads" | "/sketchpad"> {
  const { store, getAuth, profileOf } = options;

  return {
    "/sketchpads": {
      GET: async (req) => {
        const auth = getAuth(req.cookies);
        if (auth.error) {
          return { status: 401, json: { message: auth.error } };
        }
        const archived = req.query.archived ?? "exclude";
        if (!isArchivedFilter(archived)) {
          return {
            status: 400,
            json: {
              message: `"archived" is exclude, include or only, not "${archived}".`,
            },
          };
        }
        try {
          const sketchpads = await store().list({
            archived,
            ...(req.query.page !== undefined ? { page: req.query.page } : {}),
          });
          return { status: 200, json: { sketchpads } };
        } catch (error) {
          return failed(error);
        }
      },
      POST: async (req) => {
        const auth = getAuth(req.cookies);
        if (auth.error) {
          return { status: 401, json: { message: auth.error } };
        }
        const refused = refuseText(req.body.text);
        if (refused) {
          return refused;
        }
        try {
          const sketchpad = await store().create({
            text: req.body.text,
            title: titleOf(req.body.text),
            page: req.body.page,
            by: profileOf(auth),
          });
          return { status: 201, json: { sketchpad } };
        } catch (error) {
          return failed(error);
        }
      },
    },
    "/sketchpad": {
      GET: async (req) => {
        const auth = getAuth(req.cookies);
        if (auth.error) {
          return { status: 401, json: { message: auth.error } };
        }
        try {
          const sketchpad = await store().get(req.query.id);
          if (sketchpad === null) {
            return notFound(req.query.id);
          }
          return { status: 200, json: { sketchpad } };
        } catch (error) {
          return failed(error);
        }
      },
      PATCH: async (req) => {
        const auth = getAuth(req.cookies);
        if (auth.error) {
          return { status: 401, json: { message: auth.error } };
        }
        const { id, baseVersion, text, page, archived } = req.body;
        if (text !== undefined) {
          const refused = refuseText(text);
          if (refused) {
            return refused;
          }
        }
        try {
          const current = await store().get(id);
          if (current === null) {
            return notFound(id);
          }
          // Reopening is the one change an archived sketchpad takes, and it
          // can come with others: "reopen and put this in it".
          if (
            current.archived &&
            archived !== false &&
            (text !== undefined || page !== undefined)
          ) {
            return {
              status: 400,
              json: {
                message:
                  "This sketchpad is archived, so it is not changed. Reopen it first (archived: false), or ask the person to.",
              },
            };
          }
          const result = await store().update(id, {
            baseVersion,
            ...(text !== undefined ? { text, title: titleOf(text) } : {}),
            ...(page !== undefined ? { page } : {}),
            ...(archived !== undefined ? { archived } : {}),
            by: profileOf(auth),
          });
          if (result.status === "not-found") {
            return notFound(id);
          }
          if (result.status === "conflict") {
            return {
              status: 409,
              json: {
                message: `The sketchpad changed since version ${baseVersion}: it is at version ${result.sketchpad.version} now. Here it is; make the change again on top of it.`,
                sketchpad: result.sketchpad,
              },
            };
          }
          return { status: 200, json: { sketchpad: result.sketchpad } };
        } catch (error) {
          return failed(error);
        }
      },
    },
  };
}

function isArchivedFilter(value: string): value is SketchpadFilter["archived"] {
  return value === "exclude" || value === "include" || value === "only";
}

function titleOf(text: string): string | null {
  return sketchTitle(parseSketch(text).blocks);
}

type Refused = {
  status: 400;
  json: { message: string; errors?: SketchError[] };
};
type NotFound = { status: 404; json: { message: string } };
type Failed = { status: 500; json: { message: string } };

/** A 400 for a text the server will not keep, saying which lines and why. */
function refuseText(text: string): Refused | null {
  if (text.length > SKETCHPAD_MAX_TEXT_LENGTH) {
    return {
      status: 400,
      json: {
        message: `A sketchpad holds at most ${SKETCHPAD_MAX_TEXT_LENGTH / 1024} KiB of text; this is ${Math.ceil(text.length / 1024)} KiB.`,
      },
    };
  }
  const errors: SketchError[] = checkSketch(text);
  if (errors.length === 0) {
    return null;
  }
  return {
    status: 400,
    json: {
      message: `That is not a sketch the Sketchpad can show: ${errors
        .map((error) => `line ${error.line}: ${error.message}`)
        .join(" ")}`,
      errors,
    },
  };
}

function notFound(id: string): NotFound {
  return {
    status: 404,
    json: {
      message: `There is no sketchpad "${id}" in this project.`,
    },
  };
}

function failed(error: unknown): Failed {
  return {
    status: 500,
    json: {
      message:
        error instanceof Error
          ? error.message
          : "The sketchpads could not be reached.",
    },
  };
}
