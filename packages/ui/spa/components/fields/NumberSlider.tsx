import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Internal, NumberRules, SliderRender } from "@valbuild/core";
import { Input } from "../designSystem/input";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";

/**
 * Tick labels under the slider when it has at most this many stops; above
 * that only the two ends are labelled, because a row of 21 numbers is a smear.
 */
const MAX_TICK_LABELS = 11;

/**
 * The step the slider moves in: its own, else the schema's, else 1. See
 * `SliderRender` in core.
 */
export function sliderStepOf(render: SliderRender, rules: NumberRules): number {
  return render.step ?? rules.step ?? 1;
}

/**
 * `s.int().render({ as: "slider", min, max })`, without the store, so it can be
 * driven by a story and a test.
 *
 * Two inputs for one value: the slider, and a box beside it for typing an
 * exact number — which is also how a value the slider cannot show (outside its
 * range, or between its steps) stays visible and editable.
 *
 * `onChange` fires on every movement; the caller decides how often that
 * becomes a patch. `onCommit` fires when the person lets go or leaves the box.
 */
export function NumberSliderPure({
  value,
  render,
  rules,
  onChange,
  onCommit,
  readonly,
}: {
  value: number | null;
  render: SliderRender;
  rules: NumberRules;
  onChange: (value: number) => void;
  onCommit?: () => void;
  readonly?: boolean;
}) {
  const step = sliderStepOf(render, rules);
  const [text, setText] = useState(value === null ? "" : String(value));
  const [editingText, setEditingText] = useState(false);
  useEffect(() => {
    // The box shows what the person is typing until they leave it — "-" and
    // "1." are steps on the way to a number, not numbers to be overwritten.
    if (!editingText) {
      setText(value === null ? "" : String(value));
    }
  }, [value, editingText]);

  const stops = Math.floor((render.max - render.min) / step + 1e-9) + 1;
  const ticks =
    stops <= MAX_TICK_LABELS
      ? Array.from({ length: stops }, (_, i) => render.min + i * step)
      : [render.min, render.max];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <div className="flex flex-col flex-1 min-w-0">
          <input
            type="range"
            aria-label="Slider"
            className={cn(
              "w-full h-6 cursor-pointer accent-[var(--bg-brand-primary)] disabled:cursor-not-allowed",
              value === null && "opacity-50",
            )}
            min={render.min}
            max={render.max}
            step={step}
            value={value ?? render.min}
            disabled={readonly}
            onChange={(ev) => {
              const next = Number(ev.target.value);
              if (Number.isFinite(next)) {
                onChange(next);
              }
            }}
            onPointerUp={onCommit}
            onKeyUp={onCommit}
            onBlur={onCommit}
          />
          <div
            aria-hidden
            className="flex justify-between text-xs text-fg-tertiary select-none"
          >
            {ticks.map((tick) => (
              <span key={tick}>{formatNumber(tick)}</span>
            ))}
          </div>
        </div>
        <Input
          aria-label="Value"
          className="w-20 text-right tabular-nums"
          inputMode={rules.integer ? "numeric" : "decimal"}
          value={text}
          disabled={readonly}
          onFocus={() => setEditingText(true)}
          onChange={(ev) => {
            setText(ev.target.value);
            const trimmed = ev.target.value.trim();
            const next = Number(trimmed);
            if (trimmed !== "" && Number.isFinite(next)) {
              onChange(next);
            }
          }}
          onBlur={() => {
            setEditingText(false);
            onCommit?.();
          }}
        />
      </div>
      {value !== null && !readonly && (
        <NumberFix
          value={value}
          rules={rules}
          render={render}
          onChange={(next) => {
            onChange(next);
            onCommit?.();
          }}
        />
      )}
    </div>
  );
}

/**
 * What the person can do about a value that the field cannot show as it is.
 *
 * Two cases, and only one is shown, the slider's first:
 *
 * - **Outside the slider.** Not a validation error — the slider's range is
 *   layout, not a rule — but the slider is pinned to an end and lies about the
 *   value, so the field says so and offers the nearest value it can show.
 * - **Not allowed by the schema** (a decimal on an int, off the step grid, out
 *   of bounds). The validation message is shown by the field's error list
 *   already; this is the button next to it.
 *
 * Both offer a value from `Internal.number.nearestAllowedNumber`, the same
 * rules the validator applies, so the button never leads to the same error
 * again. When there is no such value, there is no button.
 */
export function NumberFix({
  value,
  rules,
  render,
  onChange,
}: {
  value: number;
  rules: NumberRules;
  render?: SliderRender;
  onChange: (value: number) => void;
}) {
  if (render && (value < render.min || value > render.max)) {
    // The slider's grid starts at its own min, which `NumberSchema` has
    // already checked is on the schema's grid, so a stop of the slider is
    // always a value the schema accepts.
    const target = Internal.number.nearestAllowedNumber(value, {
      integer: rules.integer,
      min: render.min,
      max: render.max,
      step: sliderStepOf(render, rules),
    });
    const side = value > render.max ? "above" : "below";
    return (
      <FixRow
        message={`${formatNumber(value)} is ${side} this slider's range (${formatNumber(render.min)}–${formatNumber(render.max)}).`}
        action={target === null ? null : `Set to ${formatNumber(target)}`}
        onAction={() => target !== null && onChange(target)}
      />
    );
  }
  const target = Internal.number.nearestAllowedNumber(value, rules);
  if (target === null || target === value) {
    return null;
  }
  const outOfBounds =
    (rules.min !== undefined && value < rules.min) ||
    (rules.max !== undefined && value > rules.max);
  return (
    <FixRow
      message={null}
      action={`${outOfBounds ? "Set" : "Round"} to ${formatNumber(target)}`}
      onAction={() => onChange(target)}
    />
  );
}

/**
 * The amber of `FieldErrorList`, so this reads as part of the same message and
 * not as a second, louder one.
 */
function FixRow({
  message,
  action,
  onAction,
}: {
  message: string | null;
  action: string | null;
  onAction: () => void;
}) {
  return (
    <div
      role={message ? "status" : undefined}
      className="flex flex-wrap items-center gap-2 text-sm text-fg-warning-primary"
    >
      {message && (
        <span className="flex items-start gap-1.5">
          <CircleAlert
            size={13}
            className="mt-[3px] shrink-0 text-fg-warning-primary-alt"
            aria-hidden
          />
          {message}
        </span>
      )}
      {action && (
        <Button type="button" size="xs" variant="secondary" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  // Grid arithmetic is already rounded in core; this only keeps a stray
  // `0.30000000000000004` from a tick label.
  return String(Number.parseFloat(n.toPrecision(12)));
}
