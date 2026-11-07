// Master-data fields backed by columns that a later migration adds (e.g.
// state_code from 204). Marked `optionalColumn: true` in a settings config,
// they are shown and saved only once the column exists in the database, so
// the app keeps working before that migration is applied. Pure (testable).

/** Keys of the optional columns a config uses (fields and table columns). */
export function optionalColumnKeys(config) {
  const keys = [...(config?.fields ?? []), ...(config?.columns ?? [])].filter((f) => f?.optionalColumn).map((f) => f.key);
  return [...new Set(keys)];
}

/** The config with optional fields/columns removed unless `available`. */
export function withOptionalColumns(config, available) {
  if (available || !optionalColumnKeys(config).length) return config;
  return {
    ...config,
    fields: (config.fields ?? []).filter((f) => !f.optionalColumn),
    columns: (config.columns ?? []).filter((c) => !c.optionalColumn),
  };
}
