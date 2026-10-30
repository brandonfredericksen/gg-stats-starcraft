import type { CommandData } from '@shieldbattery/broodrep'
import { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { HOTKEY_ADD, HOTKEY_ASSIGN, SPELL_ORDERS } from '../../common/games/command-stats'
import { FairPlayFlags, getFairPlayFlags } from '../../common/games/fair-play'
import { getGameDurationString } from '../../common/games/game-duration'
import { FASTEST_MS_PER_FRAME, GamePlayerStats, HiddenTarget } from '../../common/games/game-stats'
import { ReplayAction, ReplayActions } from '../../common/games/replay-actions'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { buttonReset } from '../material/button-reset'
import { useAppDispatch } from '../redux-hooks'
import { watchGameAt } from '../replays/action-creators'
import { bodyMedium, labelLarge, labelMedium, labelSmall, singleLine } from '../styles/typography'
import { ReplayCommandsRead } from './game-stats-other'
import {
  LegendButton,
  Picker,
  PickerButton,
  PlayerSwatch,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
} from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

/** How far before an action a replay opens, so what led up to it can be seen. */
const WATCH_LEAD_MS = 5_000
const ROW_HEIGHT = 36

/** BW's order ids for the orders players give most, which the rest are named after. */
const ORDER_MOVE = 0x06
const ORDER_ATTACK_UNIT = 0x0a
const ORDER_ATTACK_MOVE = 0x0e
const ORDER_PATROL = 0x98

/** BW's unit type for no unit, which a click on the ground names. */
const NO_UNIT = 228

type ActionGroup = 'all' | 'selection' | 'hotkey' | 'order' | 'production' | 'other'

const GROUPS: ReadonlyArray<Exclude<ActionGroup, 'all'>> = [
  'selection',
  'hotkey',
  'order',
  'production',
  'other',
]

function groupOf(command: CommandData): Exclude<ActionGroup, 'all'> {
  switch (command.type) {
    case 'select':
    case 'selectAdd':
    case 'selectRemove':
      return 'selection'
    case 'hotkey':
      return 'hotkey'
    case 'rightClick':
    case 'targetedOrder':
    case 'stop':
    case 'holdPosition':
    case 'burrow':
    case 'unburrow':
    case 'cloak':
    case 'decloak':
    case 'siege':
    case 'unsiege':
    case 'returnCargo':
    case 'unloadAll':
    case 'unload':
    case 'stim':
    case 'carrierStop':
    case 'reaverStop':
    case 'liftOff':
    case 'mergeArchon':
    case 'mergeDarkArchon':
      return 'order'
    case 'build':
    case 'train':
    case 'trainFighter':
    case 'unitMorph':
    case 'buildingMorph':
    case 'tech':
    case 'upgrade':
    case 'cancelBuild':
    case 'cancelTrain':
    case 'cancelMorph':
    case 'cancelAddon':
    case 'cancelTech':
    case 'cancelUpgrade':
      return 'production'
    default:
      return 'other'
  }
}

function groupLabel(group: ActionGroup, t: TFunction) {
  switch (group) {
    case 'all':
      return t('gameStats.actions.all', 'All')
    case 'selection':
      return t('gameStats.actions.selections', 'Selections')
    case 'hotkey':
      return t('gameStats.actions.hotkeys', 'Hotkeys')
    case 'order':
      return t('gameStats.actions.orders', 'Orders')
    case 'production':
      return t('gameStats.actions.production', 'Production')
    case 'other':
      return t('gameStats.actions.other', 'Other')
  }
  return group
}

function spellName(key: string, t: TFunction) {
  switch (key) {
    case 'yamatoGun':
      return t('gameStats.actions.spell.yamatoGun', 'Yamato Gun')
    case 'lockdown':
      return t('gameStats.actions.spell.lockdown', 'Lockdown')
    case 'darkSwarm':
      return t('gameStats.actions.spell.darkSwarm', 'Dark Swarm')
    case 'parasite':
      return t('gameStats.actions.spell.parasite', 'Parasite')
    case 'spawnBroodlings':
      return t('gameStats.actions.spell.spawnBroodlings', 'Spawn Broodlings')
    case 'empShockwave':
      return t('gameStats.actions.spell.empShockwave', 'EMP Shockwave')
    case 'recall':
      return t('gameStats.actions.spell.recall', 'Recall')
    case 'scannerSweep':
      return t('gameStats.actions.spell.scannerSweep', 'Scanner Sweep')
    case 'defensiveMatrix':
      return t('gameStats.actions.spell.defensiveMatrix', 'Defensive Matrix')
    case 'psionicStorm':
      return t('gameStats.actions.spell.psionicStorm', 'Psionic Storm')
    case 'irradiate':
      return t('gameStats.actions.spell.irradiate', 'Irradiate')
    case 'plague':
      return t('gameStats.actions.spell.plague', 'Plague')
    case 'consume':
      return t('gameStats.actions.spell.consume', 'Consume')
    case 'ensnare':
      return t('gameStats.actions.spell.ensnare', 'Ensnare')
    case 'stasisField':
      return t('gameStats.actions.spell.stasisField', 'Stasis Field')
    case 'hallucination':
      return t('gameStats.actions.spell.hallucination', 'Hallucination')
    case 'restoration':
      return t('gameStats.actions.spell.restoration', 'Restoration')
    case 'disruptionWeb':
      return t('gameStats.actions.spell.disruptionWeb', 'Disruption Web')
    case 'mindControl':
      return t('gameStats.actions.spell.mindControl', 'Mind Control')
    case 'feedback':
      return t('gameStats.actions.spell.feedback', 'Feedback')
    case 'opticalFlare':
      return t('gameStats.actions.spell.opticalFlare', 'Optical Flare')
    case 'maelstrom':
      return t('gameStats.actions.spell.maelstrom', 'Maelstrom')
  }
  return key
}

function orderName(order: number, t: TFunction) {
  const spell = SPELL_ORDERS.get(order)
  if (spell) {
    return spellName(spell, t)
  }
  switch (order) {
    case ORDER_MOVE:
      return t('gameStats.actions.move', 'Move')
    case ORDER_ATTACK_UNIT:
      return t('gameStats.actions.attack', 'Attack')
    case ORDER_ATTACK_MOVE:
      return t('gameStats.actions.attackMove', 'Attack move')
    case ORDER_PATROL:
      return t('gameStats.actions.patrol', 'Patrol')
    default:
      return t('gameStats.actions.order', 'Order {{order}}', { order })
  }
}

/** What an action did, in a few words. */
function describeAction(command: CommandData, t: TFunction): string {
  const unit = (unitId: number) => getUnitTypeInfo(unitId, t).name
  const target = (unitType: number, tag: number) =>
    tag && unitType < NO_UNIT ? unit(unitType) : t('gameStats.actions.ground', 'the ground')
  switch (command.type) {
    case 'select':
      return t('gameStats.actions.select', {
        defaultValue: 'Select {{count}} units',
        defaultValue_one: 'Select {{count}} unit',
        count: command.unitTags.length,
      })
    case 'selectAdd':
      return t('gameStats.actions.selectAdd', {
        defaultValue: 'Add {{count}} units to the selection',
        defaultValue_one: 'Add {{count}} unit to the selection',
        count: command.unitTags.length,
      })
    case 'selectRemove':
      return t('gameStats.actions.selectRemove', {
        defaultValue: 'Remove {{count}} units from the selection',
        defaultValue_one: 'Remove {{count}} unit from the selection',
        count: command.unitTags.length,
      })
    case 'hotkey':
      if (command.hotkeyType === HOTKEY_ASSIGN) {
        return t('gameStats.actions.hotkeyAssign', 'Assign group {{group}}', {
          group: command.group,
        })
      }
      if (command.hotkeyType === HOTKEY_ADD) {
        return t('gameStats.actions.hotkeyAdd', 'Add to group {{group}}', { group: command.group })
      }
      return t('gameStats.actions.hotkeyRecall', 'Select group {{group}}', {
        group: command.group,
      })
    case 'rightClick':
      return t('gameStats.actions.rightClick', 'Right click {{target}}', {
        target: target(command.targetUnitType, command.targetUnitTag),
      })
    case 'targetedOrder':
      return t('gameStats.actions.targetedOrder', '{{order}} {{target}}', {
        order: orderName(command.order, t),
        target: target(command.targetUnitType, command.targetUnitTag),
      })
    case 'build':
      return t('gameStats.actions.build', 'Build {{unit}}', { unit: unit(command.unitType) })
    case 'train':
      return t('gameStats.actions.train', 'Train {{unit}}', { unit: unit(command.unitType) })
    case 'unitMorph':
    case 'buildingMorph':
      return t('gameStats.actions.morph', 'Morph into {{unit}}', { unit: unit(command.unitType) })
    case 'tech':
      return t('gameStats.actions.tech', 'Research {{name}}', {
        name: getTechName(command.techId, t),
      })
    case 'upgrade':
      return t('gameStats.actions.upgrade', 'Upgrade {{name}}', {
        name: getUpgradeName(command.upgradeId, t),
      })
    case 'trainFighter':
      return t('gameStats.actions.trainFighter', 'Build ammo')
    case 'cancelBuild':
    case 'cancelTrain':
    case 'cancelMorph':
    case 'cancelAddon':
    case 'cancelTech':
    case 'cancelUpgrade':
    case 'cancelNuke':
      return t('gameStats.actions.cancel', 'Cancel')
    case 'stop':
      return t('gameStats.actions.stop', 'Stop')
    case 'holdPosition':
      return t('gameStats.actions.hold', 'Hold position')
    case 'burrow':
      return t('gameStats.actions.burrow', 'Burrow')
    case 'unburrow':
      return t('gameStats.actions.unburrow', 'Unburrow')
    case 'cloak':
      return t('gameStats.actions.cloak', 'Cloak')
    case 'decloak':
      return t('gameStats.actions.decloak', 'Decloak')
    case 'siege':
      return t('gameStats.actions.siege', 'Siege')
    case 'unsiege':
      return t('gameStats.actions.unsiege', 'Unsiege')
    case 'returnCargo':
      return t('gameStats.actions.returnCargo', 'Return cargo')
    case 'unloadAll':
    case 'unload':
      return t('gameStats.actions.unload', 'Unload')
    case 'stim':
      return t('gameStats.actions.stim', 'Stim')
    case 'liftOff':
      return t('gameStats.actions.liftOff', 'Lift off')
    case 'mergeArchon':
      return t('gameStats.actions.mergeArchon', 'Merge Archon')
    case 'mergeDarkArchon':
      return t('gameStats.actions.mergeDarkArchon', 'Merge Dark Archon')
    case 'carrierStop':
    case 'reaverStop':
      return t('gameStats.actions.stop', 'Stop')
    case 'minimapPing':
      return t('gameStats.actions.ping', 'Minimap ping')
    case 'chat':
      return t('gameStats.actions.chat', 'Chat: {{message}}', {
        message: filterColorCodes(command.message).trim(),
      })
    case 'leaveGame':
      return t('gameStats.actions.leave', 'Leave the game')
    case 'vision':
      return t('gameStats.actions.vision', 'Share vision')
    case 'alliance':
      return t('gameStats.actions.alliance', 'Change alliances')
    case 'pause':
      return t('gameStats.actions.pause', 'Pause')
    case 'resume':
      return t('gameStats.actions.resume', 'Resume')
    case 'gameSpeed':
      return t('gameStats.actions.gameSpeed', 'Change game speed')
    case 'cheat':
      return t('gameStats.actions.cheat', 'Cheat code')
    case 'known':
    case 'unknown':
      return t('gameStats.actions.unknown', 'Unknown command {{id}}', {
        id: `0x${command.typeId.toString(16).padStart(2, '0')}`,
      })
    default:
      return command.type
  }
}

type LabelKind = 'hidden' | 'macroCycle' | 'burst'

/** A label on an action: a hack the game's analysis proved, or something only suspicious. */
interface RowLabel {
  kind: LabelKind
  hack: boolean
}

interface ActionRow {
  index: number
  action: ReplayAction
  player?: GamePlayerStats
  labels: RowLabel[]
  hidden?: HiddenTarget
}

function labelText(label: RowLabel, hidden: HiddenTarget | undefined, t: TFunction) {
  switch (label.kind) {
    case 'hidden': {
      const unit = hidden ? getUnitTypeInfo(hidden.unitId, t).name : ''
      return hidden?.hiddenBy === 'cloak'
        ? t('gameStats.actions.label.cloaked', 'Cloaked {{unit}}', { unit })
        : t('gameStats.actions.label.inFog', '{{unit}} in fog', { unit })
    }
    case 'macroCycle':
      return t('gameStats.actions.label.macroCycle', 'Made and switched back')
    case 'burst':
      return t('gameStats.actions.label.burst', 'Burst')
  }
  return label.kind
}

/**
 * Builds the rows: every action, with the labels that say what's off about it. A label is a hack
 * when the player's numbers over the game say a program played for them, and only suspicious when
 * it's a one off, like a unit stepping out of sight as a command waited on high latency.
 */
function toRows(
  read: ReplayActions,
  players: ReadonlyArray<GamePlayerStats>,
  flagsOf: (player: GamePlayerStats) => FairPlayFlags,
): ActionRow[] {
  const byNetworkId = new Map<number, GamePlayerStats>()
  for (const replayPlayer of read.players) {
    const name = replayPlayer.name.toLowerCase()
    const player = players.find(p => p.names.some(n => n.toLowerCase() === name))
    if (player) {
      byNetworkId.set(replayPlayer.networkId, player)
    }
  }
  const hiddenAt = new Map<string, HiddenTarget>()
  for (const [networkId, player] of byNetworkId) {
    for (const target of player.hiddenTargets?.targets ?? []) {
      const frame = Math.round(target.timeMs / FASTEST_MS_PER_FRAME)
      hiddenAt.set(`${networkId}:${frame}:${target.kind}`, target)
    }
  }
  const findHidden = (action: ReplayAction) => {
    let kind: HiddenTarget['kind']
    if (action.command.type === 'select') {
      kind = 'select'
    } else if (action.command.type === 'rightClick' || action.command.type === 'targetedOrder') {
      kind = 'order'
    } else {
      return undefined
    }
    // The game counts frames from the one a command ran on, which can be a frame off from the one
    // the replay recorded it on.
    for (const frame of [action.frame, action.frame + 1, action.frame - 1]) {
      const found = hiddenAt.get(`${action.playerId}:${frame}:${kind}`)
      if (found) {
        return found
      }
    }
    return undefined
  }
  const flags = new Map(Array.from(byNetworkId, ([id, p]) => [id, flagsOf(p)]))

  return read.actions.map((action, index) => {
    const player = byNetworkId.get(action.playerId)
    const playerFlags = flags.get(action.playerId)
    const labels: RowLabel[] = []
    const hidden = findHidden(action)
    if (hidden) {
      labels.push({ kind: 'hidden', hack: !!playerFlags?.mapHack })
    }
    if (action.labels?.includes('macroCycle')) {
      labels.push({ kind: 'macroCycle', hack: !!playerFlags?.macroProgram })
    }
    // A person's bursts are too common to point out one by one, so they're only labeled for a
    // player a program played for.
    if (action.labels?.includes('burst') && playerFlags?.bot) {
      labels.push({ kind: 'burst', hack: true })
    }
    return { index, action, player, labels, hidden }
  })
}

const rowColumns = css`
  display: grid;
  grid-template-columns: 52px minmax(120px, 170px) minmax(0, 1fr) minmax(0, 200px) 92px;
  column-gap: var(--space-3);
  align-items: center;
`

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
`

const Players = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

const Header = styled.div`
  ${labelMedium};
  ${rowColumns};
  padding: 12px 18px;
  background: var(--theme-container);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

const Row = styled.div<{ $selected: boolean }>`
  ${bodyMedium};
  ${rowColumns};
  height: ${ROW_HEIGHT}px;
  padding: 0 18px;
  border-top: 1px solid var(--theme-outline-variant);
  background: ${props =>
    props.$selected ? 'rgb(from var(--theme-amber) r g b / 0.14)' : 'transparent'};
`

const Time = styled.span`
  font-variant-numeric: tabular-nums;
  color: var(--theme-on-surface-variant);
`

const Cell = styled.span`
  ${singleLine};
  min-width: 0;
`

const PlayerCell = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const Labels = styled.span`
  min-width: 0;
  display: flex;
  gap: var(--space-1);
  overflow: hidden;
`

const Label = styled.span<{ $hack: boolean }>`
  ${labelSmall};
  ${singleLine};
  flex-shrink: 0;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: ${props =>
    props.$hack
      ? 'rgb(from var(--theme-negative) r g b / 0.18)'
      : 'rgb(from var(--theme-amber) r g b / 0.18)'};
  color: ${props => (props.$hack ? 'var(--theme-negative)' : 'var(--theme-amber)')};
  font-weight: 700;
`

const SmallButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
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

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`

const Empty = styled.div`
  ${bodyMedium};
  padding: var(--space-4) 18px;
  color: var(--theme-on-surface-variant);
`

/** Reads every action in a game's replay. */
function useReplayActions(replayPath: string | undefined) {
  const [read, setRead] = useState<{ path: string; actions?: ReplayActions }>()
  useEffect(() => {
    if (!replayPath) {
      return undefined
    }
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('replayReadActions', replayPath))
      .then(actions => {
        if (!cancelled) {
          setRead({ path: replayPath, actions })
        }
      })
      .catch(err => {
        logger.error(`Error reading the actions in ${replayPath}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setRead({ path: replayPath })
        }
      })
    return () => {
      cancelled = true
    }
  }, [replayPath])
  const reading = !!replayPath && read?.path !== replayPath
  return { reading, actions: reading ? undefined : read?.actions }
}

