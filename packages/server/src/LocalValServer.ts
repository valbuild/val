import express from "express";
import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import { parsePatch, PatchError } from "@valbuild/core/patch";
import { PatchJSON } from "./patch/validation";
import {
  ENABLE_COOKIE_VALUE,
  getRedirectUrl,
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  ValCookies,
  ValServer,
  ValServerError,
  ValServerJsonResult,
  ValServerRedirectResult,
  ValServerResult,
} from "./ValServer";
import {
  ApiPostPatchResponse,
  ApiTreeResponse,
  Internal,
  ModuleId,
  ModulePath,
} from "@valbuild/core";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

export type LocalValServerOptions = {
  service: Service;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  git: {
    commit?: string;
    branch?: string;
  };
};

const VAL_SESSION_COOKIE = Internal.VAL_SESSION_COOKIE;
const VAL_ENABLED_COOKIE = Internal.VAL_ENABLE_COOKIE_NAME;
type VAL_STATE_COOKIE = typeof Internal.VAL_STATE_COOKIE;

export class LocalValServer implements ValServer {
  constructor(readonly options: LocalValServerOptions) {}

  async session(): Promise<
    ValServerJsonResult<{
      mode: "proxy" | "local";
      member_role?: "owner" | "developer" | "editor";
    }>
  > {
    return {
      status: 200,
      json: {
        mode: "local",
      },
    };
  }

  async getTree(
    treePath: string,
    // TODO: use the params: patch, schema, source
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    query: { patch?: string; schema?: string; source?: string }
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    const rootDir = process.cwd();
    const moduleIds: string[] = [];
    // iterate over all .val files in the root directory
    const walk = async (dir: string) => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if ((await fs.stat(path.join(dir, file))).isDirectory()) {
          if (file === "node_modules") continue;
          await walk(path.join(dir, file));
        } else {
          const isValFile =
            file.endsWith(".val.js") || file.endsWith(".val.ts");
          if (!isValFile) {
            continue;
          }
          if (
            treePath &&
            !path.join(dir, file).replace(rootDir, "").startsWith(treePath)
          ) {
            continue;
          }
          moduleIds.push(
            path
              .join(dir, file)
              .replace(rootDir, "")
              .replace(".val.js", "")
              .replace(".val.ts", "")
          );
        }
      }
    };
    const serializedModuleContent = await walk(rootDir).then(async () => {
      return Promise.all(
        moduleIds.map(async (moduleId) => {
          return await this.options.service.get(
            moduleId as ModuleId,
            "" as ModulePath
          );
        })
      );
    });

    //
    const modules = Object.fromEntries(
      serializedModuleContent.map((serializedModuleContent) => {
        const module: ApiTreeResponse["modules"][keyof ApiTreeResponse["modules"]] =
          {
            schema: serializedModuleContent.schema,
            source: serializedModuleContent.source,
            errors: serializedModuleContent.errors,
          };
        return [serializedModuleContent.path, module];
      })
    );
    const apiTreeResponse: ApiTreeResponse = {
      modules,
      git: this.options.git,
    };
    return {
      status: 200,
      json: apiTreeResponse,
    };
  }

  async enable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>> {
    const redirectToRes = getRedirectUrl(
      query,
      this.options.valEnableRedirectUrl
    );
    if (typeof redirectToRes !== "string") {
      return redirectToRes;
    }
    return {
      cookies: {
        [VAL_ENABLED_COOKIE]: ENABLE_COOKIE_VALUE,
      },
      status: 302,
      redirectTo: redirectToRes,
    };
  }

  async disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>> {
    const redirectToRes = getRedirectUrl(
      query,
      this.options.valDisableRedirectUrl
    );
    if (typeof redirectToRes !== "string") {
      return redirectToRes;
    }
    return {
      cookies: {
        [VAL_ENABLED_COOKIE]: {
          value: null,
        },
      },
      status: 302,
      redirectTo: redirectToRes,
    };
  }

  async postPatches(
    body: unknown
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    // First validate that the body has the right structure
    const patchJSON = z.record(PatchJSON).safeParse(body);
    if (!patchJSON.success) {
      return {
        status: 401,
        json: {
          message: `Invalid patch: ${patchJSON.error.message}`,
          details: patchJSON.error.issues,
        },
      };
    }

    for (const moduleId in patchJSON.data) {
      // Then parse/validate
      // TODO: validate all and then fail instead:
      const patch = parsePatch(patchJSON.data[moduleId]);
      if (result.isErr(patch)) {
        console.error("Unexpected error parsing patch", patch.error);
        throw new Error("Unexpected error parsing patch");
      }
      await this.options.service.patch(moduleId, patch.value);
    }
    return {
      status: 200,
      json: {}, // no patch ids created
    };
  }

  private badRequest(): ValServerError {
    return {
      status: 400,
      json: {
        message: "Local server does not handle this request",
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  async postCommit(): Promise<ValServerJsonResult<{}>> {
    return this.badRequest();
  }

  async authorize(): Promise<ValServerRedirectResult<VAL_SESSION_COOKIE>> {
    return this.badRequest();
  }

  async callback(): Promise<
    ValServerRedirectResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>
  > {
    return this.badRequest();
  }

  async logout(): Promise<
    ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>
  > {
    return this.badRequest();
  }
  async getFiles(): Promise<
    ValServerResult<never, ReadableStream<Uint8Array>>
  > {
    return this.badRequest();
  }

  async getPatches(): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    return this.badRequest();
  }
}
