# Remote images over MCP

> **Status: shipped**, as Option 2 below. `resolveRemoteFileAuth` lives in
> `valServerConfig.ts` and is shared with `ValServer`; the tool side is
> `packages/mcp/src/images/remoteUploadTarget.ts`. Option 3 (extracting the
> ref-building recipe out of `uploadRemoteFileCore`) was deliberately not done —
> see the reason under it, and the cross-check test in `remoteImages.test.ts`
> that stands in for it. The open questions at the bottom are still open.

`upload_image` used to refuse `s.image().remote()`, with a message saying that
uploading one needs a presigned nonce and a personal access token the endpoint
does not hold.

**That message was wrong**, and this plan is mostly the consequence of finding
out why. The nonce is the _browser's_ problem, not the server's, and the
content-host upload does not happen when an image is added at all — it happens
when the change is published. What is actually missing is much smaller than the
refusal implies.

---

## Part A — what a remote image actually is

### A.1 The bytes do not go to the content host at edit time

This is the finding that decides the whole shape.

The Studio uploads a remote image to `POST {baseUrl}/patches/{patchId}/files`
with `remote: true` — the **patch store**, the same endpoint a local image goes
to (`createValSystem.ts`, `uploadFile`). The only difference is that the remote
ref is split back to its `public/...` path first, because the server keys files
by path and a ref is a URL that encodes one.

The upload to `remote.val.build` happens later, in
`ValOpsFS.saveOrUploadFiles(mode: "upload-remote", auth)` (`ValOpsFS.ts:1160`),
which reads each remote descriptor's bytes back **out of the patch store** and
`PUT`s them to the content host. That runs at publish.

So a pending remote image is: a patch whose `file` op is flagged `remote`, and
bytes in the patch store. Nothing else. The draft renders from
`/api/val/files/{filePath}?patch_id=…&remote=true&ref=…`, which is why the
bytes have to be there and why they are enough.

> The `contentBaseUrl` / `contentAuthNonce` fields on
> `/direct-file-upload-settings` are not part of this path. They exist for the
> AI **session image** flow, which does go straight to the content host — see
> the comment in `ValServer.ts`. Reading those and concluding that ordinary
> remote uploads need a nonce is the mistake this document exists to correct.

### A.2 What has to be computed, and what it needs

The ref is the whole of the work. `uploadRemoteFileCore` in `fixHandlers.ts`
(:223–:385) is the reference implementation — it is what `val validate --fix`
runs — and the recipe is:

| Step | From                                                                                  | Needs                            |
| ---- | ------------------------------------------------------------------------------------- | -------------------------------- |
| 1    | `getSettings(project, auth)` → `publicProjectId`, `remoteFileBuckets`                 | **a credential**, a network call |
| 2    | pick a bucket (`buckets[counter % buckets.length]`)                                   | —                                |
| 3    | `Internal.remote.getFileHash(buffer)`                                                 | — (**not** `getSHA256Hash`)      |
| 4    | `Internal.remote.getValidationHash(coreVersion, schema, fileExt, metadata, fileHash)` | the **serialized schema**        |
| 5    | `Internal.remote.createRemoteRef(remoteHost, {…})`                                    | `remoteHost`                     |
| 6    | write the patch, upload the bytes to the patch store                                  | — (we already do this)           |

Only step 1 needs anything we do not already have in hand.

### A.3 Speculative validation will not fight us

Worth stating, because the local path needed work here and this one does not.

`validateSources` routes a remote ref to `remoteFiles` rather than to `files`
(`ValOps.ts:1165`), on the strength of its `image:check-remote` fix — and
`validateRemoteFiles` is a stub that returns `{}`. So a remote ref is never
metadata-checked server-side, and `image:check-remote` is in
`partitionValidationErrors`' skip set anyway, so it could not block a write even
if it fired.

Consequence: the `pendingFiles` mechanism that `savePatch` grew for local
uploads is **not needed** for remote. It also means there is no server-side
check that a remote upload was coherent, which is worth knowing when deciding
how much to verify in the tool itself.

---

## Part B — the credential question

> "If we are fs, yes we need a PAT, but if we are oauthed we should be good?"

Half right, and the fs half is better than expected: **the MCP caller never
supplies a credential, in either mode.**

`getRemoteFileAuth()` (`ValServer.ts:305`) already answers this question for the
Studio, and its rule is:

1. `options.apiKey` if set → `{ apiKey }`. In proxy mode this is always set. In
   fs mode it is set if `VAL_API_KEY` is in the environment.
2. Otherwise, in fs mode → read the developer's `val login` token from
   `getPersonalAccessTokenPath(cwd)` → `{ pat }`.
3. Otherwise → error.

Per mode:

| Mode                         | Credential for `getSettings` | Comes from                     | Caller supplies |
| ---------------------------- | ---------------------------- | ------------------------------ | --------------- |
| fs (local dev)               | the `val login` PAT on disk  | the machine running the server | **nothing**     |
| fs + `VAL_API_KEY`           | the app's API key            | the environment                | **nothing**     |
| proxy + verified OAuth token | the app's API key            | the environment                | **nothing**     |
| proxy + bearer PAT           | the app's API key            | the environment                | **nothing**     |

So the answer to the question as asked: yes, OAuth is fine — but not because
the access token is used for the upload. It is fine because in proxy mode the
app's API key was always going to be the credential, and the verified profile is
what we already use for _authorship_, which is a different question.

And fs mode needs a PAT only in the sense that `val validate --fix` needs one:
the developer has to have run `val login`. If they have not, the honest failure
is the CLI's own — _"you have remote images that are not uploaded and you are
not logged in. Fix this by running `npx val login`"_ — reported before any bytes
are read.

**Nothing in this plan requires the MCP protocol to carry a new credential, and
nothing requires a change to `ValToolAuth`.**

### B.1 One thing to be careful about

In proxy mode the credential is the app's API key, and the app's API key can do
more than the caller can. That is the D.6 confused-deputy shape the MCP plan is
otherwise careful about.

It is defensible here, and worth writing down why: `getSettings` reads the
project's public id and its bucket list, which is not user data and is the same
answer for every caller of that project. The _write_ — the content-host upload —
still happens at publish, under whatever credential publish already uses. So the
API key is used for a lookup, not to act on a caller's behalf. If that stops
being true (a future `getSettings` that returns per-user data), this decision
has to be revisited.

---

## Part C — options

The mechanics are settled; the question is where the code lives. Four options,
roughly in order of how much they invest in not having two copies of something.

### Option 1 — self-contained in `@valbuild/mcp`

A `remoteUploadTarget(deps, options)` helper inside `packages/mcp/src/images/`
that resolves auth, calls `getSettings`, caches the result, picks a bucket, and
returns `{ publicProjectId, bucket, coreVersion, remoteHost }`.

Everything it needs is **already exported** from `@valbuild/server`:
`getSettings`, `getPersonalAccessTokenPath`, `parsePersonalAccessTokenFile`, and
`ValServerConfig` (for `apiKey`, `project`, `cwd`).

- **Cost:** ~120 lines and no changes outside `packages/mcp`.
- **Duplicates:** the `getRemoteFileAuth` rule (apiKey → fs PAT → error) — about
  15 lines, and a rule that has already changed once.
- **Risk:** the two copies drift, and the failure is quiet: the MCP endpoint
  decides it cannot upload remotely while the Studio in the same process can.

### Option 2 — extract `getRemoteFileAuth` into `@valbuild/server`, share it

Move the closure out of `createValServer` into `valServerConfig.ts` (beside
`initHandlerOptions` and `createValOps`, which are there for exactly this
reason), export it, and have both `ValServer` and the MCP tool call it.

- **Cost:** Option 1 plus a careful extraction from `ValServer.ts`. The closure
  memoises into a `remoteFileAuth` variable and reads `options.config.root`, so
  it needs a small explicit input type rather than a straight move.
- **Removes:** the drift in Option 1.
- **Risk:** touching `ValServer.ts`, which is large and central. Mitigated by the
  extraction being mechanical and by the Studio's own remote-upload path being
  covered by `examples/next`.

**This is the one the repo's own precedent argues for.** `valServerConfig.ts`
exists because "two copies of this decision drift, and the failure would be
quiet — a registry that decides it is in fs mode while the Studio decides it is
in proxy mode reads different content from the same project." The credential
rule is the same kind of decision.

### Option 3 — also extract the ref-building recipe

Go further: pull steps 2–5 of A.2 out of `uploadRemoteFileCore` into a pure
`buildRemoteRef({ buffer, schema, filePath, publicProjectId, bucket, coreVersion, remoteHost })`
in `@valbuild/server`, called by both the fix handler and the MCP tool.

- **Removes:** a second copy of the hash/validation-hash/ref recipe, which is
  the part where being subtly wrong produces a ref that uploads fine and can
  never validate.
- **Cost:** `uploadRemoteFileCore` is entangled with `FixHandlerContext` — its
  fs host, its bucket counter, its event list. Extracting the pure middle is a
  real refactor of a path that `val validate --fix` depends on.
- **Verdict:** right eventually, wrong as part of this change. The recipe is
  five function calls in a fixed order; the schema synthesis below is the part
  that is actually easy to get wrong, and that is not shared with the fix
  handler anyway.

### Option 4 — do not build the ref; let `val validate --fix` promote it

Have the tool always write a local image and rely on the existing fix handler to
upload it later.