/**
 * Every action the players gave, from the game's replay, with the ones a program would give
 * labeled, the way BWChart listed them.
 */
export function GameActions({
  gameId,
  replayPath,
  players,
  playerColors,
  commands,
}: {
  gameId: string
  replayPath?: string
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  commands: ReplayCommandsRead
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { reading, actions } = useReplayActions(replayPath)
  const [hiddenPlayers, setHiddenPlayers] = useState<ReadonlySet<number>>(new Set())
  const [group, setGroup] = useState<ActionGroup>('all')
  const [labeledOnly, setLabeledOnly] = useState(false)
  const [selected, setSelected] = useState<number>()
  const listRef = useRef<VirtuosoHandle>(null)

  if (!replayPath) {
    return null
  }

  const rows = actions
    ? toRows(actions, players, p => getFairPlayFlags(p, commands.byPlayer?.get(p.id)))
    : []
  const shown = rows.filter(
    row =>
      (!row.player || !hiddenPlayers.has(row.player.id)) &&
      (group === 'all' || groupOf(row.action.command) === group) &&
      (!labeledOnly || row.labels.length),
  )
  const labeledCount = rows.filter(row => row.labels.length).length
  const shownPlayers = players.filter(p => p.apm !== undefined)

  const togglePlayer = (id: number) => {
    const next = new Set(hiddenPlayers)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setHiddenPlayers(next)
  }

  /** Moves to the next labeled action after the one picked, going back to the first at the end. */
  const goToNextLabeled = () => {
    const labeled = shown.flatMap((row, i) => (row.labels.length ? [i] : []))
    if (!labeled.length) {
      return
    }
    const at = shown.findIndex(row => row.index === selected)
    const next = labeled.find(i => i > at) ?? labeled[0]
    setSelected(shown[next].index)
    listRef.current?.scrollToIndex({ index: next, align: 'center' })
  }

  let note: string | undefined
  if (reading) {
    note = t('gameStats.readingReplay', 'Reading the replay…')
  } else if (!actions) {
    note = t('gameStats.actions.unreadable', "Couldn't read this game's replay.")
  }

  return (
    <Section>
      <SectionTitle>{t('gameStats.actions.title', 'Actions')}</SectionTitle>
      <Toolbar>
        <Players>
          {shownPlayers.map(player => (
            <LegendButton
              key={player.id}
              type='button'
              $dimmed={hiddenPlayers.has(player.id)}
              aria-pressed={!hiddenPlayers.has(player.id)}
              onClick={() => togglePlayer(player.id)}>
              <PlayerSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
              {player.name}
            </LegendButton>
          ))}
        </Players>
        <Picker>
          {(['all', ...GROUPS] as const).map(g => (
            <PickerButton key={g} type='button' $on={group === g} onClick={() => setGroup(g)}>
              {groupLabel(g, t)}
            </PickerButton>
          ))}
        </Picker>
        <Picker>
          <PickerButton
            type='button'
            $on={labeledOnly}
            aria-pressed={labeledOnly}
            onClick={() => setLabeledOnly(!labeledOnly)}>
            {t('gameStats.actions.labeledOnly', 'Labeled only ({{count}})', {
              count: labeledCount,
            })}
          </PickerButton>
        </Picker>
        <SmallButton type='button' disabled={!labeledCount} onClick={goToNextLabeled}>
          <MaterialIcon icon='arrow_downward' size={18} />
          {t('gameStats.actions.next', 'Next labeled')}
        </SmallButton>
      </Toolbar>
      <SectionErrorBoundary>
        <StatsPanel>
          <Header>
            <span>{t('gameStats.actions.time', 'Time')}</span>
            <span>{t('gameStats.actions.player', 'Player')}</span>
            <span>{t('gameStats.actions.action', 'Action')}</span>
            <span>{t('gameStats.actions.labels', 'Labels')}</span>
            <span />
          </Header>
          {shown.length ? (
            <Virtuoso
              ref={listRef}
              style={{ height: Math.min(480, shown.length * ROW_HEIGHT) }}
              data={shown}
              fixedItemHeight={ROW_HEIGHT}
              computeItemKey={(_, row) => row.index}
              itemContent={(_, row) => {
                const timeMs = row.action.frame * FASTEST_MS_PER_FRAME
                const name =
                  row.player?.name ??
                  actions?.players.find(p => p.networkId === row.action.playerId)?.name
                return (
                  <Row $selected={row.index === selected} onClick={() => setSelected(row.index)}>
                    <Time>{getGameDurationString(timeMs)}</Time>
                    <PlayerCell>
                      <PlayerSwatch
                        $color={(row.player && playerColors.get(row.player.id)) ?? 'transparent'}
                      />
                      <Cell title={name}>{name}</Cell>
                    </PlayerCell>
                    <Cell title={describeAction(row.action.command, t)}>
                      {describeAction(row.action.command, t)}
                    </Cell>
                    <Labels>
                      {row.labels.map(label => (
                        <Label
                          key={label.kind}
                          $hack={label.hack}
                          title={
                            label.hack
                              ? t('gameStats.actions.hackHelp', 'Part of what a program did')
                              : t(
                                  'gameStats.actions.suspiciousHelp',
                                  'Suspicious on its own, but not enough to say',
                                )
                          }>
                          {labelText(label, row.hidden, t)}
                        </Label>
                      ))}
                    </Labels>
                    <SmallButton
                      type='button'
                      onClick={() =>
                        dispatch(watchGameAt(gameId, Math.max(0, timeMs - WATCH_LEAD_MS)))
                      }>
                      <MaterialIcon icon='play_arrow' size={18} />
                      {t('gameStats.actions.watch', 'Watch')}
                    </SmallButton>
                  </Row>
                )
              }}
            />
          ) : (
            <Empty>{note ?? t('gameStats.actions.none', 'No actions match.')}</Empty>
          )}
        </StatsPanel>
      </SectionErrorBoundary>
      <SectionNote>
        {t(
          'gameStats.actions.note',
          'Red labels are part of what a program did. Amber ones are suspicious on their own, ' +
            'like a unit that stepped out of sight while a command waited on latency.',
        )}
      </SectionNote>
    </Section>
  )
}
