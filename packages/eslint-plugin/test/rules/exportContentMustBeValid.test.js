import { RuleTester } from "@typescript-eslint/rule-tester";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["export-content-must-be-valid"];

RuleTester.setDefaultConfig({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
    ecmaFeatures: {},
  },
});

const ruleTester = new RuleTester();

ruleTester.run("export-content-must-be-valid", rule, {
  valid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { c, s } from '../val.config';

export const schema = s.string();
export default c.define('/foo/test', schema, '')`,
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "./foo/test.ts"),
      code: `
import { c, s } from '../val.config';

export const schema = s.string();
export default c.define('/foo/test', schema, '')`,
      errors: [
        {
          message: "Val: c.define should only be exported from .val files",
        },
      ],
    },
    {
      filename: path.join(process.cwd(), "./foo/test.js"),
      code: `
import { c, s } from '../val.config';

export const schema = s.string();
export default c.define('/foo/test', schema, '')`,
      errors: [
        {
          message: "Val: c.define should only be exported from .val files",
        },
      ],
    },
  ],
});
