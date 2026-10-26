import { CacheFiles, CacheWatcher } from './cache-watcher'
import {
  LadderProfile,
  parseLadderProfile,
  readCacheKey,
  SCR_CACHE_MARKERS,
  ScrCacheSighting,
} from './scr-cache'

/**
 * Watches StarCraft's embedded browser cache for the ladder's match screen and the profiles it
 * looks up.
 */
export class ScrCacheWatcher extends CacheWatcher<ScrCacheSighting, LadderProfile> {
  constructor(files: CacheFiles, now?: () => number) {
    super(
      files,
      {
        markers: SCR_CACHE_MARKERS,
        readKey: readCacheKey,
        hasBody: sighting => sighting.kind === 'ladderProfile',
        readBody: (body, sighting) =>
          sighting.kind === 'ladderProfile'
            ? parseLadderProfile(body, sighting.name, sighting.gatewayId)
            : undefined,
      },
      now,
    )
  }
}
