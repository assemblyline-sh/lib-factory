import { defineStep } from '../define-step.js';
import { attachDocument, attachReport } from '../orchestrator.js';
import { moveWorkpieces } from '../files.js';
import { bin } from '../factoryPaths.js';
import { renderLocal } from '../renderLocal.js';
import { z } from 'zod';

/** Split "HI1/output" or "CD2/output/PO" → ['HI1', 'output'] / ['CD2', 'output', 'PO'] */
function parseBin(name) {
  return name.split('/');
}

// Strict, so a leftover files-mode key (`mode: "files"`, `pattern`,
// `recursive`) fails the step loudly instead of silently moving nothing.
// `mode: "directories"` is tolerated and ignored: most station files still
// carry it from when the conveyor had two modes.
const moveSchema = z.object({
  source_bin: z.string(),
  target_bin: z.string(),
  batch_size: z.number().default(100),
  mode: z.literal('directories').optional(),
}).strict();

export default defineStep({
  slug: 'lib-factory:move_files',
  name: 'Move Files Between Bins',
  description: 'Conveyor step — moves workpieces (directories with a pointer.json) from one station bin to another',

  inputSchema: z.union([
    moveSchema.extend({ report: z.boolean().default(false) }),
    z.object({ moves: z.array(moveSchema).min(1), report: z.boolean().default(false) }).strict(),
  ]),
  outputSchema: z.object({
    moved_count: z.number(),
    total_available: z.number(),
    entries: z.array(z.string()),
  }),

  execute: async (config, context) => {
    const { work_record } = context;

    // Normalize: simple config → single-element moves array
    const moves = config.moves || [config];

    const moves_detail = [];
    let total_moved = 0;
    let total_available = 0;
    const all_entries = [];

    for (const move of moves) {
      const { source_bin, target_bin, batch_size } = move;
      const [src_station, ...src_rest] = parseBin(source_bin);
      const [tgt_station, ...tgt_rest] = parseBin(target_bin);

      const result = moveWorkpieces({
        source_dir: bin(src_station, ...src_rest),
        target_dir: bin(tgt_station, ...tgt_rest),
        batch_size,
      });

      total_moved += result.moved_count;
      total_available += result.total_available;
      all_entries.push(...result.entries);

      moves_detail.push({
        source_bin, target_bin,
        moved_count: result.moved_count,
        total_available: result.total_available,
        entries: result.entries,
      });
    }

    const content = renderLocal(import.meta.url, './move_files_report.md', {
      moves_detail, total_moved, total_available,
      work_record_id: work_record.id, timestamp: new Date().toISOString(),
    });

    if (config.report) {
      await attachReport(work_record.id, content);
    } else {
      await attachDocument(work_record.id, 'Move Files', content, context.step.slug);
    }

    return { moved_count: total_moved, total_available, entries: all_entries };
  },
});
