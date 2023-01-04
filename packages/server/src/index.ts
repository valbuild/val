import express from "express";
import path from "path";
import { readValFile } from "./readValFile";

const PORT = process.env.PORT || 4123;
const ROOT_DIR = path.join(process.cwd(), "..", "..", "examples", "next");

const main = async () => {
  const app = express();

  app.get<{ 0: string; id: string }>("/ids/:id*", async (req, res) => {
    try {
      console.log(req.params);
      const id = req.params.id + "/" + req.params[0];
      const fileId = id.slice(
        0,
        id.indexOf(".") === -1 ? id.length : id.indexOf(".")
      );
      console.log(JSON.stringify(await readValFile(ROOT_DIR, fileId), null, 2));
      res.send("OK");
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  });

  app.post<{ id: string }>("/ids/:id*", express.json(), async (req, res) => {
    console.log("post req.params.id", req.params.id);
    res.send("OK");
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  process.on("SIGTERM", async () => {
    httpServer.close();
  });
};

main();
