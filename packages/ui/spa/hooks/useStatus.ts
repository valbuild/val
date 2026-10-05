import { Patch } from "@valbuild/core/patch";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  newestCommitSha,
  PatchGroup,
  ValClient,
  ValCommit,
  ValDeployment,
} from "@valbuild/shared/internal";
import React, {
  useState,
  useEffect,
  useRef,
  SetStateAction,
  Dispatch,
  useCallback,
} from "react";
import { z } from "zod";
import { randomUUID } from "../utils/randomUUID";

const PatchId = z
  .string()
  .uuid()
  .refine((_p): _p is PatchId => true);

export const AIModel = z.enum(["openai-gpt-5.1"]);
export type AIModel = z.infer<typeof AIModel>;

export const AIAgentDefinition = z.object({
  id: z.string(),
  systemPrompt: z.string(),
  model: AIModel,
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
          type: z.literal("object"),
          properties: z.record(z.string(), z.unknown()),
          required: z.array(z.string()).optional(),
        }),
      }),
    )
    .optional(),
  description: z.string().optional(),
});

export type AIAgentDefinition = z.infer<typeof AIAgentDefinition>;

const WebSocketServerMessage = z.union([
  z.object({
    type: z.literal("patches"),
    patches: z.array(PatchId),
    /**
     * The head of the chain. See `headPatchId` on {@link StatData}. Optional:
     * a content service that predates it sends nothing.
     */
    headPatchId: PatchId.nullable().optional(),
    /** The chain version of that head. See `headVersion` on {@link StatData}. */
    headVersion: z.number().optional(),
    /**
     * Who holds what, read with `patches` and `headVersion`. Absent from a
     * content service that predates sending it.
     */
    patchGroups: z.array(PatchGroup).optional(),
    /**
     * Of `patches`, the ones already published, read with them. Absent from a
     * content service that predates sending it. See {@link chainOfMessage}.
     */
    appliedPatches: z.array(PatchId).optional(),
    /**
     * Of `patches`, the ones a running publish holds, read with them. Absent
     * from a content service that predates sending it. See `publishingPatches`
     * on {@link StatData}.
     */
    publishingPatches: z.array(PatchId).optional(),
  }),
  z.object({
    type: z.literal("deployment"),
    deployment: ValDeployment,
  }),
  z.object({
    type: z.literal("commit"),
    commit: ValCommit,
  }),
  /*
   * A publish job moved (valbuild/home, docs/app-mode.md, "Publishing is a
   * queued job"). A NUDGE, not the state: the Studio re-reads the requests it
   * pressed, which is where Live is decided. Only the id and the status are
   * read -- the status so a publish another editor pressed shows here too --
   * and the status is optional, so the rest of what content sends may change
   * without this parse failing.
   */
  z.object({
    type: z.literal("publish-job"),
    job: z.object({ id: z.string(), status: z.string().optional() }),
  }),
  z.object({
    type: z.literal("subscribed"),
  }),
]);

/** A publish job moved: which, and its status if content said. */
export type PublishJobNudge = { id: string; status: string | null };

