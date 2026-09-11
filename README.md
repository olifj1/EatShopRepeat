# MealPlanner v1.0.18

Firebase snapshot compatibility fix.

- Encodes nested household arrays into a Firestore-safe map format before cloud upload.
- Decodes that format transparently when joining or receiving household updates.
- Keeps the existing Firestore security rules unchanged.
- No local household, meal-plan or shopping data migration is required.
