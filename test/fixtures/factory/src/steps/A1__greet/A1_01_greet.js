// @ts-check
import { defineStep, attachDocument, attachReport, attachWorkpieces } from '@assemblyline/lib-factory';

export default defineStep({
  slug: 'A1_01_greet',
  name: 'Greet',
  description: 'Greets config.name and attaches a document, a report and a workpiece outcome.',

  execute: async (config, context) => {
    const greeting = `Hello, ${config.name}`;
    await attachDocument(context.work_record.id, 'Greeting', greeting, 'A1_01_greet');
    await attachWorkpieces(context.work_record.id, { [config.name]: 'done' });
    await attachReport(context.work_record.id, `# Greeted ${config.name}`);
    return { greeting, work_record_id: context.work_record.id, org_id: context.org_id };
  },
});
