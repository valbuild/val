import * as repl from "repl";
import { result, pipe } from "../../fp";
import { newSelectorProxy, selectorToVal } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { evaluate } from "./eval";
import { parse } from "./parser";

const sources = {
  "/app/text": "text1",
  "/numbers": [1, 2, 3],
  "/blogs": [
    { title: "title1", text: "text1" },
    { title: "title2", text: "text2" },
  ],
};

repl
  .start({
    prompt: "β > ",
    eval: (
      cmd,
      context,
      filename,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (arg0: any, arg1: any) => void
    ) => {
      const res = parse(cmd);
      if (result.isErr(res)) {
        let lines = "\n\x1b[31m";
        lines +=
          res.error.message[0]?.toUpperCase() +
          res.error.message.slice(1) +
          ` (${res.error.span?.[0]}:${res.error.span?.[1]})` +
          ":\x1b[0m\n\n";
        lines += cmd + "\n";
        let underline = "\x1b[31m";
        for (let i = 0; i < cmd.length; i++) {
          if (
            res.error.span &&
            i >= res.error.span[0] &&
            i <= (res.error.span?.[1] === undefined ? -1 : res.error.span?.[1])
          ) {
            underline += "^";
          } else {
            if (cmd[i] === "\n") {
              if (!underline.includes("^")) {
                underline = "";
              }
            } else {
              underline += " ";
            }
          }
        }
        lines += underline + "\x1b[0m\n";
        callback(null, lines);
      } else {
        pipe(
          evaluate(
            res.value,
            (ref) =>
              newSelectorProxy(
                sources[ref as keyof typeof sources],
                ref as SourcePath
              ),

            []
          ),
          result.map((v) => {
            try {
              console.log(selectorToVal(v).val);
              callback(null, undefined);
            } catch (e) {
              callback(
                null,
                `\x1b[31mInvalid function! Expected selector, but got:\x1b[0m:\n${JSON.stringify(
                  v
                )}\n\nDetails: ${
                  e instanceof Error ? e.message : JSON.stringify(e)
                }`
              );
            }
          })
        );
      }
    },
    ignoreUndefined: true,
    writer: (output) => {
      return output;
    },
  })
  .setupHistory(".repl_history", () => {
    //
  });
