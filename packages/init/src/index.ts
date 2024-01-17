import { init } from "./init";

init(process.cwd(), process.argv.includes("--yes")).catch((err) => {
  if (process.argv.includes("--debug")) {
    console.error(err);
  }
});
