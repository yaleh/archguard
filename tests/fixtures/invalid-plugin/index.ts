/**
 * Invalid plugin fixture for external-plugin-loading error contract (TASK-76).
 *
 * This module deliberately exports neither a `default` class nor a named
 * `Plugin` export. `PluginRegistry.loadFromPath()` must reject it with the
 * documented error: "must export a default class or named 'Plugin' export".
 *
 * It is NOT a plugin — it exists so the "illegal plugin" path is exercised E2E
 * (a module that exists on disk but is not a valid plugin module), as opposed
 * to the "file does not exist" path.
 */
export const notAPlugin = true;
