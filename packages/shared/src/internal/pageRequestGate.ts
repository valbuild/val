/**
 * What `interact_page` lets the page send to the site's server while an
 * action runs.
 *
 * The preview is the real site, and its backend is real. The first line of
 * defence is the person: every click and every Enter or Space in the
 * preview is asked about BEFORE it is dispatched (`pageInteraction.ts`).
 * This is the second, for the actions that are not asked about -- typing,
 * other keys, opening a page, changing the width -- and for the off-site
 * rule, which holds for every action.
 *
 * ## `hold`: for the actions nobody approved
 *
 * From the moment the action is dispatched until the page has settled:
 *
 * - `fetch`, `XMLHttpRequest` and `navigator.sendBeacon` with a method that
 *   sends data (anything but GET, HEAD and OPTIONS) are not sent. The page's
 *   `fetch` gets a promise that has not settled yet; its XHR has not been
 *   sent; its beacon was "queued".
 * - A form submitted with such a method -- natively, caught by a
 *   capture-phase `submit` listener on the window, or by `form.submit()`,
 *   which fires no event and is wrapped -- is not submitted.
 *
 * What was held is shown to the person -- method, the address the browser
 * resolved, and an excerpt of the body -- and Allow sends exactly that
 * (`releaseHold`), as it was SNAPSHOT when it was held: a `Request` copy, a
 * `FormData` of the form at that moment. Anything else, or
 * {@link HOLD_TIMEOUT_MS} with no answer, refuses it as an abort. What this
 * gate cannot read -- an address it cannot resolve, a method it cannot see
 * -- is held, not let through.
 *
 * ## `off-site`: for an action the person approved
 *
 * The action is the person's, so the page does exactly what it would for
 * them: nothing same-site is held, and no same-site submit is cancelled --
 * React form actions and routers that bail on `defaultPrevented` work. Only
 * data sent to ANOTHER site, and a form that would take the frame to another
 * site or window, are refused. In both modes that is refused without
 * asking: the preview stays on the site.
 *
 * ## Not covered, in either mode
 *
 * Requests a page sends while it loads (a gate starts with an action, in a
 * document that is already there), requests sent after the page settled
 * (an autosave on a timer), WebSocket and EventSource traffic, workers,
 * embedded frames, a reference to the original `fetch` or
 * `XMLHttpRequest.prototype.send` taken before the action, an XHR opened
 * before the action, GET, HEAD and OPTIONS requests -- to other sites too,
 * where a query string can carry data -- image and script loads, and GET
 * navigations: links, which can have side effects of their own (a logout
 * link, an unsubscribe link), and script navigations and redirects, which
 * can leave the site.
 *
 * A body that cannot be copied as it is (a stream, a document) is not held
 * but refused, so what Allow sends is always what the person was shown.
 *
 * Every wrapper knows when its gate has stopped and then passes straight
 * through to what it wrapped, so a page or an SDK that wraps `fetch` again
 * during an action, or two gates that overlap, leave nothing stuck behind.
 * Nothing here runs outside the Studio's frame: only the canvas bridge
 * calls it.
 */

/** The page's window, as `window` is typed: with its own constructors. */
type Win = Window & typeof globalThis;

/** A request the page tried to make during an action. */
export type PageRequest = {
  via: "fetch" | "xhr" | "beacon" | "form";
  /** Upper case: `POST`. `UNKNOWN` when it could not be read. */
  method: string;
  /** Absolute, as the browser resolved it; empty when it could not be. */
  url: string;
  /** A short excerpt of what it sends: form fields, JSON, or its size. */
  body?: string;
};

/**
 * The most requests one hold keeps. More than this is refused outright
 * rather than shown in part: the person must see everything Allow sends. The
 * Studio checks the same number.
 */
export const MAX_HELD_REQUESTS = 10;

/** How much of a request's body the person is shown. */
export const BODY_EXCERPT_LENGTH = 200;

/**
 * A held request, and how to send or refuse it. `send` says why it could
 * not be sent, if it could not.
 */
