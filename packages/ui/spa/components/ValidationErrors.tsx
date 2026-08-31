import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { Fragment, useMemo } from "react";
import classNames from "classnames";
import { CheckCircle2, FileCode2, Loader2, TriangleAlert } from "lucide-react";
import { AnyField } from "./AnyField";
import { FieldErrorList } from "./FieldErrorList";
import { FieldErrorsOwned } from "./FieldErrorsOwner";
import { FieldPathLink } from "./FieldPathLink";
import { useNavLink } from "./navLink";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useSchemaAtPath, useSchemas } from "./ValFieldProvider";
import { useNavigation } from "./ValRouter";
import { prettifyFilename } from "../utils/prettifyFilename";
import { prettifyModulePath } from "../utils/prettifyText";

/**
 * The list of rows shown on `/val/errors` is driven entirely by the
 * `error-field` query params at page load — it never reacts to errors
 * appearing or disappearing while the user is editing here, so rows are
 * stable and the layout doesn't shift. The right-tools "Validation errors"
 * button is responsible for re-snapshotting the URL when the user wants a
 * fresh view.
 *
 * The page is grouped by module file, with a count pill per module, so a
 * user fixing errors across several files always has an at-a-glance map of
 * what's left. Errors use the warning palette rather than error-red so the
 * page reads as "needs attention before publish", not "something is broken".
 */
export function ValidationErrors({
  errorFields,
  allErrors,
}: {
  errorFields: SourcePath[];
  allErrors: Record<SourcePath, ValidationError[] | undefined> | null;
}) {
  const grouped = useMemo(() => groupByModule(errorFields), [errorFields]);
  const totalFields = errorFields.length;
  const moduleCount = grouped.length;
  const allFixed =
    totalFields > 0 &&
    errorFields.every(
      (path) => !allErrors?.[path] || allErrors[path]!.length === 0,
    );
  const remainingFieldCount = errorFields.filter(
    (path) => allErrors?.[path] && allErrors[path]!.length! > 0,
  ).length;

  if (errorFields.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-sm text-fg-secondary">
        No errors selected.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl flex flex-col gap-4 py-6">
      <header className="flex items-center gap-2">
        <TriangleAlert
          size={18}
          className="text-fg-warning-primary-alt"
          aria-hidden
        />
        <h1 className="text-lg font-medium text-fg-primary">
          Validation errors
        </h1>
        {allFixed ? (
          <CountPill tone="success">All fixed</CountPill>
        ) : (
          <CountPill tone="warning">
            {totalFields} {totalFields === 1 ? "field" : "fields"}
            {moduleCount > 1 ? (
              <>
                {" across "}
                {moduleCount} modules
              </>
            ) : null}
          </CountPill>
        )}
      </header>

      {allFixed && <AllFixedBanner total={totalFields} />}

      {!allFixed && remainingFieldCount < totalFields && totalFields > 1 && (
        <div className="text-sm text-fg-secondary">
          {remainingFieldCount} of {totalFields} still need attention.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {grouped.map(({ moduleFilePath, paths }) => (
          <ModuleGroup
            key={moduleFilePath}
            moduleFilePath={moduleFilePath}
            paths={paths}
            allErrors={allErrors}
          />
        ))}
      </div>
    </div>
  );
}

export function ValidationErrorsView() {
  const { errorFields } = useNavigation();
  const allErrors = useAllValidationErrors();
  return <ValidationErrors errorFields={errorFields} allErrors={allErrors} />;
}

function ModuleGroup({
  moduleFilePath,
  paths,
  allErrors,
}: {
  moduleFilePath: ModuleFilePath;
  paths: SourcePath[];
  allErrors: Record<SourcePath, ValidationError[] | undefined> | null;
}) {
  const moduleParts = useMemo(
    () => Internal.splitModuleFilePath(moduleFilePath),
    [moduleFilePath],
  );
  const moduleLink = useNavLink(moduleFilePath);
  const unresolvedCount = paths.filter(
    (path) => allErrors?.[path] && allErrors[path]!.length > 0,
  ).length;
  return (
    <section className="overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
      <header className="flex items-center gap-2 border-b border-border-primary bg-bg-secondary px-4 py-2">
        <FileCode2
          size={14}
          className="text-fg-secondary-alt shrink-0"
          aria-hidden
        />
        {/*
         * The module this group is about, as somewhere you can go: the group
         * header named the file and left you to find it in the navigation.
         */}
        <a
          {...moduleLink}
          title={moduleFilePath}
          className="min-w-0 flex flex-wrap items-center gap-1 rounded-sm text-sm text-fg-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          {moduleParts.map((part, i) => (
            <Fragment key={`m-${i}`}>
              {i > 0 && <span className="text-fg-tertiary">/</span>}
              <span
                className={classNames({
                  "text-fg-tertiary": i < moduleParts.length - 1,
                  "text-fg-primary": i === moduleParts.length - 1,
                })}
              >
                {prettifyFilename(part)}
              </span>
            </Fragment>
          ))}
        </a>
        <div className="ml-auto">
          {unresolvedCount === 0 ? (
            <CountPill tone="success">
              <CheckCircle2 size={11} aria-hidden />
              <span>Fixed</span>
            </CountPill>
          ) : (
            <CountPill tone="warning">
              {unresolvedCount} {unresolvedCount === 1 ? "issue" : "issues"}
            </CountPill>
          )}
        </div>
      </header>
      <ul className="flex flex-col">
        {paths.map((path, i) => (
          <ValidationErrorRow
            key={path}
            sourcePath={path}
            errors={allErrors?.[path]}
            isLast={i === paths.length - 1}
          />
        ))}
      </ul>
    </section>
  );
}

