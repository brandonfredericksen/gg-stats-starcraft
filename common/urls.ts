/**
 * Tagged template literal that constructs the path part of a url where any variable parts will be
 * properly encoded for inclusion in the URL. Can be appended to other strings (whether they are
 * created from this function or not).
 *
 * Example:
 * ```ts
 * urlPath`/assets/${fileName}`
 * ```
 */
export function urlPath(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings
    .map((str, i) => {
      if (values[i] instanceof URLSearchParams) {
        return str + String(values[i])
      } else {
        const value = values[i] === undefined ? '' : encodeURIComponent(String(values[i]))
        return str + value
      }
    })
    .join('')
}
