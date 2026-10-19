import ejs from 'ejs';
import { readFileSync } from 'node:fs';

/**
 * Render a co-located EJS template file.
 *
 * @param {string} importMetaUrl - The caller's import.meta.url (for path resolution)
 * @param {string} relativePath - Relative path to the .md template (e.g. './report.md')
 * @param {object} data - Data to pass to the template
 * @returns {string} Rendered content
 */
export function renderLocal(importMetaUrl, relativePath, data) {
  const template = readFileSync(new URL(relativePath, importMetaUrl), 'utf8');
  return ejs.render(template, data);
}
