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
import { localeName } from "../../utils/localeName";

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
  const content = (
    <div id={path}>
      <LocalePicker
        options={localeOptionsOf(projectLocales, schemaAtPath.data.aliases)}
        value={sourceAtPath.data ?? null}
        readonly={readonly}
        portalContainer={portalContainer}
        onChange={(next) => {
          addPatch([{ op: "replace", path: patchPath, value: next }], type);
        }}
      />
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

/**
 * One choice the picker offers: what is stored, and the language it means.
 *
 * `locale` is `null` only where the stored value resolves to no language, which
 * an option built by `localeOptionsOf` never is — it is in the type so the
 * label can be reused for a value read back out of content, which can be.
 */
export type LocaleOption = { value: string; locale: string | null };

/**
 * The project's languages as choices, spelled the way this field stores them.
 *
 * Without aliases the value and the language are the same tag. With them the
 * value is the field's own spelling, and the language is what it means — which
 * is why both travel together rather than the picker being handed bare strings.
 */
export function localeOptionsOf(
  projectLocales: string[],
  aliases: Record<string, string[]> | undefined,
): LocaleOption[] {
  return acceptedLocaleValues(projectLocales, aliases).map((value) => ({
    value,
    locale: localeOfValue(value, projectLocales, aliases),
  }));
}

/**
 * The picker itself, with nothing behind it.
 *
 * Split from `LocaleField` so the design can be seen without a store: this is
 * the part with states worth looking at — a project that has declared no
 * languages, a field that has not been set, aliases that make the value and the
 * language differ. See `LocaleField.stories.tsx`.
 */
export function LocalePicker({
  options,
  value,
  readonly,
  onChange,
  portalContainer,
}: {
  options: LocaleOption[];
  value: string | null;
  readonly?: boolean;
  onChange: (next: string) => void;
  portalContainer?: HTMLElement | null;
}) {
  if (options.length === 0) {
    return (
      // Not an error on this field: the project has not declared its
      // languages, and the place to do that is Settings, not here.
      <p className="text-xs text-fg-secondary-alt leading-relaxed">
        This project has no languages yet. Add them under Settings → Locales.
      </p>
    );
  }
  return (
    <Select
      value={value === null || value === "" ? undefined : value}
      disabled={readonly}
      onValueChange={onChange}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pick a language" />
      </SelectTrigger>
      <SelectContent container={portalContainer}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <LocaleOptionLabel value={option.value} locale={option.locale} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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
