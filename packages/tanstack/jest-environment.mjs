import { TestEnvironment as JSDOMEnvironment } from "jest-environment-jsdom";
import { ReadableStream } from "node:stream/web";

/**
 * JSDOM does not provide a few globals that @valbuild/core and
 * @valbuild/shared reference at module load (TextEncoder/TextDecoder and
 * ReadableStream), so we polyfill them from Node onto the test global.
 * @see https://github.com/jsdom/jsdom/issues/2524
 */
class TestEnvironment extends JSDOMEnvironment {
  async setup() {
    await super.setup();
    if (typeof this.global.TextEncoder === "undefined") {
      this.global.TextEncoder = TextEncoder;
      this.global.TextDecoder = TextDecoder;
    }
    if (typeof this.global.ReadableStream === "undefined") {
      this.global.ReadableStream = ReadableStream;
    }
  }
}

export default TestEnvironment;
