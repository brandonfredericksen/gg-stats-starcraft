/**
 * An identifier of a particular file that is GG Stats needs to run the game.
 */
export enum GgStatsFile {
  /** game/dist/sb_init.dll */
  Init,
  /** game/dist/ggstats.dll */
  Main,
  /** game/dist/sb_init_64.dll */
  Init64,
  /** game/dist/ggstats_64.dll */
  Main64,
}

export type GgStatsFileResult = [file: GgStatsFile, canAccess: boolean]
