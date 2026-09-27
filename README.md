# MealPlanner v1.0.37

Improves cookbook photo import for multi-column recipe-book pages. Photo OCR now reads the title separately, scans left/right columns independently in overlapping sections, selects the ingredient-like column, applies contrast preprocessing, removes common OCR quantity errors and falls back to whole-page recognition for single-column layouts. Firebase sync/data structures are unchanged.
