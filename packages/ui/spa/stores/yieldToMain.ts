/**
 * Let the browser do something else before going on: a click, a keystroke, a
 * frame. Resolves in a later task, never in a microtask, because a microtask
 * runs before the browser gets a turn and so yields nothing.
 *
 * For work that is long only because there is a lot of it -- loading every
 * `.jsonValues()` entry of a record, a batch at a time -- so that it is many
 * short tasks rather than one long one, and the Studio can be used while it
 * runs (phase 10's "no long task over 50 ms").
 *
 * A `MessageChannel` message rather than `setTimeout(0)`: browsers clamp a
 * nested timeout to 4 ms, which on thousands of batches is seconds of doing
 * nothing, and a message is not clamped (React's scheduler yields the same
 * way). `setTimeout` where there is no `MessageChannel`. Not on a fake clock
 * either: a fake `setTimeout` would hold a load until a test moved time.
 */
export function yieldToMain(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      // Closed, or Node keeps the process alive for a port nobody uses.
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
