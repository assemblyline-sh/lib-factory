/**
 * @assemblyline/lib-factory
 *
 * The runtime for Assembly Line factories: the factory session loop, steps, bins
 * and workpieces, watchers, and the orchestrator client.
 */

/**
 * Task received from the orchestrator for step execution.
 *
 * @typedef {object} Task
 * @property {string} step_queue_id - StepQueue ID for reporting completion
 * @property {object} step - Step definition
 * @property {string} step.slug - Step slug, maps to handler function (e.g., 'alex/fetch_data')
 * @property {object} step.config - Step configuration from process definition
 * @property {object} work_record - Work record context
 * @property {string} work_record.id - Work record ID for document attachments
 * @property {Object<string, object>} work_record.step_outputs - Outputs from previous steps keyed by slug
 * @property {string} org_id - Organization ID
 */

// Factory session
export { startFactory } from './factory.js';
export { validateEnv } from './validate-env.js';

// Step definition
export { defineStep, isStepDefinition, getStepHandler, createHandler } from './define-step.js';

// Step discovery
export { discoverSteps, createGetHandler } from './discover-steps.js';

// Orchestrator integration
export {
  attachDocument,
  attachFile,
  attachReport,
  attachWorkpieces,
  clearTemp,
} from './orchestrator.js';

// Template rendering
export { renderTemplate, initTemplates } from './utils/template-renderer.js';
export { renderLocal } from './renderLocal.js';

// Config resolution
export { resolveConfig } from './utils/config-resolver.js';

// Local step runs (`factory steps run`)
export { runStepLocally, isLocalRun } from './local-run.js';

// Factory repo path conventions
export { bin, workRecordDir, workRecordFile } from './factoryPaths.js';

// File utilities
export { moveWorkpieces, listWorkpieces, isWorkpieceDir } from './files.js';

// Workpiece-mode step helpers (5-bin doing-bin contract)
export { processWorkpiece, cleanupOrphanedDoing } from './utils/workpiece-station.js';
export { logEvent } from './utils/workpiece-log.js';

// General step-authoring helpers
export { pooled } from './utils/pooled.js';
export { stripFrontmatter, countWords } from './utils/markdown.js';

// Shared step definitions
export { default as moveFilesStep } from './steps/move_files.js';

// Watch-triggered stations (event-driven alternative/addition to cron — see
// Stations.watch_enabled): bin-watch for conveyors, intake watch for
// line-heads. startBinWatcher() starts both.
export { startBinWatcher } from './bin-watcher.js';
export { startIntakeWatcher } from './intake-watcher.js';

