import { Rocket } from "lucide-react";
import { Button } from "../components/designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
import { useValPortal } from "../components/ValPortalProvider";
import { DEMO_CREATE_PROJECT_URL } from "./DemoBanner";

/**
 * Publish, as the demo has it: what it WOULD do, rather than doing it.
 *
 * Not hidden. Publish is the end of every change in Val, and a tour of the
 * Studio with a hole where it goes would leave out the step that makes the
 * rest mean anything. Not a real publish either: the demo's server runs in the
 * tab and has nowhere to publish TO.
 */
export function DemoPublishButton() {
  const portalContainer = useValPortal();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Rocket size={16} className="mr-1" />
          Publish
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="w-[300px] text-sm"
      >
        <p className="font-medium">Publishing is off in the demo</p>
        <p className="mt-1 text-fg-secondary">
          In your own project, Publish turns these changes into a commit in your
          Git repository, and your site rebuilds with them. Here they stay in
          this tab.
        </p>
        <Button size="xs" className="mt-3" asChild>
          <a href={DEMO_CREATE_PROJECT_URL} target="_blank" rel="noreferrer">
            Create your own project
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
