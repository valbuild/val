// TODO: delete
// import { ValServer } from "./ValServer";

// export function createRequestHandler(valServer: ValServer): RequestHandler {

//   router.use("/static", createUIRequestHandler());
//   router.get("/session", valServer.session.bind(valServer));
//   router.get("/authorize", valServer.authorize.bind(valServer));
//   router.get("/callback", valServer.callback.bind(valServer));
//   router.get("/logout", valServer.logout.bind(valServer));
//   router
//     .post<{ 0: string }>(
//       "/patches/*",
//       express.json({
//         type: "application/json",
//         limit: "10mb",
//       }),
//       valServer.postPatches.bind(valServer)
//     )
//     .get("/patches/*", valServer.getPatches.bind(valServer));
//   router.post("/commit", valServer.postCommit.bind(valServer));
//   router.get("/enable", valServer.enable.bind(valServer));
//   router.get("/disable", valServer.disable.bind(valServer));
//   router.get("/tree/*", valServer.getTree.bind(valServer));
//   router.get("/files/*", valServer.getFiles.bind(valServer));

//   router.use((req: express.Request, res: express.Response) => {
//     res.status(404).json({
//       statusCode: 404,
//       message: "Not Found",
//       details: `No route found for ${req.method} ${req.url}`,
//     });
//   });
//   router.use((err: Error, req: express.Request, res: express.Response) => {
//     console.error(req.method, req.url, err);

//     // Set the HTTP status code and send a JSON response
//     res.status(500).json({
//       statusCode: 500,
//       message: "Internal Server Error",
//       details: err.message,
//     });
//   });

//   return router;
// }