**Rejected, with a reason.** `uploadRemoteFileCore` reads the file from the
**working tree** (`path.join(ctx.projectRoot, fileRef)`), and an MCP upload's
bytes are in the patch store, not the tree — they only reach the tree at
publish. So the promotion cannot run until after publish, and until then the
field holds a local path that a `remote: true` schema reports as invalid. The
agent's edit would look broken and the fix would be a CLI command nobody was
told to run.

---

## Part D — the part that is actually delicate

Not the credential. The **validation hash**, which is baked into the ref and
computed from the serialized schema.

For a single field (`s.image({ remote: true })`) the schema is the field's own,
and it is right there in `deps.state.serializedSchemas`.

For a **gallery** it is not. A gallery entry's schema is an `ObjectSchema`
(width/height/mimeType/alt), and the validator compares against a _synthesized_
`SerializedImageSchema` carrying the `accept` and `directory` of the **record
that holds the entry** — resolved from the entry's parent path, not from the
module root, because a nested gallery (`s.object({ gallery: s.images(…) })`)
would otherwise synthesize empty options. `handleRemoteGalleryFileUpload`
(`fixHandlers.ts:520`) does this and its comment names the failure exactly:

> "would otherwise synthesize a schema with no options and bake a validation
> hash into the remote ref that can never validate, so a mismatch fails fast
> instead of uploading."

The MCP tool resolves its target from the module schema already
(`resolveTarget`), so it knows which record it is writing into — but it must
synthesize the same shape, from the same source, or produce refs that upload and
then fail forever.

Also relevant, and already handled on the local path: `encode` is stripped in
`getValidationBasis`, so re-encoding before hashing is safe here.

---

## Part E — proposed work

Assuming Option 2.

1. **Extract the credential rule.** `resolveRemoteFileAuth(options)` in
   `packages/server/src/valServerConfig.ts`, returning
   `{ status: "ok"; auth } | { status: "error"; code; message }`. Rewire
   `ValServer`'s `getRemoteFileAuth` closure to call it and keep its memoisation.
   No behaviour change; the Studio's remote path is the test.

2. **`remoteUploadTarget` in `@valbuild/mcp`.** Resolve auth, `getSettings`,
   cache per process (buckets and the public id do not move), pick a bucket.
   Refuse with the CLI's own wording when fs mode has no PAT.

3. **Teach `resolveTarget` about remote.** Replace the three `refuseRemote()`
   branches with a `remote: true` marker plus, for a gallery, the synthesized
   `SerializedImageSchema` from Part D.

4. **A remote branch in the write path.** Build the ref, write
   `{ path: ref, ...metadata }`, `file` op with `filePath: ref, remote: true`,
   and upload the bytes to the patch store at the **split** `public/...` path.
   The `uploadFiles` hook already exists; it needs the split and the flag, and
   it should return no `pendingFiles` (Part A.3).

5. **Bucket allocation.** A per-process counter, as the CLI does. Worth a note:
   the Studio picks with `useCurrentRemoteFileBucket`, so a project's images end
   up spread differently depending on who added them. Not a correctness problem
   — the bucket is in the ref — but it should be a deliberate choice rather than
   an accident.

6. **Tests.** The fixture project cannot reach a content host, so:
   - unit-test the ref construction against a known `publicProjectId`/bucket and
     assert the ref round-trips through `Internal.remote.splitRemoteRef`;
   - assert the gallery case synthesizes the same schema the validator uses,
     by computing the validation hash both ways and comparing;
   - fake `getSettings` at the `remoteUploadTarget` seam for the tool-level
     tests, and assert the patch shape and that the bytes land in the patch
     store under the split path;
   - one fs-mode test that the missing-PAT refusal fires before any bytes are
     read.

7. **Verify against a real project.** The one thing tests cannot cover is
   whether the ref validates and the bytes publish. `examples/next` has
   `content/remoteImages.val.ts` (`s.images({ remote: true })`) — upload through
   MCP, then publish, then `val validate` and confirm the ref resolves.

---

## Open questions

1. **Bucket allocation.** Per-process counter, random, or ask the backend? The
   CLI's round-robin exists to spread files; an MCP server that restarts often
   would keep picking bucket 1. Probably fine, but say so on purpose.

2. **Should `upload_image` refuse remote in fs mode without `val login`, or fall
   back to a local image?** Refusing is honest. Falling back silently changes
   what the schema asked for. Recommend refusing, with the CLI's message.

3. **Does the backend accept a bare PAT for `getSettings` in proxy mode?** Not
   needed for this plan — proxy mode always has an API key — but it decides
   whether a PAT-only host could ever do this.

4. **Nothing verifies the remote upload until publish.** `validateRemoteFiles`
   is a stub, so a ref with a wrong validation hash is silent until then. Worth
   considering whether the tool should compute the hash a second way and compare
   before writing, given Part D.