type Held = PageRequest & {
  send: () => string | undefined;
  refuse: () => void;
};

/** The methods that only read: let through. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * How long a hold waits for the person -- a card can sit for a while --
 * before what it holds is refused.
 */
export const HOLD_TIMEOUT_MS = 10 * 60_000;

export type GateMode = "hold" | "off-site";

export type RequestGate = {
  /** What was held so far. */
  held: () => readonly PageRequest[];
  /** What was refused for going to another site, or for leaving it. */
  blocked: () => readonly PageRequest[];
  /** XHRs let through and not finished: counted as in flight. */
  inFlight: () => number;
  /**
   * Stop: every wrapper passes straight through from now on, and is put
   * back where nothing wrapped it since. What was held stays held, and is
   * returned: hand it to {@link holdRequests}, or refuse it.
   */
  stop: () => HeldRequests;
};

/** Requests held by a gate that stopped: opaque outside this module. */
export type HeldRequests = { readonly requests: readonly Held[] };

/** Start the gate in `mode`: see the module doc. */
export function startRequestGate(
  win: Win,
  { mode }: { mode: GateMode },
): RequestGate {
  const held: Held[] = [];
  const blocked: PageRequest[] = [];
  const restores: Array<() => void> = [];
  const origin = win.location.origin;
  let stopped = false;
  let xhrInFlight = 0;

  /** What to do with a request: send it, hold it, or refuse it. */
  const decide = (
    request: PageRequest,
    options: { navigates?: boolean } = {},
  ): "send" | "hold" | "block" => {
    const sameSite = isSameSite(request.url, origin);
    const reads = READ_METHODS.has(request.method);
    // Reading from anywhere is fine -- unless it navigates the frame there.
    if (reads && (sameSite || (!options.navigates && request.url !== ""))) {
      return "send";
    }
    if (!sameSite)
      return request.url === "" && mode === "hold" ? "hold" : "block";
    return mode === "hold" ? "hold" : "send";
  };
  const block = (request: PageRequest, refuse: () => void) => {
    blocked.push(request);
    refuse();
  };

  // --- fetch -----------------------------------------------------------------
  const originalFetch = typeof win.fetch === "function" ? win.fetch : null;
  if (originalFetch !== null) {
    const gatedFetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      // On the window, whatever it was called on: "Illegal invocation".
      const call = () => originalFetch.call(win, input, init);
      if (stopped) return call();
      const request = fetchRequestOf(win, input, init);
      const decision = decide(request);
      if (decision === "send") return call();
      return new Promise<Response>((resolve, reject) => {
        const refuse = () => reject(abortError(win));
        if (decision === "block") return block(request, refuse);
        // As it is now: what the person is shown is what Allow sends -- a
        // `Request` copy, or where there is none, a copy of the body.
        const snapshot = snapshotRequest(win, input, init);
        const body =
          snapshot === null
            ? copyBody(win, init !== undefined ? init.body : undefined)
            : { copy: undefined };
        if (body === null) return block(request, refuse);
        held.push({
          ...request,
          refuse,
          send: () => {
            // The address again, as it will be sent: still this site?
            const url = snapshot?.url ?? request.url;
            if (!isSameSite(url, origin)) {
              refuse();
              return "its address is not on this site";
            }
            (snapshot !== null
              ? originalFetch.call(win, snapshot)
              : originalFetch.call(win, input, { ...init, body: body.copy })
            ).then(resolve, reject);
            return undefined;
          },
        });
      });
    };
    win.fetch = gatedFetch;
    restores.push(() => {
      if (win.fetch === gatedFetch) win.fetch = originalFetch;
    });
  }

  // --- XMLHttpRequest --------------------------------------------------------
  const xhr = win.XMLHttpRequest?.prototype;
  if (xhr !== undefined) {
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const opened = new WeakMap<XMLHttpRequest, PageRequest>();
    const gatedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      if (!stopped) {
        const [method, url] = args;
        opened.set(this, {
          via: "xhr",
          method: typeof method === "string" ? method.toUpperCase() : "UNKNOWN",
          url: resolveUrl(win, url) ?? "",
        });
      }
      return Reflect.apply(originalOpen, this, args);
    };
    const gatedSend = function (this: XMLHttpRequest, ...args: unknown[]) {
      const request = opened.get(this);
      const call = () => Reflect.apply(originalSend, this, args);
      // Opened before the gate: not one it can judge.
      if (stopped || request === undefined) return call();
      const withBody = withExcerpt(win, request, args[0]);
      const decision = decide(withBody);
      const counted = () => {
        xhrInFlight++;
        this.addEventListener(
          "loadend",
          () => {
            xhrInFlight = Math.max(0, xhrInFlight - 1);
          },
          { once: true },
        );
        return call();
      };
      if (decision === "send") return counted();
      const refuse = () => failXhr(win, this);
      if (decision === "block") return block(withBody, refuse);
      // The body as it is now; one that cannot be copied is not held.
      const body = copyBody(win, args[0]);
      if (body === null) return block(withBody, refuse);
      // Opened again before the person answered: the page moved on, and
      // this hold is no longer what it would send.
      let reopened = false;
      Reflect.defineProperty(this, "open", {
        configurable: true,
        writable: true,
        // An arrow: `this` is the page's XHR, as in the send around it.
        value: (...again: unknown[]) => {
          reopened = true;
          Reflect.deleteProperty(this, "open");
          return Reflect.apply(this.open, this, again);
        },
      });
      const forget = () => Reflect.deleteProperty(this, "open");
      held.push({
        ...withBody,
        refuse: () => {
          forget();
          if (!reopened) refuse();
        },
        send: () => {
          forget();
          if (reopened) return "the page opened it again before you answered";
          if (!isSameSite(withBody.url, origin)) {
            refuse();
            return "its address is not on this site";
          }
          xhrInFlight++;
          this.addEventListener(
            "loadend",
            () => {
              xhrInFlight = Math.max(0, xhrInFlight - 1);
            },
            { once: true },
          );
          Reflect.apply(originalSend, this, [body.copy]);
          return undefined;
        },
      });
    };
    xhr.open = gatedOpen;
    xhr.send = gatedSend;
    restores.push(() => {
      if (xhr.open === gatedOpen) xhr.open = originalOpen;
      if (xhr.send === gatedSend) xhr.send = originalSend;
    });
  }

  // --- navigator.sendBeacon --------------------------------------------------
  const navigator = win.navigator;
  const originalBeacon: unknown = Reflect.get(navigator, "sendBeacon");
  if (typeof originalBeacon === "function") {
    const own = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
    const gatedBeacon = (url: unknown, data?: unknown): boolean => {
      const call = (to: unknown) =>
        Boolean(Reflect.apply(originalBeacon, navigator, [to, data]));
      if (stopped) return call(url);
      // Always a POST: a beacon only sends. The address as it is now.
      const request = withExcerpt(
        win,
        { via: "beacon", method: "POST", url: resolveUrl(win, url) ?? "" },
        data,
      );
      const decision = decide(request);
      if (decision === "send") return call(url);
      if (decision === "block") {
        // Nothing to tell: a refused beacon is one that was never queued.
        block(request, () => {});
        return false;
      }
      // The data as it is now; data that cannot be copied is not held.
      const body = copyBody(win, data);
      if (body === null) {
        block(request, () => {});
        return false;
      }
      held.push({
        ...request,
        refuse: () => {},
        send: () => {
          if (!isSameSite(request.url, origin)) {
            return "its address is not on this site";
          }
          Reflect.apply(originalBeacon, navigator, [request.url, body.copy]);
          return undefined;
        },
      });
      return true;
    };
    Reflect.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: gatedBeacon,
    });
    restores.push(() => {
      if (Reflect.get(navigator, "sendBeacon") !== gatedBeacon) return;
      if (own !== undefined) {
        Reflect.defineProperty(navigator, "sendBeacon", own);
      } else {
        Reflect.deleteProperty(navigator, "sendBeacon");
      }
    });
  }

  // --- forms -----------------------------------------------------------------
  const formPrototype = win.HTMLFormElement.prototype;
  const originalSubmit = formPrototype.submit;
  /** Hold a form's submission, as its fields are now. */
  const holdForm = (
    form: HTMLFormElement,
    submitter: HTMLElement | null,
    target: FormTarget,
  ) => {
    const fields = formDataOf(win, form, submitter);
    held.push({
      via: "form",
      method: target.method,
      url: target.url,
      ...(fields !== null ? { body: excerptOfEntries(fields) } : {}),
      refuse: () => {},
      send: () => {
        if (!isSameSite(target.url, origin)) {
          return "its address is not on this site";
        }
        if (fields === null) {
          originalSubmit.call(form);
          return undefined;
        }
        return submitSnapshot(win, form, target, fields, originalSubmit);
      },
    });
  };
  const gatedSubmit = function (this: HTMLFormElement) {
    if (stopped) return originalSubmit.call(this);
    const target = formTargetOf(win, this, null);
    if (target.method === "DIALOG") return originalSubmit.call(this);
    const request: PageRequest = {
      via: "form",
      method: target.method,
      url: target.url,
    };
    if (target.otherWindow) return block(request, () => {});
    // A form NAVIGATES the frame: to another site even reading is refused.
    const decision = decide(request, { navigates: true });
    if (decision === "send") return originalSubmit.call(this);
    if (decision === "block") return block(request, () => {});
    holdForm(this, null, target);
  };
  formPrototype.submit = gatedSubmit;
  restores.push(() => {
    if (formPrototype.submit === gatedSubmit) {
      formPrototype.submit = originalSubmit;
    }
  });

  /**
   * A form's `submit` event, before the page's own listeners: capture, on
   * the window. What leaves the site is cancelled in either mode. In `hold`
   * a same-site submit that sends is cancelled too, and held unless the
   * page's own handler cancels it -- then the page submits by itself, and
   * what it sends goes through the wraps above. In `off-site` a same-site
   * submit is not touched: the person approved the action.
   */
  const preventDefault = win.Event.prototype.preventDefault;
  const onSubmit = (event: Event) => {
    if (stopped) return;
    const form = event.target;
    if (!(form instanceof win.HTMLFormElement)) return;
    const submitterValue: unknown = Reflect.get(event, "submitter");
    const submitter =
      submitterValue instanceof win.HTMLElement ? submitterValue : null;
    const target = formTargetOf(win, form, submitter);
    if (target.method === "DIALOG") return;
    const request: PageRequest = {
      via: "form",
      method: target.method,
      url: target.url,
    };
    const decision = target.otherWindow
      ? "block"
      : decide(request, { navigates: true });
    if (decision === "send") return;
    preventDefault.call(event);
    if (decision === "block") return block(request, () => {});
    let handledByPage = false;
    Reflect.defineProperty(event, "preventDefault", {
      configurable: true,
      value: () => {
        handledByPage = true;
      },
    });
    // The fields as they are when it was submitted.
    const fields = formDataOf(win, form, submitter);
    // Once every listener has had the event.
    win.queueMicrotask(() => {
      if (handledByPage) return;
      held.push({
        ...request,
        ...(fields !== null ? { body: excerptOfEntries(fields) } : {}),
        refuse: () => {},
        send: () => {
          if (!isSameSite(target.url, origin)) {
            return "its address is not on this site";
          }
          if (fields === null) {
            originalSubmit.call(form);
            return undefined;
          }
          return submitSnapshot(win, form, target, fields, originalSubmit);
        },
      });
    });
  };
  win.addEventListener("submit", onSubmit, true);
  restores.push(() => win.removeEventListener("submit", onSubmit, true));

  return {
    held: () =>
      held.map(({ via, method, url, body }) => ({
        via,
        method,
        url,
        ...(body !== undefined ? { body } : {}),
      })),
    blocked: () => [...blocked],
    inFlight: () => xhrInFlight,
    stop: () => {
      stopped = true;
      for (const restore of restores.splice(0).reverse()) {
        try {
          restore();
        } catch {
          // What cannot be put back passes through: `stopped`.
        }
      }
      return { requests: [...held] };
    },
  };
}

