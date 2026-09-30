# MealPlanner v1.0.51

Recipe URL importer parser fix.

- Uses the v1.0.50 device diagnostics to handle Reader responses where a WordPress recipe card has been flattened and the literal **Ingredients** heading is missing.
- When a **Recipe** section is present, the importer can now identify a compact cluster of quantity-led ingredient bullets instead of rejecting the page.
- If the flattened card also loses its Instructions heading, subsequent recipe-style bullet steps can be recovered as the cooking method.
- Import diagnostics now also report Instructions headings, quantity-led bullet count, and detected ingredient-cluster size.
- Existing heading-based recipe importing remains the primary path and is unchanged for pages that already import correctly.
- No planner, Firebase, shopping, sides, saved-week/day, recipe-library, or household behaviour was intentionally changed.
