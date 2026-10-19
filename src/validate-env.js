/**
 * Environment validation
 *
 * Validates required environment variables at startup.
 * Fails fast if anything is missing.
 */

/**
 * Validate required environment variables. Exits the process when any is missing.
 */
export function validateEnv() {
  const required = [
    'ORCHESTRATOR_API_KEY',
    'ORCHESTRATOR_API_SECRET',
    'FACTORY_LOCATION',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('[Factory] Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    process.exit(1);
  }

  console.log('[Factory] Environment validated');
  console.log('[Factory] Orchestrator:', process.env.ORCHESTRATOR_URL || 'http://localhost:3000');
  console.log('[Factory] Location:', process.env.FACTORY_LOCATION);
}
