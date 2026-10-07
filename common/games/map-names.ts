/**
 * Maps that go by more than one name. A replay stores the title the map's author gave it, and the
 * same map is uploaded in English, in Korean and with a league's tag, so these are the names
 * to group under. Names are matched whole, after versions and tags are stripped, and with spaces and
 * punctuation ignored, so a map that merely contains one of them is a different map.
 *
 * Remakes (Neo Dark Origin, New Heartbreak Ridge) are different maps from the ones they remake and
 * have their own rows. Special editions (Dominator SE) are the same map revised, so they share one.
 */
const MAPS: ReadonlyArray<readonly [name: string, ...aliases: string[]]> = [
  ['Fighting Spirit', '투혼'],
  ['Polypoid', '폴리포이드'],
  ['Radeon', '라데온'],
  ['Pole Star', '폴스타'],
  ['KnockOut', '녹아웃'],
  ['Dominator', '도미네이터'],
  ['Attitude', '애티튜드'],
  ['Octagon', '옥타곤'],
  ['Metropolis', '메트로폴리스'],
  ['Deja Vu', '데자뷰', '데자뷔'],
  ['Eclipse', '이클립스'],
  ['Neo Dark Origin', '네오 다크 오리진'],
  ['Dark Origin', '다크 오리진'],
  ['Apocalypse', '아포칼립스'],
  ['Retro', '레트로'],
  ['Vermeer', '버미어'],
  ['Neo Sylphid', '네오 실피드'],
  ['Sylphid', '실피드'],
  ['Circuit Breakers', 'Circuit Breaker', '써킷브레이커', '서킷브레이커'],
  ['Match Point', '매치포인트'],
  ['Jane Doe', '제인 도'],
  ['Backrooms', '백룸'],
  ['Roaring Currents', '울돌목'],
  ['Litmus', '리트머스'],
  ['Death Valley', '데스밸리'],
  ['Monty Hall', '몬티홀'],
  ['Kick Back', '킥백'],
  ['Pantheon', '판테온'],
  ['Minstrel', '민스트럴'],
  ['Blitz Y', '블리츠 Y'],
  ['Citadel', '시타델'],
  ['Troy', '트로이'],
  ['Invader', '인베이더'],
  ['La Campanella', '라 캄파넬라'],
  ['Tempest', '템페스트'],
  ['Butter', '버터'],
  ['Nemesis', '네메시스'],
  ['Aiolos', '아이올로스'],
  ['Colorless Fate', '컬러리스 페이트'],
  ['Odyssey RE', 'Odyssey:RE'],
  ['Lost Temple', 'The Lost Temple', '로스트 템플', '로템'],
  ['Python', '파이썬'],
  ['Heartbreak Ridge', '단장의 능선'],
  ['New Heartbreak Ridge', '신 단장의 능선'],
  ['Destination', '데스티네이션'],
  ['Andromeda', '안드로메다'],
  ['Benzene', '벤젠'],
  ['The Hunters', 'Hunters', '헌터'],
]

/** Keeps letters and numbers, so titles that differ in spacing or punctuation compare equal. */
function squash(name: string) {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

const MAP_BY_TITLE = new Map<string, string>(
  MAPS.flatMap(([name, ...aliases]) =>
    [name, ...aliases].map(title => [squash(title), name] as const),
  ),
)

/**
 * What an upload adds to a map's name beyond the name itself: the league or site that tagged it,
 * "OBS" for observer copies, and the edition. Applied to a name `getMapBaseName` already stripped
 * of versions and tags.
 */
function stripUploadMarks(baseName: string) {
  return baseName
    .replace(/\b(wcg|agl|cpl|lancraft|bsl|stl|psl|sg|obs?)\b/gi, ' ')
    .replace(/킹옵|수동옵/g, ' ')
    .replace(/\s+se$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The name a known map goes by in English, for a title it was uploaded under, or undefined for a
 * map this doesn't know.
 */
export function getKnownMapName(baseName: string): string | undefined {
  return MAP_BY_TITLE.get(squash(baseName)) ?? MAP_BY_TITLE.get(squash(stripUploadMarks(baseName)))
}
