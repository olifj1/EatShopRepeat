# MealPlanner v1.0.17

Firebase join reliability fix.

- Household join now fetches the authoritative cloud snapshot directly from Firestore before replacing local data.
- Adds a visible Joining state so first-time connection cannot appear to do nothing.
- Keeps the existing local-first/offline behaviour and household security model unchanged.
