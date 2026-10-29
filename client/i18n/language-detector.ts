import {
  ALL_TRANSLATION_LANGUAGES,
  isTranslationLanguage,
  TranslationLanguage,
} from '../../common/i18n'

/**
 * Returns the language to show the app in: the one the user picked in settings, or the best match
 * for the system's languages when they didn't pick one (or picked one this version doesn't ship).
 */
export function getAppLanguage(
  chosenLanguage: string | undefined,
  languages: ReadonlyArray<string> = navigator.languages,
): TranslationLanguage {
  if (isTranslationLanguage(chosenLanguage)) {
    return chosenLanguage
  }
  return getBestLanguage(languages) as TranslationLanguage
}

/**
 * Choose the preferred language from the list of given languages. If no languages are given, we
 * default to using `navigator.languages` as a list of available languages. The logic for choosing
 * the preferred language is:
 *  - for languages we support without dialects, prefer the earliest matching language in the list
 *    of given languages.
 *  - for languages we support with dialects, prefer only if exact match.
 */
export function getBestLanguage(
  languages: ReadonlyArray<string> = navigator.languages,
  supportedLanguages: string[] = ALL_TRANSLATION_LANGUAGES as string[],
) {
  const lowerCaseSupportedLanguages = supportedLanguages.map(l => l.toLowerCase())

  for (const lng of languages) {
    const lowerCaseLanguage = lng.toLowerCase()

    let lngIndex = lowerCaseSupportedLanguages.indexOf(lowerCaseLanguage)
    if (lngIndex > -1) {
      return supportedLanguages[lngIndex]
    }

    const lngWithoutDialect = lowerCaseLanguage.split('-', 1)[0]

    lngIndex = lowerCaseSupportedLanguages.indexOf(lngWithoutDialect)
    if (lngIndex > -1) {
      return supportedLanguages[lngIndex]
    }
  }

  return TranslationLanguage.English
}
