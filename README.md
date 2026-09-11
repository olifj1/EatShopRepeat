# MealPlanner v1.0.16

Small Firebase first-sync fix.

- Fixes the initial household creation being denied by the production Firestore rules.
- Removes an unnecessary pre-read of a household document before its first creation.
- No Firestore rule changes are required.
- No meal, household or shopping data is changed.
