import { RuleTester } from "@typescript-eslint/rule-tester";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["no-illegal-imports"];

RuleTester.setDefaultConfig({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",

    ecmaFeatures: {},
  },
});

const ruleTester = new RuleTester();

ruleTester.run("no-illegal-imports", rule, {
  valid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config';
import { eventSchema } from './event.val';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';
import { eventSchema } from './event.val.ts';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';
import type { Event } from './eventSchema';

export const schema = s.array(s.string());
type Test = Event;
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';
import { type Event } from './eventSchema';

export const schema = s.array(s.string());
type Test = Event;
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';

export const schema = s.string();
export default val.content('/foo/test', schema, 'String')`,
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config';
import { eventSchema } from './event';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
      errors: [
        {
          message:
            "Val: can only 'import type' or import from source that is either: a .val.{j,t}s file, a @valbuild package, or val.config.{j,t}s.",
        },
      ],
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config';
import { eventSchema, type Unused } from './event';

export const schema = s.array(eventSchema);
type Event = Unused;
export default val.content('/foo/test', schema, [])`,
      errors: [
        {
          message:
            "Val: can only 'import type' or import from source that is either: a .val.{j,t}s file, a @valbuild package, or val.config.{j,t}s.",
        },
      ],
    },
  ],
});
