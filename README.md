# MealPlanner v1.0.41

Adds the first master Recipe Library prototype and cooking-method support.

- Bundles a new `recipe-library.json` master catalogue with a small public-domain starter set and overlapping packs.
- Meals → Library can browse/search recipes, add one recipe, or add an entire pack.
- Library recipes are copied into the household only when chosen, then sync normally through Firebase.
- Adds an admin-only library edit mode (`LIBRARY_ADMIN_ENABLED`) with local draft editing and JSON export.
- Adds recipe methods to meals, URL imports, library recipes, shared-week files, and a new Cook/Method tab.
- `firebase-sync.js` logic is otherwise unchanged.
