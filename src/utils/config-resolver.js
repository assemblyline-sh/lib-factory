// @ts-check

/**
 * Config Resolver - Resolves template variables in step config
 *
 * Supports:
 * - {{env.VAR_NAME}} - Environment variables
 * - {{step_slug.field}} - Previous step outputs (e.g., {{fetch_data.accounts}})
 * - {{step_slug.field.nested}} - Nested field access
 *
 * Usage:
 *   import { resolveConfig } from '@assemblyline/lib-factory';
 *   const resolved = resolveConfig(raw_config, step_outputs);
 */

/**
 * Template pattern: {{env.VAR}} or {{step_slug.field.path}}
 */
const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Get nested value from object using dot notation
 * @param {object} obj
 * @param {string} path - Dot-separated path (e.g., "accounts.0.name")
 * @returns {any}
 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Resolve a single template expression
 * @param {string} expression - Template expression without braces (e.g., "env.FOB_API_KEY" or "fetch_data.accounts")
 * @param {Object<string, object>} step_outputs - Previous step outputs keyed by slug
 * @returns {any} - Resolved value
 */
function resolveExpression(expression, step_outputs) {
  const trimmed = expression.trim();

  // Environment variable: {{env.VAR_NAME}}
  if (trimmed.startsWith('env.')) {
    const var_name = trimmed.slice(4); // Remove "env."
    const value = process.env[var_name];
    if (value === undefined) {
      console.warn(`[config-resolver] Environment variable not found: ${var_name}`);
    }
    return value;
  }

  // Step output: {{step_slug.field.path}} or {{step_slug}}
  // First dot separates slug from field path
  const dot_index = trimmed.indexOf('.');
  if (dot_index === -1) {
    // No dot — return entire step output
    const step_output = step_outputs[trimmed];
    if (step_output === undefined) {
      console.warn(`[config-resolver] Step output not found: ${trimmed}`);
    }
    return step_output;
  }

  const step_slug = trimmed.slice(0, dot_index);
  const field_path = trimmed.slice(dot_index + 1);

  const step_output = step_outputs[step_slug];
  if (!step_output) {
    console.warn(`[config-resolver] Step output not found: ${step_slug}`);
    return undefined;
  }

  return getNestedValue(step_output, field_path);
}

/**
 * Resolve templates in a config value (recursive)
 * @param {any} value - Config value (string, object, array, or primitive)
 * @param {Object<string, object>} step_outputs - Previous step outputs
 * @returns {any} - Resolved value
 */
function resolveValue(value, step_outputs) {
  // Null/undefined pass through
  if (value === null || value === undefined) {
    return value;
  }

  // String - check for templates
  if (typeof value === 'string') {
    // Check if the entire string is a single template (preserve type)
    const full_match = value.match(/^\{\{([^}]+)\}\}$/);
    if (full_match) {
      // Single template - return resolved value (preserves arrays, objects, numbers)
      return resolveExpression(full_match[1], step_outputs);
    }

    // String with embedded templates - replace and return string
    return value.replace(TEMPLATE_PATTERN, (match, expression) => {
      const resolved = resolveExpression(expression, step_outputs);
      // Convert to string for embedded templates
      if (resolved === undefined) return match; // Keep original if not resolved
      if (typeof resolved === 'object') return JSON.stringify(resolved);
      return String(resolved);
    });
  }

  // Array - resolve each element
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, step_outputs));
  }

  // Object - resolve each property
  if (typeof value === 'object') {
    const resolved = {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveValue(val, step_outputs);
    }
    return resolved;
  }

  // Primitives (number, boolean) pass through
  return value;
}

/**
 * Resolve all template variables in a config object
 *
 * @param {object} config - Raw config object with template variables
 * @param {Object<string, object>} step_outputs - Previous step outputs keyed by slug
 * @returns {object} - Config with all templates resolved
 *
 * @example
 * const resolved = resolveConfig(
 *   {
 *     api_key: "{{env.FOB_API_KEY}}",
 *     accounts: "{{fetch_data.accounts}}",
 *     report_date: "{{fetch_data.report_date}}"
 *   },
 *   {
 *     "fetch_data": { accounts: [...], report_date: "2024-01-15" }
 *   }
 * );
 */
export function resolveConfig(config, step_outputs = {}) {
  return resolveValue(config, step_outputs);
}
