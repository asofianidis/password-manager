import { powerMonitor } from 'electron'
import { settingsStore } from './settings'
import { vault } from './vault/vault'

/** Locks the vault after system idle time exceeds the configured limit, or on sleep/screen lock. */
export function startAutoLock(): void {
  setInterval(() => {
    const minutes = settingsStore.get().autoLockMinutes
    if (vault.isUnlocked && minutes > 0 && powerMonitor.getSystemIdleTime() >= minutes * 60) {
      vault.lock()
    }
  }, 15_000)

  const lockIfConfigured = (): void => {
    if (settingsStore.get().lockOnSuspend) vault.lock()
  }
  powerMonitor.on('suspend', lockIfConfigured)
  powerMonitor.on('lock-screen', lockIfConfigured)
}