/** Where a form goes, and how, as the browser resolves it. */
type FormTarget = {
  method: string;
  url: string;
  /** How its fields are encoded: the submitter's `formenctype` first. */
  enctype: string;
  otherWindow: boolean;
};

function formTargetOf(
  win: Win,
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): FormTarget {
  // The submitter's own `formmethod`/`formaction`/`formtarget` win; the
  // properties are what the browser resolved (base URL included).
  const method =
    submitter !== null && submitter.hasAttribute("formmethod")
      ? String(Reflect.get(submitter, "formMethod"))
      : form.method;
  const url =
    submitter !== null && submitter.hasAttribute("formaction")
      ? String(Reflect.get(submitter, "formAction"))
      : form.action;
  const target =
    submitter?.getAttribute("formtarget") ??
    form.getAttribute("target") ??
    baseTargetOf(win.document);
  // The attribute, not `formEnctype`: not every DOM reflects it, and the
  // copy's `enctype` normalises whatever it is given.
  const enctype =
    submitter?.getAttribute("formenctype") ??
    form.getAttribute("enctype") ??
    "";
  return {
    method: method.toUpperCase(),
    url: resolveUrl(win, url) ?? "",
    enctype,
    otherWindow: target !== null && target !== "" && target !== "_self",
  };
}

