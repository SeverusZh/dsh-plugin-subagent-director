/**
 * Allowed-route selection model for the alpha.4 client.
 *
 * The alpha.4 client no longer has a full llm model catalog RPC
 * (`connection.api.llm` was removed), and Subagent Director must pick a
 * provider/model ONLY from the routes the user authorized in the official
 * `subagent-model-selection` section (the "Subagent" plugin-config model
 * list). This module turns that route list into the option sets the settings
 * page renders. Pure and framework-free so the rules are unit-testable.
 */

/** One exact provider/model route authorized in the Subagent config list. */
export interface AllowedRoute {
  readonly provider: string;
  readonly model: string;
}

/** One selectable option derived from an allowed route. */
export interface AllowedRouteOption {
  readonly provider: string;
  readonly model: string;
  /** Stable display label for the exact route, e.g. "deepseek/deepseek-v4". */
  readonly label: string;
}

/** One-line display label for an exact route. */
export function allowedRouteLabel(route: AllowedRoute): string {
  return `${route.provider}/${route.model}`;
}

/**
 * Map the authorized route list to selectable options, preserving order and
 * dropping duplicates of the exact same provider/model pair.
 */
export function buildRouteOptions(routes: readonly AllowedRoute[]): AllowedRouteOption[] {
  const seen = new Set<string>();
  const options: AllowedRouteOption[] = [];
  for (const route of routes) {
    const key = `${route.provider}\u0000${route.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ provider: route.provider, model: route.model, label: allowedRouteLabel(route) });
  }
  return options;
}

/** Unique providers in first-seen order, for the provider select. */
export function providerNames(routes: readonly AllowedRoute[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const route of routes) {
    if (seen.has(route.provider)) continue;
    seen.add(route.provider);
    names.push(route.provider);
  }
  return names;
}

/** The allowed options available for one exact provider, for the model select. */
export function modelsForProvider(routes: readonly AllowedRoute[], provider: string): AllowedRouteOption[] {
  return buildRouteOptions(routes).filter((option) => option.provider === provider);
}
