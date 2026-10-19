// @ts-check

/**
 * Arrow-key picker for the terminal. No dependencies.
 */

import readline from 'node:readline';
import { CliError } from './errors.js';

/**
 * @typedef {object} PickerOption
 * @property {string} label - Shown to the user
 * @property {string} value - Returned when chosen
 * @property {string} [type] - Options of different types are separated by a rule
 */

/**
 * Let the user choose one option with ↑/↓ and Enter. Returns the only option without
 * asking when there is one, and null when cancelled (Esc or Ctrl-C) or there are none.
 *
 * @param {string} prompt
 * @param {PickerOption[]} options
 * @returns {Promise<PickerOption | null>}
 */
export async function pick(prompt, options) {
  if (options.length === 0) return null;
  if (options.length === 1) {
    console.log(prompt);
    console.log(`   Using: ${options[0].label}`);
    return options[0];
  }
  if (!process.stdin.isTTY) {
    throw new CliError(`${prompt} needs a terminal. Pass --station, --scenario or --empty.`);
  }

  return new Promise((resolve) => {
    let selected = 0;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin, rl);

    const render = () => {
      console.clear();
      console.log(prompt);
      console.log('');
      /** @type {string | undefined} */
      let last_type;
      options.forEach((opt, i) => {
        if (last_type !== undefined && opt.type !== last_type) console.log('   ─────────────────────────────');
        last_type = opt.type;
        const prefix = i === selected ? ' ❯ \x1b[36m' : '   \x1b[0m';
        console.log(`${prefix}${opt.label}\x1b[0m`);
      });
      console.log('');
      console.log('   ↑/↓ to navigate, Enter to select, Esc to cancel');
    };

    /**
     * @param {string} _str
     * @param {{ name?: string, ctrl?: boolean }} key
     */
    const onKey = (_str, key) => {
      if (key.name === 'up') {
        selected = (selected - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down') {
        selected = (selected + 1) % options.length;
        render();
      } else if (key.name === 'return') {
        done(options[selected]);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        done(null);
      }
    };

    /** @param {PickerOption | null} result */
    const done = (result) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      rl.close();
      console.clear();
      resolve(result);
    };

    process.stdin.on('keypress', onKey);
    render();
  });
}