/** `<base target>`: where links and forms without a target of their own go. */
export function baseTargetOf(doc: Document): string | null {
  return doc.querySelector("base[target]")?.getAttribute("target") ?? null;
}

/** The form's fields as the browser would send them, submitter included. */
function formDataOf(
  win: Win,
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): FormData | null {
  try {
    return submitter !== null
      ? new win.FormData(form, submitter)
      : new win.FormData(form);
  } catch {
    return null;
  }
}

/**
 * Submit a held submission as it was snapshot: a form of its own, with the
 * fields it had then, to the address, with the method and the encoding it
 * had -- appended for the submit, and removed after. Files go through a
 * `DataTransfer`; where the browser has none, a form with files is not sent
 * at all rather than sent without them: the answer says why.
 */
function submitSnapshot(
  win: Win,
  form: HTMLFormElement,
  target: FormTarget,
  fields: FormData,
  submit: () => void,
): string | undefined {
  let hasFiles = false;
  fields.forEach((value) => {
    if (typeof value !== "string") hasFiles = true;
  });
  if (hasFiles && typeof win.DataTransfer !== "function") {
    return "the form sends a file, which this browser cannot attach to the copy that would be sent -- submit it yourself in the preview";
  }
  const doc = form.ownerDocument;
  const copy = doc.createElement("form");
  copy.method = target.method.toLowerCase();
  copy.action = target.url;
  copy.enctype = target.enctype;
  copy.acceptCharset = form.acceptCharset;
  copy.target = "_self";
  copy.hidden = true;
  // `forEach` rather than `entries()`: not every program this is checked in
  // has the DOM's iterable types.
  fields.forEach((value, name) => {
    const input = doc.createElement("input");
    input.name = name;
    if (typeof value === "string") {
      input.type = "hidden";
      input.value = value;
    } else {
      input.type = "file";
      if (typeof win.DataTransfer === "function") {
        const files = new win.DataTransfer();
        files.items.add(value);
        input.files = files.files;
      }
    }
    copy.append(input);
  });
  doc.body.append(copy);
  try {
    submit.call(copy);
  } finally {
    copy.remove();
  }
  return undefined;
}

