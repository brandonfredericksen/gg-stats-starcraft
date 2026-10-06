/**
 * The languages the app ships, each with a translation file in `app/assets/locales`. English is the
 * source; `pnpm run i18n` translates into every other language listed here.
 */
export enum TranslationLanguage {
  English = 'en',
}

export const ALL_TRANSLATION_LANGUAGES: ReadonlyArray<TranslationLanguage> =
  Object.values(TranslationLanguage)

/**
 * A string representation of all the namespaces we're using for our translation files. Currently
 * we're not using different namespaces so we just define a default one.
 */
export enum TranslationNamespace {
  Global = 'global',
}

export const ALL_TRANSLATION_NAMESPACES: ReadonlyArray<TranslationNamespace> =
  Object.values(TranslationNamespace)