export const StatData = z.object({
  type: z.union([
    z.literal("did-change"),
    z.literal("no-change"),
    z.literal("request-again"),
    z.literal("use-websocket"),
  ]),
  profileId: z.string().nullable(),
  config: z.object({
    project: z.string().optional(),
    /*
     * The branch history is listed under, and the one thing that decides
     * whether the Studio offers History at all (`historyEnabledFor`).
     *
     * Declared here even though nothing in this file parses at runtime — the
     * `/stat` response is validated against `ApiRoutes`, which has always
     * carried it, and `ValClient` hands back the raw json regardless. What
     * this shape decides is the TYPE of `stat.data.config`, and `ValProvider`
     * bridges that to `ValConfig` with an assertion. So an undeclared field is
     * a field that is silently absent from the type while being present on the
     * wire, which is the same trap `ApiRoutes` records for `deployments`: a
     * field nobody has declared is a field the next person deletes.
     */
    gitBranch: z.string().optional(),
    ai: z
      .object({
        // Read to decide whether to open the AI socket: commit summaries run
        // over it now, so the chat flag alone is not the whole answer.
        commitMessages: z
          .object({
            disabled: z.boolean().optional(),
          })
          .optional(),
        chat: z
          .object({
            experimental: z
              .object({
                enable: z.boolean().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    files: z
      .object({
        directory: z.string(),
      })
      .optional(),
  }),
  commitSha: z.string().optional(), // Only use-websocket has this (refactor this zod schema?)
  /**
   * Why the server cannot publish this project at all.
   *
   * Absent when it can, which is the usual case -- so the Studio asks whether
   * this is here, not whether it is null.
   */
  publishRefusal: z
    .object({ code: z.literal("no-base"), message: z.string() })
    .optional(),
  /**
   * How this project's SOURCE is kept, when the server knows.
   *
   * Decides how a publish is narrated: a managed project has no repository and
   * no host watching one, so the Studio is the deployer and a publish is
   * binary. A connected project keeps the deploy feed, because there something
   * outside the browser really does pick the commit up.
   *
   * Absent means "not reported", never "managed" -- `fs` mode has no project to
   * have a mode, and neither does a server that predates the field. See
   * `sourceMode` in `ApiRoutes`.
   */
  sourceMode: z
    .union([z.literal("managed"), z.literal("connected")])
    .optional(),
  /** See `publishJobs` in `ApiRoutes`. */
  publishJobs: z.boolean().optional(),
  /**
   * FS mode only: fingerprint of the `.jsonValues()` entry files on disk. No
   * other sha here can see an entry edit, because a jsonValues module's source is
   * markers and the content sits behind a thunk.
   */
  jsonEntriesSha: z.string().optional(),
  /**
   * FS mode only: unpublished changes the store threw away because it could not
   * read them. Said once — the server drains it when it hands it over — so this
   * is absent on every stat but the one that reports it.
   */
  removed: z
    .array(z.object({ patchId: PatchId, reason: z.string() }))
    .optional(),
  sourcesSha: z.string(),
  schemaSha: z.string(),
  baseSha: z.string(),
  patches: z.array(PatchId),
  /**
   * Of `patches`, the ones that have already SHIPPED.
   *
   * `http` only: a published patch stays in the chain with `appliedAt` set
   * until the deploy lands, and a client never re-fetches a record it already
   * holds — so without this it never learns that somebody else's publish
   * committed one of the patches it is holding. `fs` forgets published patches
   * outright and does not send it.
   *
   * Absent is NOT "none of them": see `PatchStore.receiveApplied`.
   */
  appliedPatches: z.array(PatchId).optional(),
  /**
   * Of `patches`, the ones a publish that is still running holds -- on this
   * tab, another tab or another device. Publish is not offered over them.
   *
   * Unlike `appliedPatches` this is not one-way: a job that fails, is
   * cancelled or is interrupted gives its changes back, so every answer
   * replaces it whole. Absent where publishing is not done in jobs, and from a
   * content service that predates it -- which is "not reported", not "none".
   */
  publishingPatches: z.array(PatchId).optional(),
  /**
   * The head of the PATCH CHAIN, which a new patch names as its parent — see
   * `chainHeadOf`. `http` only; absent is "not reported", not `null`.
   */
  headPatchId: PatchId.nullable().optional(),
  /**
   * The version of the chain `headPatchId` was read at, so an answer that lands
   * after a newer one can be told apart. `http` only; absent is "not
   * reported".
   */
  headVersion: z.number().optional(),
  /**
   * Every group on the branch and what each holds, read with `patches` and
   * `headVersion`. `http` only, and absent where there are no groups.
   */
  patchGroups: z.array(PatchGroup).optional(),
  /**
   * The newest commit, which is the PUBLISH head.
   *
   * Carried to `/save` so a publish decided against a world somebody else has
   * since changed is refused rather than shipped. See `newestCommitSha`.
   */
  headCommitSha: z.string().optional(),
  commits: z.array(ValCommit).optional(),
  deployments: z.array(ValDeployment).optional(),
  mode: z.union([z.literal("fs"), z.literal("http")]),
});
export type StatData = z.infer<typeof StatData>;

export type StatState =
  | {
      status: "not-asked";
    }
  | {
      status: "initializing";
    }
  | {
      status: "updated-request-again";
      data: StatData;
      waitStart: number;
      wait: number;
    }
  | {
      status: "updating";
      data: StatData;
    }
  | {
      status: "ws-message-received";
      data: StatData;
      waitStart: number;
      wait: number;
    }
  | {
      status: "error";
      data?: StatData;
      isAuthenticationError?: boolean;
      error: string;
      retries: number;
      waitStart: number;
      wait: number;
    };
export function useStatus(client: ValClient) {
  // this is where we handle the base state of the application:
  // if the schema or the commit changes, we must reload the schema (and the sources)
  // if base changes, we must fetch sources (with patches applied, and errors)
  // if patches changes, we must fetch sources (applied with patches, and errors) and patch data

  // the base state changes by calling /stat, then deciding what to do:
  // if we are in dev mode, the /stat end point will block until there is a change so we immediately call /stat again on completion
  // if we are in prod mode, the /stat end point returns immediately with the base state, but we also get a websocket url to listen to patches

  const [stat, setStat] = useState<StatState>({
    status: "not-asked",
  });

  const webSocketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string>(randomUUID());
  const {
    authenticationState,
    setAuthenticationLoadingIfNotAuthenticated,
    setIsAuthenticated,
  } = useAuthentication();
  const [serviceUnavailable, setServiceUnavailable] = useState<
    boolean | boolean
  >();

  const statIdRef = useRef(0);
  /**
   * How many socket `patches` messages have been taken. A `/stat` answer
   * requested before the latest of them is older than it -- see
   * {@link holdsOfAnswer}.
   */
  const socketPatchesRef = useRef(0);
  /** See {@link ContentHolds}. */
  const [holds, setHolds] = useState<ContentHolds | undefined>();
  /** Who hears a `publish-job` nudge. See `subscribePublishJobs`. */
  const publishJobListeners = useRef(new Set<(job: PublishJobNudge) => void>());
  const onPublishJob = useCallback((job: PublishJobNudge) => {
    for (const listener of publishJobListeners.current) listener(job);
  }, []);
  /**
   * Hear every `publish-job` nudge the socket delivers. A stable function, so
   * a subscriber's effect runs once.
   */
  const subscribePublishJobs = useCallback(
    (listener: (job: PublishJobNudge) => void) => {
      publishJobListeners.current.add(listener);
      return () => {
        publishJobListeners.current.delete(listener);
      };
    },
    [],
  );
  useEffect(() => {
    if (
      stat.status === "updated-request-again" ||
      stat.status === "error" ||
      stat.status === "ws-message-received"
    ) {
      if (stat.status === "error") {
        console.error("Stat error", stat.status, "error:", stat.error);
      }
      // Never wait longer than a publish that has not reached the site yet can
      // afford: `/stat` is the only thing that reports which commit the site
      // actually serves.
      const wait = Math.min(
        stat.wait,
        awaitingDeploymentInterval(stat.data, Date.now()),
      );
      if (wait === 0) {
        console.debug(
          "Executing stat immediately",
          stat.status,
          stat.status === "error" ? stat.error : "no error",
          "Now:",
          Date.now(),
        );
        execStat(
          client,
          webSocketRef,
          connectionIdRef,
          statIdRef,
          socketPatchesRef,
          setHolds,
          stat,
          setStat,
          setAuthenticationLoadingIfNotAuthenticated,
          setIsAuthenticated,
          setServiceUnavailable,
          onPublishJob,
        );
      } else {
        console.debug(
          "Executing stat in ",
          wait,
          " status: ",
          stat.status,
          "Now:",
          Date.now(),
        );
        const timeout = setTimeout(() => {
          execStat(
            client,
            webSocketRef,
            connectionIdRef,
            statIdRef,
            socketPatchesRef,
            setHolds,
            stat,
            setStat,
            setAuthenticationLoadingIfNotAuthenticated,
            setIsAuthenticated,
            setServiceUnavailable,
            onPublishJob,
          );
        }, wait);
        return () => clearTimeout(timeout);
      }
    }
  }, [client, stat]);

  useEffect(() => {
    if (stat.status === "not-asked") {
      setStat({
        status: "initializing",
      });
      console.debug("Initializing stat");
      execStat(
        client,
        webSocketRef,
        connectionIdRef,
        statIdRef,
        socketPatchesRef,
        setHolds,
        stat,
        setStat,
        setAuthenticationLoadingIfNotAuthenticated,
        setIsAuthenticated,
        setServiceUnavailable,
        onPublishJob,
      );
    }
  }, [client, stat.status]);

  return [
    stat,
    setStat,
    authenticationState,
    setAuthenticationLoadingIfNotAuthenticated,
    setIsAuthenticated,
    serviceUnavailable,
    subscribePublishJobs,
    holds,
  ] as const;
}

type PatchesMessage = Extract<
  z.infer<typeof WebSocketServerMessage>,
  { type: "patches" }
>;

/**
 * What a `patches` message replaces in the stat: the chain, read at one moment.
 *
 * The client takes this message as its new chain without asking `/stat`
 * again, so everything that describes the chain comes from the message, never
 * from the stat before it:
 *
 * - the head and its version: a head older than the list it came with is a
 *   parent the server will refuse;
 * - the groups: read at that version. A message without them clears the old
 *   ones rather than keeping them -- the old groups beside the new version
 *   would say a stage or unstage the server has made is not there, and the
 *   scope would follow that;
 * - which of the patches are already published. This one was kept from the
 *   previous stat, and a publish is exactly the change that moves both at
 *   once: it takes the patches out of every group and marks them applied. With
 *   the new groups and the old applied list, the publisher's patches looked
 *   like pending ones that had left their group -- unstaged -- so the
 *   published change vanished from the Studio until a reload, which reads both
 *   from one `/stat`. The `/stat` poll is twenty minutes apart once a socket is
 *   up, so nothing else corrected it.
 *
 * Applied is one-way, so a content service that does not send the list (one
 * that predates it) keeps the previous one: incomplete, never wrong.
 */
export function chainOfMessage(
  prev: Pick<StatData, "appliedPatches" | "publishingPatches">,
  message: PatchesMessage,
): Pick<
  StatData,
  | "patches"
  | "headPatchId"
  | "headVersion"
  | "patchGroups"
  | "appliedPatches"
  | "publishingPatches"
> {
  return {
    patches: message.patches,
    headPatchId: message.headPatchId,
    headVersion: message.headVersion,
    patchGroups: message.patchGroups,
    appliedPatches: message.appliedPatches ?? prev.appliedPatches,
    /*
     * Replaced, never accumulated: a job that ends without sealing gives its
     * changes back, and the message is the whole set at that moment. Kept
     * from before only when the message does not carry it at all.
     */
    publishingPatches: message.publishingPatches ?? prev.publishingPatches,
  };
}

/**
 * What content says a running publish holds, with the chain it said it
 * against: `heldByContent` reads the three together, so they are always taken
 * from one answer or one socket message, never mixed.
 *
 * Kept APART from the stat the stores adopt. A `/stat` answer requested before
 * a socket message is older than it for the holds -- but it can also come from
 * a newer BUILD than the socket describes, so the stat itself is taken whole:
 * the chain pairs with the build metadata it was read with, or `BaseAlignment`
 * replays published patches onto the new base. Only these holds prefer the
 * socket.
 */
export type ContentHolds = Pick<
  StatData,
  "patches" | "appliedPatches" | "publishingPatches"
>;

/** The holds after a socket `patches` message. See {@link chainOfMessage}. */
export function holdsOfMessage(
  prev: ContentHolds | undefined,
  message: PatchesMessage,
): ContentHolds {
  return {
    patches: message.patches,
    appliedPatches: message.appliedPatches ?? prev?.appliedPatches,
    publishingPatches: message.publishingPatches ?? prev?.publishingPatches,
  };
}

/**
 * The holds after a `/stat` answer: the answer's, unless a socket message
 * arrived after the request went out. Socket messages do not move
 * `statIdRef`, so an answer requested before a publish started elsewhere was
 * taken after the socket had said which changes that publish holds -- and
 * Publish was offered over them until the next update. The socket's view is
 * never left stale by keeping it: every later change to the chain or to a
 * publish sends another message.
 */
export function holdsOfAnswer(
  prev: ContentHolds | undefined,
  answer: ContentHolds,
  socketSpokeSince: boolean,
): ContentHolds {
  if (socketSpokeSince && prev !== undefined) return prev;
  return {
    patches: answer.patches,
    appliedPatches: answer.appliedPatches,
    publishingPatches: answer.publishingPatches,
  };
}

/** How long the Studio leaves between `/stat` calls once a socket is up. */
const WebSocketStatInterval = 2 * 60 * 10 * 1000;

/** The shortest gap between `/stat` calls while a publish is on its way out. */
const AwaitingDeploymentMinInterval = 5 * 1000;

/**
 * How long to wait before asking `/stat` again while a publish has not landed.
 *
 * `/stat` is the ONLY thing that reports which commit the site is actually
 * serving — `commitSha` is read from the environment when the app boots, so a
 * finished deploy is a new process answering with a new sha — and that is how
 * Val decides a publish is live. Nothing pushes it: the socket carries patches,
 * commits and deployments, none of which can say "the site is now serving this".
 * So on the idle interval a publish that went out two minutes after it was made
 * still read as "Building" for another eighteen.
 *
 * A quarter of however long the publish has been waiting, floored at five
 * seconds and capped at the idle interval: quick right after a publish, and
 * cheaper the longer the build runs, so a deploy that never lands settles back
 * onto the idle interval rather than polling forever.
 *
 * `Infinity` — i.e. "no opinion, use the idle interval" — when every commit and
 * deployment Val knows about is one the site already answers with.
 */
export function awaitingDeploymentInterval(
  data: StatData | undefined,
  now: number,
): number {
  // fs mode has no deployments and long-polls anyway, and a stat that has not
  // reported a commit sha cannot tell us what is outstanding.
  if (!data?.commitSha) {
    return Infinity;
  }
  /**
   * Commits and deployments alike: both are "something was published that the
   * site does not answer with yet", and either can be the only record of one.
   */
  const published: { commitSha: string; createdAt: string }[] = [
    ...(data.commits || []).map((commit) => ({
      commitSha: commit.commitSha,
      createdAt: commit.createdAt,
    })),
    ...(data.deployments || []).map((deployment) => ({
      commitSha: deployment.commitSha,
      createdAt: deployment.createdAt,
    })),
  ];
  const awaiting = published
    .filter((entry) => entry.commitSha !== data.commitSha)
    .map((entry) => new Date(entry.createdAt).getTime())
    .filter((at) => !Number.isNaN(at));
  if (awaiting.length === 0) {
    return Infinity;
  }
  // The one that started waiting most recently, so a publish that will never
  // land does not slow down the poll for a fresh one behind it.
  const waitedFor = Math.max(0, now - Math.max(...awaiting));
  return Math.min(
    WebSocketStatInterval,
    Math.max(AwaitingDeploymentMinInterval, waitedFor / 4),
  );
}

async function execStat(
  client: ValClient,
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  connectionIdRef: React.MutableRefObject<string>,
  statIdRef: React.MutableRefObject<number>,
  socketPatchesRef: React.MutableRefObject<number>,
  setHolds: Dispatch<SetStateAction<ContentHolds | undefined>>,
  stat: StatState,
  setStat: Dispatch<SetStateAction<StatState>>,
  setAuthenticationLoadingIfNotAuthenticated: () => void,
  setIsAuthenticated: Dispatch<SetStateAction<AuthenticationState>>,
  setServiceUnavailable: Dispatch<SetStateAction<boolean | undefined>>,
  onPublishJob: (job: PublishJobNudge) => void,
) {
  const id = ++statIdRef.current;
  const socketPatchesAtRequest = socketPatchesRef.current;
  let body = null;
  if ("data" in stat && stat.data) {
    body = {
      schemaSha: stat.data.schemaSha,
      sourcesSha: stat.data.sourcesSha,
      baseSha: stat.data.baseSha,
      patches: stat.data.patches,
      // Echoed back so FS mode can tell us a `.jsonValues()` entry file changed:
      // no other sha here can see that (a jsonValues module's source is markers).
      jsonEntriesSha: stat.data.jsonEntriesSha,
    };
  }

  setAuthenticationLoadingIfNotAuthenticated();
  return client("/stat", "POST", {
    body: body,
  })
    .then((res) => {
      if (res.status === 401) {
        setIsAuthenticated("login-required");
        return;
      } else {
        setIsAuthenticated("authorized");
      }
      if (res.status === 503) {
        setServiceUnavailable(true);
        setStat((prev) => ({
          status: "error",
          error: "Service unavailable",
          /*
           * The last answer stands, as it does for every other error
           * (`createError`): an outage is not news that a publish ended, and
           * dropping the data released every change content had said a
           * running publish holds.
           */
          data: "data" in prev ? prev.data : undefined,
          retries: ("retries" in prev ? prev.retries : 0) + 1,
          waitStart: Date.now(),
          wait: 5000,
        }));
        return;
      }
      setServiceUnavailable(false);
      if (statIdRef.current !== 0 && statIdRef.current !== id) {
        return;
      }
      if (res.status === 200) {
        if (
          // we could have less types on json, but these are supposed to be more descriptive
          res.json.type === "did-change" ||
          res.json.type === "no-change" ||
          res.json.type === "request-again"
        ) {
          setStat({
            status: "updated-request-again",
            data: res.json,
            waitStart: Date.now(),
            wait: webSocketRef.current ? WebSocketStatInterval : 0, // why 0 wait unless websocket? If websocket is not used, we are long polling so no point in waiting
          });
          const answer = res.json;
          setHolds((prev) =>
            holdsOfAnswer(
              prev,
              answer,
              socketPatchesRef.current !== socketPatchesAtRequest,
            ),
          );
        } else if (res.json.type === "use-websocket") {
          const answer = res.json;
          // Whole: see `ContentHolds` for why only the holds prefer the socket.
          setStat((prev) => ({
            ...prev,
            status: "updated-request-again",
            data: answer,
            waitStart: Date.now(),
            wait: WebSocketStatInterval,
          }));
          setHolds((prev) =>
            holdsOfAnswer(
              prev,
              answer,
              socketPatchesRef.current !== socketPatchesAtRequest,
            ),
          );
          if (webSocketRef.current) {
            console.debug("Closing existing WebSocket");
            webSocketRef.current.close();
          }
          const wsUrl = res.json.url;
          console.debug("Connecting to WebSocket", wsUrl);
          webSocketRef.current = new WebSocket(wsUrl);
          const nonce = res.json.nonce;
          webSocketRef.current.onopen = () => {
            webSocketRef.current?.send(
              JSON.stringify({
                nonce,
                type: "subscribe",
                connectionId: connectionIdRef.current,
              }),
            );
          };
          webSocketRef.current.onmessage = (event) => {
            try {
              const messageRes = WebSocketServerMessage.safeParse(
                JSON.parse(event.data),
              );
              if (!messageRes.success) {
                console.error(
                  "Could not parse WebSocket message",
                  messageRes.error,
                );
                return;
              }
              const message = messageRes.data;
              if (message.type === "patches") {
                socketPatchesRef.current++;
                setHolds((prev) => holdsOfMessage(prev, message));
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        ...chainOfMessage(prev.data, message),
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(
                              0,
                              prev.waitStart +
                                WebSocketStatInterval -
                                Date.now(),
                            )
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else if (message.type === "publish-job") {
                onPublishJob({
                  id: message.job.id,
                  status: message.job.status ?? null,
                });
              } else if (message.type === "subscribed") {
                console.debug("Subscribed!");
              } else if (message.type === "commit") {
                console.debug("Commit", message.commit);
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    const commits = (prev.data.commits || []).concat(
                      message.commit,
                    );
                    // we don't want to set the wait time to 0 here, because we want to keep the polling
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        commits,
                        /*
                         * The publish head moves HERE too, not only on a poll.
                         *
                         * This message is how another author's publish reaches
                         * this client, and `headCommitSha` was only ever set by
                         * a `/stat` response — so between the two, a publish
                         * from this tab carried a head the server had already
                         * moved past and came back 409. Derived with the same
                         * `newestCommitSha` the server compares with, rather
                         * than assuming the message is the newest: commits
                         * arrive in whatever order the socket delivers them.
                         */
                        headCommitSha:
                          newestCommitSha(commits) ?? prev.data.headCommitSha,
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(
                              0,
                              prev.waitStart +
                                WebSocketStatInterval -
                                Date.now(),
                            )
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else if (message.type === "deployment") {
                console.debug("Deployment", message.deployment);
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        deployments: (prev.data.deployments || []).concat({
                          commitSha: message.deployment.commitSha,
                          deploymentId: message.deployment.deploymentId,
                          deploymentState: message.deployment.deploymentState,
                          createdAt: message.deployment.createdAt,
                          updatedAt: message.deployment.updatedAt,
                          // The git message, where the content service sends
                          // one. Copied field by field here, so leaving it out
                          // dropped it as surely as the schema stripping it
                          // would have. See `ValDeployment`.
                          commitMessage: message.deployment.commitMessage,
                        }),
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(
                              0,
                              prev.waitStart +
                                WebSocketStatInterval -
                                Date.now(),
                            )
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else {
                const exhaustiveCheck: never = message;
                console.warn("Unknown WebSocket message", exhaustiveCheck);
              }
            } catch (e) {
              console.error("Could not parse WebSocket message", e);
            }
          };
          const currentWebSocket = webSocketRef.current;
          webSocketRef.current.onclose = () => {
            if (currentWebSocket === webSocketRef.current) {
              console.debug("WebSocket closed");
              setStat((prev) => createError(prev, "WebSocket closed"));
            }
          };
          webSocketRef.current.onerror = () => {
            console.warn("WebSocket error");
            setStat((prev) =>
              createError(
                prev,
                `Got an error while syncing with Val (reason: WebSocket error)`,
              ),
            );
          };
        }
      } else {
        setStat((prev) => createError(prev, res.json.message));
      }
    })
    .catch((err) => {
      if (statIdRef.current !== 0 && statIdRef.current !== id) {
        return;
      }
      setStat((prev) => createError(prev, err.message));
    });
}

function createError(stat: StatState, message: string): StatState {
  const retries = "retries" in stat ? stat.retries + 1 : 0;
  // a bit of random jitter in the start, but maxes out pretty soon on 5000ms
  const waitMillis =
    stat.status === "error" && stat.retries > 1
      ? Math.min(500, stat.retries * 50 + Math.floor(Math.random() * 100)) * 10
      : 0;

  return {
    status: "error",
    error: message,
    data: "data" in stat ? stat.data : undefined,
    retries,
    waitStart: "waitStart" in stat ? stat.waitStart : Date.now(),
    wait: waitMillis,
  };
}

export type AuthenticationState =
  | "not-asked"
  | "loading"
  | "login-required"
  | "authorized"
  | "authentication-error";
function useAuthentication() {
  const [authenticationState, setIsAuthenticated] =
    useState<AuthenticationState>("not-asked");
  const setAuthenticationLoadingIfNotAuthenticated = useCallback(() => {
    if (authenticationState === "not-asked") {
      setIsAuthenticated("loading");
    }
  }, [authenticationState]);

  return {
    authenticationState,
    setIsAuthenticated,
    setAuthenticationLoadingIfNotAuthenticated,
  };
}

export type PatchWithMetadata = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Patch;
  author: string | null;
  createdAt: string;
  error: string | null;
};

export type Author = {
  id: string;
  name: string;
  avatar: string;
};

export type ValError =
  | {
      type: "validationError";
      message: string;
    }
  | {
      type: "patchError";
      message: string;
    }
  | {
      // should the UI be responsible for "handling" errors? That makes sense right now, but not sure if it will in the future
      type: "typeError" | "schemaError" | "unknownError";
      message: string;
    };
