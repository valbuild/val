import { SourcePath } from "@valbuild/core";
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
import { useLocaleFilter } from "../LocaleFilterProvider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";

/**
 * One of the project's languages, as a picker.
 *
 * The options come from `locales.available` in the settings module, not from the
 * schema — which is the whole design: a project adds a language once, there, and
 * every locale field in the project offers it.
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
  const localeFilter = useLocaleFilter();
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
        options={projectLocales}
        value={sourceAtPath.data ?? null}
        readonly={readonly}
        filterLocale={localeFilter}
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
 * The picker itself, with nothing behind it.
 *
 * Split from `LocaleField` so the design can be seen without a store: this is
 * the part with states worth looking at — a project that has declared no
 * languages, and a field that has not been set. See `LocaleField.stories.tsx`.
 */
export function LocalePicker({
  options,
  value,
  readonly,
  filterLocale,
  onChange,
  portalContainer,
}: {
  /** The project's languages, in the order it declared them. */
  options: string[];
  value: string | null;
  readonly?: boolean;
  /**
   * The language the Studio's locale filter is narrowed to, or `null` for all.
   *
   * Narrowed means this field cannot be changed. Everything on screen is in
   * that language — that is what the filter did — so changing this one field
   * to another language would make the thing you are editing disappear as you
   * saved it, which reads as the Studio losing your work rather than as a
   * filter doing its job.
   */
  filterLocale?: string | null;
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
  // `readonly` already draws its own explanation through `ReadonlyGuard`, so
  // the filter only speaks where it is the reason.
  const lockedToFilter = !readonly && filterLocale != null;
  const select = (
    <Select
      value={value === null || value === "" ? undefined : value}
      disabled={readonly || lockedToFilter}
      onValueChange={onChange}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pick a language" />
      </SelectTrigger>
      <SelectContent container={portalContainer}>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            <LocaleOptionLabel locale={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (!lockedToFilter) {
    return select;
  }
  return (
    <Tooltip>
      {/*
       * The span is load-bearing: a disabled control fires no pointer events,
       * so a tooltip triggered on the `Select` itself would never open — which
       * is the one state it exists to explain.
       */}
      <TooltipTrigger asChild>
        <span className="block w-full" tabIndex={0}>
          {select}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-xs">
        The locale filter is showing only {localeLabel(filterLocale)}, so this
        is fixed to it. Clear the filter in the top bar to change it.
      </TooltipContent>
    </Tooltip>
  );
}

/** A language as a person reads it: the name where there is one, else the tag. */
function localeLabel(locale: string): string {
  const name = localeName(locale);
  return name === undefined ? locale : `${name} (${locale})`;
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
 * One option: the language's name, and the tag under it.
 *
 * The tag as well as the name because the tag is what is stored, and a list of
 * language names alone leaves an editor guessing which string a `.val.ts` will
 * hold. `Intl.DisplayNames` does not know every tag, so a name is not always
 * available — then the tag is the whole label rather than a blank row.
 */
function LocaleOptionLabel({ locale }: { locale: string }) {
  const name = localeName(locale);
  if (name === undefined) {
    return <span>{locale}</span>;
  }
  return (
    <span className="flex items-baseline gap-2">
      <span>{name}</span>
      <span className="text-fg-secondary-alt tabular-nums">{locale}</span>
    </span>
  );
}
