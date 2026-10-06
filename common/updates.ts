/** Where the app is with installing a newer version of itself. */
export type UpdateStatus =
  | { kind: 'none' }
  /** A newer version was found and is downloading. */
  | { kind: 'downloading'; version: string }
  /** A newer version is downloaded and installs on the next restart. */
  | { kind: 'ready'; version: string }