/** A refused XHR, as one that failed: done, and every event a page waits on. */
function failXhr(win: Win, request: XMLHttpRequest): void {
  const finished: Array<[string, number]> = [
    ["readyState", 4],
    ["status", 0],
  ];
  for (const [name, value] of finished) {
    Reflect.defineProperty(request, name, { configurable: true, value });
  }
  request.dispatchEvent(new win.Event("readystatechange"));
  request.dispatchEvent(new win.ProgressEvent("error"));
  request.dispatchEvent(new win.ProgressEvent("loadend"));
}

// --- holds -------------------------------------------------------------------

type Hold = { requests: readonly Held[]; timer: ReturnType<typeof setTimeout> };

/** The holds of each window: the requests waiting for the person. */
const HOLDS = new WeakMap<Window, Map<string, Hold>>();

function holdsOf(win: Window): Map<string, Hold> {
  let holds = HOLDS.get(win);
  if (holds === undefined) {
    holds = new Map();
    HOLDS.set(win, holds);
  }
  return holds;
}

/**
 * Keep held requests for the person to decide on: the id the Studio sends
 * back with Allow or Don't allow. Refused by themselves after
 * {@link HOLD_TIMEOUT_MS}.
 */
export function holdRequests(win: Window, held: HeldRequests): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const holds = holdsOf(win);
  const timer = setTimeout(() => {
    holds.delete(id);
    refuseAll(held.requests);
  }, HOLD_TIMEOUT_MS);
  holds.set(id, { requests: held.requests, timer });
  return id;
}

