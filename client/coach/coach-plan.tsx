import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  CoachBucket,
  CoachGoal,
  CoachNote,
  CoachRecentForm,
  CoachReview,
} from '../../common/my-stats/coach'
import { isTeamGame } from '../../common/my-stats/player-games'
import { raceCharToLabel } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { useAppDispatch } from '../redux-hooks'
import { watchGameAt } from '../replays/action-creators'

import { formatPercent, HelpLabel, PaddedPanel, PanelTitle } from '../my-stats/my-stats-panels'

import {
  bodyMedium,
  labelLarge,
  labelMedium,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import {
  formatGameTime,
  formatTimeDiff,
  getBuildName,
  getMetricText,
  getRaceWords,
  getTimingTip,
  getTip,
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

const CheckSummary = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Goals = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
`

const GoalRow = styled.li`
  padding: var(--space-4) 0;

  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--space-3);

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }

  &:first-child {
    padding-top: 0;
  }

  &:last-child {
    padding-bottom: 0;
  }
`

/** Neutral, so green only ever means a good result. Lines up with the goal's name. */
export const GoalNumber = styled.span`
  ${labelMedium};
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
  color: var(--theme-on-surface);
  font-weight: 700;
`

const GoalBody = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`

const GoalTop = styled.div`
  ${titleSmall};
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
`

const Tag = styled.span`
  ${labelMedium};
  height: 22px;
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;

  border-radius: var(--radius-full);
  background: var(--theme-negative-container);
  color: var(--theme-negative);
  font-weight: 600;
`

const Aim = styled.span<{ $small: boolean }>`
  ${props => (props.$small ? titleMedium : titleLarge)};
  font-variant-numeric: tabular-nums;
`

/** The one goal to play the next game around: a band across the panel, edge to edge. */
const Focus = styled.div`
  margin: 0 calc(-1 * var(--space-5));
  padding: var(--space-3) var(--space-5) var(--space-4);

  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  border-block: 1px solid var(--theme-outline-variant);
  background: var(--theme-container);

  /* With no goals after it, it runs to the panel's bottom edge. */
  &:last-child {
    margin-bottom: calc(-1 * var(--space-5));
    padding-bottom: var(--space-5);
    border-bottom: 0;
  }
`

const GoalsLabel = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

const AfterLabel = styled(GoalsLabel)`
  margin-top: var(--space-3);
`

const AimLine = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
`

const AimBasis = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** The same three columns in every goal, so their numbers line up from one goal to the next. */
const Facts = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: 200px 200px minmax(0, 1fr);
  gap: var(--space-1) var(--space-4);
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;

  @container coach (width < 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Fact = styled.span<{ $tone?: Tone }>`
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);

  & > strong {
    color: ${props => (props.$tone ? toneColor(props.$tone) : 'var(--theme-on-surface)')};
    font-weight: 600;
  }
`

const CheckDots = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  cursor: help;
`

/** One of the latest games: reached the target or missed it. */
const CheckDot = styled.span<{ $hit: boolean }>`
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background-color: ${props => (props.$hit ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

/** The game that missed a goal by the most, and a way to watch that moment, under it. */
const Review = styled.div`
  ${bodyMedium};
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--theme-on-surface-variant);
`

const WatchButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  margin-left: calc(-1 * var(--space-2));
  padding: 0 var(--space-3) 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  border-radius: var(--radius-full);
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: var(--theme-container-highest);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** Shows or hides a later goal's replay moment and tip. */
const DetailsButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  margin-left: auto;
  padding: 0 var(--space-1) 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  border-radius: var(--radius-sm);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Tip = styled.p`
  ${bodyMedium};
  margin: 0;
  padding: var(--space-3) var(--space-4);

  border-left: 3px solid var(--theme-outline);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--theme-container-high);
  color: var(--theme-on-surface);
`

/** The notes side by side, as many across as fit. */
const Notes = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;

  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4) var(--space-6);
`

const NoteRow = styled.li`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--space-3);
`

const NoteIcon = styled(MaterialIcon)<{ $tone?: Tone }>`
  margin-top: 1px;
  color: ${props => toneColor(props.$tone)};
`

const NoteBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const NoteTitle = styled.span`
  ${labelLarge};
  font-weight: 600;
`

