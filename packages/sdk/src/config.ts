export { defineSpace, defineSpaces } from './space';
export type { SpaceDefinition, SpacesWorkspace, SpaceActionTemplate, SpaceResourceReference, SpaceDatabaseCreate, SpaceStore } from './space';
export type { SpaceViewParam, SpaceViewParamType, SpaceShows, SpaceMemoryPolicy, SpaceMemorySnapshot, SpaceChrome, SpaceMarkdownInput } from './space';
export { threadHookInput, commentOptionInput } from './functions';
export type { SpaceFunctionDeclaration, SpaceFunctionHandler, SpaceFunctionContext } from './functions';

/**
 * Configuration utilities for notis.config.ts and Space definitions.
 *
 * Usage:
 * ```ts
 * // notis.config.ts
 * import { defineSpaces } from '@notis/sdk/config';
 *
 * export default defineSpaces({
 *   spaces: { notes: { definition: 'spaces/notes/space.config.ts' } },
 * });
 * ```
 *
 * Each definition file exports `defineSpace({ ... })`. `notis spaces build`
 * reads only these two shapes.
 */

/**
 * Identity helper kept so older sources whose configuration files still import
 * it keep loading and bundling. It accepts any object and returns it unchanged;
 * `notis spaces build` never reads that shape.
 *
 * @deprecated Use `defineSpaces` for the workspace index and `defineSpace` for each Space.
 */
export function defineNotisApp<T extends object>(config: T): T {
  return config;
}