function ValidationErrorRow({
  sourcePath,
  errors,
  isLast,
}: {
  sourcePath: SourcePath;
  errors: ValidationError[] | undefined;
  isLast: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(sourcePath);
  const hasError = !!errors && errors.length > 0;
  return (
    <li
      className={classNames("flex flex-col gap-3 px-4 py-3", {
        "border-b border-border-secondary": !isLast,
      })}
    >
      <FieldPathLabel sourcePath={sourcePath} />
      {schemaAtPath.status === "success" ? (
        /*
         * This row shows the errors itself, below the field, so the field must
         * not show them too.
         *
         * A field opened on its own has no `Field` wrapper above it, so
         * `AnyField` fills in and renders them — which is right everywhere else
         * and is a duplicate here, where listing the error IS the row's job and
         * where the same block also turns into "Fixed." once it clears. See
         * `FieldErrorsOwner`.
         */
        <FieldErrorsOwned>
          <AnyField path={sourcePath} schema={schemaAtPath.data} />
        </FieldErrorsOwned>
      ) : (
        <div className="flex items-center gap-2 text-sm text-fg-secondary">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          <span>Loading field&hellip;</span>
        </div>
      )}
      {hasError ? (
        <FieldErrorList validationErrors={errors!} />
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-fg-brand-primary">
          <CheckCircle2 size={13} aria-hidden />
          <span>Fixed.</span>
        </div>
      )}
    </li>
  );
}

function FieldPathLabel({ sourcePath }: { sourcePath: SourcePath }) {
  const schemas = useSchemas();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const segments = modulePath
    ? Internal.splitModulePath(modulePath as ModulePath)
    : [];
  const schemasData = schemas.status === "success" ? schemas.data : undefined;
  const moduleSchema = schemasData?.[moduleFilePath];
  const isRouterModule =
    moduleSchema?.type === "record" && Boolean(moduleSchema.router);
  const isRouterPageKey = isRouterModule && segments.length === 1;

  return (
    <FieldPathLink
      sourcePath={sourcePath}
      previewSegment={isRouterPageKey ? segments[0] : undefined}
      className={isRouterPageKey ? undefined : "self-start max-w-full"}
    >
      {isRouterPageKey
        ? segments[0]
        : modulePath
          ? prettifyModulePath(modulePath)
          : prettifyFilename(
              Internal.splitModuleFilePath(moduleFilePath).pop() ?? "",
            )}
    </FieldPathLink>
  );
}

function CountPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warning" | "success";
}) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        {
          "bg-bg-warning-primary text-fg-warning-primary": tone === "warning",
          "bg-bg-brand-primary text-fg-brand-primary": tone === "success",
        },
      )}
    >
      {children}
    </span>
  );
}

function AllFixedBanner({ total }: { total: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-bg-secondary px-4 py-3 text-sm text-fg-primary">
      <CheckCircle2 size={16} className="text-fg-secondary" aria-hidden />
      <span>
        All <span className="font-medium">{total}</span>{" "}
        {total === 1 ? "error is" : "errors are"} fixed. Ready to publish.
      </span>
    </div>
  );
}

function groupByModule(
  errorFields: SourcePath[],
): { moduleFilePath: ModuleFilePath; paths: SourcePath[] }[] {
  const map = new Map<ModuleFilePath, SourcePath[]>();
  for (const path of errorFields) {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    const bucket = map.get(moduleFilePath);
    if (bucket) {
      bucket.push(path);
    } else {
      map.set(moduleFilePath, [path]);
    }
  }
  const groups = Array.from(map.entries()).map(([moduleFilePath, paths]) => ({
    moduleFilePath,
    paths: paths.slice().sort(compareWithinModule),
  }));
  groups.sort((a, b) => a.moduleFilePath.localeCompare(b.moduleFilePath));
  return groups;
}

function compareWithinModule(a: SourcePath, b: SourcePath): number {
  const [, aPath] = Internal.splitModuleFilePathAndModulePath(a);
  const [, bPath] = Internal.splitModuleFilePathAndModulePath(b);
  const aSegs = aPath ? Internal.splitModulePath(aPath as ModulePath) : [];
  const bSegs = bPath ? Internal.splitModulePath(bPath as ModulePath) : [];
  const min = Math.min(aSegs.length, bSegs.length);
  for (let i = 0; i < min; i++) {
    if (aSegs[i] !== bSegs[i]) return aSegs[i].localeCompare(bSegs[i]);
  }
  return aSegs.length - bSegs.length;
}
