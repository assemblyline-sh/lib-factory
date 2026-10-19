// @ts-check

/**
 * The `factory` command: run and list a factory's steps from inside the repo.
 *
 * It ships with lib-factory, so it runs steps with the same copy of the library the steps
 * import, whatever version this factory pins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { listSteps, runStep } from './steps.js';
import { updateStepMetadata } from './stations.js';
import { CliError } from './errors.js';

const HELP = `Usage: factory <command> [options]

Run this from a factory repo's root.

Commands:
  factory steps list                       List the steps in src/steps
  factory steps run <slug>                 Run one step locally; output saved to temp/<slug>.json
      --station <CODE>                     use the step's config from .orchestrator/stations
      -s, --scenario <name>                use .orchestrator/scenarios/<slug>/<name>.json
      -e, --empty                          run with an empty config
                                           (none of these: choose from a list)
  factory stations update-step-metadata    Copy step names and descriptions into station files

Options:
  -h, --help       Show this help
  -v, --version    Show the lib-factory version

A local run is real: anything the step calls or writes happens. Attachments and reports
are written to temp/work_records/ and never sent to the Orchestrator.`;

/** @returns {string} */
function version() {
  const pkg_path = new URL('../../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(pkg_path, 'utf8')).version;
}

/**
 * @param {string[]} argv - Arguments after the command name
 * @param {string} [root] - Factory repo root
 * @returns {Promise<number>} Exit code
 */
export async function main(argv, root = process.cwd()) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        station: { type: 'string' },
        scenario: { type: 'string', short: 's' },
        empty: { type: 'boolean', short: 'e' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('Run "factory --help" for usage');
    return 1;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    console.log(version());
    return 0;
  }
  const [resource, action, ...rest] = positionals;
  if (values.help || !resource) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  try {
    if (!fs.existsSync(path.join(root, 'src', 'steps'))) {
      throw new CliError(`No src/steps/ in ${root}. Run this from a factory repo's root.`);
    }
    // Step code and {{env.X}} templates read the factory's .env, as `npm run start` does.
    dotenv.config({ path: path.join(root, '.env') });

    if (resource === 'steps' && action === 'list') {
      await listSteps(root);
    } else if (resource === 'steps' && action === 'run') {
      const slug = rest[0];
      if (!slug) throw new CliError('Missing step slug: factory steps run <slug>');
      await runStep(root, slug, values);
    } else if (resource === 'stations' && action === 'update-step-metadata') {
      await updateStepMetadata(root);
    } else {
      throw new CliError(`Unknown command: ${positionals.join(' ')}\nRun "factory --help" for usage`);
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    return 1;
  }
}
