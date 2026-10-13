import { HKCU, WindowsRegistry } from '@shieldbattery/windows-registry'
import { getErrorStack } from '../common/errors'
import logger from './logger'

/**
 * Whether Windows writes times on a 12 or 24 hour clock. Windows lets the user pick this apart from
 * their region, as the short time format in its regional settings, which a locale alone can't tell.
 * A format with `H` is a 24 hour clock, and one with only `h` is a 12 hour clock.
 */
export async function readSystemHourCycle(): Promise<'h12' | 'h23' | undefined> {
  try {
    const format = await new WindowsRegistry().read(
      HKCU,
      'Control Panel\\International',
      'sShortTime',
    )
    if (typeof format !== 'string') {
      return undefined
    }
    if (format.includes('H')) {
      return 'h23'
    }
    return format.includes('h') ? 'h12' : undefined
  } catch (err) {
    logger.warn(`Error reading the Windows time format: ${getErrorStack(err)}`)
    return undefined
  }
}
