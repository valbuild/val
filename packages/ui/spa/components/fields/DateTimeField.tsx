import { SourcePath } from "@valbuild/core";
import { CalendarIcon } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Button } from "../designSystem/button";
import { Calendar } from "../designSystem/calendar";
import { Input } from "../designSystem/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import classNames from "classnames";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValFieldProvider";
import { useValPortal } from "../ValPortalProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";

const TZ_STORAGE_KEY = "val:datetime:tz";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Oslo",
  "Europe/Stockholm",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getAllTimezones(): string[] {
  try {
    // `Intl.supportedValuesOf` exists at runtime in modern engines but is not
    // yet in the TS lib we target. Widen the type to feature-detect and call it
    // without a type assertion (the extra member is optional, so `Intl` is
    // assignable as-is).
    const intl: typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    } = Intl;
    if (typeof intl.supportedValuesOf === "function") {
      return intl.supportedValuesOf("timeZone");
    }
  } catch {
    // fall through
  }
  return FALLBACK_TIMEZONES;
}

// Returns the offset, in minutes, that the given timezone has from UTC at the given instant.
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const find = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = find("year");
  const month = find("month");
  const day = find("day");
  let hour = find("hour");
  const minute = find("minute");
  const second = find("second");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  // We want the UTC instant whose wall-clock in `timeZone` equals the given
  // fields. Pretend the wall-clock is UTC, then correct for the zone offset.
  // The offset can change between the guess and the corrected instant (DST
  // transitions), so iterate to a fixed point (usually 2 passes is enough).
  const wallClockAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = wallClockAsUtcMs;
  for (let i = 0; i < 3; i++) {
    const offset = getTimezoneOffsetMinutes(new Date(utcMs), timeZone);
    const next = wallClockAsUtcMs - offset * 60000;
    if (next === utcMs) {
      break;
    }
    utcMs = next;
  }
  return new Date(utcMs);
}

function formatInTimezone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function wallClockInZone(
  date: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const find = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  let hour = find("hour");
  if (hour === "24") hour = "00";
  return {
    date: `${find("year")}-${find("month")}-${find("day")}`,
    time: `${hour}:${find("minute")}:${find("second")}`,
  };
}

export type DateTimeFieldPureProps = {
  value: Date | null;
  onChange: (isoString: string) => void;
  from?: string;
  to?: string;
  /** Initial timezone. Defaults to the browser's resolved zone. */
  defaultTimezone?: string;
  /** Override the timezone list. Defaults to `Intl.supportedValuesOf("timeZone")` with a static fallback. */
  availableTimezones?: string[];
  /** Persist timezone selection to localStorage. Defaults to `true` in the bundled field, `false` in the pure variant. */
  persistTimezone?: boolean;
  portalContainer?: HTMLElement | null;
  /** Used for the wrapper element id (matches the schema field path in the bundled variant). */
  id?: string;
};

