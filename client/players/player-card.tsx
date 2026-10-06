import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { isMyPlayerName } from '../../common/games/player-names'
import { RaceChar } from '../../common/races'
import { KnownPlayer } from '../../common/settings/local-settings'
import { useMyPlayerNames } from '../games/my-player-names'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { RaceTag } from '../material/race-tag'
import { SkeletonText } from '../material/skeleton'
import { useAppDispatch } from '../redux-hooks'
import {
  bahnschrift,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { getPlayerForAccount, savePlayer, useKnownPlayers } from './known-players'
import { loadPlayerRecord, PlayerRecord, Tally } from './player-record'

/** A player's name that opens their card, wherever it appears. */
const NameButton = styled.button`
  ${buttonReset};
  ${singleLine};
  min-width: 0;
  max-width: 100%;
  padding: 0;

  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
    text-decoration-color: rgb(from currentColor r g b / 0.5);
    text-underline-offset: 3px;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
    border-radius: 4px;
  }
`

/**
 * Wraps a player's name so clicking it opens their card: their note, every account they play
 * under, and the user's record against and with them. Clicking it again, or anywhere else, closes
 * the card. The click is marked with `preventDefault` so anything around the name, like a library
 * row that would open the game, can ignore it. It has to keep propagating: open cards close on
 * clicks that reach the document.
 */
export function PlayerNameButton({
  name,
  race,
  children,
  className,
}: {
  name: string
  race?: RaceChar
  children: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })
  return (
    <>
      <NameButton
        ref={anchor}
        type='button'
        className={className}
        title={t('players.openCard', 'About {{name}}', { name })}
        onClick={event => {
          event.preventDefault()
          // An open card closes on this click as it reaches the document.
          if (!open) {
            openPopover(event)
          }
        }}
        onKeyDown={event => event.stopPropagation()}>
        {children}
      </NameButton>
      <Popover
        open={open}
        onDismiss={closePopover}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) + 4}
        originX='left'
        originY='top'>
        <PlayerCard account={name} race={race} />
      </Popover>
    </>
  )
}

const Card = styled.div`
  width: 340px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const CardHeader = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

const CardName = styled.div`
  ${titleSmall};
  ${singleLine};
  font-size: 16px;
  font-weight: 700;
`

const Muted = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const FieldLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

const Records = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`

const RecordBox = styled.div`
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background: var(--theme-container-low);
`

const RecordValue = styled.span`
  ${bahnschrift};
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Chip = styled.span`
  ${labelLarge};
  height: 28px;
  padding: 0 4px 0 10px;

  display: inline-flex;
  align-items: center;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-full);
  font-weight: 600;
`

const ChipRemove = styled.button`
  ${buttonReset};
  width: 22px;
  height: 22px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    background: rgb(from var(--theme-on-surface) r g b / 0.08);
    color: var(--theme-on-surface);
  }
`

const AddRow = styled.form`
  display: flex;
  gap: 6px;
`

const fieldStyle = `
  min-width: 0;
  padding: 0 10px;

  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-md);
  background: var(--theme-container-low);
  color: var(--theme-on-surface);
  font: inherit;

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const TextInput = styled.input`
  ${bodyMedium};
  ${fieldStyle};
  flex: 1 1 auto;
  height: 32px;
`

const NoteInput = styled.textarea`
  ${bodyMedium};
  ${fieldStyle};
  min-height: 72px;
  padding: 8px 10px;
  resize: vertical;
`

const AddButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 12px;

  border-radius: var(--radius-md);
  color: var(--theme-on-surface);
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`

function formatTally(tally: Tally) {
  return `${tally.wins}–${tally.losses}`
}

/**
 * The user's record against and with a player. Until it's counted, the same boxes show with
 * placeholders for the numbers, so the card keeps its size when they arrive.
 */
function RecordSummary({
  record,
  t,
}: {
  record: PlayerRecord | undefined
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <>
      <Records>
        <RecordBox>
          <RecordValue>
            {record ? formatTally(record.against) : <SkeletonText $width='56px' />}
          </RecordValue>
          <Muted>{t('players.against', 'Against them')}</Muted>
        </RecordBox>
        <RecordBox>
          <RecordValue>
            {record ? formatTally(record.with) : <SkeletonText $width='56px' />}
          </RecordValue>
          <Muted>{t('players.with', 'On your team')}</Muted>
        </RecordBox>
      </Records>
      <Muted>
        {record ? <GamesTogether record={record} t={t} /> : <SkeletonText $width='120px' />}
      </Muted>
    </>
  )
}

function GamesTogether({
  record,
  t,
}: {
  record: PlayerRecord
  t: ReturnType<typeof useTranslation>['t']
}) {
  const games =
    record.against.wins +
    record.against.losses +
    record.against.unknown +
    record.with.wins +
    record.with.losses +
    record.with.unknown
  const unknown = record.against.unknown + record.with.unknown
  if (!games) {
    return <>{t('players.noGamesTogether', "You haven't played with or against them.")}</>
  }
  return (
    <>
      {unknown
        ? t('players.gamesTogetherSomeUnknown', {
            defaultValue_one: '{{count}} game together, {{unknown}} without a result yet',
            defaultValue_other: '{{count}} games together, {{unknown}} without a result yet',
            count: games,
            unknown,
          })
        : t('players.gamesTogether', {
            defaultValue_one: '{{count}} game together',
            defaultValue_other: '{{count}} games together',
            count: games,
          })}
    </>
  )
}

/** Everything about one player: their note, their accounts, and the user's record with them. */
export function PlayerCard({ account, race }: { account: string; race?: RaceChar }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const knownPlayers = useKnownPlayers()
  const myNames = useMyPlayerNames()
  const isMe = isMyPlayerName(account, myNames)
  const [player, setPlayer] = useState<KnownPlayer>(() =>
    getPlayerForAccount(knownPlayers, account),
  )
  const [note, setNote] = useState(player.note ?? '')
  const [newAccount, setNewAccount] = useState('')
  const [record, setRecord] = useState<PlayerRecord>()

  const accountsKey = player.accounts.join('\n')
  const namesKey = myNames?.join('\n') ?? ''
  useEffect(() => {
    if (isMe || !namesKey) {
      return undefined
    }
    let cancelled = false
    loadPlayerRecord(accountsKey.split('\n'), namesKey.split('\n'))
      .then(loaded => {
        if (!cancelled) {
          setRecord(loaded)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accountsKey, namesKey, isMe])

  const save = (next: KnownPlayer) => {
    setPlayer(next)
    dispatch(savePlayer(next))
  }

  if (isMe) {
    return (
      <Card>
        <CardHeader>
          {race ? <RaceTag race={race} /> : null}
          <CardName>{account}</CardName>
        </CardHeader>
        <Muted>{t('players.thisIsYou', 'This is one of your names.')}</Muted>
      </Card>
    )
  }

  const addAccount = () => {
    const name = newAccount.trim()
    if (name && !player.accounts.some(a => a.toLowerCase() === name.toLowerCase())) {
      save({ ...player, accounts: [...player.accounts, name] })
    }
    setNewAccount('')
  }

  let recordContent: React.ReactNode
  if (!myNames?.length) {
    recordContent = (
      <Muted>
        {t(
          'players.recordNeedsNames',
          'Add your own names in Settings to see your record with them.',
        )}
      </Muted>
    )
  } else {
    recordContent = <RecordSummary record={record} t={t} />
  }

  return (
    <Card>
      <CardHeader>
        {race ? <RaceTag race={race} /> : null}
        <CardName>{player.name}</CardName>
      </CardHeader>

      <Field>{recordContent}</Field>

      <Field>
        <FieldLabel>{t('players.accounts', 'Accounts')}</FieldLabel>
        <Chips>
          {player.accounts.map(name => (
            <Chip key={name}>
              {name}
              {player.accounts.length > 1 ? (
                <ChipRemove
                  type='button'
                  aria-label={t('players.removeAccount', 'Remove {{name}}', { name })}
                  onClick={() =>
                    save({ ...player, accounts: player.accounts.filter(a => a !== name) })
                  }>
                  <MaterialIcon icon='close' size={16} />
                </ChipRemove>
              ) : (
                <span style={{ width: 6 }} />
              )}
            </Chip>
          ))}
        </Chips>
        <AddRow
          onSubmit={event => {
            event.preventDefault()
            addAccount()
          }}>
          <TextInput
            value={newAccount}
            placeholder={t('players.addAccountPlaceholder', 'Another name they play as')}
            aria-label={t('players.addAccount', 'Add an account')}
            onChange={event => setNewAccount(event.target.value)}
          />
          <AddButton type='submit' disabled={!newAccount.trim()}>
            {t('players.add', 'Add')}
          </AddButton>
        </AddRow>
      </Field>

      <Field>
        <FieldLabel>{t('players.note', 'Note')}</FieldLabel>
        <NoteInput
          value={note}
          placeholder={t('players.notePlaceholder', 'Anything to remember about them')}
          aria-label={t('players.note', 'Note')}
          // Saved as it's typed, so closing the card any way at all keeps it.
          onChange={event => {
            setNote(event.target.value)
            save({ ...player, note: event.target.value })
          }}
        />
      </Field>
    </Card>
  )
}
