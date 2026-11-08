import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { gripElement, startBlockDrag } from "./dragBlocks";

export type RouteViewOptions = {
  /** The site's pages, to pick from. */
  getRoutes: () => string[];
  /** The route whose page is beside the sketch, if any. */
  getActiveRoute: () => string | null;
  /** Show this route's page beside the sketch. */
  openRoute: (route: string) => void;
};

const PIN =
  "M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6";

/**
 * A route divider: a rule across the page with the route on it. Everything
 * below it, to the next one, is the page at that route. The route is a
 * button, and pressing it shows that page beside the sketch; the pencil next
 * to it picks another of the site's routes.
 */
export class RouteView implements NodeView {
  readonly dom: HTMLElement;
  private readonly chip: HTMLButtonElement;
  private readonly change: HTMLButtonElement;
  private node: PMNode;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly options: RouteViewOptions,
    private readonly registry: Set<RouteView>,
  ) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className =
      "group relative -mx-2 flex items-center gap-2 px-2 pt-4 first:pt-0";
    this.dom.contentEditable = "false";

    const grip = gripElement(
      "Drag to move this page's part of the sketch",
      (event) => {
        const pos = this.getPos();
        if (pos !== undefined) startBlockDrag(this.view, pos, event, this.dom);
      },
      "absolute -left-5 flex h-5 w-5 cursor-grab items-center justify-center rounded text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-secondary group-hover:opacity-100 [@media(hover:none)]:opacity-60",
    );
    const rule = () => {
      const hr = document.createElement("span");
      hr.className = "h-px flex-1 bg-border-primary";
      return hr;
    };

    this.chip = document.createElement("button");
    this.chip.type = "button";
    this.chip.addEventListener("click", () =>
      this.options.openRoute(String(this.node.attrs.route)),
    );

    this.change = document.createElement("button");
    this.change.type = "button";
    this.change.textContent = "Change";
    this.change.className =
      "cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-fg-tertiary opacity-0 hover:bg-bg-secondary hover:text-fg-primary group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";
    this.change.addEventListener("click", () => this.pick());

    this.dom.append(grip, rule(), this.chip, this.change, rule());
    this.render();
    registry.add(this);
  }

  render() {
    const route = String(this.node.attrs.route);
    const active = this.options.getActiveRoute() === route;
    this.chip.className = [
      "flex max-w-[60%] cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
      active
        ? "border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary"
        : "border-border-primary bg-bg-primary text-fg-primary hover:bg-bg-secondary",
    ].join(" ");
    this.chip.title = active
      ? `The page at ${route} is beside the sketch`
      : `Show the page at ${route} beside the sketch`;
    this.chip.setAttribute("aria-pressed", String(active));
    this.chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="${PIN}"/></svg>`;
    const label = document.createElement("span");
    label.className = "truncate font-mono";
    label.textContent = route;
    this.chip.append(label);
    this.change.style.display = this.view.editable ? "" : "none";
  }

  /** Another of the site's routes, from a list typed into to narrow it. */
  private pick() {
    if (!this.view.editable) {
      return;
    }
    const input = document.createElement("input");
    const listId = `sketch-routes-${Math.random().toString(36).slice(2)}`;
    input.setAttribute("list", listId);
    input.value = String(this.node.attrs.route);
    input.setAttribute("aria-label", "Route of this page");
    input.className =
      "w-56 rounded-full border border-border-focus bg-bg-primary px-3 py-1 font-mono text-xs text-fg-primary outline-none";
    const list = document.createElement("datalist");
    list.id = listId;
    for (const route of this.options.getRoutes()) {
      const option = document.createElement("option");
      option.value = route;
      list.append(option);
    }
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const route = input.value.trim();
      input.replaceWith(this.chip);
      list.remove();
      const pos = this.getPos();
      if (
        save &&
        pos !== undefined &&
        route.startsWith("/") &&
        !/\s/.test(route) &&
        route !== this.node.attrs.route
      ) {
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, undefined, { route }),
        );
      }
      this.view.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    this.chip.replaceWith(input);
    this.dom.append(list);
    input.focus();
    input.select();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    // Its own buttons and field are its own; a drag, from its grip or over
    // it to a drop, is ProseMirror's.
    return !event.type.startsWith("drag") && event.type !== "drop";
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.registry.delete(this);
  }
}
