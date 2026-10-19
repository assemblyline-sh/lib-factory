/**
 * Template Renderer - EJS-based template rendering for supporting documents
 *
 * Two-layer template system:
 * - Factory templates: `src/templates/` in each factory repo (checked first)
 * - Lib templates: `src/templates/` in lib-factory (fallback, shared partials)
 *
 * Templates use .md extension for VS Code markdown + EJS highlighting.
 *
 * Setup: Call initTemplates(import.meta.url) once at factory startup.
 * This is done automatically by startFactory() when you pass callerUrl.
 *
 * Usage in step handlers:
 *   import { renderTemplate } from '@assemblyline/lib-factory';
 *   const content = await renderTemplate('check_invoice/totals', data);
 *
 * Including partials (EJS resolves from the factory first, then lib):
 *   <%- include('partials/line-items-table', { line_items }) %>
 */

import ejs from 'ejs';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Module state - set once at factory startup
let factoryTemplatesDir = null;
let libTemplatesDir = null;

// Template cache for production performance
const templateCache = new Map();

/**
 * Shared helpers available to all templates. Currency formatting is left to the
 * factory: pass a formatting function in the template data.
 */
const helpers = {
  formatDate: (date, style = 'short') => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    const options = style === 'short'
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    return new Intl.DateTimeFormat('en-US', options).format(d);
  },

  formatPercent: (ratio) => {
    if (ratio === null || ratio === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 1,
    }).format(ratio);
  },

  formatNumber: (num) => {
    if (num === null || num === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US').format(num);
  },
};

/**
 * Initialize template directories from a caller's import.meta.url
 *
 * Called automatically by startFactory() - no need to call directly.
 *
 * @param {string} callerUrl - import.meta.url from the factory's entry point
 */
export function initTemplates(callerUrl) {
  // Factory templates directory
  let dir = dirname(fileURLToPath(callerUrl));

  // Walk up until we find 'src' directory
  while (dir !== '/' && !dir.endsWith('/src')) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  factoryTemplatesDir = join(dir, 'templates');

  // Lib templates directory (relative to this file)
  libTemplatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
}

/**
 * Render an EJS template with the given data
 *
 * Looks for templates in the factory repo first, then falls back to lib-factory.
 * EJS includes also resolve in this order, allowing factories to override partials.
 *
 * @param {string} templateName - Template path relative to src/templates (without .md extension)
 * @param {object} data - Data to pass to the template
 * @returns {Promise<string>} Rendered template content
 *
 * @example
 * import { renderTemplate } from '@assemblyline/lib-factory';
 *
 * const doc = await renderTemplate('check_invoice/totals', {
 *   invoice,
 *   totals_match,
 * });
 */
export async function renderTemplate(templateName, data) {
  if (!factoryTemplatesDir) {
    throw new Error('Templates not initialized. Pass callerUrl to startFactory().');
  }

  const factoryPath = join(factoryTemplatesDir, `${templateName}.md`);
  const libPath = join(libTemplatesDir, `${templateName}.md`);

  // Check cache first (in production)
  let template = templateCache.get(factoryPath) || templateCache.get(libPath);
  let templatePath;

  if (!template) {
    // Try factory templates first, fall back to lib
    try {
      template = await readFile(factoryPath, 'utf-8');
      templatePath = factoryPath;
    } catch (err) {
      if (err.code === 'ENOENT') {
        template = await readFile(libPath, 'utf-8');
        templatePath = libPath;
      } else {
        throw err;
      }
    }

    // Cache in production
    if (process.env.NODE_ENV === 'production') {
      templateCache.set(templatePath, template);
    }
  } else {
    // Determine path for cached template (for EJS filename option)
    templatePath = templateCache.has(factoryPath) ? factoryPath : libPath;
  }

  // Merge data with helpers
  const templateData = {
    ...data,
    ...helpers,
  };

  // views array: factory first, then lib (for include resolution)
  return ejs.render(template, templateData, {
    filename: templatePath,
    views: [factoryTemplatesDir, libTemplatesDir],
  });
}
