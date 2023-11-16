import express from "express";
import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import { parsePatch, PatchError } from "@valbuild/core/patch";
import { PatchJSON } from "./patch/validation";
import { ValServer } from "./ValServer";
import { ApiTreeResponse, ModuleId, ModulePath } from "@valbuild/core";
import { disable, enable } from "./ProxyValServer";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

export type LocalValServerOptions = {
  service: Service;
  git: {
    commit?: string;
    branch?: string;
  };
};

export class LocalValServer implements ValServer {
  constructor(readonly options: LocalValServerOptions) {}

  async session(_req: express.Request, res: express.Response): Promise<void> {
    res.json({
      mode: "local",
    });
  }

  async getTree(req: express.Request, res: express.Response): Promise<void> {
    try {
      // TODO: use the params: patch, schema, source
      const treePath = req.params["0"].replace("~", "");
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
      res.send(JSON.stringify(apiTreeResponse));
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  }

  async enable(req: express.Request, res: express.Response): Promise<void> {
    return enable(req, res);
  }

  async disable(req: express.Request, res: express.Response): Promise<void> {
    return disable(req, res);
  }

  async postPatches(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    // First validate that the body has the right structure
    const patchJSON = z.record(PatchJSON).safeParse(req.body);
    if (!patchJSON.success) {
      res.status(401).json(patchJSON.error.issues);
      return;
    }

    try {
      for (const moduleId in patchJSON.data) {
        // Then parse/validate
        // TODO: validate all and then fail instead:
        const patch = parsePatch(patchJSON.data[moduleId]);
        if (result.isErr(patch)) {
          res.status(401).json(patch.error);
          return;
        }
        await this.options.service.patch(moduleId, patch.value);
      }
      res.json({});
    } catch (err) {
      if (err instanceof PatchError) {
        res.status(400).send({ message: err.message });
      } else {
        console.error(err);
        res.status(500).send({
          message: err instanceof Error ? err.message : "Unknown error",
        });
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
  getFiles(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  getPatches(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }
}
