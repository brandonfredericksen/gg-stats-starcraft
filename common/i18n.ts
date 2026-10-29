/**
 * The languages the app ships, each with a translation file in `app/assets/locales`. English is the
 * source; `pnpm run i18n` translates into every other language listed here.
 */
export enum TranslationLanguage {
  English = 'en',
  Korean = 'ko',
}

export const ALL_TRANSLATION_LANGUAGES: ReadonlyArray<TranslationLanguage> =
  Object.values(TranslationLanguage)

/**
 * Each language's name written in that language, so people can find their own language in the list
 * whatever language the app is showing.
 */
export const TRANSLATION_LANGUAGE_NAMES: Readonly<Record<TranslationLanguage, string>> = {
  [TranslationLanguage.English]: 'English',
  [TranslationLanguage.Korean]: '한국어',
}

/** Returns whether `value` is one of the languages the app ships. */
export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return ALL_TRANSLATION_LANGUAGES.includes(value as TranslationLanguage)
}

/**
 * A string representation of all the namespaces we're using for our translation files. Currently
 * we're not using different namespaces so we just define a default one.
 */
export enum TranslationNamespace {
  Global = 'global',
}

export const ALL_TRANSLATION_NAMESPACES: ReadonlyArray<TranslationNamespace> =
  Object.values(TranslationNamespace)
