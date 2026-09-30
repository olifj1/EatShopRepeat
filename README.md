# MealPlanner v1.0.48

Corrects the v1.0.47 sides implementation. Sides are now chosen per planned lunch/dinner from the normal meal library and shown directly beneath that planned meal. They are no longer stored inside meal/recipe definitions. Side meals contribute their normal ingredients to the shopping list and are preserved by saved weeks/days, shared-week files, backups and household/Firebase sync.

Ingredient names now use the same title-style capitalisation as meal names, including existing shopping-item records and ingredient choices selected from known items.

The **Not eating** state is now reversible from its planner row: tap it and use **Rejoin main meal** to move one or more people back onto the primary meal.

The v1.0.47 Veg Space importer improvement and all other existing planner behaviour are retained. `firebase-sync.js` was not changed.
