# Meal Planner v1.0.8

Household foundation release.

- Add/edit household members with adult/child roles, visual colours and app-user flags.
- Mark which app user a particular Safari/Home Screen copy represents.
- Split a dinner or lunch so different household members can have different meals.
- Share/import household snapshots containing people, meals, plans, regulars and shopping state.
- Snapshot imports merge newer records and independent week-plan/shopping fields rather than blindly replacing the whole app.
- Keeps lightweight week sharing and full backup/restore as secondary tools.
- Migrates existing v1.x plans into the household-aware data structure without clearing them.

This remains fully local/offline and server-free. The household IDs, member identities, timestamps and merge model are groundwork for later automatic Firebase sync.
