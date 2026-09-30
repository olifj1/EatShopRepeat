# MealPlanner v1.0.49

This release refines meal reassignment, the iPhone meal picker and recipe URL importing.

- Removed the duplicate **Remove people** button from the meal picker.
- **Rejoin main meal** now handles moving people back from both **Not eating** and an alternative meal, so reassignment functionality is preserved with one clearer action.
- Expanded the meal picker to use the full available iPhone screen height while respecting the top safe area, giving the meal list substantially more room.
- Strengthened recipe-card parsing for WordPress-style pages whose ingredients are exposed as form/input rows instead of ordinary Markdown bullets.
- Added generic WordPress recipe-plugin HTML fallbacks (including Schema.org/itemprop and common recipe-card classes) plus a raw-HTML CORS fallback after the existing direct/Jina attempts.
- Preserves v1.0.48 planner sides, Not eating, ingredient title case, saved days/weeks, shopping, recipe library, Cook popup and household sync behaviour.

`firebase-sync.js` is unchanged.
