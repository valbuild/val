/**
 * The custom elements the Studio mounts from Val Build (valbuild/home,
 * `web-components/`). Their attributes are their whole interface, and are
 * documented where each is defined: `src/<name>/index.ts` over there.
 */
import type {} from "react";

type CustomElementProps<Attributes> = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> &
  Attributes;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "val-project-switcher": CustomElementProps<{
        /** `org/name` of this Studio's project. */
        project: string;
        /** The Studio's proxy to Val Build. */
        "api-base"?: string;
        /** The project's page in Val Build, until the component has loaded its own. */
        "admin-url"?: string;
        layout?: "popover" | "sheet";
        theme?: "light" | "dark";
      }>;
    }
  }
}
