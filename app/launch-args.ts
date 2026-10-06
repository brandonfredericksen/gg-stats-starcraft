/**
 * Matches any argument carrying a URI scheme with an authority (RFC 3986 scheme grammar). An
 * argument that names a scheme is never a filesystem path, so it must not reach filesystem path
 * handling (`path.resolve`, the replay loader) no matter what its path portion ends with.
 */
const URI_ARG_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Picks the replay files out of untrusted launch arguments (an external process placed them on the
 * command line), exactly as passed rather than resolved to absolute paths. `--` flags, URIs and
 * anything that isn't a `.rep` file are dropped.
 */
export function getLaunchReplayPaths(args: string[]): string[] {
  return args.filter(
    arg =>
      !arg.startsWith('--') && !URI_ARG_PATTERN.test(arg) && arg.toLowerCase().endsWith('.rep'),
  )
}
