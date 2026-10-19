// @ts-check
import { defineStep } from '@assemblyline/lib-factory';

export default defineStep({
  slug: 'B1_01_shout',
  name: 'Shout',
  description: 'Upper-cases config.text and appends config.suffix.',

  execute: async (config) => ({ shouted: `${String(config.text).toUpperCase()}${config.suffix ?? ''}` }),
});
