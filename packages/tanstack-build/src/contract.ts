// The contract between the natively-built shell and the browser-built user app.
//
// This is types-only on purpose: the user app must not need a runtime import
// from the platform, so the only thing crossing the boundary is a plain object.
// Widening this contract is a CI-time change, same as adding a vendor module.
import type { ComponentType, ReactNode } from "react";

export interface UserRoute {
  /** TanStack Router path syntax, e.g. '/', '/about', '/posts/$postId'. */
  path: string;
  /**
   * `never` rather than `any`, and it means "this side supplies no props".
   *
   * A component's props are contravariant, so every component -- including one
   * that declares props of its own -- is assignable to `ComponentType<never>`,
   * which is what a route component has to be: the router renders it, and
   * nothing here can know or pass what it declares.
   */
  component: ComponentType<never>;
  /** Runs on the server during SSR and on the client during navigation. */
  loader?: (ctx: { params: Record<string, string> }) => unknown;
}

export interface UserApp {
  routes: Array<UserRoute>;
  /** Optional wrapper rendered inside the shell's root route. */
  layout?: ComponentType<{ children: ReactNode }>;
}

/** Shape of the module the browser build emits, for both targets. */
export interface UserAppModule {
  default: UserApp;
}

/** What the studio uploads and the loader Worker stores per publish. */
export interface PublishManifest {
  projectId: string;
  /** sha256 of serverCode + clientCode; used as the LOADER.get() cache id. */
  hash: string;
  /** Vendor artifact revision the app was built against. */
  vendorRev: string;
  createdAt: string;
}

/**
 * Everything a build needs to know about the platform it is targeting.
 *
 * ## Why this exists
 *
 * `@valbuild/builder` used to import `@valbuild/vendor/externals` at COMPILE
 * TIME to learn which specifiers are externalised and where their chunks live.
 * That made the builder unmovable: it could only ever be built in the same
 * repository as the vendor package it read, so the Studio could not carry its
 * own copy and a published build could not be made anywhere but here.
 *
 * The facts have not changed -- they are still the platform's -- but they now
 * ARRIVE rather than being compiled in. `GET /__api/build-target` answers this
 * shape, content proxies it at `GET /v1/build-target`, and `BuildInput` takes
 * it as a parameter.
 *
 * ## The two halves move on different clocks
 *
 * `base` changes when the platform is deployed: new chunks, a new shell. It is
 * immutable for the life of a loader deployment, which is what makes it
 * cacheable by revision.
 *
 * `project` changes when a project's dependencies do, which is rarely and on
 * nobody else's schedule. It has to be revalidated per project.
 *
 * Together in one response because a build needs both and two round trips to
 * assemble one answer is two chances to get a mismatched pair -- a base layer
 * from after a deploy and a project layer built against the one before it.
 */
export interface BuildTarget {
  base: {
    /** The base vendor layer's revision. Every build is pinned to one. */
    rev: string;
    /** The shell this loader serves, and the RSC shell beside it. */
    shellRev: string;
    rscShellRev: string;
    /**
     * Specifier -> chunk name for the base layer, e.g. `{ react: 'react' }`.
     *
     * The map rather than a resolve function, because a function cannot cross
     * a wire. Resolving is `base + modules[specifier] + '.js'`, which the
     * builder does itself -- one line, and it keeps the RULE on the side that
     * owns the chunks.
     */
    modules: Record<string, string>;
    /** The same, for the react-server layer. Empty when RSC is not served. */
    rscModules: Record<string, string>;
    /** Where the chunks live, as seen from each kind of importer. */
    paths: {
      /** The base layer, from a project-layer chunk. */
      baseFromProject: string;
      /** The project's own layer, inside the isolate's module map. */
      projectVendorDir: string;
      /** The react-server layer, from a module in `rsc/`. */
      rscVendorBase: string;
      /** The specifier an RSC bundle imports its runtime as, and its path. */
      rscRuntimeSpecifier: string;
      rscRuntimePath: string;
      /** Where `registerClientReference` comes from, for the rsc target. */
      flightServer: string;
      /** Where the shell dispatches server functions. */
      serverFnBase: string;
    };
  };
  project: {
    /**
     * This project's layer revision, or null when it declares nothing beyond
     * the base set. Null is a real answer, not a missing one.
     */
    rev: string | null;
    /** Whether this project's published build renders server components. */
    rsc: boolean;
    /** Specifier -> chunk name for the project's own layer. */
    modules: Record<string, string>;
    /** Stylesheets the project imports from its dependencies. */
    css: Record<string, string>;
    /**
     * Specifiers layered for the worker only. Importing one from client code
     * is an error the client build reports, rather than a chunk URL that 404s
     * in the browser.
     */
    workerOnly: Array<string>;
  };
}

/**
 * The cheap half, for the one question a publisher asks before it has built
 * anything: must I send my dependency layer at all?
 *
 * Answered by `?only=rev`, because the full response reads the whole layer out
 * of storage to get its specifier map -- several megabytes to establish a
 * string comparison.
 */
export interface BuildTargetRev {
  project: { rev: string | null };
}