/**
 * Send (`allow`) or refuse what a hold kept: what the person decided. `null`
 * when there is no such hold any more -- refused already, timed out, or the
 * page reloaded.
 */
export function releaseHold(
  win: Window,
  id: string,
  allow: boolean,
): { requests: readonly PageRequest[]; notSent: string[] } | null {
  const holds = holdsOf(win);
  const hold = holds.get(id);
  if (hold === undefined) return null;
  holds.delete(id);
  clearTimeout(hold.timer);
  const notSent: string[] = [];
  for (const request of hold.requests) {
    try {
      if (allow) {
        const why = request.send();
        if (why !== undefined)
          notSent.push(`${request.method} ${request.url}: ${why}`);
      } else {
        request.refuse();
      }
    } catch (error) {
      // One that cannot be sent does not stop the rest.
      notSent.push(
        `${request.method} ${request.url}: ${error instanceof Error ? error.message : "it failed"}`,
      );
    }
  }
  return {
    requests: hold.requests.map(({ via, method, url }) => ({
      via,
      method,
      url,
    })),
    notSent,
  };
}

/** Refuse every hold of the window: a new action means they were not wanted. */
export function refuseAllHolds(win: Window): void {
  const holds = holdsOf(win);
  for (const [id, hold] of Array.from(holds)) {
    holds.delete(id);
    clearTimeout(hold.timer);
    refuseAll(hold.requests);
  }
}

/** Refuse requests a gate held and nobody kept. */
export function refuseHeld(held: HeldRequests): void {
  refuseAll(held.requests);
}

function refuseAll(requests: readonly Held[]): void {
  for (const request of requests) {
    try {
      request.refuse();
    } catch {
      // Nothing more to do for it.
    }
  }
}

// --- helpers -----------------------------------------------------------------

/**
 * Whether `url` stays on the site: this origin -- or a `javascript:` URL,
 * which goes nowhere but into the page's own code (React renders one as the
 * `action` of a form whose action is a function).
 */
function isSameSite(url: string, origin: string): boolean {
  try {
    if (url === "") return false;
    const parsed = new URL(url);
    return parsed.protocol === "javascript:" || parsed.origin === origin;
  } catch {
    return false;
  }
}

/**
 * An address as the browser resolves it, against the document's base. Only
 * from what can be read without running the page's code -- a string, a URL,
 * a Location -- and `null` for anything else (an object with a `toString`
 * of its own), which the gate then holds rather than lets through.
 */
function resolveUrl(win: Win, value: unknown): string | null {
  try {
    const written =
      value instanceof URL
        ? value.href
        : typeof win.Location === "function" && value instanceof win.Location
          ? value.href
          : typeof value === "string"
            ? value
            : null;
    if (written === null) return null;
    return new URL(written, win.document.baseURI).href;
  } catch {
    return null;
  }
}

