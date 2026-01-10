/**
 * Shared route validation utilities
 */

export type SerializedRegExpPattern = {
  source: string;
  flags: string;
};

/**
 * Filter routes by include/exclude patterns
 */
export function filterRoutesByPatterns(
  routes: string[],
  includePattern?: SerializedRegExpPattern,
  excludePattern?: SerializedRegExpPattern,
): string[] {
  // Validate patterns upfront and warn about issues
  let includeRegex: RegExp | null = null;
  let excludeRegex: RegExp | null = null;

  if (includePattern) {
    try {
      includeRegex = new RegExp(includePattern.source, includePattern.flags);
    } catch (e) {
      console.warn(
        `[Val] Invalid include pattern: /${includePattern.source}/${includePattern.flags}`,
        `\nError: ${e instanceof Error ? e.message : String(e)}`,
        `\nAll routes will be filtered out due to malformed include pattern.`,
      );
    }
  }

  if (excludePattern) {
    try {
      excludeRegex = new RegExp(excludePattern.source, excludePattern.flags);
    } catch (e) {
      console.warn(
        `[Val] Invalid exclude pattern: /${excludePattern.source}/${excludePattern.flags}`,
        `\nError: ${e instanceof Error ? e.message : String(e)}`,
        `\nAll routes will be filtered out due to malformed exclude pattern.`,
      );
    }
  }

  return routes.filter((route) => {
    // Check include pattern
    if (includePattern) {
      if (!includeRegex) {
        // Pattern creation failed, filter out this route
        return false;
      }
      if (!includeRegex.test(route)) {
        return false;
      }
    }

    // Check exclude pattern
    if (excludePattern) {
      if (!excludeRegex) {
        // Pattern creation failed, filter out this route
        return false;
      }
      if (excludeRegex.test(route)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Validate a single route against include/exclude patterns
 */
export function validateRoutePatterns(
  route: string,
  includePattern?: SerializedRegExpPattern,
  excludePattern?: SerializedRegExpPattern,
): { valid: true } | { valid: false; message: string } {
  // Validate include pattern
  if (includePattern) {
    try {
      const regex = new RegExp(includePattern.source, includePattern.flags);
      if (!regex.test(route)) {
        return {
          valid: false,
          message: `Route '${route}' does not match include pattern: /${includePattern.source}/${includePattern.flags}`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: `Invalid include pattern: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Validate exclude pattern
  if (excludePattern) {
    try {
      const regex = new RegExp(excludePattern.source, excludePattern.flags);
      if (regex.test(route)) {
        return {
          valid: false,
          message: `Route '${route}' matches exclude pattern: /${excludePattern.source}/${excludePattern.flags}`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: `Invalid exclude pattern: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Create RegExp from pattern (with error handling)
 */
export function createRegExpFromPattern(
  pattern: SerializedRegExpPattern,
): RegExp | null {
  try {
    return new RegExp(pattern.source, pattern.flags);
  } catch {
    return null;
  }
}
