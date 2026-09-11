# MealPlanner v1.0.15

Adds optional Firebase household sync while keeping the existing local/offline-first behaviour.

- Email/password Firebase accounts with email verification.
- Syncs the same household across Safari, Home Screen installs and invited app users.
- Uses each installation's own mergeable household snapshot to avoid devices overwriting one another while offline.
- App-user household members can store a sign-in email for invitations.
- Existing manual household snapshots and full backup/restore remain available as fallbacks.

Before deploying this release, publish the accompanying household-only Firestore security rules supplied with the release instructions.
