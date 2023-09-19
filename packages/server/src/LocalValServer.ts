import express from "express";
import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import { parsePatch, PatchError } from "@valbuild/core/patch";
import { getPathFromParams } from "./expressHelpers";
import { PatchJSON } from "./patch/validation";
import { ValServer } from "./ValServer";
import {
  ApiTreeResponse,
  Internal,
  ModuleId,
  ModulePath,
} from "@valbuild/core";
import { disable, enable } from "./ProxyValServer";
import { promises as fs } from "fs";
import path from "path";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";

export type LocalValServerOptions = {
  service: Service;
  git: {
    commit?: string;
    branch?: string;
  };
};

export class LocalValServer implements ValServer {
  constructor(readonly options: LocalValServerOptions) {}

  // TODO: remove
  getAllModules(req: express.Request, res: express.Response): Promise<void> {
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
          if (file.endsWith(".val.js") || file.endsWith(".val.ts")) {
            moduleIds.push(
              path
                .join(dir, file)
                .replace(rootDir, "")
                .replace(".val.js", "")
                .replace(".val.ts", "")
            );
          }
        }
      }
    };

    return walk(rootDir).then(async () => {
      res.send(
        JSON.stringify(
          await Promise.all(
            moduleIds.map(async (moduleId) => {
              return await this.options.service.get(
                moduleId as ModuleId,
                "" as ModulePath
              );
            })
          )
        )
      );
    });
  }

  async session(_req: express.Request, res: express.Response): Promise<void> {
    res.json({
      mode: "local",
    });
  }

  async getTree(
    req: express.Request<
      ParamsDictionary,
      any,
      any,
      ParsedQs,
      Record<string, any>
    >,
    res: express.Response<any, Record<string, any>>
  ): Promise<void> {
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
          if (file.endsWith(".val.js") || file.endsWith(".val.ts")) {
            moduleIds.push(
              path
                .join(dir, file)
                .replace(rootDir, "")
                .replace(".val.js", "")
                .replace(".val.ts", "")
            );
          }
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
    const modules = Object.fromEntries(
      serializedModuleContent.map((serializedModuleContent) => {
        const module: ApiTreeResponse["modules"][keyof ApiTreeResponse["modules"]] =
          {
            schema: serializedModuleContent.schema,
            source: serializedModuleContent.source,
          };
        return [serializedModuleContent.path, module];
      })
    );
    const apiTreeResponse: ApiTreeResponse = {
      modules,
      git: this.options.git,
    };
    return walk(rootDir).then(async () => {
      res.send(JSON.stringify(apiTreeResponse));
    });
  }

  async enable(req: express.Request, res: express.Response): Promise<void> {
    return enable(req, res);
  }

  async disable(req: express.Request, res: express.Response): Promise<void> {
    return disable(req, res);
  }

  async getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    try {
      console.log(req.params);
      const path = getPathFromParams(req.params);
      const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(path);

      const valModule = await this.options.service.get(moduleId, modulePath);

      res.json(valModule);
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  }

  async patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    // First validate that the body has the right structure
    const patchJSON = PatchJSON.safeParse(req.body);
    if (!patchJSON.success) {
      res.status(401).json(patchJSON.error.issues);
      return;
    }
    // Then parse/validate
    const patch = parsePatch(patchJSON.data);
    if (result.isErr(patch)) {
      res.status(401).json(patch.error);
      return;
    }
    const id = getPathFromParams(req.params);
    try {
      const valModule = await this.options.service.patch(id, patch.value);
      res.json(valModule);
    } catch (err) {
      if (err instanceof PatchError) {
        res.status(401).send(err.message);
      } else {
        console.error(err);
        res
          .status(500)
          .send(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
  private async badRequest(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    console.debug("Local server does handle this request", req.url);
    res.sendStatus(400);
  }

  commit(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  authorize(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  callback(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  logout(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }
}