/** What a `fetch` call sends, read without throwing: unknown is unknown. */
function fetchRequestOf(
  win: Win,
  input: unknown,
  init?: RequestInit,
): PageRequest {
  let method = "UNKNOWN";
  let url = "";
  try {
    const fromRequest =
      typeof win.Request === "function" && input instanceof win.Request;
    url =
      resolveUrl(
        win,
        fromRequest ? Reflect.get(Object(input), "url") : input,
      ) ?? "";
    const written: unknown =
      init !== undefined && "method" in Object(init)
        ? Reflect.get(Object(init), "method")
        : fromRequest
          ? Reflect.get(Object(input), "method")
          : "GET";
    if (typeof written === "string") method = written.toUpperCase();
    return withExcerpt(
      win,
      { via: "fetch", method, url },
      init !== undefined ? Reflect.get(Object(init), "body") : undefined,
    );
  } catch {
    return { via: "fetch", method, url };
  }
}

/** A copy of the request as it is now, or `null` where there is no `Request`. */
function snapshotRequest(
  win: Win,
  input: RequestInfo | URL,
  init?: RequestInit,
): Request | null {
  try {
    return typeof win.Request === "function"
      ? new win.Request(input, init)
      : null;
  } catch {
    return null;
  }
}

/**
 * A copy of a request body as it is now, so the page changing it later
 * does not change what is sent: `null` for a body that cannot be copied (a
 * stream, a document), which is then not held but refused.
 */
function copyBody(
  win: Win,
  body: unknown,
): { copy: BodyInit | null | undefined } | null {
  try {
    if (body === undefined || body === null) return { copy: body };
    if (typeof body === "string") return { copy: body };
    if (body instanceof win.URLSearchParams) {
      return { copy: new win.URLSearchParams(body.toString()) };
    }
    if (body instanceof win.FormData) {
      const copy = new win.FormData();
      body.forEach((value, name) => copy.append(name, value));
      return { copy };
    }
    if (body instanceof win.Blob) {
      return { copy: body.slice(0, body.size, body.type) };
    }
    if (body instanceof ArrayBuffer) return { copy: body.slice(0) };
    if (ArrayBuffer.isView(body)) {
      const copy = new Uint8Array(body.byteLength);
      copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      return { copy };
    }
    return null;
  } catch {
    return null;
  }
}

/** `request`, with an excerpt of `body` if it has one. */
function withExcerpt(
  win: Win,
  request: PageRequest,
  body: unknown,
): PageRequest {
  const excerpt = excerptOf(win, body);
  return excerpt === undefined ? request : { ...request, body: excerpt };
}

/** A short, readable excerpt of a body: its text, its fields, or its size. */
function excerptOf(win: Win, body: unknown): string | undefined {
  try {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return clampExcerpt(body);
    if (body instanceof win.URLSearchParams)
      return clampExcerpt(body.toString());
    if (body instanceof win.FormData) return excerptOfEntries(body);
    if (body instanceof win.Blob) return `(${body.size} bytes)`;
    if (body instanceof ArrayBuffer) return `(${body.byteLength} bytes)`;
    if (ArrayBuffer.isView(body)) return `(${body.byteLength} bytes)`;
    return "(data)";
  } catch {
    return "(data)";
  }
}

function excerptOfEntries(fields: FormData): string {
  const parts: string[] = [];
  let length = 0;
  fields.forEach((value, name) => {
    if (length > BODY_EXCERPT_LENGTH) return;
    const part = `${name}=${typeof value === "string" ? value : `(file ${value.name})`}`;
    parts.push(part);
    length += part.length + 1;
  });
  return clampExcerpt(parts.join("&"));
}

function clampExcerpt(text: string): string {
  return text.length > BODY_EXCERPT_LENGTH
    ? `${text.slice(0, BODY_EXCERPT_LENGTH - 1)}…`
    : text;
}

function abortError(win: Win): Error {
  const message = "The person did not allow this request to be sent.";
  return typeof win.DOMException === "function"
    ? new win.DOMException(message, "AbortError")
    : Object.assign(new Error(message), { name: "AbortError" });
}
