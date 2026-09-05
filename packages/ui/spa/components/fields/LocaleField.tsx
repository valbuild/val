import { SourcePath } from "@valbuild/core";
import { acceptedLocaleValues, localeOfValue } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { useProjectLocales } from "../../hooks/useProjectLocales";
import { useValPortal } from "../ValPortalProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { PreviewLoading, PreviewNull } from "../../components/Preview";

/**
 * The name of a language, in that language.
 *
 * `undefined` for anything `Intl` will not parse, so a value validation is
 * already complaining about shows as itself rather than crashing the field.
 */
export function localeName(tag: string): string | undefined {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag);
  } catch {
    return undefined;
  }
}

/**
 * One of the project's languages, as a picker.
 *
 * The options come from `locales.available` in the settings module, not from the
 * schema — which is the whole design: a project adds a language once, there, and
 * every locale field in the project offers it.
 *
 * With `.aliases()` the options are the field's own spellings instead, since
 * those are what this field stores. Each is labelled with the language it means,
 * so `no` reads as "norsk bokmål" and not as a mystery.
 */
export function LocaleField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
}) {
  const type = "locale";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const projectLocales = useProjectLocales();
  const portalContainer = useValPortal();
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    sourceAtPath.status === "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading" || !("data" in sourceAtPath)) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const aliases = schemaAtPath.data.aliases;
  const options = acceptedLocaleValues(projectLocales, aliases);
  const current = sourceAtPath.data ?? "";
  const content = (
    <div id={path}>
      {options.length === 0 ? (
        // Not an error on this field: the project has not declared its
        // languages, and the place to do that is Settings, not here.
        <p className="text-xs text-fg-secondary-alt leading-relaxed">
          This project has no languages yet. Add them under Settings → Locales.
        </p>
      ) : (
        <Select
          value={current === "" ? undefined : current}
          disabled={readonly}
          onValueChange={(next) => {
            addPatch([{ op: "replace", path: patchPath, value: next }], type);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a language" />
          </SelectTrigger>
          <SelectContent container={portalContainer}>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                <LocaleOptionLabel
                  value={option}
                  locale={localeOfValue(option, projectLocales, aliases)}
                />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

/**
 * A locale where a preview of it is needed — a row in a list, a search hit.
 *
 * The stored value rather than the language name: a preview row is where
 * someone is scanning for the key they wrote, and `nb-NO` is that key.
 */
export function LocalePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "locale");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}

/**
 * One option: the language, and the value it is stored as where those differ.
 *
 * Without aliases they are the same string and showing it twice would be noise,
 * so the tag is only drawn when it is not the stored value.
 */
function LocaleOptionLabel({
  value,
  locale,
}: {
  value: string;
  locale: string | null;
}) {
  const name = locale === null ? undefined : localeName(locale);
  if (name === undefined) {
    return <span>{value}</span>;
  }
  return (
    <span className="flex items-baseline gap-2">
      <span>{name}</span>
      <span className="text-fg-secondary-alt tabular-nums">{value}</span>
    </span>
  );
}
