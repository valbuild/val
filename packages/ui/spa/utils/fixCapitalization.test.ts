import { fixCapitalization } from "./fixCapitalization";

describe("fixCapitalization", () => {
  test("should capitalize the first letter of a string", () => {
    expect(fixCapitalization("hello")).toEqual("Hello");
  });

  test("should capitalize the first letter of a string and add a space before each capital letter", () => {
    expect(fixCapitalization("helloWorld")).toEqual("Hello World");
  });
});
