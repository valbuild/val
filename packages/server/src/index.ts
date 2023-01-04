import express from "express";

const PORT = process.env.PORT || 4123;

const main = async () => {
  const app = express();

  app.get<{ id: string }>("/ids/:id*", async (req, res) => {
    res.send("OK");
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
