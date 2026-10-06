import { app } from 'electron'

const userDataPath = app.getPath('userData')

export function getUserDataPath(): string {
  return userDataPath
}
