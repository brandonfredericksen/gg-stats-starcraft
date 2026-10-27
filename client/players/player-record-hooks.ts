import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { loadPlayerRecord, PlayerRecord } from './player-record'

/**
 * The user's record with whoever goes by any of `accounts`, undefined while it's counted. When more
 * of their accounts become known, the record so far stays up until the new count replaces it.
 */
export function usePlayerRecord(
  accounts: ReadonlyArray<string>,
  myNames: ReadonlyArray<string>,
): PlayerRecord | 'error' | undefined {
  const [record, setRecord] = useState<PlayerRecord | 'error'>()
  const accountsKey = accounts.join('\n')
  const namesKey = myNames.join('\n')

  useEffect(() => {
    let cancelled = false
    loadPlayerRecord(accountsKey.split('\n'), namesKey.split('\n'))
      .then(loaded => {
        if (!cancelled) {
          setRecord(loaded)
        }
      })
      .catch(err => {
        logger.error(`Error counting the games with ${accountsKey}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setRecord('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [accountsKey, namesKey])

  return record
}
