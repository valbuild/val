/**
 * The browser's `XMLHttpRequest`, as far as the Studio's upload uses it
 * (`uploadFile` in `createValSystem`: `open`, `setRequestHeader`, `send`,
 * `status`, `responseText`, the `load` and `error` events and
 * `upload.addEventListener("progress")`), sending through the world's
 * network. Node has none, and like `fetch` it is the network: an edge the
 * world stands in for, not Val's code.
 */
type Send = (input: string, init: RequestInit) => Promise<Response>;

export function installXmlHttpRequest(send: Send): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");

  class WorldXmlHttpRequest {
    status = 0;
    statusText = "";
    responseText = "";
    responseType = "";
    readonly upload = { addEventListener: () => {} };
    private method = "GET";
    private url = "";
    private readonly headers = new Headers();
    private readonly listeners: Record<string, Array<() => void>> = {};

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    addEventListener(type: string, listener: () => void) {
      (this.listeners[type] ??= []).push(listener);
    }
    send(body: string | null) {
      void send(this.url, {
        method: this.method,
        headers: this.headers,
        body,
      }).then(
        async (response) => {
          this.status = response.status;
          this.statusText = response.statusText;
          this.responseText = await response.text();
          this.emit("load");
        },
        () => this.emit("error"),
      );
    }
    private emit(type: string) {
      for (const listener of this.listeners[type] ?? []) listener();
    }
  }

  Object.defineProperty(globalThis, "XMLHttpRequest", {
    value: WorldXmlHttpRequest,
    configurable: true,
    writable: true,
  });
  return () => {
    if (before) {
      Object.defineProperty(globalThis, "XMLHttpRequest", before);
    } else {
      Reflect.deleteProperty(globalThis, "XMLHttpRequest");
    }
  };
}
