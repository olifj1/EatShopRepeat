# MealPlanner v1.0.22

Sync-reliability rebuild based on the last known-good Firebase version.

- Restores and hardens the Household / sync entry point.
- Adds a fallback Household & sync action inside Week settings.
- Keeps Firebase realtime/foreground sync from v1.0.19.
- Keeps generalized structural-week revisions for clear, copy, move, saved-week apply and shared-week import.
- Structural week changes push to Firebase immediately.
- Service-worker updates bypass HTTP cache to reduce mixed-version states.
