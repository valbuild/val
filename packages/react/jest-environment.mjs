import { TestEnvironment as JSDOMEnvironment } from "jest-environment-jsdom";

/**
 * JSDOM currently does not support TextEncoder/TextDecoder...
 * @see https://github.com/jsdom/jsdom/issues/2524
 */
class TestEnvironment extends JSDOMEnvironment {
  async setup() {
    await super.setup();
    if (typeof this.global.TextEncoder === "undefined") {
      this.global.TextEncoder = TextEncoder;
      this.global.TextDecoder = TextDecoder;
    }
  }
}

export default TestEnvironment;
