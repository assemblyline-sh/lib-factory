// @ts-check

/**
 * Strip a leading YAML frontmatter block (`---\n...\n---`) from a markdown
 * string. Returns the original string unchanged if no frontmatter is present.
 *
 * @param {string} md
 * @returns {string}
 */
export function stripFrontmatter(md) {
  if (!md.startsWith('---')) return md;
  const close = md.indexOf('\n---', 3);
  return close === -1 ? md : md.slice(close + 4).replace(/^\s+/, '');
}

/**
 * Whitespace-split word count.
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
