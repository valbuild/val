import express from "express";
import path from "path";
import { readValFile } from "./readValFile";
import { writeValFile } from "./writeValFile";
import cors from "cors";

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

  app.post<{ 0: string }>("/ids/*", express.json(), async (req, res) => {
    console.log("post req.params", req.params);
    console.log(getFileIdFromParams(req.params));
    console.log(req.body);

    try {
      await writeValFile(ROOT_DIR, getFileIdFromParams(req.params), req.body);
      res.send("OK");
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  process.on("SIGTERM", async () => {
    httpServer.close();
  });
};

main();