function getWinRate(wins: number, losses: number) {
  return wins + losses ? wins / (wins + losses) : undefined
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
      return goal.unit === 'time'
        ? t('myStats.coach.basisOthersTime', 'when most {{race}} players start it', {
            race: raceCharToLabel(bucket.race, t),
          })
        : t('myStats.coach.basisOthers', 'what most {{race}} players reach', {
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

/** How far before a moment a replay opens, so what led up to it can be seen. */
const WATCH_LEAD_MS = 20_000

/** A short date for one of the user's games, like "Oct 4". */
function formatGameDate(gameTimeMs: number) {
  return new Date(gameTimeMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** What happened in the game that missed a goal by the most, in a sentence. */
function getReviewText(
  review: CoachReview,
  goal: CoachGoal,
  bucket: CoachBucket,
  formatValue: ReturnType<typeof useFormatValue>,
  t: TFunction,
) {
  const values = {
    date: formatGameDate(review.game.gameTimeMs),
    map: review.game.mapName,
    start: formatGameTime(review.atMs),
    end: formatGameTime(review.endMs ?? review.atMs),
    amount: review.amount ?? 0,
    value: review.amount !== undefined ? formatValue(review.amount, goal.unit) : '-',
    workers: getRaceWords(bucket.race, t).workers,
  }
  switch (review.kind) {
    case 'supplyBlock':
      return t(
        'myStats.coach.review.supplyBlock',
        'Worst lately: {{date}} on {{map}}, supply blocked from {{start}} to {{end}}.',
        values,
      )
    case 'bankPeak':
      return t(
        'myStats.coach.review.bankPeak',
        'Worst lately: {{date}} on {{map}}, {{amount}} banked at {{start}}.',
        values,
      )
    case 'workerLoss':
      return t(
        'myStats.coach.review.workerLoss',
        'Worst lately: {{date}} on {{map}}, {{amount}} {{workers}} lost from {{start}} to {{end}}.',
        values,
      )
    case 'timing':
      return t(
        'myStats.coach.review.timing',
        'Worst lately: {{date}} on {{map}}, started at {{value}}.',
        values,
      )
    case 'minute':
      return t(
        'myStats.coach.review.minute',
        'Worst lately: {{date}} on {{map}}, {{value}} at {{start}}.',
        values,
      )
    default:
      return review.kind satisfies never
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
  compact = false,
}: {
  goal: CoachGoal
  index: number
  bucket: CoachBucket
  /** A later goal: its replay moment and tip stay hidden until asked for. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const formatValue = useFormatValue()
  const [open, setOpen] = useState(!compact)
  const [label, help] = getGoalText(goal, t)
  const { target, review } = goal
  const watchFromMs = review ? Math.max(0, review.atMs - WATCH_LEAD_MS) : 0
  const checkWord = (hit: boolean) =>
    hit ? t('myStats.coach.hit', 'Reached') : t('myStats.coach.missed', 'Not reached')
  const checksHelp = [
    t(
      'myStats.coach.checksHelpGames',
      'Your latest games with this number, oldest first: {{games}}.',
      {
        games: goal.checks.map(checkWord).join(', ').toLowerCase(),
      },
    ),
    isTeamGame(bucket.shape)
      ? t(
          'myStats.coach.checksHelpTeam',
          "A team game where someone left before this point doesn't have it, so it's skipped.",
        )
      : '',
  ].join(' ')

  return (
    <GoalRow>
      <GoalNumber aria-hidden={true}>{index + 1}</GoalNumber>
      <GoalBody>
        <GoalTop>
          <HelpLabel label={label} help={help} />
          {goal.inLosses && goal.basis === 'others' ? (
            <Tag>{t('myStats.coach.alsoCostsGames', 'Also costs you games')}</Tag>
          ) : null}
          {compact ? (
            <DetailsButton type='button' aria-expanded={open} onClick={() => setOpen(!open)}>
              {open
                ? t('myStats.coach.hideDetails', 'Hide details')
                : t('myStats.coach.showDetails', 'Details')}
              <MaterialIcon icon={open ? 'expand_less' : 'expand_more'} size={18} />
            </DetailsButton>
          ) : null}
        </GoalTop>
        <AimLine>
          <Aim $small={compact}>{getAimText(goal, formatValue(target, goal.unit), t)}</Aim>
          <AimBasis>{getBasisText(goal, bucket, t)}</AimBasis>
        </AimLine>
        <Facts>
          <Fact>
            {goal.basis === 'wins'
              ? t('myStats.coach.factLosses', 'In your losses')
              : t('myStats.coach.factUsually', 'You usually')}
            <strong>{formatValue(goal.userValue, goal.unit)}</strong>
          </Fact>
          <Fact>
            {goal.checks.length ? (
              <>
                {t('myStats.coach.factChecks', 'Last {{count}} games', {
                  count: goal.checks.length,
                })}
                <CheckDots role='img' aria-label={checksHelp} title={checksHelp}>
                  {goal.checks.map((hit, i) => (
                    <CheckDot key={i} $hit={hit} />
                  ))}
                </CheckDots>
              </>
            ) : null}
          </Fact>
          <Fact>
            {goal.beats !== undefined ? (
              <>
                {t('myStats.coach.factBeats', 'Better than')}
                <strong>{formatPercent(goal.beats)}</strong>
                {t('myStats.coach.factBeatsOf', 'of {{race}} players', {
                  race: raceCharToLabel(bucket.race, t),
                })}
              </>
            ) : null}
          </Fact>
        </Facts>
        {open && review ? (
          <Review>
            <span>{getReviewText(review, goal, bucket, formatValue, t)}</span>
            <WatchButton
              type='button'
              onClick={() => dispatch(watchGameAt(review.game.gameId, watchFromMs))}>
              <MaterialIcon icon='play_arrow' size={18} />
              {t('myStats.coach.watchFrom', 'Watch from {{time}}', {
                time: formatGameTime(watchFromMs),
              })}
            </WatchButton>
          </Review>
        ) : null}
        {open ? (
          <Tip>
            {goal.key === 'buildTiming'
              ? getTimingTip(getBuildName(goal.buildKey ?? '', t), formatGameTime(target), t)
              : getTip(goal.key, getTipContext(bucket), t, goal.basis)}
          </Tip>
        ) : null}
      </GoalBody>
    </GoalRow>
  )
}

/**
 * A few things to aim for, from the games the coach is looking at: the first one to play the next
 * game around, then the rest, each with a target, how the latest games did, and a tip.
 */
export function NextGame({ bucket, allGames }: { bucket: CoachBucket; allGames: boolean }) {
  const { t } = useTranslation()
  return (
    <PaddedPanel>
      <PanelHeader>
        <PanelTitle>{t('myStats.coach.goals', 'Your goals')}</PanelTitle>
        <CheckSummary>
          {allGames
            ? t('myStats.coach.goalsFromAll', 'From all {{count}} of your games.', {
                count: bucket.userGames,
              })
            : t('myStats.coach.goalsFrom', 'From your last {{count}} games.', {
                count: bucket.userGames,
              })}
        </CheckSummary>
      </PanelHeader>
      {bucket.goals.length ? (
        <>
          <Focus>
            <GoalsLabel>
              {t('myStats.coach.focusLabel', 'Play your next game around this')}
            </GoalsLabel>
            <Goals>
              <GoalItem goal={bucket.goals[0]} index={0} bucket={bucket} />
            </Goals>
          </Focus>
          {bucket.goals.length > 1 ? (
            <>
              <AfterLabel>{t('myStats.coach.afterThat', 'After that')}</AfterLabel>
              <Goals>
                {bucket.goals.slice(1).map((goal, i) => (
                  <GoalItem
                    key={goal.buildKey ?? goal.key}
                    goal={goal}
                    index={i + 1}
                    bucket={bucket}
                    compact={true}
                  />
                ))}
              </Goals>
            </>
          ) : null}
        </>
      ) : (
        <Text>
          {t(
            'myStats.coach.noGoalsNow',
            'No goals right now. You play your wins and losses alike, and keep up with other players on the basics. The tables below show where you are closest to slipping.',
          )}
        </Text>
      )}
    </PaddedPanel>
  )
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
    earlierCount: form.earlierGames,
  }
  if (earlierRate !== undefined && rate - earlierRate >= 0.1) {
    return {
      icon: 'trending_up',
      tone: 'good',
      title:
        rate > 0.5
          ? t('myStats.coach.note.formUpTitle', "You're on a good run")
          : t('myStats.coach.note.formBetterTitle', 'Winning more lately'),
      body: t(
        'myStats.coach.note.formUpBefore',
        '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, against {{earlierRate}} in the {{earlierCount}} before. Whatever changed, keep doing it.',
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
        'myStats.coach.note.formDownBefore',
        '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, against {{earlierRate}} in the {{earlierCount}} before. Pick one goal and play a few games with only that in mind.',
        values,
      ),
    }
  }
  return {
    icon: 'trending_flat',
    title: t('myStats.coach.note.formSteadyTitle', 'Steady results'),
    body: t(
      'myStats.coach.note.formSteadyBefore',
      '{{wins}} wins and {{losses}} losses in your last {{count}}, {{rate}}, about the same as the {{earlierRate}} in the {{earlierCount}} before. To move up, work on your goals.',
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
        title: t('myStats.coach.note.lossesWrongTitle', 'Where losses go wrong'),
        body: isTeamGame(bucket.shape)
          ? t(
              'myStats.coach.note.inLossesTeamShort',
              '{{metric}}: {{win}} in your wins, {{loss}} in your losses. In team games, check if you were the one they attacked.',
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
          'myStats.coach.note.strengthUse',
          '{{metric}}: {{you}} against {{them}}, better than {{percent}} of {{race}} players here. Plan your game around it: that is your window to attack.',
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

/**
 * What a coach would say about how the user's games are going, in a few short notes side by side.
 * A note about a number that's already a goal is left out, since the goal says it, and so is the
 * note about a strength while the user's strengths are listed below.
 */
export function CoachNotes({
  bucket,
  hideStrength,
}: {
  bucket: CoachBucket
  hideStrength: boolean
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  const goalKeys = new Set(bucket.goals.map(goal => goal.buildKey ?? goal.key))
  const notes = bucket.notes.filter(note => {
    switch (note.kind) {
      case 'strength':
        return !hideStrength
      case 'inLosses':
        return !goalKeys.has(note.finding.key)
      case 'slipping':
      case 'improving':
        return !goalKeys.has(note.change.key)
      case 'timing':
        return !goalKeys.has(note.timing.buildKey)
      default:
        return true
    }
  })
  return (
    <PaddedPanel>
      <PanelTitle>{t('myStats.coach.trendsTitle', 'Your trends')}</PanelTitle>
      {notes.length ? (
        <Notes>
          {notes.map(note => {
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
