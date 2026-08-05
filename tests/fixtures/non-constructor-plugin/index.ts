/**
 * Non-constructor plugin fixture for external-plugin-loading error contract
 * (TASK-76).
 *
 * This module exports a `default` that is NOT a constructor function/class.
 * `PluginRegistry.loadFromPath()` picks up the default export but must fail at
 * instantiation (`new PluginClass()` → TypeError) rather than silently return a
 * broken plugin. It complements tests/fixtures/invalid-plugin (no export at
 * all).
 */
export default { notAConstructor: true };
