/** SDK-owned read failures. The host still owns messages for server/action refusals. */
const copy = {
  en: {
    bindingUnavailable: 'This Space cannot read this database yet.',
    actionUnavailable: 'This action is unavailable in this Space.',
    readUnavailable: 'These data cannot be read in this Space.',
    schemaChanged: 'This database changed. Refresh the page and try again.',
    responseIncomplete: 'This database could not be loaded. Refresh the page and try again.',
    listUnavailable: 'This list is unavailable in this view.',
    timedOut: 'This read took too long. Please retry.',
    scopeUnavailable: 'App query scope is no longer available.',
    scopeCleared: 'App query scope was cleared.',
  },
  fr: {
    bindingUnavailable: 'Ce Space ne peut pas encore lire cette base de données.',
    actionUnavailable: 'Cette action n’est pas disponible dans ce Space.',
    readUnavailable: 'Ces données ne sont pas accessibles dans ce Space.',
    schemaChanged: 'Cette base de données a changé. Actualise la page et réessaie.',
    responseIncomplete: 'Cette base de données n’a pas pu être chargée. Actualise la page et réessaie.',
    listUnavailable: 'Cette liste n’est pas disponible dans cette vue.',
    timedOut: 'Cette lecture a pris trop de temps. Réessaie.',
    scopeUnavailable: 'Les données de cette vue ne sont plus accessibles.',
    scopeCleared: 'Les données de cette vue ont été réinitialisées.',
  },
} as const;

export type QueryErrorKey = keyof typeof copy.en;
const PREFIX = 'notis_sdk_query:';

/** Code and diagnostic survive localisation; only SDK-owned messages are translated. */
export class SdkQueryError extends Error {
  readonly code: string;
  readonly diagnostic?: string;
  constructor(key: QueryErrorKey, diagnostic?: string, locale?: string, cause?: Error) {
    super(copy[locale === 'fr' ? 'fr' : 'en'][key], cause ? { cause } : undefined);
    this.name = 'SdkQueryError';
    this.code = PREFIX + key;
    this.diagnostic = diagnostic;
  }
}

/** Called at render time, so a cached failure changes language without replaying its read. */
export function localizeQueryError(error: Error | null, locale?: string): Error | null {
  const failure = error as (Error & { code?: unknown; diagnostic?: unknown }) | null;
  if (!failure || typeof failure.code !== 'string' || !failure.code.startsWith(PREFIX)) return error;
  const key = failure.code.slice(PREFIX.length);
  if (!Object.hasOwn(copy.en, key)) return error;
  const message = copy[locale === 'fr' ? 'fr' : 'en'][key as QueryErrorKey];
  if (failure.message === message) return error;
  return new SdkQueryError(key as QueryErrorKey, typeof failure.diagnostic === 'string' ? failure.diagnostic : undefined, locale, failure);
}
