/**
 * Where a note floating over the bottom of the Studio is anchored, so it
 * clears whichever bar is along the bottom edge.
 *
 * On a desktop, above the status bar. On a phone, above the pane bar
 * (`PhonePaneBar`): `max(0.75rem, safe area)` up and 58px tall, so this rises
 * with the safe area and stays a few pixels clear of it.
 */
export const CLEAR_OF_BOTTOM_BARS =
  "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4rem)]";
