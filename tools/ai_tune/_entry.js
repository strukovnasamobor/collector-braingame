// Re-export entry for the tournament harness. Bundled by engine_bridge.js
// via esbuild so Node can load the engine despite extensionless imports.
export { chooseAIMove } from '../../src/game/aiEngineCore.js';
export { AI_TIERS } from '../../src/game/aiTiers.js';
