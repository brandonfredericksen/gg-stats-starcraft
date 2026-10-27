import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { urlPath } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { buttonReset } from '../material/button-reset'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { singleLine } from '../styles/typography'

/** A player's name that opens their details, wherever it appears. */
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
 * Wraps a player's name so clicking it opens everything known about them, or with `opensPage`,
 * their page. The click is marked with `preventDefault` so anything around the name, like a
 * library row that would open the game, can ignore it.
 */
export function PlayerNameButton({
  name,
  race,
  opensPage = false,
  children,
  className,
}: {
  name: string
  race?: RaceChar
  opensPage?: boolean
  children: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  return (
    <NameButton
      type='button'
      className={className}
      title={
        opensPage
          ? t('players.openPage', "Open {{name}}'s stats", { name })
          : t('players.openCard', 'About {{name}}', { name })
      }
      onClick={event => {
        event.preventDefault()
        if (opensPage) {
          push(urlPath`/players/${name}`)
        } else {
          dispatch(openDialog({ type: DialogType.Player, initData: { name, race } }))
        }
      }}
      onKeyDown={event => event.stopPropagation()}>
      {children}
    </NameButton>
  )
}
