import { lexer } from "./lexer";

const cases: {
  description: string;
  input: string;
}[] = [
  {
    description: "basic",
    input: `
# Title 1

## Title 2

### Title 3

#### Title 4

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2
`,
  },
  {
    description: "escapes",
    input: `\\## test   hei

    
    test
    `,
    //     input: `
    // \\*not emphasized*
    // \\<br/> not a tag
    // 1\\. not a list
    // \\* not a list
    // \\# not a heading
    // `,
  },
  {
    description: "all features",
    input: `
# Title 1

Title 1 content.

## Title 2

Title 2 content.

### Title 3

Title 3 content.

#### Title 4

Title 4 content.

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2

More Text

<br />

  Even more

<br />

- List 1
    1. List 1.1
    1. List 1.2
- List 2
- List 3
    1. Formatted **list**<br />
Test 123
`,
  },
];

describe("lexer", () => {
  test.each(cases)("$description", ({ input }) => {
    console.log(lexer(input));
  });
});
