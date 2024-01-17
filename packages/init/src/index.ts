import { init } from "./init";

init("/tmp/my-app", process.argv.includes("--yes")).catch((err) => {
  if (process.argv.includes("--debug")) {
    console.error(err);
  }
});
