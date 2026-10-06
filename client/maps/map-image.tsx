import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { BodyLarge } from '../styles/typography'

const NoImageContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 220px;
  background-color: var(--theme-container);
  color: var(--theme-on-surface-variant);
`

const NoImageIcon = styledWithAttrs(MaterialIcon, { icon: 'image', size: 90 })`
  opacity: 0.5;
`

export function MapNoImage() {
  const { t } = useTranslation()
  return (
    <NoImageContainer>
      <NoImageIcon />
      <BodyLarge>{t('maps.thumbnail.noMapPreview', 'Map preview not available')}</BodyLarge>
    </NoImageContainer>
  )
}
