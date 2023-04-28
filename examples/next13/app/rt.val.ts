import { val } from "../val.config";

function richtext(schema: any): any {
  return {
    schema,
  };
}

export const schema = richtext(tailwindConfig);

export default val.content("/app/rt", schema, [
  {
    type: "string",
    children: [{ type: "text", text: "Hello world", className: "" }],
  },
]);
