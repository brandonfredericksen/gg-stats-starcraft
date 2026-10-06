import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  CoachBucket,
  CoachChange,
  CoachGame,
  CoachGoal,
  CoachNote,
  CoachRecentForm,
  MIN_EARLIER_GAMES,
  RECENT_FORM_GAMES,
} from '../../common/my-stats/coach'
import { isTeamGame } from '../../common/my-stats/player-games'
import { raceCharToLabel } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import {
  formatPercent,
  getResultLetter,
  getResultWord,
  HelpLabel,
  PaddedPanel,
  PanelTitle,
  RecentChip,
  RecentTooltip,
} from '../my-stats/my-stats-panels'
import { push } from '../navigation/routing'
import { getGameStatsUrl } from '../replays/action-creators'
import { bodyMedium, labelLarge, labelMedium, titleLarge, titleSmall } from '../styles/typography'
import {
  Cell,
  Columns,
  formatGameTime,
  formatTimeDiff,
  getBuildName,
  getMetricGroup,
  getMetricText,
  getTimingTip,
  getTip,
  GroupHead,
  MetricGroup,
  Table,
  Text,
  Tone,
  toneColor,
  useFormatValue,
} from './coach-shared'

const PanelHeader = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 12px;
`

const PanelNote = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const LastGameButton = styled.button`
  ${buttonReset};
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Goals = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
`

const GoalRow = styled.li`
  padding: 16px 0;

  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 14px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }

  &:last-child {
    padding-bottom: 0;
  }
`

const GoalNumber = styled.span`
  ${labelLarge};
  width: 32px;
  height: 32px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  background: var(--theme-tab-coach-tint);
  box-shadow: inset 0 0 0 1px var(--theme-tab-coach-ring);
  color: var(--theme-tab-coach);
  font-weight: 700;
`

const GoalBody = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const GoalTop = styled.div`
  ${titleSmall};
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
`

const Tag = styled.span`
  ${labelMedium};
  height: 22px;
  padding: 0 8px;

  display: inline-flex;
  align-items: center;

  border-radius: var(--radius-full);
  background: var(--theme-negative-container);
  color: var(--theme-negative);
  font-weight: 600;
`

const Aim = styled.span`
  ${titleLarge};
  font-variant-numeric: tabular-nums;
`

const AimLine = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 12px;
`

const AimBasis = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Facts = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const Fact = styled.span<{ $tone?: Tone }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  & > strong {
    color: ${props => (props.$tone ? toneColor(props.$tone) : 'var(--theme-on-surface)')};
    font-weight: 600;
  }
`

const Tip = styled.p`
  ${bodyMedium};
  margin: 0;
  padding: 10px 12px;

  border-left: 3px solid var(--theme-tab-coach);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--theme-container);
  color: var(--theme-on-surface);
`

const Notes = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 14px;
`

const NoteRow = styled.li`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
`

const NoteIcon = styled(MaterialIcon)<{ $tone?: Tone }>`
  margin-top: 1px;
  color: ${props => (props.$tone ? toneColor(props.$tone) : 'var(--theme-tab-coach)')};
`

const NoteBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const NoteTitle = styled.span`
  ${titleSmall};
`

const RecentStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(${RECENT_FORM_GAMES}, minmax(0, 1fr));
  gap: 5px;
  max-width: 520px;
`

const Record = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  color: var(--theme-on-surface-variant);

  & strong {
    color: var(--theme-on-surface);
    font-weight: 600;
  }
`

function getWinRate(wins: number, losses: number) {
  return wins + losses ? wins / (wins + losses) : undefined
}

