import { describe, expect, test } from 'vitest'
import { TranslationLanguage } from '../../common/i18n'
import { getAppLanguage, getBestLanguage } from './language-detector'

describe('client/i18n/language-detector getAppLanguage', () => {
  test('uses the language chosen in settings over the system languages', () => {
    expect(getAppLanguage('ko', ['en-US'])).toBe(TranslationLanguage.Korean)
    expect(getAppLanguage('en', ['ko-KR'])).toBe(TranslationLanguage.English)
  })

  test('follows the system languages when no language was chosen', () => {
    expect(getAppLanguage(undefined, ['ko-KR', 'en-US'])).toBe(TranslationLanguage.Korean)
    expect(getAppLanguage(undefined, ['fr-FR', 'en-US'])).toBe(TranslationLanguage.English)
  })

  test('follows the system languages when the chosen language is not shipped', () => {
    expect(getAppLanguage('xx', ['ko-KR'])).toBe(TranslationLanguage.Korean)
  })

  test('falls back on English when nothing matches', () => {
    expect(getAppLanguage(undefined, ['fr-FR'])).toBe(TranslationLanguage.English)
  })
})

const SUPPORTED_LANGUAGES = ['zh-Hans', 'en', 'ko', 'ru', 'es']

describe('client/i18n/language-detector', () => {
  test('returns the english language if none of the given languages are supported', () => {
    const lng = getBestLanguage(['INVALID_LANGUAGE'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the earliest matching language without dialect', () => {
    const lng = getBestLanguage(['en-US', 'ko-KR'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the exact match for the language with dialect', () => {
    const lng = getBestLanguage(['zh-Hans', 'en-US'], SUPPORTED_LANGUAGES)

    expect(lng).toBe('zh-Hans')
  })

  test('language with a dialect will match a non-dialect code', () => {
    const lng = getBestLanguage(['es-MX', 'en-US'], SUPPORTED_LANGUAGES)

    expect(lng).toBe('es')
  })
})
