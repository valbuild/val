import { useEffect } from "react";
import { useStudioIsDeployer } from "../components/ValProvider";
import { preloadBuilder } from "./loadBuilder";

/**
 * Starts loading the bundler as soon as the Studio is up.
 *
 * Renders nothing. A component rather than a call in `ValStudio` because it has
 * to be INSIDE `ValProvider` -- what it needs is the project's source mode, and
 * that arrives with the first stat rather than with the props.
 *
 * ## Why at mount, without asking
 *
 * `@rolldown/browser` is 10.9 MB of WebAssembly and compiling it is about half
 * the wait, so {@link preloadBuilder} instantiates rather than prefetching.
 * There is no prompt and no gating on connection quality: these are
 * non-technical users and there is no decision to put to them -- the bytes are
 * the same whether they are spent while someone reads the page or while they
 * stare at a button.
 *
 * ## The one gate there IS, and why it is not "no gating"
 *
 * Only a MANAGED project builds in the browser. In `fs` mode a dev server
 * rebuilds, and a connected project's commit is picked up by a host; neither
 * will ever call the builder, so downloading it there is 10.9 MB spent on
 * nothing. `useStudioIsDeployer` is the same question the deploy feed asks, and
 * reads an unreported source mode as connected for the same reason.
 *
 * The plan for this chunk says "preload always, at mount". This is that, for
 * every Studio the sentence was about; the sentence's own next section is what
 * says the behaviour is per source mode.
 */
export function BuilderPreload(): null {
  const studioIsDeployer = useStudioIsDeployer();
  useEffect(() => {
    if (!studioIsDeployer) {
      return;
    }
    preloadBuilder();
  }, [studioIsDeployer]);
  return null;
}
