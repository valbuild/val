import express from "express";
import path from "path";
import { readValFile } from "./readValFile";
import { writeValFile } from "./writeValFile";
import cors from "cors";
import {
  validate,
  applyPatch,
  Operation,
  JsonPatchError,
} from "fast-json-patch";
import { ValidTypes } from "@val/lib/src/ValidTypes";

const PORT = process.env.PORT || 4123;
const ROOT_DIR = path.join(process.cwd(), "..", "..", "examples", "next");

const getFileIdFromParams = (params: { 0: string }) => {
  const id = params[0];
  return id.slice(0, id.indexOf(".") === -1 ? id.length : id.indexOf("."));
};

const main = async () => {
  const app = express();
  // TODO: configure cors properly
  app.use(cors());

  app.get<{ 0: string }>("/ids/*", async (req, res) => {
    try {
      console.log(req.params);
      console.log(
        JSON.stringify(
          await readValFile(ROOT_DIR, getFileIdFromParams(req.params)),
          null,
          2
        )
      );
      const valContent = await readValFile(
        ROOT_DIR,
        getFileIdFromParams(req.params)
      );
      res.json(valContent);
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  });

  app.patch<{ 0: string }>(
    "/ids/*",
    express.json({
      type: "application/json-patch+json",
    }),
    async (req, res) => {
      const patch: Operation[] = req.body;
      // TODO: Validate patch and/or resulting document against schema

      const id = getFileIdFromParams(req.params);
      const document = (await readValFile(ROOT_DIR, id)).val;
      let newDocument: ValidTypes;
      try {
        const result = applyPatch(document, patch, true, false);
        newDocument = result.newDocument;
      } catch (err) {
        if (err instanceof JsonPatchError) {
          res.status(400).json({
            error: err.name,
            index: err.index,
          });
        } else {
          console.error(err);
          res
            .status(500)
            .send(err instanceof Error ? err.message : "Unknown error");
        }
        return;
      }

      try {
        await writeValFile(
          ROOT_DIR,
          getFileIdFromParams(req.params),
          newDocument
        );
        res.send("OK");
      } catch (err) {
        console.error(err);
        res.sendStatus(500);
      }
    }
  );

  const httpServer = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  process.on("SIGTERM", async () => {
    httpServer.close();
  });
};

main();