/** A short date for one of the user's games, like "Oct 4". */
function formatGameDate(gameTimeMs: number) {
  return new Date(gameTimeMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getAimText(goal: CoachGoal, value: string, t: TFunction) {
  if (goal.unit === 'time') {
    return t('myStats.coach.aimBy', 'By {{value}}', { value })
  }
  return goal.higherIsBetter
    ? t('myStats.coach.aimAtLeast', 'At least {{value}}', { value })
    : t('myStats.coach.aimAtMost', 'At most {{value}}', { value })
}

/** Where a goal's target comes from, in a few words beside it. */
function getBasisText(goal: CoachGoal, bucket: CoachBucket, t: TFunction) {
  switch (goal.basis) {
    case 'others':
      return t('myStats.coach.basisOthers', 'what most {{race}} players reach', {
        race: raceCharToLabel(bucket.race, t),
      })
    case 'wins':
      return t('myStats.coach.basisWins', 'what you reach in your wins')
    case 'earlier':
      return t('myStats.coach.basisEarlier', 'where you were before your last {{count}}', {
        count: bucket.recentForm.games.length,
      })
    default:
      return goal.basis satisfies never
  }
}

/** What a tip needs to know about the kind of game. */
function getTipContext(bucket: CoachBucket) {
  return {
    race: bucket.race,
    opponentRace: bucket.opponentRace,
    teamGame: isTeamGame(bucket.shape),
    mapFamily: bucket.mapFamily,
  }
}

/** A goal's name and what it means, for a number or for when to start something. */
function getGoalText(goal: CoachGoal, t: TFunction): [label: string, help: string] {
  if (goal.key === 'buildTiming') {
    return [
      t('myStats.coach.metric.buildTiming', '{{build}} timing', {
        build: getBuildName(goal.buildKey ?? '', t),
      }),
      t('myStats.coach.help.buildTiming', 'When you usually start it, against other players.'),
    ]
  }
  return getMetricText(goal.key, t)
}

function GoalItem({
  goal,
  index,
  bucket,
}: {
  goal: CoachGoal
  index: number
  bucket: CoachBucket
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  const [label, help] = getGoalText(goal, t)
  const { target } = goal
  let lastTone: Tone | undefined
  if (goal.lastHit !== undefined) {
    lastTone = goal.lastHit ? 'good' : 'bad'
  }

  return (
    <GoalRow>
      <GoalNumber aria-hidden={true}>{index + 1}</GoalNumber>
      <GoalBody>
        <GoalTop>
          <HelpLabel label={label} help={help} />
          {goal.inLosses ? (
            <Tag>{t('myStats.coach.inYourLosses', 'Worse in your losses')}</Tag>
          ) : null}
        </GoalTop>
        <AimLine>
          <Aim>{getAimText(goal, formatValue(target, goal.unit), t)}</Aim>
          <AimBasis>{getBasisText(goal, bucket, t)}</AimBasis>
        </AimLine>
        <Facts>
          <Fact>
            {goal.basis === 'wins'
              ? t('myStats.coach.factLosses', 'In your losses')
              : t('myStats.coach.factTypical', 'You, typically')}
            <strong>{formatValue(goal.userValue, goal.unit)}</strong>
          </Fact>
          {goal.recentValue !== undefined ? (
            <Fact>
              {t('myStats.coach.factRecent', 'Last {{count}}', {
                count: Math.min(RECENT_FORM_GAMES, bucket.userGames),
              })}
              <strong>{formatValue(goal.recentValue, goal.unit)}</strong>
            </Fact>
          ) : null}
          <Fact $tone={lastTone}>
            {t('myStats.coach.factLast', 'Last game')}
            <strong>
              {goal.lastValue !== undefined ? formatValue(goal.lastValue, goal.unit) : '-'}
            </strong>
            {goal.lastHit !== undefined ? (
              <MaterialIcon
                icon={goal.lastHit ? 'check' : 'close'}
                size={18}
                aria-label={
                  goal.lastHit
                    ? t('myStats.coach.hit', 'Reached')
                    : t('myStats.coach.missed', 'Not reached')
                }
              />
            ) : null}
          </Fact>
          {goal.beats !== undefined ? (
            <Fact>
              {t('myStats.coach.factBeats', 'Better than')}
              <strong>{formatPercent(goal.beats)}</strong>
              {t('myStats.coach.factBeatsOf', 'of {{race}} players', {
                race: raceCharToLabel(bucket.race, t),
              })}
            </Fact>
          ) : null}
        </Facts>
        <Tip>
          {goal.key === 'buildTiming'
            ? getTimingTip(getBuildName(goal.buildKey ?? '', t), formatGameTime(target), t)
            : getTip(goal.key, getTipContext(bucket), t)}
        </Tip>
      </GoalBody>
    </GoalRow>
  )
}

/** How the user's latest game went against the goals, which opens that game. */
function LastGameCheck({ game, goals }: { game: CoachGame; goals: ReadonlyArray<CoachGoal> }) {
  const { t } = useTranslation()
  const checked = goals.filter(g => g.lastHit !== undefined)
  const hit = checked.filter(g => g.lastHit).length
  return (
    <LastGameButton type='button' onClick={() => push(getGameStatsUrl(game.gameId))}>
      {checked.length
        ? t('myStats.coach.lastGameCheck', {
            defaultValue:
              'Your last game ({{result}} on {{map}}, {{date}}) reached {{hit}} of {{count}}.',
            result: getResultWord(game.result, t).toLowerCase(),
            map: game.mapName,
            date: formatGameDate(game.gameTimeMs),
            hit,
            count: checked.length,
          })
        : t('myStats.coach.lastGameOnly', 'Your last game: {{result}} on {{map}}, {{date}}.', {
            result: getResultWord(game.result, t).toLowerCase(),
            map: game.mapName,
            date: formatGameDate(game.gameTimeMs),
          })}
    </LastGameButton>
  )
}

/** A few things to aim for in the next game, each with a target, a tip, and how the last game did. */
export function NextGame({ bucket }: { bucket: CoachBucket }) {
  const { t } = useTranslation()
  const lastGame = bucket.recentForm.games.at(-1)
  return (
    <PaddedPanel>
      <PanelHeader>
        <PanelTitle>{t('myStats.coach.nextGame', 'For your next game')}</PanelTitle>
        {lastGame && bucket.goals.length ? (
          <LastGameCheck game={lastGame} goals={bucket.goals} />
        ) : null}
      </PanelHeader>
      {bucket.goals.length ? (
        <Goals>
          {bucket.goals.map((goal, i) => (
            <GoalItem key={goal.buildKey ?? goal.key} goal={goal} index={i} bucket={bucket} />
          ))}
        </Goals>
      ) : (
        <Text>
          {t(
            'myStats.coach.noGoals',
            "Nothing stands out against other players right now. Keep playing your game: the notes and the tables below show where you're closest to slipping.",
          )}
        </Text>
      )}
    </PaddedPanel>
  )
}

function formatChange(
  change: CoachChange,
  formatValue: ReturnType<typeof useFormatValue>,
  t: TFunction,
) {
  const diff = change.recentValue - change.earlierValue
  if (change.unit === 'time') {
    const seconds = Math.round(Math.abs(diff) / 1000)
    if (!seconds) {
      return t('myStats.coach.sameTime', 'Same')
    }
    const time = formatTimeDiff(Math.abs(diff), t)
    return diff > 0
      ? t('myStats.coach.later', '{{time}} later', { time })
      : t('myStats.coach.earlier', '{{time}} earlier', { time })
  }
  const amount = formatValue(Math.abs(diff), change.unit === 'perMinute' ? 'count' : change.unit)
  if (amount === formatValue(0, change.unit === 'perMinute' ? 'count' : change.unit)) {
    return t('myStats.coach.sameTime', 'Same')
  }
  return `${diff > 0 ? '+' : '-'}${amount}`
}

/** What the coach says about the latest results, against the games before them. */
function getFormContent(
  form: CoachRecentForm,
  t: TFunction,
): { icon: string; tone?: Tone; title: string; body: string } {
  const rate = getWinRate(form.wins, form.losses) ?? 0
  const earlierRate = getWinRate(form.earlierWins, form.earlierLosses)
  const values = {
    count: form.games.length,
    wins: form.wins,
    losses: form.losses,
    rate: formatPercent(rate),
    earlierRate: formatPercent(earlierRate),
  }
  if (earlierRate !== undefined && rate - earlierRate >= 0.1) {
    return {
      icon: 'trending_up',
      tone: 'good',
      title: t('myStats.coach.note.formUpTitle', "You're on a good run"),
      body: t(
        'myStats.coach.note.formUp',
        '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, up from {{earlierRate}} before. Whatever changed, keep doing it.',
        values,
      ),
    }
  }
  if (earlierRate !== undefined && earlierRate - rate >= 0.1) {
    return {
      icon: 'trending_down',
      tone: 'bad',
      title: t('myStats.coach.note.formDownTitle', 'A rough patch'),
      body: t(
        'myStats.coach.note.formDown',
        '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, down from {{earlierRate}} before. Pick one goal for your next game and play a few games with only that in mind.',
        values,
      ),
    }
  }
  return {
    icon: 'trending_flat',
    title: t('myStats.coach.note.formSteadyTitle', 'Steady results'),
    body: t(
      'myStats.coach.note.formSteady',
      '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, about the same as the {{earlierRate}} before. To move up, work on the goals for your next game.',
      values,
    ),
  }
}

function getNoteContent(
  note: CoachNote,
  bucket: CoachBucket,
  formatValue: ReturnType<typeof useFormatValue>,
  t: TFunction,
): { icon: string; tone?: Tone; title: string; body: string } {
  switch (note.kind) {
    case 'form': {
      const content = getFormContent(note.form, t)
      const partners = note.form.newPartnerGames
      if (isTeamGame(bucket.shape) && partners * 2 >= note.form.games.length) {
        content.body += ` ${t('myStats.coach.note.newPartners', {
          defaultValue:
            '{{count}} of them were with a teammate you had not played with before, which often explains a swing.',
          defaultValue_one:
            '{{count}} of them was with a teammate you had not played with before, which often explains a swing.',
          count: partners,
        })}`
      }
      return content
    }
    case 'inLosses': {
      const { finding } = note
      const values = {
        metric: getMetricText(finding.key, t)[0],
        win: formatValue(finding.winValue, finding.unit),
        loss: formatValue(finding.lossValue, finding.unit),
      }
      return {
        icon: 'flag',
        tone: 'bad',
        title: t('myStats.coach.note.inLossesTitle', 'Where your games slip away'),
        body: isTeamGame(bucket.shape)
          ? t(
              'myStats.coach.note.inLossesTeam',
              '{{metric}}: {{win}} in your typical win, {{loss}} in your typical loss, leaving out losses where a teammate fell first. In team games that can also mean you were the one they attacked, so check a few of those games.',
              values,
            )
          : t(
              'myStats.coach.note.inLosses',
              '{{metric}}: {{win}} in your typical win, {{loss}} in your typical loss. It goes together with losing, so getting it right is worth more than anything else here.',
              values,
            ),
      }
    }
    case 'firstOut': {
      const { firstOut } = note
      return {
        icon: 'person_off',
        tone: 'bad',
        title: t('myStats.coach.note.firstOutTitle', 'First to fall'),
        body: t(
          'myStats.coach.note.firstOut',
          'You were the first of your team out in {{firstOut}} of your {{losses}} losses, {{share}}, against {{poolShare}} for other players. Scout which way their first push is heading, and ask for help before it lands rather than after.',
          {
            firstOut: firstOut.firstOut,
            losses: firstOut.losses,
            share: formatPercent(firstOut.firstOut / firstOut.losses),
            poolShare: formatPercent(firstOut.poolShare),
          },
        ),
      }
    }
    case 'slipping':
    case 'improving': {
      const { change } = note
      const values = {
        metric: getMetricText(change.key, t)[0],
        recent: formatValue(change.recentValue, change.unit),
        earlier: formatValue(change.earlierValue, change.unit),
        count: change.recentGames,
      }
      return note.kind === 'improving'
        ? {
            icon: 'north_east',
            tone: 'good',
            title: t('myStats.coach.note.improvingTitle', 'Getting better'),
            body: t(
              'myStats.coach.note.improving',
              '{{metric}}: {{recent}} lately, from {{earlier}} before. The practice is paying off.',
              values,
            ),
          }
        : {
            icon: 'south_east',
            tone: 'bad',
            title: t('myStats.coach.note.slippingTitle', 'Slipping lately'),
            body: t(
              'myStats.coach.note.slipping',
              '{{metric}}: {{recent}} lately, from {{earlier}} before. Watch it in your next games before it becomes a habit.',
              values,
            ),
          }
    }
    case 'strength':
      return {
        icon: 'star',
        tone: 'good',
        title: t('myStats.coach.note.strengthTitle', 'Your strength'),
        body: t(
          'myStats.coach.note.strength',
          '{{metric}}: {{you}} against {{them}}, better than {{percent}} of {{race}} players here. Lean on it.',
          {
            metric: getMetricText(note.finding.key, t)[0],
            you: formatValue(note.finding.userValue, note.finding.unit),
            them: formatValue(note.finding.poolValue, note.finding.unit),
            percent: formatPercent(note.finding.beats),
            race: raceCharToLabel(bucket.race, t),
          },
        ),
      }
    case 'timing': {
      const { userMs = 0, poolMs = 0 } = note.timing
      const time = formatTimeDiff(Math.abs(userMs - poolMs), t)
      const values = {
        build: getBuildName(note.timing.buildKey, t),
        time,
      }
      return {
        icon: 'schedule',
        title: t('myStats.coach.note.timingTitle', 'A timing to check'),
        body:
          userMs > poolMs
            ? t(
                'myStats.coach.note.timingLate',
                "You start {{build}} {{time}} later than most. If your build doesn't call for that, it's free time to win back.",
                values,
              )
            : t(
                'myStats.coach.note.timingEarly',
                'You start {{build}} {{time}} earlier than most. Make sure it pays for what it costs elsewhere.',
                values,
              ),
      }
    }
    default:
      return note satisfies never
  }
}

/** What a coach would say first, in a few short notes. */
export function CoachNotes({ bucket }: { bucket: CoachBucket }) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <PaddedPanel>
      <PanelTitle>{t('myStats.coach.notesTitle', "Coach's notes")}</PanelTitle>
      {bucket.notes.length ? (
        <Notes>
          {bucket.notes.map(note => {
            const content = getNoteContent(note, bucket, formatValue, t)
            return (
              <NoteRow key={note.kind}>
                <NoteIcon icon={content.icon} size={22} $tone={content.tone} />
                <NoteBody>
                  <NoteTitle>{content.title}</NoteTitle>
                  <Text>{content.body}</Text>
                </NoteBody>
              </NoteRow>
            )
          })}
        </Notes>
      ) : (
        <Text>
          {t(
            'myStats.coach.noNotes',
            'Nothing to say yet. Notes come once there are wins and losses to compare, and earlier games to compare your latest ones with.',
          )}
        </Text>
      )}
    </PaddedPanel>
  )
}

function ChangeGroup({
  title,
  changes,
  recentCount,
}: {
  title: string
  changes: ReadonlyArray<CoachChange>
  recentCount: number
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <>
      <GroupHead>{title}</GroupHead>
      <GroupHead $end={true}>{t('myStats.coach.before', 'Before')}</GroupHead>
      <GroupHead $end={true}>
        {t('myStats.coach.lastCount', 'Last {{count}}', { count: recentCount })}
      </GroupHead>
      <GroupHead $end={true}>{t('myStats.coach.change', 'Change')}</GroupHead>
      {changes.map(change => {
        const [label, help] = getMetricText(change.key, t)
        let tone: Tone | 'muted' = 'muted'
        if (change.direction !== 'same') {
          tone = change.direction === 'better' ? 'good' : 'bad'
        }
        return [
          <Cell key={`${change.key}-label`}>
            <HelpLabel
              label={label}
              help={`${help} ${t(
                'myStats.coach.changeGames',
                'From {{recentGames}} of your latest games and {{earlierGames}} before them.',
                { recentGames: change.recentGames, earlierGames: change.earlierGames },
              )}`}
            />
          </Cell>,
          <Cell key={`${change.key}-before`} $end={true} $tone='muted'>
            {formatValue(change.earlierValue, change.unit)}
          </Cell>,
          <Cell key={`${change.key}-recent`} $end={true}>
            {formatValue(change.recentValue, change.unit)}
          </Cell>,
          <Cell key={`${change.key}-change`} $end={true} $tone={tone}>
            {formatChange(change, formatValue, t)}
          </Cell>,
        ]
      })}
    </>
  )
}

/** The user's latest games: their results, and every number next to the games before them. */
export function RecentForm({ bucket }: { bucket: CoachBucket }) {
  const { t } = useTranslation()
  const form = bucket.recentForm
  const rate = getWinRate(form.wins, form.losses)
  const earlierRate = getWinRate(form.earlierWins, form.earlierLosses)
  const titles: Record<MetricGroup, string> = {
    economy: t('myStats.coach.groupEconomy', 'Economy'),
    growth: t('myStats.coach.groupGrowth', 'Growth'),
    spending: t('myStats.coach.groupSpending', 'Spending'),
    fights: t('myStats.coach.groupFights', 'Fights'),
    speed: t('myStats.coach.groupSpeed', 'Speed'),
  }
  const sides: ReadonlyArray<ReadonlyArray<MetricGroup>> = [
    ['economy', 'growth', 'spending'],
    ['fights', 'speed'],
  ]

  return (
    <PaddedPanel>
      <PanelHeader>
        <PanelTitle>{t('myStats.coach.recentForm', 'Recent form')}</PanelTitle>
        <PanelNote>{t('myStats.coach.recentNote', 'Newest first')}</PanelNote>
      </PanelHeader>
      <RecentStrip>
        {form.games.toReversed().map(game => (
          <RecentTooltip
            key={game.gameId}
            tabIndex={-1}
            position='top'
            text={[
              getResultWord(game.result, t),
              game.mapName,
              new Date(game.gameTimeMs).toLocaleString(),
            ].join(', ')}>
            <RecentChip
              type='button'
              $result={game.result}
              $tall={false}
              aria-label={getResultWord(game.result, t)}
              onClick={() => push(getGameStatsUrl(game.gameId))}>
              <span>{getResultLetter(game.result, t)}</span>
            </RecentChip>
          </RecentTooltip>
        ))}
      </RecentStrip>
      <Record>
        <span>
          {t('myStats.coach.recentRecord', 'Last {{count}}:', { count: form.games.length })}{' '}
          <strong>
            {t('myStats.coach.winsLosses', '{{wins}} wins, {{losses}} losses', {
              wins: form.wins,
              losses: form.losses,
            })}
          </strong>{' '}
          ({formatPercent(rate)})
        </span>
        {form.earlierGames ? (
          <span>
            {t('myStats.coach.earlierRecord', 'The {{count}} before:', {
              count: form.earlierGames,
            })}{' '}
            <strong>
              {t('myStats.coach.winsLosses', '{{wins}} wins, {{losses}} losses', {
                wins: form.earlierWins,
                losses: form.earlierLosses,
              })}
            </strong>{' '}
            ({formatPercent(earlierRate)})
          </span>
        ) : null}
      </Record>
      {form.changes.length ? (
        <Columns>
          {sides.map(groups => (
            <Table key={groups.join()} $columns='minmax(0, 1fr) auto auto auto'>
              {groups.map(group => {
                const inGroup = form.changes.filter(c => getMetricGroup(c.key) === group)
                return inGroup.length ? (
                  <ChangeGroup
                    key={group}
                    title={titles[group]}
                    changes={inGroup}
                    recentCount={form.games.length}
                  />
                ) : null
              })}
            </Table>
          ))}
        </Columns>
      ) : (
        <Text>
          {form.earlierGames < MIN_EARLIER_GAMES
            ? t('myStats.coach.recentNeeds', {
                defaultValue:
                  'Once you have {{count}} more games here, this compares your latest ones with the ones before.',
                defaultValue_one:
                  'Once you have {{count}} more game here, this compares your latest ones with the ones before.',
                count: RECENT_FORM_GAMES + MIN_EARLIER_GAMES - bucket.userGames,
              })
            : t(
                'myStats.coach.recentNoNumbers',
                "These games don't have enough numbers in common to compare.",
              )}
        </Text>
      )}
    </PaddedPanel>
  )
}
