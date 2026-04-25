export class UsageParser {
  sessionUsage:    number | null = null
  weeklyUsage:     number | null = null
  sessionResetMs:  number | null = null
  weeklyResetMs:   number | null = null

  parse(evt: Record<string, unknown>): void {
    try {
      const limits = (evt?.limits ?? evt?.message_limit ?? {}) as Record<string, unknown>
      for (const [key, val] of Object.entries(limits)) {
        if (!val || typeof val !== 'object') continue
        const v = val as Record<string, unknown>
        const fraction = v.fraction != null
          ? Number(v.fraction)
          : (v.used != null && v.limit ? Number(v.used) / Number(v.limit) : null)
        const resetsAt = v.resets_at ?? v.resetsAt ?? null
        const isWeekly = key.includes('week') || key.includes('7_day')
        if (isWeekly) {
          if (fraction != null) this.weeklyUsage = Math.min(1, fraction)
          if (resetsAt) this.weeklyResetMs = new Date(resetsAt as string).getTime() - Date.now()
        } else {
          if (fraction != null) this.sessionUsage = Math.min(1, fraction)
          if (resetsAt) this.sessionResetMs = new Date(resetsAt as string).getTime() - Date.now()
        }
      }
      if (this.sessionUsage === null && evt?.fraction != null) {
        this.sessionUsage = Math.min(1, Number(evt.fraction))
      }
    } catch { /* ignore parse errors */ }
  }

  async persist(): Promise<void> {
    try {
      await chrome.storage.local.set({
        cp_session_usage:    this.sessionUsage,
        cp_weekly_usage:     this.weeklyUsage,
        cp_session_reset_ms: this.sessionResetMs,
        cp_weekly_reset_ms:  this.weeklyResetMs,
      })
    } catch { /* ignore */ }
  }
}
