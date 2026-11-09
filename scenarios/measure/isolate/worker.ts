/**
 * The probe with synthetic inputs only: `input=synth:<MB>[+<patches>]`.
 * See `probe.ts`, and "The deployed isolate probe" in `../README.md`.
 */
import { createProbe } from "./probe";

export default createProbe({ web: null });
