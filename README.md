# MealPlanner v1.0.36

Adds the first cookbook photo-import prototype alongside the existing website recipe importer. Users can take or choose up to four recipe photos; text recognition runs locally in the browser with Tesseract.js, then the existing deterministic ingredient parser opens the normal Edit Meal screen for review. The OCR library is loaded only when photo import is used. Existing Firebase sync/data structures are unchanged.
