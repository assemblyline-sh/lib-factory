// @ts-check

import { resolveConfig } from './utils/config-resolver.js';

/**
 * @fileoverview
 * Declarative step definition factory.
 *
 * Usage:
 * ```javascript
 * import { defineStep } from '@assemblyline/lib-factory';
 * import { z } from 'zod';
 *
 * export default defineStep({
 *   slug: 'acme/fetch_document',
 *   name: 'Fetch Document',
 *   description: 'Fetch a document and its metadata from the source system',
 *   inputSchema: z.object({ document_id: z.string() }),
 *   outputSchema: z.object({ document: z.object({...}) }),
 *   execute: async (config, context) => {
 *     return { document: {...} };
 *   },
 * });
 * ```
 */

/**
 * @template TInput, TOutput
 * @typedef {object} StepDefinition
 * @property {string} slug - Step identifier (e.g., 'alex/fetch_data')
 * @property {string} name - Human-readable step name
 * @property {string} description - What this step does
 * @property {import('zod').ZodType<TInput>} [inputSchema] - Zod schema for step.config validation
 * @property {import('zod').ZodType<TOutput>} [outputSchema] - Zod schema for output validation
 * @property {(config: TInput, context: StepContext) => Promise<TOutput>} execute - Step implementation
 * @property {boolean} [enabled] - Whether this step is discoverable (default: true)
 * @property {boolean} [__isStepDefinition] - Internal marker for type detection
 */

/**
 * @typedef {object} StepContext
 * @property {object} work_record - Work record from orchestrator
 * @property {string} work_record.id - Work record ID
 * @property {Object<string, object>} work_record.step_outputs - Previous step outputs
 * @property {string} step_queue_id - StepQueue ID for reporting
 * @property {string} org_id - Organization ID
 * @property {object} step - Original step object from task
 * @property {string} step.slug - Step slug
 * @property {object} step.config - Raw config (before validation)
 */

/**
 * Define a step with typed input/output schemas.
 *
 * @template TInput, TOutput
 * @param {StepDefinition<TInput, TOutput>} definition
 * @returns {StepDefinition<TInput, TOutput>}
 */
export function defineStep(definition) {
  const { slug, name, description, inputSchema, outputSchema, execute, enabled = true } = definition;

  // Validate required fields
  if (!slug) throw new Error('defineStep: slug is required');
  if (!name) throw new Error('defineStep: name is required');
  if (!description) throw new Error('defineStep: description is required');
  if (!execute) throw new Error('defineStep: execute is required');
  if (typeof execute !== 'function') throw new Error('defineStep: execute must be a function');

  // Return the definition object (marker for isStepDefinition)
  return {
    slug,
    name,
    description,
    inputSchema,
    outputSchema,
    execute,
    enabled,
    __isStepDefinition: true,
  };
}

/**
 * Check if a value is a StepDefinition
 *
 * @param {any} value
 * @returns {value is StepDefinition<any, any>}
 */
export function isStepDefinition(value) {
  return value && value.__isStepDefinition === true && typeof value.execute === 'function';
}

/**
 * Create a task handler from a StepDefinition.
 * Wraps execute() with input/output validation.
 *
 * @template TInput, TOutput
 * @param {StepDefinition<TInput, TOutput>} definition
 * @returns {(task: import('./index.js').Task) => Promise<TOutput>}
 */
export function createHandler(definition) {
  const { slug, inputSchema, outputSchema, execute } = definition;

  return async function handler(task) {
    const { step, work_record, step_queue_id, org_id } = task;
    const raw_config = step.config || {};
    const step_outputs = work_record?.step_outputs || {};

    // --- Template resolution ---
    // Resolves {{env.VAR}} and {{step/slug.field}} before validation
    console.log(`[${slug}] Raw config:`, JSON.stringify(raw_config));
    const resolved_config = resolveConfig(raw_config, step_outputs);
    console.log(`[${slug}] Resolved config:`, JSON.stringify(resolved_config));

    // --- Input validation ---
    let config = resolved_config;
    if (inputSchema) {
      const result = inputSchema.safeParse(resolved_config);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(`[${slug}] Invalid input config:\n${errors}`);
      }
      config = result.data;
    }

    // --- Build context ---
    /** @type {StepContext} */
    const context = {
      work_record,
      step_queue_id,
      org_id,
      step,
    };

    // --- Execute ---
    const output = await execute(config, context);

    // --- Output validation ---
    if (outputSchema) {
      const result = outputSchema.safeParse(output);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(`[${slug}] Invalid output:\n${errors}`);
      }
      return result.data;
    }

    return output;
  };
}

/**
 * Get a handler function for a step slug.
 *
 * @param {Object<string, StepDefinition<any, any>>} steps - Step registry
 * @param {string} slug - Step slug to look up
 * @returns {((task: import('./index.js').Task) => Promise<any>) | null}
 */
export function getStepHandler(steps, slug) {
  const step = steps[slug];

  if (!step) {
    return null;
  }

  if (!isStepDefinition(step)) {
    throw new Error(
      `Step "${slug}" must be a StepDefinition created with defineStep(). ` +
        `Plain function handlers are no longer supported.`
    );
  }

  return createHandler(step);
}
