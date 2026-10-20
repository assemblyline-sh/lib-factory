/**
 * Orchestrator integration
 *
 * Functions for interacting with the orchestrator:
 * - Attaching supporting documents to work records
 * - Attaching final reports
 * - Managing temp files for dev mode
 */

import fs from 'fs';
import path from 'path';
import { getSessionId } from './factory.js';
import { isLocalRun } from './local-run.js';
import { orchestratorUrl } from './utils/orchestrator-url.js';

const is_dev = process.env.NODE_ENV === 'development';

/** Resolve the temp directory for a work record. */
function workRecordDir(work_record_id) {
  return path.join('temp', 'work_records', work_record_id);
}

/**
 * Write content to local temp folder.
 * Written in all environments (needed by CLI-based LLM steps).
 * Cleaned up after process completion in production (see clearTemp).
 */
function writeToLocalTemp(work_record_id, filename, content) {
  try {
    const dir = workRecordDir(work_record_id);
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`[Factory] Wrote ${filepath}`);
  } catch (err) {
    console.error('[Factory] Failed to write local file:', err.message);
  }
}

/**
 * Clear temp folder for a work record.
 * Skipped in dev mode so files remain for inspection.
 */
export function clearTemp(work_record_id) {
  if (is_dev) {
    console.log(`[Factory] Dev: skipping temp cleanup for ${work_record_id}`);
    return;
  }
  try {
    const dir = workRecordDir(work_record_id);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[Factory] Cleared temp: ${dir}`);
  } catch (err) {
    console.error('[Factory] Failed to clear temp:', err.message);
  }
}

/**
 * Attach a supporting document to a work record
 * @param {string} work_record_id
 * @param {string} title
 * @param {string} content
 * @param {string} step_slug
 */
export async function attachDocument(work_record_id, title, content, step_slug) {
  // Write to local temp (just use title as filename)
  const safe_title =title.replace(/[^a-zA-Z0-9-_]/g, '_');
  writeToLocalTemp(work_record_id, `${safe_title}.md`, content);

  if (isLocalRun(work_record_id)) return true;

  const url = orchestratorUrl();

  try {
    const response = await fetch(`${url}/api/factory/attach-document`, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        work_record_id,
        title,
        content,
        step_slug,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Factory] attach-document failed:', response.status, error);
      return false;
    }

    console.log(`[Factory] Document attached: "${title}"`);
    return true;
  } catch (error) {
    console.error('[Factory] attach-document error:', error.message);
    return false;
  }
}

/**
 * Attach a binary file to a work record
 * @param {string} work_record_id
 * @param {string} title - Display title
 * @param {string} filepath - Path to the file on disk
 * @param {string} step_slug
 */
export async function attachFile(work_record_id, title, filepath, step_slug) {
  // Copy to local temp (always, for dev inspection)
  try {
    const dir = workRecordDir(work_record_id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(filepath));
    fs.copyFileSync(filepath, dest);
    console.log(`[Factory] Copied ${filepath} → ${dest}`);
  } catch (err) {
    console.error('[Factory] Failed to copy file to temp:', err.message);
  }

  if (isLocalRun(work_record_id)) return true;

  const MIME_MAP = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };

  const ext = path.extname(filepath).toLowerCase();
  const mime_type = MIME_MAP[ext] || 'application/octet-stream';
  const filename = path.basename(filepath);

  const url = orchestratorUrl();

  try {
    const file_buffer = fs.readFileSync(filepath);
    const content_base64 = file_buffer.toString('base64');

    const response = await fetch(`${url}/api/factory/attach-file`, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        work_record_id,
        title,
        step_slug,
        filename,
        mime_type,
        content_base64,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Factory] attach-file failed:', response.status, error);
      return false;
    }

    console.log(`[Factory] File attached: "${title}" (${filename})`);
    return true;
  } catch (error) {
    console.error('[Factory] attach-file error:', error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers (reuse auth from env)
// ---------------------------------------------------------------------------

function getBaseHeaders() {
  const headers = {
    'api-key': process.env.ORCHESTRATOR_API_KEY,
    'api-secret': process.env.ORCHESTRATOR_API_SECRET,
  };
  const sid = getSessionId();
  if (sid) headers['X-Factory-Session'] = sid;
  return headers;
}

export async function orchestratorGet(urlPath) {
  const url = orchestratorUrl();
  const res = await fetch(`${url}${urlPath}`, {
    headers: getBaseHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${urlPath}: ${res.status} — ${text}`);
  }
  return res.json();
}

export async function orchestratorPost(urlPath, body) {
  const url = orchestratorUrl();
  const res = await fetch(`${url}${urlPath}`, {
    method: 'POST',
    headers: {
      ...getBaseHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${urlPath}: ${res.status} — ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function attachReport(work_record_id, content) {
  // Write to local temp
  writeToLocalTemp(work_record_id, 'report.md', content);

  if (isLocalRun(work_record_id)) return true;

  const url = orchestratorUrl();

  try {
    const response = await fetch(`${url}/api/factory/attach-report`, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        work_record_id,
        content,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Factory] attach-report failed:', response.status, error);
      return false;
    }

    console.log(`[Factory] Report attached`);
    return true;
  } catch (error) {
    console.error('[Factory] attach-report error:', error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Workpieces
// ---------------------------------------------------------------------------

/**
 * Report the per-workpiece outcome map for a work record.
 *
 * The map is `workpiece_id → "done" | "failed"`. The orchestrator stores
 * it on the WR and derives `done_count` / `failed_count` from the values.
 * Each step builds the map from its own knowledge (e.g. the `seeded`
 * array for a line-head, the `results` array for a body station) and
 * calls this once before `attachReport`.
 *
 * Empty `{}` is valid and represents a no-op run.
 *
 * @param {string} work_record_id
 * @param {Record<string, 'done' | 'failed'>} workpieces
 * @returns {Promise<boolean>} true on success, false on any error (logged)
 */
export async function attachWorkpieces(work_record_id, workpieces) {
  // Write to local temp for inspection during dev / `factory steps run`.
  writeToLocalTemp(work_record_id, 'workpieces.json', JSON.stringify(workpieces, null, 2));

  if (isLocalRun(work_record_id)) return true;

  const url = orchestratorUrl();

  try {
    const response = await fetch(`${url}/api/factory/attach-workpieces`, {
      method: 'POST',
      headers: {
        ...getBaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        work_record_id,
        workpieces,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Factory] attach-workpieces failed:', response.status, error);
      return false;
    }

    const count = Object.keys(workpieces).length;
    console.log(`[Factory] Workpieces attached: ${count}`);
    return true;
  } catch (error) {
    console.error('[Factory] attach-workpieces error:', error.message);
    return false;
  }
}
