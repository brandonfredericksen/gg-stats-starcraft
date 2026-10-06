import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  CoachBucket,
  CoachGoal,
  CoachNote,
  CoachRecentForm,
  RECENT_FORM_GAMES,
} from '../../common/my-stats/coach'
import { isTeamGame } from '../../common/my-stats/player-games'
import { raceCharToLabel } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'

import { formatPercent, HelpLabel, PaddedPanel, PanelTitle } from '../my-stats/my-stats-panels'

import { bodyMedium, labelLarge, labelMedium, titleLarge, titleSmall } from '../styles/typography'
import {
  formatGameTime,
  formatTimeDiff,
  getBuildName,
  getMetricText,
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

const CheckDots = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
`

/** One of the latest games: reached the target, missed it, or didn't have the number. */
const CheckDot = styled.span<{ $hit: boolean | null }>`
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background-color: ${props => {
    if (props.$hit === null) {
      return 'transparent'
    }
    return props.$hit ? 'var(--theme-positive)' : 'var(--theme-negative)'
  }};
  box-shadow: ${props => (props.$hit === null ? 'inset 0 0 0 1.5px var(--theme-outline)' : 'none')};
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
  const checkWord = (hit: boolean | null) => {
    if (hit === null) {
      return t('myStats.coach.checkNone', "Didn't have it")
    }
    return hit ? t('myStats.coach.hit', 'Reached') : t('myStats.coach.missed', 'Not reached')
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
          {goal.checks.length ? (
            <Fact>
              {t('myStats.coach.factChecks', 'Last {{count}} games', {
                count: goal.checks.length,
              })}
              <CheckDots
                role='img'
                aria-label={goal.checks.map(checkWord).join(', ')}
                title={t('myStats.coach.checksHelp', 'Oldest to newest: {{games}}', {
                  games: goal.checks.map(checkWord).join(', ').toLowerCase(),
                })}>
                {goal.checks.map((hit, i) => (
                  <CheckDot key={i} $hit={hit} />
                ))}
              </CheckDots>
            </Fact>
          ) : null}
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

/**
 * A few things to aim for, from the games the coach is looking at, each with a target, a tip, and
 * how the latest games did.
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
