/**
 * Build a user agent string for this factory session.
 *
 * Format:
 * <factory_name>/<version> (<os> <arch>; <hostname>; <username>; pid:<pid>) node/<node_version> ram:<gb>GB cpu:<count>x<model> cwd:<dir> sudo:<yes|no>
 *
 * Example:
 * factory-acme/1.2.0 (linux x64; ip-172-31-4-52; ubuntu; pid:3847) node/20.11.0 ram:16GB cpu:4xIntel_Xeon_E5-2676 cwd:/home/ubuntu/factories/acme sudo:no
 */

import os from 'os';
import { createRequire } from 'module';

/**
 * @param {object} [options]
 * @param {string} [options.callerUrl] - import.meta.url from the factory entry point (to find its package.json)
 * @returns {string}
 */
export function buildUserAgent(options = {}) {
  // Factory repo name and version (from caller's package.json)
  // callerUrl is typically src/index.js, so package.json is one level up
  let factory_name = 'factory';
  let factory_version = 'unknown';
  if (options.callerUrl) {
    try {
      const caller_require = createRequire(options.callerUrl);
      const caller_pkg = caller_require('../package.json');
      factory_version = caller_pkg.version || 'unknown';
      if (caller_pkg.name) {
        factory_name = caller_pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // The factory may not have package.json at expected path
    }
  }

  const platform = os.platform();
  const arch = os.arch();
  const hostname = os.hostname();

  let username = 'unknown';
  try {
    username = os.userInfo().username;
  } catch {
    // May fail in some environments
  }

  const pid = process.pid;
  const node_version = process.version.replace('v', '');
  const ram_gb = Math.round(os.totalmem() / (1024 * 1024 * 1024));

  const cpus = os.cpus();
  const cpu_count = cpus.length;
  const cpu_model = cpus.length > 0
    ? cpus[0].model.replace(/\s+/g, '_').replace(/[()@]/g, '').substring(0, 40)
    : 'unknown';

  const cwd = process.cwd();

  let is_sudo = false;
  try {
    is_sudo = process.getuid?.() === 0;
  } catch {
    // getuid not available on Windows
  }

  const parts = [
    `${factory_name}/${factory_version}`,
    `(${platform} ${arch}; ${hostname}; ${username}; pid:${pid})`,
    `node/${node_version}`,
    `ram:${ram_gb}GB`,
    `cpu:${cpu_count}x${cpu_model}`,
    `cwd:${cwd}`,
    `sudo:${is_sudo ? 'yes' : 'no'}`,
  ];

  return parts.join(' ');
}
