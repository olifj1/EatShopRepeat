# MealPlanner v1.0.19

Foreground sync responsiveness update.

- Forces an immediate Firebase refresh when Safari or the Home Screen app returns to the foreground.
- Pushes any locally queued change before pulling the latest household state.
- Helps iOS copies catch up quickly after being suspended in the background.
