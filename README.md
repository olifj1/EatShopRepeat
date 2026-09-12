# MealPlanner v1.0.23

Sync reliability rollback/fix. Rebuilt from the known-good v1.0.19 Firebase/UI base. Bulk week operations (clear, copy, move, apply/save/delete saved week, shared-week import and week-start changes) now request an immediate cloud push using the existing per-field timestamp merge system. No Firebase settings or data migration changes are required.