export function DateTimeFieldPure({
  value,
  onChange,
  from,
  to,
  defaultTimezone,
  availableTimezones,
  persistTimezone = false,
  portalContainer = null,
  id,
}: DateTimeFieldPureProps) {
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const [timezone, setTimezone] = useState<string>(
    () => defaultTimezone || browserTz,
  );

  const timezones = useMemo(() => {
    if (availableTimezones) return availableTimezones;
    const all = getAllTimezones();
    return [browserTz, ...all.filter((z) => z !== browserTz)];
  }, [availableTimezones, browserTz]);

  const wall = value
    ? wallClockInZone(value, timezone)
    : { date: "", time: "" };

  const commit = (
    newDateIso: string | null,
    newTime: string,
    nextTimezone: string,
  ) => {
    if (!newDateIso) return;
    const [y, m, d] = newDateIso.split("-").map((n) => Number(n));
    const timeParts = newTime.split(":").map((n) => Number(n));
    const hh = timeParts[0] || 0;
    const mm = timeParts[1] || 0;
    const ss = timeParts[2] || 0;
    if ([y, m, d, hh, mm, ss].some((n) => Number.isNaN(n))) return;
    const utc = zonedWallClockToUtc(y, m, d, hh, mm, ss, nextTimezone);
    onChange(utc.toISOString());
  };

  const handleTimezoneChange = (next: string) => {
    setTimezone(next);
    if (persistTimezone) {
      try {
        localStorage.setItem(TZ_STORAGE_KEY, next);
      } catch {
        // ignore storage failures
      }
    }
  };

  return (
    <div id={id}>
      <Popover
        open={isPopoverOpen}
        onOpenChange={(next) => {
          setPopoverOpen(next);
        }}
      >
        <PopoverTrigger
          asChild
          onClick={() => {
            setPopoverOpen(true);
          }}
        >
          <Button
            variant={"outline"}
            className={classNames(
              "w-[280px] justify-start text-left font-normal bg-bg-primary hover:bg-bg-secondary",
            )}
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            {value ? (
              <span className="truncate">
                {formatInTimezone(value, timezone)}
              </span>
            ) : (
              <span>Pick a date & time</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" container={portalContainer}>
          <Calendar
            mode="single"
            captionLayout="dropdown"
            defaultMonth={value ?? undefined}
            weekStartsOn={1}
            fromDate={from ? new Date(from) : undefined}
            toDate={to ? new Date(to) : undefined}
            selected={value || undefined}
            onSelect={(date) => {
              if (date) {
                const isoDay = `${date.getFullYear()}-${String(
                  date.getMonth() + 1,
                ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                const t = wall.time || "12:00:00";
                commit(isoDay, t, timezone);
              }
            }}
          />
          <div className="p-3 pt-0 flex flex-col gap-2">
            <Input
              type="time"
              step={1}
              value={wall.time || "12:00:00"}
              onChange={(e) => {
                const day =
                  wall.date ||
                  (() => {
                    const now = new Date();
                    return `${now.getFullYear()}-${String(
                      now.getMonth() + 1,
                    ).padStart(2, "0")}-${String(now.getDate()).padStart(
                      2,
                      "0",
                    )}`;
                  })();
                commit(day, e.target.value, timezone);
              }}
            />
            <Select
              value={timezone}
              onValueChange={(next) => {
                handleTimezoneChange(next);
              }}
            >
              <SelectTrigger className="text-xs text-fg-tertiary h-7">
                <SelectValue placeholder="Timezone" />
              </SelectTrigger>
              <SelectContent container={portalContainer}>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                    {tz === browserTz ? " (browser)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function DateTimeField({
  path,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "dateTime";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const [currentValue, setCurrentValue] = useState<Date | null>(null);
  const portalContainer = useValPortal();

  const initialTimezone = useMemo(() => {
    try {
      return localStorage.getItem(TZ_STORAGE_KEY) || getBrowserTimezone();
    } catch {
      return getBrowserTimezone();
    }
  }, []);

  useEffect(() => {
    if ("data" in sourceAtPath && sourceAtPath.data !== undefined) {
      if (sourceAtPath.data === null) {
        setCurrentValue(null);
      } else {
        const parsed = new Date(sourceAtPath.data);
        if (Number.isNaN(parsed.getTime())) {
          console.error("Cannot parse invalid datetime:", sourceAtPath.data);
        } else {
          setCurrentValue(parsed);
        }
      }
    }
  }, [sourceAtPath]);

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
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
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

  const schema = schemaAtPath.data;

  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <DateTimeFieldPure
        value={currentValue}
        onChange={(iso) => {
          setCurrentValue(new Date(iso));
          addPatch(
            [{ op: "replace", value: iso, path: patchPath }],
            schema.type,
          );
        }}
        from={schema.options?.from}
        to={schema.options?.to}
        defaultTimezone={initialTimezone}
        persistTimezone
        portalContainer={portalContainer}
      />
    </div>
  );
}

export function DateTimePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "dateTime");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return (
    <div className="truncate">
      {new Date(sourceAtPath.data).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </div>
  );
}
