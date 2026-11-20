import {
  Sketchpad,
  SketchpadSummary,
  type SketchpadT,
} from "@valbuild/shared/internal";
import { z } from "zod";
import {
  isSketchpadId,
  type SketchpadStore,
  type SketchpadUpdate,
} from "./SketchpadStore";

/**
 * Sketchpads in `http` mode: the content service keeps them, per project, at
 * `/v1/{project}/sketchpads` (valbuild/home). This only carries requests
 * there and reads the answers; the version check is the service's, done in
 * one statement.
 */
export function createHttpSketchpadStore(options: {
  /** `${contentUrl}/v1/${project}/sketchpads` */
  url: string;
  headers: Record<string, string>;
}): SketchpadStore {
  const request = async (
    path: string,
    init: { method: string; body?: unknown; by?: string | null },
  ) =>
    fetch(`${options.url}${path}`, {
      method: init.method,
      headers: {
        ...options.headers,
        // WHO, as for a proposal or a commit: the key names the project.
        ...(init.by ? { "x-val-profile-id": init.by } : {}),
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  const failed = async (res: Response, doing: string) =>
    new Error(
      `Val Build could not ${doing} (HTTP ${res.status}): ${await res.text().catch(() => "")}`,
    );

  return {
    async list(filter) {
      const query = new URLSearchParams({ archived: filter.archived });
      if (filter.page !== undefined) {
        query.set("page", filter.page);
      }
      const res = await request(`?${query}`, { method: "GET" });
      if (!res.ok) {
        throw await failed(res, "list the sketchpads");
      }
      return z
        .object({ sketchpads: z.array(SketchpadSummary) })
        .parse(await res.json()).sketchpads;
    },
    async get(id) {
      if (!isSketchpadId(id)) {
        return null;
      }
      const res = await request(`/${encodeURIComponent(id)}`, {
        method: "GET",
      });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw await failed(res, "read the sketchpad");
      }
      return z.object({ sketchpad: Sketchpad }).parse(await res.json())
        .sketchpad;
    },
    async create(input) {
      const res = await request("", {
        method: "POST",
        body: { text: input.text, title: input.title, page: input.page },
        by: input.by,
      });
      if (!res.ok) {
        throw await failed(res, "make the sketchpad");
      }
      return z.object({ sketchpad: Sketchpad }).parse(await res.json())
        .sketchpad;
    },
    async update(id, change): Promise<SketchpadUpdate> {
      if (!isSketchpadId(id)) {
        return { status: "not-found" };
      }
      const { by, ...body } = change;
      const res = await request(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body,
        by,
      });
      if (res.status === 404) {
        return { status: "not-found" };
      }
      if (res.status === 409) {
        const current: SketchpadT = z
          .object({ sketchpad: Sketchpad })
          .parse(await res.json()).sketchpad;
        return { status: "conflict", sketchpad: current };
      }
      if (!res.ok) {
        throw await failed(res, "save the sketchpad");
      }
      return {
        status: "updated",
        sketchpad: z.object({ sketchpad: Sketchpad }).parse(await res.json())
          .sketchpad,
      };
    },
  };
}
