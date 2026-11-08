import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { gripElement, startBlockDrag } from "./dragBlocks";

/** What the menu a route divider opens can do, and where to draw it. */
export type RouteMenuRequest = {
  route: string;
  /** The chip it opens from, in the viewport. */
  anchor: DOMRect;
  /** Point the divider at another route. */
  change: (route: string) => void;
  /** Take the divider out; what was below it stays where it is. */
  remove: () => void;
};

export type RouteViewOptions = {
  /** The site's pages, to pick from. */
  getRoutes: () => string[];
  /** The route whose page is beside the sketch, if any. */
  getActiveRoute: () => string | null;
  /** Show this route's page beside the sketch. */
  openRoute: (route: string) => void;
  /**
   * Opens the divider's menu: show the page, change the route, remove the
   * divider. Null where there is no menu, and the chip then shows the page.
   */
  getOpenMenu: () => ((menu: RouteMenuRequest) => void) | null;
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
    this.chip.addEventListener("click", () => this.open());

    this.dom.append(grip, rule(), this.chip, rule());
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
      : `The page at ${route}`;
    this.chip.setAttribute("aria-pressed", String(active));
    this.chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="${PIN}"/></svg>`;
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = route;
    this.chip.append(label);
    this.chip.setAttribute(
      "aria-haspopup",
      this.options.getOpenMenu() && this.view.editable ? "menu" : "false",
    );
  }

  /** The menu, where there is one and it can be edited; else the page. */
  private open() {
    const route = String(this.node.attrs.route);
    const menu = this.options.getOpenMenu();
    if (!menu || !this.view.editable) {
      this.options.openRoute(route);
      return;
    }
    menu({
      route,
      anchor: this.chip.getBoundingClientRect(),
      change: (next) => {
        const pos = this.getPos();
        if (pos !== undefined && next !== route) {
          this.view.dispatch(
            this.view.state.tr.setNodeMarkup(pos, undefined, { route: next }),
          );
        }
      },
      remove: () => {
        const pos = this.getPos();
        if (pos !== undefined) {
          this.view.dispatch(
            this.view.state.tr.delete(pos, pos + this.node.nodeSize),
          );
        }
      },
    });
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
