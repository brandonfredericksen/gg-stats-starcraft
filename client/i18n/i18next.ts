import i18n, { TFunction } from 'i18next'
import HttpBackend, { HttpBackendOptions } from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'
import createDeferred from '../../common/async/deferred'
import {
  ALL_TRANSLATION_LANGUAGES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../common/i18n'
import { getBestLanguage } from './language-detector'

const CUR_VERSION = import.meta.env.GGSTATS_VERSION

/**
 * Type to use for interpolations in `Trans` components since React doesn't allow objects as
 * children.
 *
 * Taken as a best solution from this comment:
 * https://github.com/i18next/react-i18next/issues/1483#issuecomment-1268455602
 */
export type TransInterpolation = any

const i18nextDeferred = createDeferred<TFunction>()

export const i18nextPromise = i18nextDeferred.then(i18next => i18next)

/** Initializes i18next, loading the translations for the system's language. */
export function initI18next() {
  const i18next = i18n
    .use(HttpBackend)
    .use(initReactI18next)
    .init<HttpBackendOptions>({
      backend: {
        // Served by the app itself (see `app/assets/locales`), so translations work offline.
        loadPath: '/assets/locales/{{lng}}/{{ns}}.json?' + encodeURIComponent(CUR_VERSION),
      },

      lng: getBestLanguage(),
      supportedLngs: ALL_TRANSLATION_LANGUAGES,
      fallbackLng: TranslationLanguage.English,

      // These are basically the defaults, but just defining them explicitly if we ever decide to
      // use namespaces.
      ns: TranslationNamespace.Global,
      defaultNS: TranslationNamespace.Global,
      fallbackNS: false,

      interpolation: {
        escapeValue: false, // Not needed for react as it escapes by default
      },

      // Some HTML attributes (e.g. `title`, `label`) only accept `string | undefined` as valid
      // values, so we configure our `t` function to not be able to return `null` values.
      returnNull: false,
    })
  i18n.on('languageChanged', lang => {
    document.documentElement.lang = lang
    document.body.dataset.lang = lang
  })

  i18next.then(
    r => i18nextDeferred.resolve(r),
    e => i18nextDeferred.reject(e),
  )

  return i18nextPromise
}

export default i18n
