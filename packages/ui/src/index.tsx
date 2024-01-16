"use client";
/*
 * This module is the entrypoint of @valbuild/ui until the package is built with
 * Vite. It is used only as a shim during local development, and is actually not
 * part of the build output meant for consumers.
 *
 * After building with Vite, this entrypoint is replaced by ./vite-index.tsx,
 * which is optimized for consumers.
 */

export * from "./exports";
export * from "./constants";

export const IS_DEV = true;
