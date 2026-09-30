"use strict";

const APP_VERSION = "1.0.48";
const STORAGE_KEY = "mealPlannerData";
const CATEGORIES = [
  "Fruit & veg",
  "Meat & fish",
  "Chilled & dairy",
  "Bakery",
  "Cupboard",
  "Frozen",
  "Drinks",
  "Household",
  "Other"
];
const UNITS = ["", "pack", "packs", "g", "kg", "ml", "l", "pint", "pints", "tbsp", "tsp", "cm", "clove", "cloves", "tin", "tins", "jar", "jars", "tub", "tubs"];
const NO_MEAL = "__none__";
const NOT_EATING = "__not_eating__";
const DEFAULT_WEEK_START_DAY = 5; // Friday
const BUNDLED_CONTENT_VERSION = 1;
const SCHEMA_VERSION = 11;
const MEMBER_COLORS = ["sage", "terracotta", "blue", "gold", "rose", "plum"];
const DEFAULT_MEAL_TAGS = ["Kids", "Adults", "Sunday", "Quick", "Lunch", "Vegetarian", "Treat"];
const RECIPE_LIBRARY_URL = "./recipe-library.json";
const LIBRARY_ADMIN_ENABLED = true;
const LIBRARY_ADMIN_OVERRIDE_KEY = "mealPlannerLibraryAdminOverrideV1";

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const normaliseName = value => String(value || "").trim().replace(/\s+/g, " ");
const titleStyleName = value => String(value || "").replace(/(^|[\s\-–—/(&+])([a-zà-öø-ÿ])/g, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`);
const keyName = value => normaliseName(value).toLocaleLowerCase();

function applyTitleStyleToInput(input) {
  if (!input) return;
  const before = input.value;
  const after = titleStyleName(before);
  if (after === before) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = after;
  if (start !== null && end !== null) {
    try { input.setSelectionRange(start, end); } catch (_) {}
  }
}
const clone = value => JSON.parse(JSON.stringify(value));

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function startOfWeek(input = new Date(), startDay = DEFAULT_WEEK_START_DAY) {
  const date = new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12);
  const offset = (date.getDay() - Number(startDay) + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function addDays(input, days) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function dateDistance(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

function formatDay(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function formatDayLong(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function formatDateShort(date) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function formatWeekRange(start) {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(start)}`;
  }
  if (sameYear) {
    return `${formatDateShort(start)} – ${formatDateShort(end)} ${end.getFullYear()}`;
  }
  return `${formatDateShort(start)} ${start.getFullYear()} – ${formatDateShort(end)} ${end.getFullYear()}`;
}

function formatWeekHeading(start) {
  const currentStart = startOfWeek(new Date(), data.settings.weekStartDay);
  const weekOffset = Math.round(dateDistance(currentStart, start) / 7);
  if (weekOffset === 0) return "This week";
  if (weekOffset === 1) return "Next week";
  if (weekOffset === -1) return "Last week";
  const label = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(start);
  return `Week of ${label}`;
}

function emptyWeek(startKey) {
  const now = new Date().toISOString();
  return {
    startDate: startKey,
    slots: {
      dinner: Array.from({ length: 7 }, () => []),
      lunch: Array.from({ length: 7 }, () => [])
    },
    // Legacy mirrors are retained for backup compatibility with older builds.
    meals: Array(7).fill(null),
    lunches: Array(7).fill(null),
    regularItemIds: [],
    extras: [],
    checkedItemIds: [],
    notNeededItemIds: [],
    fieldUpdatedAt: {
      dinner: Array(7).fill(null),
      lunch: Array(7).fill(null),
      regularItemIds: null,
      extras: null,
      checkedItemIds: null,
      notNeededItemIds: null
    },
    createdAt: now,
    updatedAt: now,
    updatedBy: null
  };
}

function cleanSideMealIds(value, mainMealId = null) {
  const blocked = new Set([mainMealId, NO_MEAL, NOT_EATING].filter(Boolean));
  return Array.from(new Set((Array.isArray(value) ? value : []).filter(id => typeof id === "string" && id && !blocked.has(id))));
}

function makeAssignment(mealId, memberIds = null, updatedAt = new Date().toISOString(), id = null, updatedBy = null, sideMealIds = []) {
  return {
    id: id || uid("assign"),
    mealId,
    memberIds: Array.isArray(memberIds) ? Array.from(new Set(memberIds.filter(Boolean))) : null,
    sideMealIds: mealId === NO_MEAL || mealId === NOT_EATING ? [] : cleanSideMealIds(sideMealIds, mealId),
    returnMealId: mealId === NOT_EATING ? null : undefined,
    createdAt: updatedAt,
    updatedAt,
    updatedBy: updatedBy || null
  };
}

function normaliseAssignment(raw, fallbackUpdatedAt) {
  if (!raw || typeof raw !== "object" || !raw.mealId) return null;
  const stamp = raw.updatedAt || fallbackUpdatedAt || new Date().toISOString();
  return {
    id: raw.id || uid("assign"),
    mealId: raw.mealId,
    memberIds: Array.isArray(raw.memberIds) ? Array.from(new Set(raw.memberIds.filter(Boolean))) : null,
    sideMealIds: raw.mealId === NO_MEAL || raw.mealId === NOT_EATING ? [] : cleanSideMealIds(raw.sideMealIds, raw.mealId),
    returnMealId: raw.mealId === NOT_EATING && typeof raw.returnMealId === "string" ? raw.returnMealId : undefined,
    createdAt: raw.createdAt || stamp,
    updatedAt: stamp,
    updatedBy: raw.updatedBy || null
  };
}

function normaliseWeek(week, key) {
  const clean = week && typeof week === "object" ? week : {};
  clean.startDate = clean.startDate || clean.monday || key;
  clean.createdAt = clean.createdAt || new Date().toISOString();
  clean.updatedAt = clean.updatedAt || clean.createdAt;
  clean.updatedBy = clean.updatedBy || null;

  const legacyMeals = Array.isArray(clean.meals) ? [...clean.meals, ...Array(7).fill(null)].slice(0, 7) : Array(7).fill(null);
  const legacyLunches = Array.isArray(clean.lunches) ? [...clean.lunches, ...Array(7).fill(null)].slice(0, 7) : Array(7).fill(null);
  const rawSlots = clean.slots && typeof clean.slots === "object" ? clean.slots : {};

  const normalisePeriod = (rawPeriod, legacy) => Array.from({ length: 7 }, (_, index) => {
    if (Array.isArray(rawPeriod?.[index])) return rawPeriod[index].map(raw => normaliseAssignment(raw, clean.updatedAt)).filter(Boolean);
    const mealId = legacy[index];
    return mealId ? [makeAssignment(mealId, null, clean.updatedAt, null, clean.updatedBy)] : [];
  });

  clean.slots = {
    dinner: normalisePeriod(rawSlots.dinner, legacyMeals),
    lunch: normalisePeriod(rawSlots.lunch, legacyLunches)
  };
  clean.regularItemIds = Array.isArray(clean.regularItemIds) ? clean.regularItemIds : [];
  clean.extras = Array.isArray(clean.extras) ? clean.extras : [];
  clean.checkedItemIds = Array.isArray(clean.checkedItemIds) ? clean.checkedItemIds : [];
  clean.notNeededItemIds = Array.isArray(clean.notNeededItemIds) ? clean.notNeededItemIds : [];

  const rawField = clean.fieldUpdatedAt && typeof clean.fieldUpdatedAt === "object" ? clean.fieldUpdatedAt : {};
  const periodStamps = (slotType) => Array.from({ length: 7 }, (_, index) => {
    const stamp = Array.isArray(rawField[slotType]) ? rawField[slotType][index] : null;
    if (stamp) return stamp;
    return clean.slots[slotType][index].length ? clean.updatedAt : null;
  });
  clean.fieldUpdatedAt = {
    dinner: periodStamps("dinner"),
    lunch: periodStamps("lunch"),
    regularItemIds: rawField.regularItemIds || (clean.regularItemIds.length ? clean.updatedAt : null),
    extras: rawField.extras || (clean.extras.length ? clean.updatedAt : null),
    checkedItemIds: rawField.checkedItemIds || (clean.checkedItemIds.length ? clean.updatedAt : null),
    notNeededItemIds: rawField.notNeededItemIds || (clean.notNeededItemIds.length ? clean.updatedAt : null)
  };
  syncLegacyWeekSlots(clean);
  delete clean.monday;
  return clean;
}


function normaliseSavedWeek(savedWeek, index = 0) {
  if (!savedWeek || typeof savedWeek !== "object") return null;
  const now = new Date().toISOString();
  const stamp = savedWeek.updatedAt || savedWeek.createdAt || now;
  const rawSlots = savedWeek.slots && typeof savedWeek.slots === "object" ? savedWeek.slots : {};
  const normalisePeriod = rawPeriod => Array.from({ length: 7 }, (_, dayIndex) => {
    const rawAssignments = Array.isArray(rawPeriod?.[dayIndex]) ? rawPeriod[dayIndex] : [];
    return rawAssignments.map(raw => normaliseAssignment(raw, stamp)).filter(Boolean);
  });
  return {
    id: savedWeek.id || uid("savedweek"),
    name: normaliseName(savedWeek.name) || `Saved week ${index + 1}`,
    weekStartDay: Number.isInteger(Number(savedWeek.weekStartDay)) ? Number(savedWeek.weekStartDay) : DEFAULT_WEEK_START_DAY,
    sourceStartDate: savedWeek.sourceStartDate || null,
    slots: {
      dinner: normalisePeriod(rawSlots.dinner),
      lunch: normalisePeriod(rawSlots.lunch)
    },
    regularItemIds: Array.isArray(savedWeek.regularItemIds) ? Array.from(new Set(savedWeek.regularItemIds.filter(Boolean))) : [],
    createdAt: savedWeek.createdAt || stamp,
    updatedAt: stamp,
    updatedBy: savedWeek.updatedBy || null,
    deletedAt: savedWeek.deletedAt || null
  };
}

function normaliseSavedDay(savedDay, index = 0) {
  if (!savedDay || typeof savedDay !== "object") return null;
  const now = new Date().toISOString();
  const stamp = savedDay.updatedAt || savedDay.createdAt || now;
  const normalisePeriod = rawAssignments => (Array.isArray(rawAssignments) ? rawAssignments : [])
    .map(raw => normaliseAssignment(raw, stamp))
    .filter(Boolean);
  return {
    id: savedDay.id || uid("savedday"),
    name: normaliseName(savedDay.name) || `Saved day ${index + 1}`,
    slots: {
      dinner: normalisePeriod(savedDay.slots?.dinner),
      lunch: normalisePeriod(savedDay.slots?.lunch)
    },
    createdAt: savedDay.createdAt || stamp,
    updatedAt: stamp,
    updatedBy: savedDay.updatedBy || null,
    deletedAt: savedDay.deletedAt || null
  };
}

function syncLegacyWeekSlots(week) {
  const primary = assignments => {
    if (!assignments?.length) return null;
    if (assignments.length === 1) return assignments[0].mealId || null;
    return assignments[0]?.mealId || null;
  };
  week.meals = Array.from({ length: 7 }, (_, index) => primary(week.slots?.dinner?.[index]));
  week.lunches = Array.from({ length: 7 }, (_, index) => primary(week.slots?.lunch?.[index]));
  return week;
}

function getSlotAssignments(week, slotType, dayIndex) {
  const period = slotType === "lunch" ? "lunch" : "dinner";
  if (!week.slots) week.slots = { dinner: Array.from({ length: 7 }, () => []), lunch: Array.from({ length: 7 }, () => []) };
  if (!Array.isArray(week.slots[period])) week.slots[period] = Array.from({ length: 7 }, () => []);
  if (!Array.isArray(week.slots[period][dayIndex])) week.slots[period][dayIndex] = [];
  return week.slots[period][dayIndex];
}

function rebaseWeekMap(weeks, oldStartDay, newStartDay) {
  const rebased = {};
  const ensureTarget = start => {
    const key = localDateKey(start);
    if (!rebased[key]) rebased[key] = emptyWeek(key);
    return rebased[key];
  };

  Object.entries(weeks || {}).forEach(([key, rawWeek]) => {
    const week = normaliseWeek(clone(rawWeek), key);
    const sourceStart = fromDateKey(week.startDate || key);

    ["dinner", "lunch"].forEach(slotName => {
      week.slots[slotName].forEach((assignments, index) => {
        if (!assignments?.length) return;
        const date = addDays(sourceStart, index);
        const targetStart = startOfWeek(date, newStartDay);
        const target = ensureTarget(targetStart);
        const targetIndex = dateDistance(targetStart, date);
        if (targetIndex >= 0 && targetIndex < 7) {
          target.slots[slotName][targetIndex] = clone(assignments);
          target.fieldUpdatedAt[slotName][targetIndex] = week.fieldUpdatedAt?.[slotName]?.[index] || week.updatedAt;
        }
      });
    });

    const shoppingStart = startOfWeek(sourceStart, newStartDay);
    const shoppingTarget = ensureTarget(shoppingStart);
    shoppingTarget.regularItemIds = Array.from(new Set([...shoppingTarget.regularItemIds, ...week.regularItemIds]));
    shoppingTarget.checkedItemIds = Array.from(new Set([...shoppingTarget.checkedItemIds, ...week.checkedItemIds]));
    shoppingTarget.notNeededItemIds = Array.from(new Set([...shoppingTarget.notNeededItemIds, ...week.notNeededItemIds]));
    if (week.regularItemIds.length) shoppingTarget.fieldUpdatedAt.regularItemIds = week.fieldUpdatedAt?.regularItemIds || week.updatedAt;
    if (week.checkedItemIds.length) shoppingTarget.fieldUpdatedAt.checkedItemIds = week.fieldUpdatedAt?.checkedItemIds || week.updatedAt;
    if (week.notNeededItemIds.length) shoppingTarget.fieldUpdatedAt.notNeededItemIds = week.fieldUpdatedAt?.notNeededItemIds || week.updatedAt;
    const existingExtraIds = new Set(shoppingTarget.extras.map(extra => extra.id));
    week.extras.forEach(extra => {
      if (!existingExtraIds.has(extra.id)) {
        shoppingTarget.extras.push(extra);
        existingExtraIds.add(extra.id);
      }
    });
    if (week.extras.length) shoppingTarget.fieldUpdatedAt.extras = week.fieldUpdatedAt?.extras || week.updatedAt;
    if (String(week.updatedAt) > String(shoppingTarget.updatedAt)) {
      shoppingTarget.updatedAt = week.updatedAt;
      shoppingTarget.updatedBy = week.updatedBy || null;
    }
  });

  Object.values(rebased).forEach(syncLegacyWeekSlots);
  return rebased;
}

function applyBundledContent(target) {
  const currentVersion = Number(target.bundledContentVersion) || 0;
  if (currentVersion >= BUNDLED_CONTENT_VERSION) return target;

  const now = new Date().toISOString();
  const bundledItems = [
    ["item_olive_oil", "Olive oil", "Cupboard"],
    ["item_onion", "Onion", "Fruit & veg"],
    ["item_carrots", "Carrots", "Fruit & veg"],
    ["item_root_ginger", "Fresh root ginger", "Fruit & veg"],
    ["item_garlic", "Garlic", "Fruit & veg"],
    ["item_chilli_flakes", "Dried red chilli flakes", "Cupboard"],
    ["item_sweet_potatoes", "Sweet potatoes", "Fruit & veg"],
    ["item_vegetable_stock", "Vegetable stock", "Cupboard"],
    ["item_salt", "Salt", "Cupboard"],
    ["item_black_pepper", "Black pepper", "Cupboard"]
  ];

  const itemIds = {};
  bundledItems.forEach(([preferredId, name, category]) => {
    let item = target.items.find(entry => entry.id === preferredId) || target.items.find(entry => keyName(entry.name) === keyName(name));
    if (!item) {
      item = { id: preferredId, name: titleStyleName(name), category, regular: false, createdAt: now, updatedAt: now };
      target.items.push(item);
    }
    itemIds[preferredId] = item.id;
  });

  if (!target.meals.some(meal => meal.id === "meal_sweet_potato_soup")) {
    target.meals.push({
      id: "meal_sweet_potato_soup",
      name: "Sweet Potato Soup",
      ingredients: [
        { itemId: itemIds.item_olive_oil, qty: "1", unit: "tbsp" },
        { itemId: itemIds.item_onion, qty: "1", unit: "" },
        { itemId: itemIds.item_carrots, qty: "2", unit: "" },
        { itemId: itemIds.item_root_ginger, qty: "4", unit: "cm" },
        { itemId: itemIds.item_garlic, qty: "1", unit: "clove" },
        { itemId: itemIds.item_chilli_flakes, qty: "0.5", unit: "tsp" },
        { itemId: itemIds.item_sweet_potatoes, qty: "700", unit: "g" },
        { itemId: itemIds.item_vegetable_stock, qty: "1.2", unit: "l" },
        { itemId: itemIds.item_salt, qty: "", unit: "" },
        { itemId: itemIds.item_black_pepper, qty: "", unit: "" }
      ],
      sourceUrl: "https://www.bbc.co.uk/food/recipes/sweet_potato_soup_62834",
      tags: [],
      rating: 0,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null
    });
  }

  target.bundledContentVersion = BUNDLED_CONTENT_VERSION;
  return target;
}

function seedData() {
  const now = new Date().toISOString();
  const itemDefs = [
    ["chicken", "Chicken breasts", "Meat & fish", false],
    ["wraps", "Wraps", "Bakery", false],
    ["peppers", "Peppers", "Fruit & veg", false],
    ["cheese", "Grated cheese", "Chilled & dairy", false],
    ["avocado", "Avocado", "Fruit & veg", false],
    ["sourcream", "Sour cream", "Chilled & dairy", false],
    ["sausages", "Sausages", "Meat & fish", false],
    ["potatoes", "Potatoes", "Fruit & veg", false],
    ["peas", "Peas", "Frozen", false],
    ["gravy", "Gravy", "Cupboard", false],
    ["pasta", "Pasta", "Cupboard", false],
    ["meatballs", "Meatballs", "Meat & fish", false],
    ["tomatosauce", "Tomato pasta sauce", "Cupboard", false],
    ["fishfingers", "Fish fingers", "Frozen", false],
    ["wedges", "Potato wedges", "Frozen", false],
    ["curry", "Mild curry sauce", "Cupboard", false],
    ["rice", "Rice", "Cupboard", false],
    ["naan", "Naan bread", "Bakery", false],
    ["jackets", "Baking potatoes", "Fruit & veg", false],
    ["beans", "Baked beans", "Cupboard", false],
    ["tortilla", "Tortilla wraps", "Bakery", false],
    ["ham", "Ham", "Chilled & dairy", false],
    ["wholechicken", "Whole chicken", "Meat & fish", false],
    ["carrots", "Carrots", "Fruit & veg", false],
    ["milk", "Milk", "Chilled & dairy", true],
    ["bread", "Bread", "Bakery", true],
    ["bananas", "Bananas", "Fruit & veg", true],
    ["cereal", "Cereal", "Cupboard", true],
    ["yoghurts", "Yoghurts", "Chilled & dairy", true],
    ["nappies", "Nappies", "Household", true],
    ["kitchenroll", "Kitchen roll", "Household", true],
    ["washingup", "Washing-up liquid", "Household", true]
  ];
  const items = itemDefs.map(([short, name, category, regular]) => ({ id: `item_${short}`, name, category, regular, createdAt: now, updatedAt: now }));

  const ingredient = (itemId, qty = "", unit = "") => ({ itemId: `item_${itemId}`, qty: String(qty), unit });
  const meals = [
    { id: "meal_fajitas", name: "Chicken fajitas", ingredients: [ingredient("chicken", 2), ingredient("wraps", 1, "pack"), ingredient("peppers", 2), ingredient("cheese"), ingredient("avocado", 1), ingredient("sourcream", 1, "tub")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_sausage_mash", name: "Sausage & mash", ingredients: [ingredient("sausages", 1, "pack"), ingredient("potatoes", 1, "kg"), ingredient("peas", 1, "pack"), ingredient("gravy")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_meatballs", name: "Pasta & meatballs", ingredients: [ingredient("pasta", 500, "g"), ingredient("meatballs", 1, "pack"), ingredient("tomatosauce", 1, "jar"), ingredient("cheese")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_fish", name: "Fish fingers & wedges", ingredients: [ingredient("fishfingers", 1, "pack"), ingredient("wedges", 1, "pack"), ingredient("peas", 1, "pack")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_curry", name: "Mild chicken curry", ingredients: [ingredient("chicken", 2), ingredient("curry", 1, "jar"), ingredient("rice", 300, "g"), ingredient("naan", 1, "pack")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_jackets", name: "Jacket potatoes", ingredients: [ingredient("jackets", 4), ingredient("beans", 1, "tin"), ingredient("cheese")], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_quesadillas", name: "Ham & cheese quesadillas", ingredients: [ingredient("tortilla", 1, "pack"), ingredient("ham", 1, "pack"), ingredient("cheese"), ingredient("peppers", 1)], createdAt: now, updatedAt: now, lastUsedAt: null },
    { id: "meal_roast", name: "Roast chicken", ingredients: [ingredient("wholechicken", 1), ingredient("potatoes", 1, "kg"), ingredient("carrots", 1, "pack"), ingredient("peas", 1, "pack"), ingredient("gravy")], createdAt: now, updatedAt: now, lastUsedAt: null }
  ];
  meals.forEach(meal => { meal.tags = []; meal.rating = 0; });

  const household = createEmptyHousehold();
  const seeded = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    bundledContentVersion: 0,
    household,
    items,
    meals,
    weeks: {},
    savedWeeks: [],
    savedDays: [],
    settings: { hideChecked: false, lastTab: "week", weekStartDay: DEFAULT_WEEK_START_DAY, currentMemberId: null }
  };
  const ready = applyBundledContent(seeded);
  ready.items.forEach(item => { item.name = titleStyleName(normaliseName(item.name)); });
  ready.meals.forEach(meal => { meal.name = titleStyleName(normaliseName(meal.name)); });
  return ready;
}

function createEmptyHousehold() {
  const now = new Date().toISOString();
  return {
    id: uid("household"),
    name: "Our household",
    weekStartDay: DEFAULT_WEEK_START_DAY,
    members: [],
    hiddenMealTags: [],
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    dataUpdatedAt: now,
    dataUpdatedBy: null
  };
}

function normaliseMember(member, index = 0) {
  if (!member || typeof member !== "object") return null;
  const name = normaliseName(member.name);
  if (!name) return null;
  const now = new Date().toISOString();
  return {
    id: member.id || uid("member"),
    name,
    role: member.role === "child" ? "child" : "adult",
    appUser: !!member.appUser,
    email: String(member.email || "").trim().toLowerCase(),
    color: MEMBER_COLORS.includes(member.color) ? member.color : MEMBER_COLORS[index % MEMBER_COLORS.length],
    createdAt: member.createdAt || member.updatedAt || now,
    updatedAt: member.updatedAt || member.createdAt || now,
    updatedBy: member.updatedBy || null,
    deletedAt: member.deletedAt || null
  };
}

function normaliseMealTags(tags) {
  const result = [];
  const seen = new Set();
  (Array.isArray(tags) ? tags : []).forEach(raw => {
    const value = normaliseName(raw);
    if (!value) return;
    const key = keyName(value);
    if (seen.has(key)) return;
    seen.add(key);
    const defaultTag = DEFAULT_MEAL_TAGS.find(tag => keyName(tag) === key);
    result.push(defaultTag || value);
  });
  return result;
}

function normaliseMealRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0;
}

function normaliseMethod(value) {
  const raw = Array.isArray(value) ? value : String(value || "").replace(/\r/g, "").split("\n");
  return raw.map(step => normaliseName(String(step || "").replace(/^\s*\d+[.)]\s*/, ""))).filter(Boolean);
}

function hiddenMealTagKeys() {
  return new Set((data?.household?.hiddenMealTags || []).map(keyName).filter(Boolean));
}

function knownMealTags() {
  const hidden = hiddenMealTagKeys();
  const defaults = DEFAULT_MEAL_TAGS.filter(tag => !hidden.has(keyName(tag)));
  const custom = [];
  const seen = new Set(DEFAULT_MEAL_TAGS.map(keyName));
  data?.meals?.forEach(meal => {
    if (meal.deletedAt) return;
    normaliseMealTags(meal.tags).forEach(tag => {
      const key = keyName(tag);
      if (!hidden.has(key) && !seen.has(key)) { seen.add(key); custom.push(tag); }
    });
  });
  custom.sort((a, b) => a.localeCompare(b));
  return [...defaults, ...custom];
}

function prepareDataObject(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items) || !Array.isArray(parsed.meals)) {
    throw new Error("Not valid Meal Planner data");
  }

  const clean = clone(parsed);
  const oldSchema = Number(clean.schemaVersion) || 1;
  const hadWeekStartSetting = Number.isInteger(Number(clean.settings?.weekStartDay));
  const oldStartDay = hadWeekStartSetting ? Number(clean.settings.weekStartDay) : 1;
  const weekStartDay = hadWeekStartSetting ? Number(clean.settings.weekStartDay) : DEFAULT_WEEK_START_DAY;

  if (!clean.household || typeof clean.household !== "object") clean.household = createEmptyHousehold();
  clean.household.id = clean.household.id || uid("household");
  clean.household.name = normaliseName(clean.household.name) || "Our household";
  clean.household.weekStartDay = Number.isInteger(Number(clean.household.weekStartDay)) ? Number(clean.household.weekStartDay) : weekStartDay;
  clean.household.members = Array.isArray(clean.household.members)
    ? clean.household.members.map(normaliseMember).filter(Boolean)
    : [];
  clean.household.hiddenMealTags = Array.isArray(clean.household.hiddenMealTags)
    ? Array.from(new Set(clean.household.hiddenMealTags.map(keyName).filter(Boolean)))
    : [];
  clean.household.createdAt = clean.household.createdAt || new Date().toISOString();
  clean.household.updatedAt = clean.household.updatedAt || clean.household.createdAt;
  clean.household.updatedBy = clean.household.updatedBy || null;
  clean.household.dataUpdatedAt = clean.household.dataUpdatedAt || clean.household.updatedAt;
  clean.household.dataUpdatedBy = clean.household.dataUpdatedBy || clean.household.updatedBy || null;

  clean.weeks = clean.weeks && typeof clean.weeks === "object" ? clean.weeks : {};
  if (oldSchema < 2 || !hadWeekStartSetting) {
    clean.weeks = rebaseWeekMap(clean.weeks, oldStartDay, clean.household.weekStartDay);
  } else {
    Object.entries(clean.weeks).forEach(([key, week]) => { clean.weeks[key] = normaliseWeek(week, key); });
  }

  clean.savedWeeks = Array.isArray(clean.savedWeeks)
    ? clean.savedWeeks.map(normaliseSavedWeek).filter(Boolean)
    : [];
  clean.savedDays = Array.isArray(clean.savedDays)
    ? clean.savedDays.map(normaliseSavedDay).filter(Boolean)
    : [];

  clean.items = clean.items.map(item => ({
    ...item,
    name: titleStyleName(normaliseName(item.name)),
    createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    updatedBy: item.updatedBy || null,
    deletedAt: item.deletedAt || null
  }));
  clean.meals = clean.meals.map(meal => {
    const { sides: _legacySides, ...mealWithoutLegacySides } = meal;
    return {
      ...mealWithoutLegacySides,
      name: titleStyleName(normaliseName(meal.name)),
      tags: normaliseMealTags(meal.tags),
      rating: normaliseMealRating(meal.rating),
      method: normaliseMethod(meal.method),
      libraryRecipeId: meal.libraryRecipeId || null,
      librarySourceId: meal.librarySourceId || null,
      createdAt: meal.createdAt || meal.updatedAt || new Date().toISOString(),
      updatedAt: meal.updatedAt || meal.createdAt || new Date().toISOString(),
      updatedBy: meal.updatedBy || null,
      deletedAt: meal.deletedAt || null
    };
  });

  clean.schemaVersion = SCHEMA_VERSION;
  clean.appVersion = APP_VERSION;
  clean.settings = {
    hideChecked: false,
    lastTab: "week",
    weekStartDay: clean.household.weekStartDay,
    currentMemberId: null,
    ...(clean.settings || {}),
    weekStartDay: clean.household.weekStartDay
  };
  if (!activeMembers(clean).some(member => member.id === clean.settings.currentMemberId && member.appUser)) clean.settings.currentMemberId = null;
  return applyBundledContent(clean);
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return prepareDataObject(parsed);
  } catch (_) {
    return seedData();
  }
}

let data = loadData();
let selectedWeekStart = startOfWeek(new Date(), data.settings.weekStartDay);
let pickerDayIndex = null;
let pickerSlotType = "dinner";
let pickerAssignmentId = null;
let pickerMode = "replace";
let splitDayIndex = null;
let splitSlotType = "dinner";
let splitAssignmentId = null;
let splitReturnMode = "card";
let pendingSplitMemberIds = [];
let pendingAudienceAll = false;
let pickerAudienceMemberIds = null;
let pendingAlternativeMealId = null;
let toastTimer = null;
let deferredInstallPrompt = null;
let mealTagFilters = [];
let mealRatingFilter = "any";
let pickerTagFilters = [];
let pickerRatingFilter = "any";
let editingMealTags = [];
let mealTagRemoveMode = false;
let editingMealRating = 0;
let editingMealSourceUrl = "";
let photoImportFiles = [];
let ocrScriptPromise = null;
let recipeLibrary = { schemaVersion: 1, libraryVersion: 1, sources: [], packs: [], recipes: [] };
let recipeLibraryLoaded = false;
let recipeLibraryPromise = null;
let librarySelectedPackId = "all";
let libraryAdminMode = false;
let activeLibraryRecipeId = null;
let editingLibraryRecipeId = null;
let activeMethodMealId = null;
let dayTemplateTargetIndex = null;

function currentMemberId() {
  return data?.settings?.currentMemberId || null;
}

function touchSharedState(stamp = new Date().toISOString(), by = currentMemberId()) {
  if (!data?.household) return stamp;
  data.household.dataUpdatedAt = stamp;
  data.household.dataUpdatedBy = by || null;
  return stamp;
}

function touchRecord(record, stamp = new Date().toISOString()) {
  if (!record) return stamp;
  record.updatedAt = stamp;
  record.updatedBy = currentMemberId();
  touchSharedState(stamp, record.updatedBy);
  return stamp;
}

function touchWeekField(week, field, index = null, stamp = new Date().toISOString()) {
  if (!week.fieldUpdatedAt) normaliseWeek(week, week.startDate || "");
  if ((field === "dinner" || field === "lunch") && Number.isInteger(Number(index))) {
    week.fieldUpdatedAt[field][Number(index)] = stamp;
  } else if (Object.prototype.hasOwnProperty.call(week.fieldUpdatedAt, field)) {
    week.fieldUpdatedAt[field] = stamp;
  }
  touchRecord(week, stamp);
  return stamp;
}

function saveData(options = {}) {
  data.appVersion = APP_VERSION;
  data.schemaVersion = SCHEMA_VERSION;
  if (data.household) data.settings.weekStartDay = data.household.weekStartDay;
  Object.values(data.weeks || {}).forEach(syncLegacyWeekSlots);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (!options.skipCloud) {
    window.dispatchEvent(new CustomEvent("mealplanner:localchange", {
      detail: { immediate: !!options.immediateCloud }
    }));
  }
}

function weekKey(start = selectedWeekStart) {
  return localDateKey(startOfWeek(start, data.settings.weekStartDay));
}

function getWeek(start = selectedWeekStart) {
  const key = weekKey(start);
  if (!data.weeks[key]) {
    data.weeks[key] = emptyWeek(key);
    saveData();
  }
  data.weeks[key] = normaliseWeek(data.weeks[key], key);
  return data.weeks[key];
}

function activeMembers(source = data) { return (source?.household?.members || []).filter(member => !member.deletedAt); }
function appUserMembers(source = data) { return activeMembers(source).filter(member => member.appUser); }
function findMember(id) { return activeMembers().find(member => member.id === id) || null; }
function findMeal(id) { return data.meals.find(meal => meal.id === id && !meal.deletedAt) || null; }
function findItem(id) { return data.items.find(item => item.id === id && !item.deletedAt) || null; }
function findItemByName(name) { const key = keyName(name); return data.items.find(item => !item.deletedAt && keyName(item.name) === key) || null; }
function activeSavedWeeks(source = data) { return (source?.savedWeeks || []).filter(savedWeek => !savedWeek.deletedAt); }
function findSavedWeek(id) { return activeSavedWeeks().find(savedWeek => savedWeek.id === id) || null; }
function activeSavedDays(source = data) { return (source?.savedDays || []).filter(savedDay => !savedDay.deletedAt); }
function findSavedDay(id) { return activeSavedDays().find(savedDay => savedDay.id === id) || null; }

function ensureItem(name, category = "Other", regular = false) {
  const clean = titleStyleName(normaliseName(name));
  if (!clean) return null;
  let item = findItemByName(clean);
  if (!item) {
    const now = new Date().toISOString();
    item = { id: uid("item"), name: clean, category: CATEGORIES.includes(category) ? category : "Other", regular: !!regular, createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null };
    data.items.push(item);
    touchSharedState(now, item.updatedBy);
  } else {
    if (category && CATEGORIES.includes(category)) item.category = category;
    if (regular) item.regular = true;
    touchRecord(item);
  }
  return item;
}

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function openOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => overlay.querySelector("input:not([type='hidden']),button")?.focus({ preventScroll: true }));
}

function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = true;
  if (!$(".overlay:not([hidden])")) document.body.classList.remove("modal-open");
}

function categoryOptions(selected = "Other") {
  return CATEGORIES.map(category => `<option value="${escapeHtml(category)}"${category === selected ? " selected" : ""}>${escapeHtml(category)}</option>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function renderKnownItems() {
  const names = data.items.filter(item => !item.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const options = names.map(item => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  $("#known-items").innerHTML = options;
  $("#ingredient-known-items").innerHTML = options;
}

function memberInitials(member) {
  return normaliseName(member?.name).split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function memberAvatar(member, small = false) {
  if (!member) return "";
  return `<span class="member-avatar ${small ? "small" : ""} member-${escapeHtml(member.color)}" title="${escapeHtml(member.name)}">${escapeHtml(memberInitials(member))}</span>`;
}

function audienceInfo(memberIds) {
  const members = activeMembers();
  if (!members.length || memberIds === null) return { label: "Everyone", members };
  const ids = new Set(memberIds || []);
  const selected = members.filter(member => ids.has(member.id));
  if (selected.length === members.length) return { label: "Everyone", members: selected };
  const adults = members.filter(member => member.role === "adult");
  const kids = members.filter(member => member.role === "child");
  const selectedAdults = selected.filter(member => member.role === "adult");
  const selectedKids = selected.filter(member => member.role === "child");
  const allAdults = adults.length && selectedAdults.length === adults.length && adults.every(member => ids.has(member.id));
  const allKids = kids.length && selectedKids.length === kids.length && kids.every(member => ids.has(member.id));
  if (allAdults && !selectedKids.length) return { label: "Adults", members: selected };
  if (allKids && !selectedAdults.length) return { label: "Kids", members: selected };
  if (allAdults && selectedKids.length) {
    const extra = selectedKids.length === 1 ? selectedKids[0].name : `${selectedKids.length} kids`;
    return { label: `Adults + ${extra}`, members: selected };
  }
  if (allKids && selectedAdults.length) {
    const extra = selectedAdults.length === 1 ? selectedAdults[0].name : `${selectedAdults.length} adults`;
    return { label: `Kids + ${extra}`, members: selected };
  }
  if (selected.length === 1) return { label: selected[0].name, members: selected };
  if (selected.length <= 3) return { label: selected.map(member => member.name).join(" + "), members: selected };
  return { label: `${selected.length} people`, members: selected };
}

function audienceAvatarsMarkup(memberIds) {
  const info = audienceInfo(memberIds);
  const avatars = info.members.slice(0, 5).map(member => memberAvatar(member, true)).join("");
  return `<span class="audience audience-initials-only" title="${escapeHtml(info.label)}" aria-label="${escapeHtml(info.label)}"><span class="audience-avatars">${avatars}</span></span>`;
}

function audienceControlMarkup(memberIds, slotType, dayIndex, assignmentId) {
  const info = audienceInfo(memberIds);
  const all = memberIds === null || info.label === "Everyone";
  const content = all
    ? `<span class="audience-control-label">All</span>`
    : `<span class="audience-avatars">${info.members.slice(0, 4).map(member => memberAvatar(member, true)).join("")}</span>`;
  return `<button class="audience-control" type="button" data-audience-slot="${slotType}" data-day-index="${dayIndex}" data-assignment-id="${escapeHtml(assignmentId || "")}" aria-label="Choose who has this ${slotType}" title="${escapeHtml(info.label)}">${content}<svg class="audience-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.5 6 6l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

function assignmentMemberIds(assignment) {
  const allIds = activeMembers().map(member => member.id);
  if (!allIds.length) return [];
  if (!assignment || assignment.memberIds === null) return allIds;
  const active = new Set(allIds);
  return Array.from(new Set((assignment.memberIds || []).filter(id => active.has(id))));
}

function unassignedMemberIds(assignments) {
  const allIds = activeMembers().map(member => member.id);
  if (!allIds.length) return [];
  const assigned = new Set();
  (assignments || []).forEach(assignment => assignmentMemberIds(assignment).forEach(id => assigned.add(id)));
  return allIds.filter(id => !assigned.has(id));
}

function canAddAlternativeMeal(assignments) {
  const members = activeMembers();
  if (members.length <= 1 || !assignments?.length) return false;
  if (assignments.some(assignment => assignment.mealId === NO_MEAL)) return false;
  // Keep offering alternatives until every household member has their own assignment.
  return assignments.length < members.length;
}

function addAlternativeMealButton(slotType, dayIndex) {
  return `<button class="add-alternative-button" type="button" data-add-alternative="${slotType}" data-day-index="${dayIndex}">＋ Add alternative meal</button>`;
}

function assignmentSideMealIds(assignment) {
  return cleanSideMealIds(assignment?.sideMealIds, assignment?.mealId).filter(id => !!findMeal(id));
}

function plannedSidesMarkup(assignment, slotType, dayIndex) {
  if (!assignment || assignment.mealId === NO_MEAL || assignment.mealId === NOT_EATING || !findMeal(assignment.mealId)) return "";
  const sides = assignmentSideMealIds(assignment).map(id => findMeal(id)).filter(Boolean);
  const chips = sides.map(side => `<button class="planned-side-chip" type="button" data-remove-side-meal="${escapeHtml(side.id)}" data-side-day="${dayIndex}" data-side-slot="${slotType}" data-side-assignment="${escapeHtml(assignment.id)}" aria-label="Remove ${escapeHtml(side.name)} side"><span>${escapeHtml(side.name)}</span><b aria-hidden="true">×</b></button>`).join("");
  return `<div class="planned-sides-row"><span class="planned-sides-label">Sides</span><div class="planned-side-chips">${chips}<button class="planned-side-add" type="button" data-add-side-meal="${slotType}" data-side-day="${dayIndex}" data-side-assignment="${escapeHtml(assignment.id)}">＋ Add side</button></div></div>`;
}

function mealPeriodMarkup(slotType, dayIndex, assignments) {
  const label = slotType === "lunch" ? "Lunch" : "Dinner";
  if (!assignments.length) {
    if (slotType === "lunch") return `<button class="add-lunch-button" type="button" data-day-index="${dayIndex}" data-meal-slot="lunch">＋ Lunch</button>`;
    return `<button class="meal-slot dinner empty" type="button" data-day-index="${dayIndex}" data-meal-slot="dinner"><span class="meal-slot-copy"><span class="slot-label">Dinner</span><strong>Choose meal</strong></span><span class="slot-arrow" aria-hidden="true">›</span></button>`;
  }

  if (assignments.length === 1) {
    const assignment = assignments[0];
    const noMeal = assignment.mealId === NO_MEAL;
    const notEating = assignment.mealId === NOT_EATING;
    const meal = noMeal || notEating ? null : findMeal(assignment.mealId);
    const name = meal ? meal.name : noMeal ? "No meal / eating out" : notEating ? "Not eating" : "Choose meal";
    const showAlternative = !noMeal && (meal || notEating) && canAddAlternativeMeal(assignments);
    const notEatingAudience = notEating ? `<span class="not-eating-inline">${audienceAvatarsMarkup(assignment.memberIds)}</span>` : "";
    return `<div class="meal-period single ${slotType} ${showAlternative ? "has-alternative" : ""}">
      <button class="meal-slot ${slotType} ${meal || noMeal || notEating ? "" : "empty"}" type="button" data-day-index="${dayIndex}" data-meal-slot="${slotType}" data-assignment-id="${escapeHtml(assignment.id)}">
        <span class="meal-slot-copy"><span class="slot-label">${label}</span><strong>${escapeHtml(name)}</strong>${notEatingAudience}</span><span class="slot-arrow" aria-hidden="true">›</span>
      </button>
      ${meal ? plannedSidesMarkup(assignment, slotType, dayIndex) : ""}
      ${showAlternative ? addAlternativeMealButton(slotType, dayIndex) : ""}
    </div>`;
  }

  const rows = assignments.map(assignment => {
    const notEating = assignment.mealId === NOT_EATING;
    const meal = notEating ? null : findMeal(assignment.mealId);
    if (!meal && !notEating) return "";
    const name = notEating ? "Not eating" : meal.name;
    return `<div class="split-assignment-block ${notEating ? "not-eating-block" : ""}"><button class="split-assignment-row ${notEating ? "not-eating-row" : ""}" type="button" data-day-index="${dayIndex}" data-meal-slot="${slotType}" data-assignment-id="${escapeHtml(assignment.id)}">
      <strong>${escapeHtml(name)}</strong>${audienceAvatarsMarkup(assignment.memberIds)}<span class="slot-arrow" aria-hidden="true">›</span>
    </button>${meal ? plannedSidesMarkup(assignment, slotType, dayIndex) : ""}</div>`;
  }).join("");
  return `<div class="meal-period split ${slotType}">
    <div class="split-period-heading"><span>${label}</span></div>
    ${rows}
    ${canAddAlternativeMeal(assignments) ? addAlternativeMealButton(slotType, dayIndex) : ""}
  </div>`;
}

function renderWeek() {
  const week = getWeek();
  const todayKey = localDateKey(new Date());
  $("#week-title").textContent = formatWeekHeading(selectedWeekStart);
  $("#week-range").textContent = formatWeekRange(selectedWeekStart);
  $("#week-list").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    const dinner = getSlotAssignments(week, "dinner", index);
    const lunch = getSlotAssignments(week, "lunch", index);
    const hasPlan = dinner.length > 0 || lunch.length > 0;
    return `<article class="day-card ${localDateKey(date) === todayKey ? "today" : ""}">
      <div class="day-meta"><strong>${escapeHtml(formatDay(date))}</strong><span>${escapeHtml(formatDateShort(date))}</span></div>
      <div class="day-slots">
        ${mealPeriodMarkup("dinner", index, dinner)}
        ${mealPeriodMarkup("lunch", index, lunch)}
      </div>
      <div class="day-actions" aria-label="${escapeHtml(formatDayLong(date))} actions">
        <button type="button" data-save-day="${index}"${hasPlan ? "" : " disabled"}>Save</button>
        <button type="button" data-load-day="${index}">Load</button>
        <button type="button" data-clear-day-plan="${index}"${hasPlan ? "" : " disabled"}>Clear</button>
      </div>
    </article>`;
  }).join("");
}

function mealUsageText(meal) {
  if (!meal.lastUsedAt) return `${meal.ingredients.length} item${meal.ingredients.length === 1 ? "" : "s"}`;
  const date = new Date(meal.lastUsedAt);
  return `Last used ${formatDateShort(date)} · ${meal.ingredients.length} item${meal.ingredients.length === 1 ? "" : "s"}`;
}

function mealRatingText(rating) {
  const value = normaliseMealRating(rating);
  return value ? `${"★".repeat(value)}${"☆".repeat(5 - value)}` : "";
}

function cleanActiveTagFilters(filters, tags) {
  const known = new Set(tags.map(keyName));
  return (Array.isArray(filters) ? filters : []).filter((tag, index, all) => {
    const key = keyName(tag);
    return known.has(key) && all.findIndex(value => keyName(value) === key) === index;
  });
}

function toggleTagFilter(filters, tag) {
  const key = keyName(tag);
  const index = filters.findIndex(value => keyName(value) === key);
  if (index >= 0) filters.splice(index, 1);
  else filters.push(tag);
}

function mealHasAllTags(meal, filters) {
  if (!filters.length) return true;
  const tags = new Set(normaliseMealTags(meal.tags).map(keyName));
  return filters.every(filter => tags.has(keyName(filter)));
}

function renderMealFilters() {
  const tags = knownMealTags();
  mealTagFilters = cleanActiveTagFilters(mealTagFilters, tags);
  const options = ["all", ...tags];
  $("#meal-tag-filters").innerHTML = options.map(tag => {
    const label = tag === "all" ? "All" : tag;
    const active = tag === "all" ? mealTagFilters.length === 0 : mealTagFilters.some(value => keyName(value) === keyName(tag));
    return `<button class="meal-filter-chip ${active ? "active" : ""}" type="button" data-meal-tag-filter="${escapeHtml(tag)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
  }).join("");
  $("#meal-rating-filter").value = mealRatingFilter;
}

function mealMatchesRatingValue(meal, filterValue) {
  const rating = normaliseMealRating(meal.rating);
  if (filterValue === "unrated") return rating === 0;
  if (["3", "4", "5"].includes(filterValue)) return rating >= Number(filterValue);
  return true;
}

function mealMatchesRating(meal) {
  return mealMatchesRatingValue(meal, mealRatingFilter);
}

function normaliseLibrary(raw) {
  const clean = raw && typeof raw === "object" ? clone(raw) : {};
  clean.schemaVersion = Number(clean.schemaVersion) || 1;
  clean.libraryVersion = Number(clean.libraryVersion) || 1;
  clean.updatedAt = clean.updatedAt || new Date().toISOString();
  clean.sources = Array.isArray(clean.sources) ? clean.sources.filter(source => source?.id && source?.title) : [];
  clean.packs = Array.isArray(clean.packs) ? clean.packs.filter(pack => pack?.id && pack?.title).map(pack => ({
    ...pack,
    description: normaliseName(pack.description || ""),
    access: pack.access || "free",
    type: pack.type || "curated"
  })) : [];
  clean.recipes = Array.isArray(clean.recipes) ? clean.recipes.filter(recipe => recipe?.id && recipe?.title).map(recipe => {
    const { sides: _legacySides, ...recipeWithoutLegacySides } = recipe;
    return {
    ...recipeWithoutLegacySides,
    title: normaliseName(recipe.title),
    servings: normaliseName(recipe.servings || ""),
    tags: Array.from(new Set((recipe.tags || []).map(normaliseName).filter(Boolean))),
    packIds: Array.from(new Set((recipe.packIds || []).filter(id => clean.packs.some(pack => pack.id === id)))),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(ingredient => ({
      name: titleStyleName(normaliseName(ingredient?.name)),
      qty: normaliseName(ingredient?.qty),
      unit: normaliseName(ingredient?.unit),
      category: CATEGORIES.includes(ingredient?.category) ? ingredient.category : guessIngredientCategory(ingredient?.name || "")
    })).filter(ingredient => ingredient.name) : [],
    method: normaliseMethod(recipe.method),
    sourceId: recipe.sourceId || null,
    sourceUrl: recipe.sourceUrl || null
    };
  }) : [];
  return clean;
}

async function loadRecipeLibrary() {
  if (recipeLibraryLoaded) return recipeLibrary;
  if (recipeLibraryPromise) return recipeLibraryPromise;
  recipeLibraryPromise = (async () => {
    let base = null;
    try {
      const response = await fetch(RECIPE_LIBRARY_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Library HTTP ${response.status}`);
      base = await response.json();
    } catch (error) {
      console.warn("Recipe library could not be loaded from the app bundle:", error);
    }
    let override = null;
    if (LIBRARY_ADMIN_ENABLED) {
      try { override = JSON.parse(localStorage.getItem(LIBRARY_ADMIN_OVERRIDE_KEY) || "null"); } catch (_) {}
    }
    recipeLibrary = normaliseLibrary(override || base || recipeLibrary);
    recipeLibraryLoaded = true;
    return recipeLibrary;
  })().finally(() => { recipeLibraryPromise = null; });
  return recipeLibraryPromise;
}

function librarySource(id) { return recipeLibrary.sources.find(source => source.id === id) || null; }
function libraryPack(id) { return recipeLibrary.packs.find(pack => pack.id === id) || null; }
function libraryRecipe(id) { return recipeLibrary.recipes.find(recipe => recipe.id === id) || null; }
function addedLibraryMeal(recipeId) { return data.meals.find(meal => !meal.deletedAt && meal.libraryRecipeId === recipeId) || null; }

function libraryPackCount(packId) {
  return recipeLibrary.recipes.filter(recipe => recipe.packIds.includes(packId)).length;
}

function renderLibraryPacks() {
  const packs = recipeLibrary.packs;
  const buttons = [{ id: "all", title: "All recipes" }, ...packs];
  $("#library-pack-strip").innerHTML = buttons.map(pack => {
    const active = librarySelectedPackId === pack.id;
    const count = pack.id === "all" ? recipeLibrary.recipes.length : libraryPackCount(pack.id);
    return `<button class="library-pack-chip ${active ? "active" : ""}" type="button" data-library-pack="${escapeHtml(pack.id)}" aria-pressed="${active}"><strong>${escapeHtml(pack.title)}</strong><small>${count}</small></button>`;
  }).join("");
}

function renderLibraryPackSummary() {
  const panel = $("#library-pack-summary");
  const pack = librarySelectedPackId === "all" ? null : libraryPack(librarySelectedPackId);
  panel.hidden = !pack;
  if (!pack) { panel.innerHTML = ""; return; }
  const recipeIds = recipeLibrary.recipes.filter(recipe => recipe.packIds.includes(pack.id)).map(recipe => recipe.id);
  const missing = recipeIds.filter(id => !addedLibraryMeal(id)).length;
  panel.innerHTML = `<div><strong>${escapeHtml(pack.title)}</strong><p>${escapeHtml(pack.description || "Recipe collection")}</p></div><button class="small-add-button" type="button" data-add-library-pack="${escapeHtml(pack.id)}" ${missing ? "" : "disabled"}>${missing ? `Add pack · ${missing}` : "Pack added"}</button>`;
}

function libraryRecipeMatches(recipe, query) {
  if (librarySelectedPackId !== "all" && !recipe.packIds.includes(librarySelectedPackId)) return false;
  if (!query) return true;
  const haystack = [recipe.title, recipe.servings, ...(recipe.tags || []), ...(recipe.ingredients || []).map(item => item.name), ...recipe.packIds.map(id => libraryPack(id)?.title || "")].join(" ");
  return keyName(haystack).includes(query);
}

function renderRecipeLibrary() {
  if (!recipeLibraryLoaded) return;
  renderLibraryPacks();
  renderLibraryPackSummary();
  const query = keyName($("#library-search").value);
  const recipes = recipeLibrary.recipes.filter(recipe => libraryRecipeMatches(recipe, query)).sort((a, b) => a.title.localeCompare(b.title));
  $("#library-recipe-list").innerHTML = recipes.length ? recipes.map(recipe => {
    const added = !!addedLibraryMeal(recipe.id);
    const packNames = recipe.packIds.filter(id => id !== "pdr-starter").slice(0, 2).map(id => libraryPack(id)?.title).filter(Boolean);
    const source = librarySource(recipe.sourceId);
    return `<article class="library-recipe-card"><button class="library-recipe-open" type="button" data-library-recipe="${escapeHtml(recipe.id)}"><span><strong>${escapeHtml(recipe.title)}</strong><small>${escapeHtml([recipe.servings ? `${recipe.servings} servings` : "", ...packNames].filter(Boolean).join(" · ") || source?.title || "Recipe")}</small></span><span class="library-added-state ${added ? "added" : ""}">${added ? "Added" : "View"}</span></button>${libraryAdminMode ? `<button class="library-inline-edit" type="button" data-library-edit="${escapeHtml(recipe.id)}">Edit</button>` : ""}</article>`;
  }).join("") : `<div class="empty-state"><strong>No library recipes found</strong><p>Try another search or collection.</p></div>`;
  $("#library-admin-tools").hidden = !(LIBRARY_ADMIN_ENABLED && libraryAdminMode);
  const adminToggle = $("#library-admin-toggle");
  adminToggle.hidden = !LIBRARY_ADMIN_ENABLED;
  adminToggle.classList.toggle("active", libraryAdminMode);
  adminToggle.textContent = libraryAdminMode ? "Done" : "Admin";
}

async function openRecipeLibrary() {
  openOverlay("recipe-library-overlay");
  $("#library-recipe-list").innerHTML = `<div class="empty-state"><strong>Loading recipes…</strong></div>`;
  try {
    await loadRecipeLibrary();
    renderRecipeLibrary();
  } catch (error) {
    $("#library-recipe-list").innerHTML = `<div class="empty-state"><strong>Library unavailable</strong><p>${escapeHtml(error?.message || "Try again when online.")}</p></div>`;
  }
}

function renderLibraryRecipeDetail(recipeId) {
  const recipe = libraryRecipe(recipeId);
  if (!recipe) return;
  activeLibraryRecipeId = recipe.id;
  $("#library-recipe-title").textContent = recipe.title;
  const source = librarySource(recipe.sourceId);
  const packNames = recipe.packIds.map(id => libraryPack(id)?.title).filter(Boolean);
  $("#library-detail-meta").innerHTML = `<div class="library-detail-chips">${recipe.servings ? `<span>${escapeHtml(recipe.servings)} servings</span>` : ""}${recipe.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${packNames.length ? `<p>In ${escapeHtml(packNames.join(" · "))}</p>` : ""}${source ? `<p>Source: ${escapeHtml(source.title)} · ${escapeHtml(source.license || "")}</p>` : ""}`;
  const ingredients = recipe.ingredients.map(item => `<li><strong>${escapeHtml([item.qty, item.unit].filter(Boolean).join(" "))}</strong><span>${escapeHtml(item.name)}</span></li>`).join("");
  const method = recipe.method.map(step => `<li>${escapeHtml(step)}</li>`).join("");
  $("#library-detail-body").innerHTML = `<section class="recipe-detail-section"><h4>Ingredients</h4><ul class="recipe-ingredient-list">${ingredients}</ul></section><section class="recipe-detail-section"><h4>Method</h4>${method ? `<ol class="recipe-method-list">${method}</ol>` : `<p class="muted-copy">No method has been added yet.</p>`}</section>${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">View original source ↗</a>` : ""}`;
  const existing = addedLibraryMeal(recipe.id);
  const addButton = $("#library-add-recipe");
  addButton.textContent = existing ? "Already in my meals" : "Add to my meals";
  addButton.disabled = !!existing;
  $("#library-admin-edit").hidden = !(LIBRARY_ADMIN_ENABLED && libraryAdminMode);
}

function openLibraryRecipe(recipeId) {
  renderLibraryRecipeDetail(recipeId);
  openOverlay("library-recipe-overlay");
}

function addLibraryRecipe(recipeId, options = {}) {
  const recipe = libraryRecipe(recipeId);
  if (!recipe) return false;
  if (addedLibraryMeal(recipe.id)) return false;
  const now = new Date().toISOString();
  const ingredients = recipe.ingredients.map(raw => {
    const item = ensureItem(titleStyleName(raw.name), raw.category || guessIngredientCategory(raw.name));
    return { itemId: item.id, qty: normaliseName(raw.qty), unit: normaliseName(raw.unit) };
  });

  data.meals.push({
    id: uid("meal"),
    name: titleStyleName(recipe.title),
    ingredients,
    method: normaliseMethod(recipe.method),
    tags: [],
    rating: 0,
    sourceUrl: recipe.sourceUrl || null,
    libraryRecipeId: recipe.id,
    librarySourceId: recipe.sourceId || null,
    createdAt: now,
    updatedAt: now,
    updatedBy: currentMemberId(),
    deletedAt: null,
    lastUsedAt: null
  });
  touchSharedState(now);
  if (!options.deferSave) {
    saveData({ immediateCloud: true });
    renderAll();
    renderRecipeLibrary();
    if (activeLibraryRecipeId === recipe.id) renderLibraryRecipeDetail(recipe.id);
    showToast(`${recipe.title} added`);
  }
  return true;
}

function addLibraryPack(packId) {
  const pack = libraryPack(packId);
  if (!pack) return;
  const recipes = recipeLibrary.recipes.filter(recipe => recipe.packIds.includes(packId));
  let added = 0;
  recipes.forEach(recipe => { if (addLibraryRecipe(recipe.id, { deferSave: true })) added += 1; });
  if (!added) return showToast("That pack is already added");
  saveData({ immediateCloud: true });
  renderAll();
  renderRecipeLibrary();
  showToast(`${added} recipe${added === 1 ? "" : "s"} added`);
}

function saveLibraryDraft() {
  recipeLibrary.updatedAt = new Date().toISOString();
  recipeLibrary.libraryVersion = (Number(recipeLibrary.libraryVersion) || 1) + 1;
  localStorage.setItem(LIBRARY_ADMIN_OVERRIDE_KEY, JSON.stringify(recipeLibrary));
  recipeLibraryLoaded = true;
}

function exportRecipeLibrary() {
  const blob = new Blob([JSON.stringify(recipeLibrary, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "recipe-library.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Library JSON exported");
}

function openLibraryAdminEditor(recipeId = null) {
  if (!LIBRARY_ADMIN_ENABLED) return;
  const recipe = recipeId ? libraryRecipe(recipeId) : null;
  editingLibraryRecipeId = recipe?.id || null;
  $("#library-admin-editor-title").textContent = recipe ? "Edit library recipe" : "New library recipe";
  $("#library-admin-id").value = recipe?.id || "";
  $("#library-admin-title").value = recipe?.title || "";
  $("#library-admin-servings").value = recipe?.servings || "";
  $("#library-admin-source").innerHTML = recipeLibrary.sources.map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.title)}</option>`).join("");
  $("#library-admin-source").value = recipe?.sourceId || recipeLibrary.sources[0]?.id || "";
  $("#library-admin-source-url").value = recipe?.sourceUrl || "";
  $("#library-admin-tags").value = (recipe?.tags || []).join(", ");
  $("#library-admin-pack-checks").innerHTML = recipeLibrary.packs.map(pack => `<label class="library-pack-check"><input type="checkbox" value="${escapeHtml(pack.id)}" ${(recipe?.packIds || []).includes(pack.id) ? "checked" : ""}><span><strong>${escapeHtml(pack.title)}</strong><small>${escapeHtml(pack.description || "")}</small></span></label>`).join("");
  $("#library-admin-ingredients").value = (recipe?.ingredients || []).map(item => [item.qty || "", item.unit || "", item.name || "", item.category || "Other"].join(" | ")).join("\n");
  $("#library-admin-method").value = (recipe?.method || []).join("\n");
  $("#library-admin-delete").hidden = !recipe;
  openOverlay("library-admin-editor-overlay");
}

function saveLibraryAdminRecipe(event) {
  event.preventDefault();
  if (!LIBRARY_ADMIN_ENABLED) return;
  const title = normaliseName($("#library-admin-title").value);
  if (!title) return;
  const id = editingLibraryRecipeId || `admin-${keyName(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now().toString(36)}`;
  const ingredientLines = $("#library-admin-ingredients").value.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
  const ingredients = ingredientLines.map(line => {
    const [qty = "", unit = "", name = "", category = ""] = line.split("|").map(part => normaliseName(part));
    return { name, qty, unit, category: CATEGORIES.includes(category) ? category : guessIngredientCategory(name) };
  }).filter(item => item.name);
  const packIds = Array.from($("#library-admin-pack-checks").querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
  const next = {
    id,
    title: titleStyleName(title),
    servings: normaliseName($("#library-admin-servings").value),
    tags: Array.from(new Set($("#library-admin-tags").value.split(",").map(normaliseName).filter(Boolean))),
    packIds,
    sourceId: $("#library-admin-source").value || null,
    sourceUrl: normaliseName($("#library-admin-source-url").value) || null,
    ingredients,
    method: normaliseMethod($("#library-admin-method").value)
  };
  const index = recipeLibrary.recipes.findIndex(recipe => recipe.id === id);
  if (index >= 0) recipeLibrary.recipes[index] = next; else recipeLibrary.recipes.push(next);
  recipeLibrary = normaliseLibrary(recipeLibrary);
  saveLibraryDraft();
  closeOverlay("library-admin-editor-overlay");
  renderRecipeLibrary();
  if (activeLibraryRecipeId === id) renderLibraryRecipeDetail(id);
  showToast("Library draft saved");
}

function deleteLibraryAdminRecipe() {
  if (!LIBRARY_ADMIN_ENABLED || !editingLibraryRecipeId) return;
  const recipe = libraryRecipe(editingLibraryRecipeId);
  if (!recipe || !confirm(`Delete “${recipe.title}” from the master library draft?`)) return;
  recipeLibrary.recipes = recipeLibrary.recipes.filter(entry => entry.id !== editingLibraryRecipeId);
  saveLibraryDraft();
  closeOverlay("library-admin-editor-overlay");
  closeOverlay("library-recipe-overlay");
  renderRecipeLibrary();
  showToast("Library recipe removed");
}

function householdMealIngredientText(ingredient) {
  const item = findItem(ingredient.itemId);
  return [ingredient.qty, ingredient.unit, item?.name].filter(Boolean).join(" ");
}

function mealShoppingItemCount(meal) {
  return meal?.ingredients?.length || 0;
}

function startCookingMeal(mealId) {
  const meal = findMeal(mealId);
  if (!meal) return;
  if (!normaliseMethod(meal.method).length) return showToast("No cooking method has been added yet");
  openMealMethod(mealId);
}

function openMealMethod(mealId) {
  const meal = findMeal(mealId);
  if (!meal) return;
  activeMethodMealId = meal.id;
  $("#meal-method-title").textContent = meal.name;
  const ingredients = meal.ingredients.map(ingredient => `<li>${escapeHtml(householdMealIngredientText(ingredient))}</li>`).join("");
  const method = normaliseMethod(meal.method).map(step => `<li>${escapeHtml(step)}</li>`).join("");
  $("#meal-method-body").innerHTML = `<section class="recipe-detail-section"><h4>Ingredients</h4><ul class="meal-method-ingredients">${ingredients}</ul></section><section class="recipe-detail-section"><h4>Method</h4>${method ? `<ol class="recipe-method-list">${method}</ol>` : `<p class="muted-copy">No method has been added to this meal.</p>`}</section>${meal.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(meal.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source ↗</a>` : ""}`;
  openOverlay("meal-method-overlay");
}

function renderMeals() {
  renderMealFilters();
  const query = keyName($("#meal-search").value);
  const meals = data.meals
    .filter(meal => {
      if (meal.deletedAt) return false;
      const tags = normaliseMealTags(meal.tags);
      const matchesQuery = !query || keyName(meal.name).includes(query) || tags.some(tag => keyName(tag).includes(query));
      const matchesTag = mealHasAllTags(meal, mealTagFilters);
      return matchesQuery && matchesTag && mealMatchesRating(meal);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  $("#meal-list").innerHTML = meals.length ? meals.map(meal => {
    const names = meal.ingredients.slice(0, 4).map(ing => findItem(ing.itemId)?.name).filter(Boolean).join(", ");
    const tags = normaliseMealTags(meal.tags);
    const rating = mealRatingText(meal.rating);
    const meta = (rating || tags.length) ? `<div class="meal-card-meta">${rating ? `<span class="meal-card-rating" aria-label="${normaliseMealRating(meal.rating)} out of 5 stars">${rating}</span>` : ""}${tags.map(tag => `<button class="meal-tag-chip" type="button" data-meal-card-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}</div>` : "";
    const hasMethod = normaliseMethod(meal.method).length > 0;
    return `<article class="meal-card">
      <div class="meal-card-main"><h3>${escapeHtml(meal.name)}</h3>${meta}<p class="meal-ingredients-preview">${escapeHtml(names || "No shopping items yet")}${meal.ingredients.length > 4 ? "…" : ""}</p></div>
      <div class="meal-card-actions">
        ${hasMethod ? `<button class="meal-cook-button" type="button" data-cook-meal="${meal.id}" aria-label="Cook ${escapeHtml(meal.name)}">Cook</button>` : ""}
        <button class="meal-more-button" type="button" data-edit-meal="${meal.id}" aria-label="Edit ${escapeHtml(meal.name)}">•••</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty-state"><strong>No meals found</strong><p>Try another search, category or rating filter.</p></div>`;
}

function renderPickerFilters() {
  const tags = knownMealTags();
  pickerTagFilters = cleanActiveTagFilters(pickerTagFilters, tags);
  const options = ["all", ...tags];
  $("#picker-tag-filters").innerHTML = options.map(tag => {
    const label = tag === "all" ? "All" : tag;
    const active = tag === "all" ? pickerTagFilters.length === 0 : pickerTagFilters.some(value => keyName(value) === keyName(tag));
    return `<button class="meal-filter-chip ${active ? "active" : ""}" type="button" data-picker-tag-filter="${escapeHtml(tag)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
  }).join("");
  $("#picker-rating-filter").value = pickerRatingFilter;
}

function renderPicker() {
  renderPickerFilters();
  const query = keyName($("#picker-search").value);
  const matches = meal => {
    if (meal.deletedAt) return false;
    const tags = normaliseMealTags(meal.tags);
    const matchesQuery = !query || keyName(meal.name).includes(query) || tags.some(tag => keyName(tag).includes(query));
    const matchesTag = mealHasAllTags(meal, pickerTagFilters);
    return matchesQuery && matchesTag && mealMatchesRatingValue(meal, pickerRatingFilter);
  };
  let all = data.meals.filter(matches).sort((a, b) => a.name.localeCompare(b.name));
  if (pickerMode === "side") {
    const week = getWeek();
    const assignment = getSlotAssignments(week, pickerSlotType, pickerDayIndex).find(entry => entry.id === pickerAssignmentId);
    const blocked = new Set([assignment?.mealId, ...assignmentSideMealIds(assignment)].filter(Boolean));
    all = all.filter(meal => !blocked.has(meal.id));
  }
  const allowedIds = new Set(all.map(meal => meal.id));
  const recent = data.meals.filter(meal => meal.lastUsedAt && allowedIds.has(meal.id)).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt))).slice(0, 4);
  const recentIds = new Set(recent.map(meal => meal.id));
  const filtersActive = !!query || pickerTagFilters.length > 0 || pickerRatingFilter !== "any";
  let html = "";
  if (!filtersActive && recent.length) {
    html += `<div class="picker-section-title">Recent</div>`;
    html += recent.map(meal => pickerRow(meal)).join("");
    html += `<div class="picker-section-title">All meals</div>`;
    html += all.filter(meal => !recentIds.has(meal.id)).map(meal => pickerRow(meal)).join("");
  } else {
    html = all.length ? all.map(meal => pickerRow(meal)).join("") : `<div class="empty-state"><strong>No meals found</strong><p>Try another search, tag or rating.</p></div>`;
  }
  $("#picker-list").innerHTML = html;
}

function pickerRow(meal) {
  const tags = normaliseMealTags(meal.tags);
  const rating = mealRatingText(meal.rating);
  const meta = (rating || tags.length) ? `<span class="picker-row-meta meal-card-meta">${rating ? `<span class="meal-card-rating" aria-label="${normaliseMealRating(meal.rating)} out of 5 stars">${rating}</span>` : ""}${tags.map(tag => `<span class="meal-tag-chip">${escapeHtml(tag)}</span>`).join("")}</span>` : "";
  const count = mealShoppingItemCount(meal);
  return `<button class="picker-row" type="button" data-pick-meal="${meal.id}"><span class="picker-row-main"><strong>${escapeHtml(meal.name)}</strong>${meta}</span><span class="picker-row-count">${count} item${count === 1 ? "" : "s"}</span></button>`;
}

function normalisedAudienceIds(memberIds) {
  const allIds = activeMembers().map(member => member.id);
  if (!allIds.length || memberIds === null) return null;
  const active = new Set(allIds);
  const selected = Array.from(new Set((memberIds || []).filter(id => active.has(id))));
  if (selected.length === allIds.length && allIds.every(id => selected.includes(id))) return null;
  return selected;
}

function renderPickerAudience() {
  // Audience is intentionally not chosen in the meal picker. A normal meal
  // defaults to everyone; alternative meals ask who is eating it afterwards.
  const button = $("#picker-audience");
  if (button) button.hidden = true;
}

function openMealPicker(dayIndex, slotType = "dinner", assignmentId = null, mode = "replace") {
  pickerDayIndex = Number(dayIndex);
  pickerSlotType = slotType === "lunch" ? "lunch" : "dinner";
  pickerAssignmentId = assignmentId || null;
  pickerMode = mode;
  const date = addDays(selectedWeekStart, pickerDayIndex);
  const slotLabel = pickerSlotType === "lunch" ? "Lunch" : "Dinner";
  $("#meal-picker-kicker").textContent = pickerMode === "side" ? "CHOOSE SIDE" : "CHOOSE MEAL";
  $("#meal-picker-title").textContent = pickerMode === "alternative"
    ? `Alternative ${slotLabel.toLowerCase()} · ${formatDateShort(date)}`
    : pickerMode === "side"
      ? `Add side · ${formatDateShort(date)}`
      : `${formatDayLong(date)} ${slotLabel.toLowerCase()} · ${formatDateShort(date)}`;

  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const assignmentIndex = pickerAssignmentId ? assignments.findIndex(assignment => assignment.id === pickerAssignmentId) : -1;
  const assignment = assignmentIndex >= 0 ? assignments[assignmentIndex] : null;

  pickerAudienceMemberIds = assignment ? normalisedAudienceIds(assignment.memberIds) : null;
  renderPickerAudience();

  $("#clear-day").hidden = pickerMode === "alternative" || pickerMode === "side";
  if (pickerMode !== "alternative" && pickerMode !== "side") {
    $("#clear-day").textContent = assignments.length > 1 && assignmentIndex >= 0
      ? "Remove meal"
      : (pickerSlotType === "lunch" ? "Remove lunch" : "Clear dinner");
  }
  $("#no-dinner").hidden = pickerMode === "alternative" || pickerMode === "side" || pickerSlotType === "lunch" || assignments.length > 1 || assignmentIndex > 0;
  const notEatingButton = $("#not-eating");
  const hasMealAssignments = assignments.some(entry => entry.mealId !== NO_MEAL && entry.mealId !== NOT_EATING);
  const hasAvailableNotEatingMembers = activeMembers().some(member => !assignments.some(entry => entry.mealId === NOT_EATING && assignmentMemberIds(entry).includes(member.id)));
  notEatingButton.hidden = pickerMode === "alternative" || pickerMode === "side" || !activeMembers().length || !hasMealAssignments || !hasAvailableNotEatingMembers || assignment?.mealId === NOT_EATING;
  const rejoinButton = $("#rejoin-main");
  const hasMainMeal = assignments.some(entry => entry.mealId !== NO_MEAL && entry.mealId !== NOT_EATING && !!findMeal(entry.mealId));
  const canRestoreMainMeal = assignment?.mealId === NOT_EATING && !!findMeal(assignment.returnMealId);
  rejoinButton.hidden = pickerMode === "side" || assignment?.mealId !== NOT_EATING || (!hasMainMeal && !canRestoreMainMeal);
  renderPickerAssignmentFooter(assignments, assignment, assignmentIndex);
  $("#picker-search").value = "";
  pickerTagFilters = [];
  pickerRatingFilter = "any";
  renderPicker();
  openOverlay("meal-picker-overlay");
}

function renderPickerAssignmentFooter(assignments, assignment, assignmentIndex) {
  const footer = $("#picker-assignment-footer");
  const avatars = $("#picker-assignment-avatars");
  const removePeople = $("#remove-people");
  if (!footer || !avatars || !removePeople) return;
  const validAssignment = !!assignment && assignment.mealId !== NO_MEAL;
  footer.hidden = !validAssignment || pickerMode === "alternative" || pickerMode === "side";
  if (!validAssignment || pickerMode === "alternative" || pickerMode === "side") {
    avatars.innerHTML = "";
    removePeople.hidden = true;
    return;
  }
  const members = assignmentMemberIds(assignment).map(findMember).filter(Boolean);
  avatars.innerHTML = members.map(member => memberAvatar(member)).join("");
  removePeople.hidden = assignments.length < 2 || assignmentIndex < 0 || !members.length;
}

function assignmentDisplayName(assignment) {
  if (!assignment) return "meal";
  if (assignment.mealId === NOT_EATING) return "Not eating";
  if (assignment.mealId === NO_MEAL) return "No meal / eating out";
  return findMeal(assignment.mealId)?.name || "meal";
}

function movePeopleBetweenAssignments(assignments, assignmentId, memberIds, now) {
  const sourceIndex = assignments.findIndex(assignment => assignment.id === assignmentId);
  if (sourceIndex < 0 || assignments.length < 2) return assignments;
  const targetIndex = sourceIndex === 0 ? 1 : 0;
  const source = assignments[sourceIndex];
  const target = assignments[targetIndex];
  if (!target) return assignments;
  const sourceIds = assignmentMemberIds(source);
  const selected = new Set((memberIds || []).filter(id => sourceIds.includes(id)));
  if (!selected.size) return assignments;
  const remainingSourceIds = sourceIds.filter(id => !selected.has(id));
  const mergedTargetIds = Array.from(new Set([...assignmentMemberIds(target), ...selected]));
  const next = assignments.map(assignment => ({ ...assignment }));
  next[targetIndex] = {
    ...next[targetIndex],
    memberIds: normalisedAudienceIds(mergedTargetIds),
    updatedAt: now,
    updatedBy: currentMemberId()
  };
  if (remainingSourceIds.length) {
    next[sourceIndex] = {
      ...next[sourceIndex],
      memberIds: normalisedAudienceIds(remainingSourceIds),
      updatedAt: now,
      updatedBy: currentMemberId()
    };
  } else {
    next.splice(sourceIndex, 1);
  }
  return normaliseSplitSlot(next);
}

function openRemovePeopleFromMeal() {
  if (!pickerAssignmentId) return;
  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const sourceIndex = assignments.findIndex(assignment => assignment.id === pickerAssignmentId);
  if (sourceIndex < 0 || assignments.length < 2) return;
  const assignment = assignments[sourceIndex];
  closeOverlay("meal-picker-overlay");
  openSplitMembers(pickerDayIndex, pickerSlotType, assignment.id, "remove", []);
}

function normaliseSplitSlot(assignments) {
  const members = activeMembers();
  const activeIds = new Set(members.map(member => member.id));
  const clean = assignments
    .filter(assignment => assignment && assignment.mealId)
    .map(assignment => ({
      ...assignment,
      memberIds: assignment.memberIds === null ? null : Array.from(new Set((assignment.memberIds || []).filter(id => activeIds.has(id))))
    }))
    .filter(assignment => assignment.memberIds === null || assignment.memberIds.length);

  // A person can move from Not eating (or another alternative) back onto a
  // meal that already exists in the slot. Collapse those duplicate rows so
  // the planner always shows one assignment per meal/state.
  const merged = [];
  clean.forEach(assignment => {
    const existing = merged.find(entry => entry.mealId === assignment.mealId);
    if (!existing) {
      merged.push({ ...assignment, memberIds: assignment.memberIds === null ? null : [...assignment.memberIds] });
      return;
    }
    if (existing.memberIds === null || assignment.memberIds === null) {
      existing.memberIds = null;
    } else {
      existing.memberIds = Array.from(new Set([...existing.memberIds, ...assignment.memberIds]));
    }
    existing.sideMealIds = cleanSideMealIds([...(existing.sideMealIds || []), ...(assignment.sideMealIds || [])], existing.mealId);
    if (String(assignment.updatedAt || "") > String(existing.updatedAt || "")) {
      existing.updatedAt = assignment.updatedAt;
      existing.updatedBy = assignment.updatedBy;
    }
  });

  if (merged.length === 1 && members.length) {
    const ids = merged[0].memberIds;
    if (ids === null || (ids.length === members.length && members.every(member => ids.includes(member.id)))) merged[0].memberIds = null;
  }
  return merged;
}

function applyMealToAudience(assignments, mealId, assignmentId, audienceIds, now) {
  const allIds = activeMembers().map(member => member.id);
  if (!allIds.length) {
    const existing = assignmentId ? assignments.find(assignment => assignment.id === assignmentId) : null;
    if (existing) return [{ ...existing, mealId, memberIds: null, updatedAt: now, updatedBy: currentMemberId() }];
    return [makeAssignment(mealId, null, now, null, currentMemberId())];
  }

  const compact = normalisedAudienceIds(audienceIds);
  const selectedIds = compact === null ? allIds : compact;
  if (!selectedIds.length) return assignments;
  const selected = new Set(selectedIds);

  // Choosing All intentionally makes this the only meal for the slot.
  if (compact === null) {
    const existing = assignmentId ? assignments.find(assignment => assignment.id === assignmentId) : null;
    if (existing) return [{ ...existing, mealId, memberIds: null, updatedAt: now, updatedBy: currentMemberId() }];
    return [makeAssignment(mealId, null, now, null, currentMemberId())];
  }

  let targetFound = false;
  const next = [];
  assignments.forEach(assignment => {
    if (assignment.id === assignmentId) {
      targetFound = true;
      next.push({ ...assignment, mealId, memberIds: selectedIds, updatedAt: now, updatedBy: currentMemberId() });
      return;
    }
    const existingIds = assignment.memberIds === null ? allIds : assignment.memberIds;
    const remainingIds = existingIds.filter(id => !selected.has(id));
    if (remainingIds.length) next.push({ ...assignment, memberIds: remainingIds, updatedAt: now, updatedBy: currentMemberId() });
  });

  if (!targetFound) next.push(makeAssignment(mealId, selectedIds, now, null, currentMemberId()));
  return normaliseSplitSlot(next);
}

function applyNotEatingToAudience(assignments, audienceIds, now) {
  const allIds = activeMembers().map(member => member.id);
  if (!allIds.length) return assignments;
  const selected = new Set((audienceIds || []).filter(id => allIds.includes(id)));
  if (!selected.size) return assignments;

  const existingNotEating = assignments.find(assignment => assignment.mealId === NOT_EATING);
  const mainMeal = assignments.find(assignment => assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING && !!findMeal(assignment.mealId));
  const returnMealId = existingNotEating?.returnMealId || mainMeal?.mealId || null;
  const notEatingIds = new Set(existingNotEating ? assignmentMemberIds(existingNotEating) : []);
  selected.forEach(id => notEatingIds.add(id));

  const next = [];
  assignments.forEach(assignment => {
    if (assignment.mealId === NOT_EATING) return;
    const remaining = assignmentMemberIds(assignment).filter(id => !selected.has(id));
    if (!remaining.length) return;
    next.push({ ...assignment, memberIds: normalisedAudienceIds(remaining), updatedAt: now, updatedBy: currentMemberId() });
  });

  const finalNotEatingIds = Array.from(notEatingIds);
  if (existingNotEating) {
    next.push({ ...existingNotEating, memberIds: normalisedAudienceIds(finalNotEatingIds), returnMealId, updatedAt: now, updatedBy: currentMemberId() });
  } else {
    const notEating = makeAssignment(NOT_EATING, normalisedAudienceIds(finalNotEatingIds), now, null, currentMemberId());
    notEating.returnMealId = returnMealId;
    next.push(notEating);
  }
  return normaliseSplitSlot(next);
}

function removeAlternativeAndRejoinMain(assignments, assignmentId, now) {
  const targetIndex = assignments.findIndex(assignment => assignment.id === assignmentId);
  if (targetIndex <= 0) return [];
  const target = assignments[targetIndex];
  const targetIds = assignmentMemberIds(target);
  const remaining = assignments.filter(assignment => assignment.id !== assignmentId).map(assignment => ({ ...assignment }));
  if (!remaining.length) return [];

  const primary = remaining[0];
  const mergedIds = Array.from(new Set([...assignmentMemberIds(primary), ...targetIds]));
  remaining[0] = {
    ...primary,
    memberIds: normalisedAudienceIds(mergedIds),
    updatedAt: now,
    updatedBy: currentMemberId()
  };
  return normaliseSplitSlot(remaining);
}

function addSideMealToAssignment(dayIndex, slotType, assignmentId, sideMealId) {
  const week = getWeek();
  const assignments = getSlotAssignments(week, slotType, dayIndex);
  const assignment = assignments.find(entry => entry.id === assignmentId);
  const sideMeal = findMeal(sideMealId);
  if (!assignment || !sideMeal || assignment.mealId === NO_MEAL || assignment.mealId === NOT_EATING || assignment.mealId === sideMealId) return false;
  assignment.sideMealIds = cleanSideMealIds([...(assignment.sideMealIds || []), sideMealId], assignment.mealId);
  const now = new Date().toISOString();
  assignment.updatedAt = now;
  assignment.updatedBy = currentMemberId();
  sideMeal.lastUsedAt = now;
  touchRecord(sideMeal, now);
  touchWeekField(week, slotType, dayIndex, now);
  syncLegacyWeekSlots(week);
  saveData();
  return true;
}

function removeSideMealFromAssignment(dayIndex, slotType, assignmentId, sideMealId) {
  const week = getWeek();
  const assignments = getSlotAssignments(week, slotType, dayIndex);
  const assignment = assignments.find(entry => entry.id === assignmentId);
  if (!assignment) return;
  const next = assignmentSideMealIds(assignment).filter(id => id !== sideMealId);
  if (next.length === assignmentSideMealIds(assignment).length) return;
  const now = new Date().toISOString();
  assignment.sideMealIds = next;
  assignment.updatedAt = now;
  assignment.updatedBy = currentMemberId();
  touchWeekField(week, slotType, dayIndex, now);
  syncLegacyWeekSlots(week);
  saveData();
  renderAll();
}

function rejoinNotEatingMembers(assignments, assignmentId, memberIds, now) {
  const source = assignments.find(assignment => assignment.id === assignmentId && assignment.mealId === NOT_EATING);
  let primary = assignments.find(assignment => assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING && !!findMeal(assignment.mealId));
  if (!source) return assignments;
  if (!primary && source.returnMealId && findMeal(source.returnMealId)) {
    primary = makeAssignment(source.returnMealId, [], now, null, currentMemberId());
  }
  if (!primary) return assignments;
  const sourceIds = assignmentMemberIds(source);
  const selected = new Set((memberIds || []).filter(id => sourceIds.includes(id)));
  if (!selected.size) return assignments;
  const remainingSource = sourceIds.filter(id => !selected.has(id));
  const mergedPrimary = Array.from(new Set([...assignmentMemberIds(primary), ...selected]));
  const next = assignments.map(assignment => ({ ...assignment }));
  let primaryIndex = next.findIndex(assignment => assignment.id === primary.id);
  const sourceIndex = next.findIndex(assignment => assignment.id === source.id);
  if (primaryIndex < 0) {
    next.unshift(primary);
    primaryIndex = 0;
  }
  next[primaryIndex] = { ...next[primaryIndex], memberIds: normalisedAudienceIds(mergedPrimary), updatedAt: now, updatedBy: currentMemberId() };
  const liveSourceIndex = next.findIndex(assignment => assignment.id === source.id);
  if (remainingSource.length) next[liveSourceIndex] = { ...next[liveSourceIndex], memberIds: normalisedAudienceIds(remainingSource), updatedAt: now, updatedBy: currentMemberId() };
  else next.splice(liveSourceIndex, 1);
  return normaliseSplitSlot(next);
}

function chooseMealForDay(mealId) {
  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const now = new Date().toISOString();

  if (pickerMode === "side") {
    if (mealId && addSideMealToAssignment(pickerDayIndex, pickerSlotType, pickerAssignmentId, mealId)) {
      closeOverlay("meal-picker-overlay");
      pickerMode = "replace";
      renderAll();
      showToast("Side added");
    }
    return;
  }

  // Adding an alternative is a two-stage flow: choose the food first, then
  // choose the household members who will have it.
  if (pickerMode === "alternative" && mealId && mealId !== NO_MEAL) {
    pendingAlternativeMealId = mealId;
    closeOverlay("meal-picker-overlay");
    openSplitMembers(pickerDayIndex, pickerSlotType, null, "alternative", []);
    return;
  }

  if (!mealId) {
    if (pickerAssignmentId) {
      const assignmentIndex = assignments.findIndex(assignment => assignment.id === pickerAssignmentId);
      if (assignmentIndex >= 0 && assignments.length > 1) {
        week.slots[pickerSlotType][pickerDayIndex] = movePeopleBetweenAssignments(
          assignments,
          pickerAssignmentId,
          assignmentMemberIds(assignments[assignmentIndex]),
          now
        );
      } else {
        week.slots[pickerSlotType][pickerDayIndex] = [];
      }
    } else {
      week.slots[pickerSlotType][pickerDayIndex] = [];
    }
  } else if (mealId === NO_MEAL) {
    week.slots[pickerSlotType][pickerDayIndex] = [makeAssignment(NO_MEAL, null, now, pickerAssignmentId || null, currentMemberId())];
  } else {
    // Normal meal selection defaults to everyone. Editing an existing split
    // assignment preserves the people already attached to that meal.
    const audience = pickerAssignmentId ? pickerAudienceMemberIds : null;
    week.slots[pickerSlotType][pickerDayIndex] = applyMealToAudience(
      assignments,
      mealId,
      pickerAssignmentId,
      audience,
      now
    );
  }

  touchWeekField(week, pickerSlotType, pickerDayIndex, now);
  const meal = mealId === NO_MEAL ? null : findMeal(mealId);
  if (meal) {
    meal.lastUsedAt = now;
    touchRecord(meal, now);
  }
  syncLegacyWeekSlots(week);
  saveData();
  pickerAudienceMemberIds = null;
  pickerMode = "replace";
  closeOverlay("meal-picker-overlay");
  renderAll();
}

function ingredientRow(ingredient = {}) {
  const item = findItem(ingredient.itemId);
  const selectedCategory = item?.category || ingredient.category || "Other";
  return `<div class="ingredient-row" data-ingredient-row>
    <div class="ingredient-row-main">
      <input class="text-input ingredient-name" list="ingredient-known-items" type="text" placeholder="Item" value="${escapeHtml(titleStyleName(item?.name || ingredient.name || ""))}" autocomplete="off" aria-label="Ingredient name">
      <input class="text-input ingredient-qty" type="text" inputmode="decimal" placeholder="Qty" value="${escapeHtml(ingredient.qty || "")}" aria-label="Quantity">
      <input class="text-input ingredient-unit" type="text" list="unit-list" placeholder="Unit" value="${escapeHtml(ingredient.unit || "")}" aria-label="Unit">
      <button class="remove-ingredient" type="button" aria-label="Remove item">×</button>
    </div>
    <select class="text-input select-input ingredient-category" aria-label="Shopping category">${categoryOptions(selectedCategory)}</select>
  </div>`;
}

function addIngredientRow(ingredient = {}) {
  $("#ingredient-list").insertAdjacentHTML("beforeend", ingredientRow(ingredient));
}

function renderMealTagEditor() {
  const tags = knownMealTags();
  const extras = editingMealTags.filter(tag => !tags.some(existing => keyName(existing) === keyName(tag)));
  const hidden = hiddenMealTagKeys();
  const allTags = [...tags, ...extras.filter(tag => !hidden.has(keyName(tag)))];
  $("#meal-tag-editor").innerHTML = allTags.map(tag => {
    const selected = editingMealTags.some(value => keyName(value) === keyName(tag));
    return `<button class="meal-editor-tag ${selected ? "selected" : ""} ${mealTagRemoveMode ? "remove-mode" : ""}" type="button" data-edit-meal-tag="${escapeHtml(tag)}" aria-pressed="${selected}" aria-label="${mealTagRemoveMode ? `Remove tag ${escapeHtml(tag)}` : escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }).join("");
  const removeButton = $("#meal-tag-remove");
  if (removeButton) {
    removeButton.classList.toggle("active", mealTagRemoveMode);
    removeButton.textContent = mealTagRemoveMode ? "Done" : "Remove";
    removeButton.setAttribute("aria-pressed", String(mealTagRemoveMode));
  }
}

function renderMealRatingEditor() {
  $("#meal-rating-editor").innerHTML = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return `<button class="meal-rating-star ${value <= editingMealRating ? "active" : ""}" type="button" data-edit-meal-rating="${value}" aria-label="${value} star${value === 1 ? "" : "s"}${editingMealRating === value ? "; tap again to clear" : ""}" aria-pressed="${editingMealRating === value}">★</button>`;
  }).join("");
}

function toggleEditingMealTag(tag) {
  const value = normaliseName(tag);
  if (!value) return;
  const index = editingMealTags.findIndex(existing => keyName(existing) === keyName(value));
  if (index >= 0) editingMealTags.splice(index, 1);
  else editingMealTags.push(DEFAULT_MEAL_TAGS.find(existing => keyName(existing) === keyName(value)) || value);
  editingMealTags = normaliseMealTags(editingMealTags);
  renderMealTagEditor();
}

function removeMealTagFromLibrary(tag) {
  const value = normaliseName(tag);
  if (!value) return;
  const affected = data.meals.filter(meal => !meal.deletedAt && normaliseMealTags(meal.tags).some(existing => keyName(existing) === keyName(value)));
  const detail = affected.length
    ? ` It will also be removed from ${affected.length} meal${affected.length === 1 ? "" : "s"}.`
    : "";
  if (!window.confirm(`Remove the tag “${value}”?${detail}`)) return;

  const now = new Date().toISOString();
  affected.forEach(meal => {
    meal.tags = normaliseMealTags(meal.tags).filter(existing => keyName(existing) !== keyName(value));
    meal.updatedAt = now;
    meal.updatedBy = currentMemberId();
  });

  const hidden = new Set((data.household.hiddenMealTags || []).map(keyName).filter(Boolean));
  hidden.add(keyName(value));
  data.household.hiddenMealTags = Array.from(hidden);
  touchRecord(data.household, now);

  editingMealTags = editingMealTags.filter(existing => keyName(existing) !== keyName(value));
  mealTagFilters = mealTagFilters.filter(existing => keyName(existing) !== keyName(value));
  pickerTagFilters = pickerTagFilters.filter(existing => keyName(existing) !== keyName(value));
  mealTagRemoveMode = false;
  saveData({ immediateCloud: true });
  renderMealTagEditor();
  renderMeals();
  if (!$("#meal-picker-overlay").hidden) renderPicker();
  showToast(`Removed “${value}” tag`);
}

function toggleMealTagRemoveMode() {
  mealTagRemoveMode = !mealTagRemoveMode;
  renderMealTagEditor();
}

function addCustomMealTag() {
  const input = $("#meal-tag-input");
  const value = normaliseName(input.value);
  if (!value) return;
  const hidden = new Set((data.household.hiddenMealTags || []).map(keyName).filter(Boolean));
  if (hidden.delete(keyName(value))) {
    data.household.hiddenMealTags = Array.from(hidden);
    touchRecord(data.household);
    saveData({ immediateCloud: true });
  }
  if (!editingMealTags.some(tag => keyName(tag) === keyName(value))) editingMealTags.push(value);
  editingMealTags = normaliseMealTags(editingMealTags);
  input.value = "";
  renderMealTagEditor();
}


function normaliseRecipeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function recipeSourceHost(value) {
  const url = normaliseRecipeUrl(value);
  return url ? url.hostname.replace(/^www\./, "") : "";
}

function renderMealSourceRow() {
  const row = $("#meal-source-row");
  const url = normaliseRecipeUrl(editingMealSourceUrl);
  row.hidden = !url;
  if (!url) return;
  $("#meal-source-host").textContent = recipeSourceHost(url.href);
  $("#meal-source-link").href = url.href;
}

function recipeNodeFromJson(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = recipeNodeFromJson(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const rawType = value["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some(type => String(type || "").toLowerCase() === "recipe") && Array.isArray(value.recipeIngredient)) return value;
  for (const child of Object.values(value)) {
    const found = recipeNodeFromJson(child);
    if (found) return found;
  }
  return null;
}

function instructionLinesFromValue(value) {
  const result = [];
  const walk = entry => {
    if (!entry) return;
    if (typeof entry === "string") { const text = normaliseName(entry); if (text) result.push(text); return; }
    if (Array.isArray(entry)) { entry.forEach(walk); return; }
    if (typeof entry === "object") {
      if (entry.text) walk(entry.text);
      else if (entry.itemListElement) walk(entry.itemListElement);
      else if (entry.name && String(entry["@type"] || "").toLowerCase().includes("step")) walk(entry.name);
    }
  };
  walk(value);
  return normaliseMethod(result);
}

function visibleMethodFromHtml(doc) {
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  const methodHeading = headings.find(node => /^(method|directions|instructions|preparation)\b/i.test(normaliseName(node.textContent).replace(/^[^A-Za-z0-9]+/, "")));
  if (!methodHeading) return [];
  const result = [];
  let node = methodHeading.nextElementSibling;
  while (node) {
    if (/^H[1-6]$/.test(node.tagName || "")) break;
    if (node.matches?.("ol,ul")) node.querySelectorAll(":scope > li").forEach(li => { const text = normaliseName(li.textContent); if (text) result.push(text); });
    else if (node.matches?.("p")) { const text = normaliseName(node.textContent); if (text) result.push(text); }
    else node.querySelectorAll?.("li,p").forEach(el => { const text = normaliseName(el.textContent); if (text) result.push(text); });
    node = node.nextElementSibling;
  }
  return normaliseMethod(result);
}

function recipeFromHtml(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const node = recipeNodeFromJson(JSON.parse(script.textContent || "null"));
      if (!node) continue;
      const ingredients = (node.recipeIngredient || []).map(value => normaliseName(String(value || ""))).filter(Boolean);
      if (!ingredients.length) continue;
      const yieldValue = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
      return {
        name: normaliseName(node.name || doc.querySelector("h1")?.textContent || "Imported recipe"),
        ingredients,
        method: instructionLinesFromValue(node.recipeInstructions),
        serves: normaliseName(yieldValue || ""),
        sourceUrl
      };
    } catch (_) {}
  }

  // Printable WordPress recipe-plugin pages often contain clean visible recipe
  // markup but no JSON-LD. Read their H1 and Ingredients list directly.
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  const ingredientsHeading = headings.find(node => /^ingredients\b/i.test(normaliseName(node.textContent).replace(/^[^A-Za-z0-9]+/, "")));
  if (!ingredientsHeading) return null;
  const endHeading = /^(method|directions|instructions|preparation|nutrition|notes?)\b/i;
  const ingredients = [];
  let node = ingredientsHeading.nextElementSibling;
  while (node) {
    if (/^H[1-6]$/.test(node.tagName || "")) {
      const heading = normaliseName(node.textContent);
      if (endHeading.test(heading)) break;
    }
    if (node.matches?.("ul,ol")) {
      node.querySelectorAll(":scope > li").forEach(li => {
        const text = normaliseName(li.textContent);
        if (text) ingredients.push(text);
      });
    } else {
      node.querySelectorAll?.("li").forEach(li => {
        const text = normaliseName(li.textContent);
        if (text) ingredients.push(text);
      });
    }
    node = node.nextElementSibling;
  }
  if (!ingredients.length) {
    ingredientsHeading.parentElement?.querySelectorAll("ul li, ol li").forEach(li => {
      const text = normaliseName(li.textContent);
      if (text) ingredients.push(text);
    });
  }
  if (!ingredients.length) return null;

  const h1s = Array.from(doc.querySelectorAll("h1")).map(node => normaliseName(node.textContent)).filter(Boolean);
  const metaTitle = normaliseName(doc.querySelector('meta[property="og:title"]')?.content || doc.title || "").replace(/\s+[|–—-]\s+[^|–—-]+$/, "");
  const yieldMatch = /\b(?:yield|serves|makes)\s*:\s*([^\n|]{1,30})/i.exec(doc.body?.innerText || "");
  return {
    name: h1s[0] || metaTitle || "Imported recipe",
    ingredients: Array.from(new Set(ingredients)),
    method: visibleMethodFromHtml(doc),
    serves: yieldMatch ? normaliseName(yieldMatch[1]) : "",
    sourceUrl
  };
}

function cleanMarkdownRecipeText(value) {
  return normaliseName(String(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:Input|Button:[^\]]*)\]/gi, "")
    .replace(/^\s*\[[ xX]\]\s*/, "")
    .replace(/[*_`]/g, "")
    .replace(/&nbsp;/gi, " "));
}

function markdownHeadingText(line) {
  const match = /^#{1,6}\s+(.+?)\s*$/.exec(String(line || "").trim());
  if (!match) return "";
  return cleanMarkdownRecipeText(match[1]).replace(/^[^A-Za-z0-9]+/, "").trim();
}

function recipeFromMarkdown(markdown, sourceUrl) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const headingAt = index => markdownHeadingText(lines[index]);
  const recipeHeadingIndex = lines.findIndex((line, index) => /^recipe\b/i.test(headingAt(index)));
  let start = -1;
  for (let i = Math.max(0, recipeHeadingIndex); i < lines.length; i += 1) {
    if (/^ingredients?\b/i.test(headingAt(i))) { start = i; break; }
  }
  if (start < 0) {
    start = lines.findIndex((line, index) => /^ingredients?\b/i.test(headingAt(index)));
  }
  if (start < 0) return null;

  let name = "";
  if (recipeHeadingIndex >= 0 && recipeHeadingIndex < start) {
    for (let i = start - 1; i > recipeHeadingIndex; i -= 1) {
      const heading = headingAt(i);
      if (!heading || /^(ingredients?|recipe|for the\b)/i.test(heading)) continue;
      name = heading;
      break;
    }
  }
  // Preserve the older importer behaviour for sites without a dedicated
  // Recipe heading: the page H1 is a safer title than a nearby editorial
  // subheading such as “What you need”.
  if (!name) {
    for (let i = start - 1; i >= 0; i -= 1) {
      if (!/^#\s+\S/.test(String(lines[i] || "").trim())) continue;
      const heading = headingAt(i);
      if (heading && !/^recipe\b/i.test(heading)) { name = heading; break; }
    }
  }
  if (!name) {
    let titleLine = lines.find(line => /^title\s*:/i.test(line.trim())) || "";
    name = cleanMarkdownRecipeText(titleLine.replace(/^title\s*:\s*/i, ""));
  }
  name = titleStyleName(name.replace(/\s+[|–—-]\s+[^|–—-]+$/, "").trim() || "Imported Recipe");

  const servesLine = lines.find(line => /^\s*(serves|servings|makes|yield)\b/i.test(cleanMarkdownRecipeText(line)));
  const serves = servesLine ? cleanMarkdownRecipeText(servesLine) : "";
  const endHeadings = /^(nutrition|method|directions|instructions|preparation|comments|notes|rate this recipe|video)\b/i;
  const collected = [];
  let current = "";
  const flush = () => { if (current) collected.push(cleanMarkdownRecipeText(current)); current = ""; };
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    const heading = headingAt(i);
    if (heading) {
      if (endHeadings.test(heading)) break;
      flush();
      continue;
    }
    if (!raw) continue;
    const isBullet = /^[-*+]\s+/.test(raw);
    const text = cleanMarkdownRecipeText(raw.replace(/^[-*+]\s+/, ""));
    if (!text || /^(units:?|metric\s*us|us conversions|loading\.{0,3}|ad|1x\s*2x\s*3x)$/i.test(text) || /^not all measurements/i.test(text) || /^cook mode\b/i.test(text)) continue;
    if (isBullet) {
      flush();
      current = text;
    } else if (current && text.length < 120 && !/^(keep the screen|print|save recipe)/i.test(text)) {
      current += ` ${text}`;
    }
  }
  flush();
  const ingredients = collected.filter(line => line && !/^nutrition\b/i.test(line));

  let methodStart = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^(method|directions|instructions|preparation)\b/i.test(headingAt(i))) { methodStart = i; break; }
  }
  const method = [];
  if (methodStart >= 0) {
    for (let i = methodStart + 1; i < lines.length; i += 1) {
      const raw = lines[i].trim();
      const heading = headingAt(i);
      if (heading) break;
      if (!raw) continue;
      const text = cleanMarkdownRecipeText(raw.replace(/^\d+[.)]\s+/, "").replace(/^[-*+]\s+/, ""));
      if (text && !/^(notes?|nutrition|rate this recipe|video)\b/i.test(text)) method.push(text);
    }
  }
  return ingredients.length ? { name, ingredients, method: normaliseMethod(method), serves, sourceUrl } : null;
}

function stripIngredientPreparation(value) {
  return normaliseName(String(value || "")
    .replace(/,.*$/, "")
    .replace(/\b(finely|roughly|thinly)\s+(chopped|sliced|diced)\b.*$/i, "")
    .replace(/\b(chopped|crushed|grated|diced|peeled|sliced)\b\s*$/i, ""));
}

function guessIngredientCategory(name) {
  const clean = keyName(name);
  const exact = findItemByName(name);
  if (exact) return exact.category;
  const known = data.items.filter(item => !item.deletedAt && keyName(item.name).length >= 4)
    .sort((a, b) => keyName(b.name).length - keyName(a.name).length)
    .find(item => clean.includes(keyName(item.name)) || keyName(item.name).includes(clean));
  if (known) return known.category;
  const has = words => words.some(word => clean.includes(word));
  if (has(["onion","garlic","tomato","pepper","chilli","potato","carrot","ginger","parsley","coriander","basil","spinach","mushroom","courgette","broccoli","avocado","lemon","lime","apple","banana","pea","sweetcorn","salad","lettuce"])) return "Fruit & veg";
  if (has(["chicken","beef","pork","lamb","turkey","bacon","sausage","salmon","tuna","cod","haddock","prawn","fish","mince"])) return "Meat & fish";
  if (has(["cheddar","mozzarella","mascarpone","cheese","milk","cream","butter","yoghurt","yogurt","egg","parmesan","feta"])) return "Chilled & dairy";
  if (has(["bread","roll","bun","wrap","tortilla","bagel","pitta","croissant"])) return "Bakery";
  if (has(["frozen","ice cream"])) return "Frozen";
  if (has(["juice","cola","lemonade","water","coffee","tea"])) return "Drinks";
  if (has(["pasta","penne","spaghetti","rice","oil","sugar","flour","stock","beans","lentil","chickpea","spice","paprika","cumin","oregano","thyme","salt","pepper","flakes","tomato puree","tomato purée"])) return "Cupboard";
  return "Other";
}

function parseRecipeIngredient(raw) {
  let line = cleanMarkdownRecipeText(raw).replace(/^[-*+]\s+/, "").replace(/^\[?Input\]?\s*/i, "");
  line = line.replace(/\s+/g, " ").trim();
  const fraction = "(?:\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])";
  let qty = "";
  let unit = "";
  let name = line;

  const composite = new RegExp(`^(${fraction})\\s*[x×]\\s*(${fraction})\\s*(g|kg|ml|l)\\s*(cans?|tins?|packs?|jars?|bottles?|tubs?)?\\s+(.+)$`, "i").exec(line);
  if (composite) {
    qty = `${composite[1]} × ${composite[2]}`;
    unit = `${composite[3]}${composite[4] ? ` ${composite[4]}` : ""}`;
    name = composite[5];
  } else {
    const amount = new RegExp(`^(${fraction}(?:\\s*[-–]\\s*${fraction})?)\\s*(.*)$`, "i").exec(line);
    if (amount) {
      qty = amount[1].replace(",", ".");
      name = amount[2];
      const unitMatch = /^(tbsp|tablespoons?|tsp|teaspoons?|kg|g|ml|l|litres?|liters?|pints?|cloves?|cans?|tins?|jars?|packs?|packets?|tubs?|bottles?|slices?|handfuls?|bunch(?:es)?|small bunch|large bunch)\b\s*(?:of\s+)?(.*)$/i.exec(name);
      if (unitMatch) {
        const rawUnit = unitMatch[1].toLowerCase();
        unit = /^tablespoon/.test(rawUnit) ? "tbsp" : /^teaspoon/.test(rawUnit) ? "tsp" : unitMatch[1];
        name = unitMatch[2];
      }
    }
  }
  name = stripIngredientPreparation(name) || line;
  const nameKey = keyName(name);
  const known = findItemByName(name) || data.items
    .filter(item => !item.deletedAt && keyName(item.name).length >= 4)
    .sort((a, b) => keyName(b.name).length - keyName(a.name).length)
    .find(item => nameKey.includes(keyName(item.name)));
  if (known) name = known.name;
  else name = titleStyleName(name);
  return { name, qty, unit, category: guessIngredientCategory(name), raw: line };
}

async function fetchWithRecipeTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal, cache: "no-store" }); }
  finally { clearTimeout(timer); }
}

async function extractRecipeFromUrl(rawUrl) {
  const url = normaliseRecipeUrl(rawUrl);
  if (!url) throw new Error("Enter a valid http or https recipe link.");

  // Prefer the publisher's own Schema.org Recipe data when CORS allows it.
  try {
    const direct = await fetchWithRecipeTimeout(url.href, 6500);
    if (direct.ok) {
      const recipe = recipeFromHtml(await direct.text(), url.href);
      if (recipe) return recipe;
    }
  } catch (_) {}

  // Static PWAs cannot read many third-party pages because of CORS. For this
  // prototype, Reader is a fetch bridge only; parsing below remains rule-based.
  let response;
  try {
    response = await fetchWithRecipeTimeout(`https://r.jina.ai/${url.href}`, 18000);
  } catch (_) {
    throw new Error("The recipe page could not be reached. Check the link and try again.");
  }
  if (!response.ok) throw new Error(`The recipe page could not be read (${response.status}).`);
  const recipe = recipeFromMarkdown(await response.text(), url.href);
  if (!recipe) throw new Error("I could open that page, but couldn't find a clear ingredients section.");
  return recipe;
}

function setRecipeImportStatus(message = "", isError = false) {
  const status = $("#recipe-import-status");
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", !!isError);
}

function setPhotoImportStatus(message = "", isError = false) {
  const status = $("#recipe-photo-status");
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", !!isError);
}

function updatePhotoImportSelection() {
  const row = $("#recipe-photo-selection");
  if (!photoImportFiles.length) {
    row.hidden = true;
    row.textContent = "";
    $("#recipe-photo-read").disabled = true;
    return;
  }
  row.hidden = false;
  row.textContent = `${photoImportFiles.length} photo${photoImportFiles.length === 1 ? "" : "s"} selected`;
  $("#recipe-photo-read").disabled = false;
}

function selectRecipePhotos(event) {
  const files = Array.from(event.target.files || []).filter(file => file.type.startsWith("image/")).slice(0, 4);
  photoImportFiles = files;
  updatePhotoImportSelection();
  setPhotoImportStatus(files.length ? "Ready to read. Clear, straight-on photos work best." : "");
}

function loadOcrLibrary() {
  if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
  if (ocrScriptPromise) return ocrScriptPromise;
  ocrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => window.Tesseract?.createWorker ? resolve(window.Tesseract) : reject(new Error("The photo reader could not start."));
    script.onerror = () => reject(new Error("The photo reader could not be downloaded. Check your connection and try again."));
    document.head.appendChild(script);
  }).catch(error => { ocrScriptPromise = null; throw error; });
  return ocrScriptPromise;
}

async function imageFileForOcr(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const maxSide = 2600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function preparedOcrCrop(source, xFrac, yFrac, wFrac, hFrac, upscale = 1.55) {
  const sx = Math.max(0, Math.round(source.width * xFrac));
  const sy = Math.max(0, Math.round(source.height * yFrac));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * wFrac)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * hFrac)));
  const maxPixels = 4_600_000;
  let scale = upscale;
  if (sw * sh * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (sw * sh));
  scale = Math.max(1, scale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // Mild local-independent contrast normalisation works well for photographed
  // book pages while preserving anti-aliased text for Tesseract.
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    histogram[gray] += 1;
  }
  const total = canvas.width * canvas.height;
  const lowTarget = total * 0.015;
  const highTarget = total * 0.985;
  let low = 0, high = 255, running = 0;
  for (let i = 0; i < 256; i += 1) { running += histogram[i]; if (running >= lowTarget) { low = i; break; } }
  running = 0;
  for (let i = 0; i < 256; i += 1) { running += histogram[i]; if (running >= highTarget) { high = i; break; } }
  const range = Math.max(36, high - low);
  for (let i = 0; i < pixels.length; i += 4) {
    const raw = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    let value = ((raw - low) / range) * 255;
    value = Math.max(0, Math.min(255, (value - 128) * 1.22 + 138));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function cleanOcrRecipeLine(value) {
  let clean = normaliseName(String(value || "")
    .replace(/[•●▪◦·]/g, " ")
    .replace(/^[-–—]+\s*/, "")
    .replace(/\s*[|]\s*/g, " "));
  // Common photographed-page OCR substitutions at the start of quantities.
  clean = clean
    .replace(/^\s*[|Il]\s+(?=[A-Za-z])/i, "1 ")
    .replace(/^\s*[|Il](?=\d)/i, "1")
    .replace(/\b[®©]\b/g, "&");
  return clean.trim();
}

function ocrLineLooksLikeMetadata(line) {
  return /^(serves?|makes?|prep(?:aration)?|cook(?:ing)?|ready in|total time|difficulty|page\s+\d+|\d+\s*(mins?|minutes?|hrs?|hours?))\b/i.test(line) || /^\d+$/.test(line);
}

function ocrLineLooksLikeIngredient(line) {
  const clean = cleanOcrRecipeLine(line);
  if (!clean || clean.length > 120) return false;
  if (/^(method|directions|instructions|preparation|step\s+\d+|how to|heat |preheat |cook |stir |mix |place |add the |when |meanwhile |for the pickled|assemble )/i.test(clean)) return false;
  const afterLeadingNumber = clean.replace(/^(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*[-–]\s*(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s+/, "");
  if (afterLeadingNumber !== clean && /^(heat|preheat|cook|stir|mix|place|add|pour|bake|fry|roast|season|bring|leave|transfer|serve)\b/i.test(afterLeadingNumber)) return false;
  if (/^(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*[-–]\s*(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s*(?:x|×)?\s*(?:\d+(?:[.,]\d+)?)?\s*(?:g|kg|ml|l|cm|tbsp|tsp|cups?|cloves?|cans?|tins?|packs?|packets?|jars?|bottles?|bunch(?:es)?|handfuls?|slices?|lettuces?)?\b/i.test(clean)) return true;
  return /^(?:a|an)\s+(?:small|medium|large)?\s*\w+|^(?:pinch|handful|salt|pepper|oil)\b/i.test(clean);
}

function dedupeOcrLines(lines) {
  const seen = new Set();
  const output = [];
  lines.forEach(line => {
    const clean = cleanOcrRecipeLine(line);
    const key = keyName(clean).replace(/\d+/g, match => match);
    if (!clean || !key || seen.has(key)) return;
    seen.add(key);
    output.push(clean);
  });
  return output;
}

function scoreOcrIngredientText(text) {
  const lines = String(text || "").split(/\n+/).map(cleanOcrRecipeLine).filter(Boolean);
  let score = 0;
  if (lines.some(line => /^ingredients?\b/i.test(line))) score += 45;
  if (lines.some(line => /^(method|directions|instructions)\b/i.test(line))) score -= 28;
  lines.forEach(line => {
    if (ocrLineLooksLikeIngredient(line)) score += 4;
    if (/^(add|mix|stir|cook|fry|heat|when|meanwhile|place|serve|for the)\b/i.test(line)) score -= 3;
  });
  return score;
}

function ingredientLinesFromOcr(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map(cleanOcrRecipeLine).filter(Boolean);
  const ingredientHeading = /^ingredients?\s*:?$/i;
  const stopHeading = /^(method|directions|instructions|preparation|steps?|how to make|cooking method|to cook)\s*:?$/i;
  const start = lines.findIndex(line => ingredientHeading.test(line));
  const source = start >= 0 ? lines.slice(start + 1) : lines;
  const output = [];
  for (const line of source) {
    if (stopHeading.test(line)) break;
    if (ocrLineLooksLikeMetadata(line)) continue;
    if (/^for (?:the )?\w+(?:\s+\w+){0,3}:?$/i.test(line) && !/\d/.test(line)) continue;
    if (ocrLineLooksLikeIngredient(line)) output.push(line.replace(/^\d+[.)]\s+/, ""));
  }
  return dedupeOcrLines(output);
}

function recipeNameFromTitleOcr(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n")
    .map(line => cleanOcrRecipeLine(line).replace(/[®©@]/g, "&").replace(/^[^A-Za-z0-9]+/, ""))
    .filter(line => line.length >= 4 && line.length <= 90)
    .filter(line => !ocrLineLooksLikeMetadata(line) && !/^(ingredients?|method)\b/i.test(line));
  if (!lines.length) return "Imported recipe";
  let candidate = lines[lines.length - 1]
    .replace(/^[il1]\s+(?=[A-Z])/i, "")
    .replace(/\s*[®©]\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[A-Z0-9 '&-]{4,}$/.test(candidate)) {
    candidate = candidate.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
  }
  return candidate || "Imported recipe";
}

async function recogniseOcrRegion(worker, canvas, psm = "6") {
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
  const result = await worker.recognize(canvas, { rotateAuto: false });
  return result?.data?.text || "";
}

async function ocrCookbookPhoto(worker, source, photoNumber, photoCount) {
  setPhotoImportStatus(`Reading title · photo ${photoNumber} of ${photoCount}…`);
  const titleCanvas = preparedOcrCrop(source, 0.16, 0.055, 0.82, 0.23, 1.7);
  const titleText = await recogniseOcrRegion(worker, titleCanvas, "6");

  // Most cookbook spreads use a left/right column arrangement. OCR both sides
  // independently and choose the side that behaves most like an ingredient list.
  const sideSpecs = [
    { name: "left", x: 0.00, width: 0.47 },
    { name: "right", x: 0.53, width: 0.47 }
  ];
  const sliceSpecs = [
    { y: 0.25, h: 0.29 },
    { y: 0.47, h: 0.29 },
    { y: 0.69, h: 0.29 }
  ];
  const sideResults = [];
  for (const side of sideSpecs) {
    const parts = [];
    for (let i = 0; i < sliceSpecs.length; i += 1) {
      setPhotoImportStatus(`Scanning ${side.name} column · photo ${photoNumber} of ${photoCount}…`);
      const slice = sliceSpecs[i];
      const crop = preparedOcrCrop(source, side.x, slice.y, side.width, slice.h, 1.65);
      const text = await recogniseOcrRegion(worker, crop, "6");
      if (text) parts.push(text);
    }
    const text = parts.join("\n");
    sideResults.push({ ...side, text, score: scoreOcrIngredientText(text), ingredients: ingredientLinesFromOcr(text) });
  }
  sideResults.sort((a, b) => (b.score + b.ingredients.length * 2) - (a.score + a.ingredients.length * 2));
  const best = sideResults[0];

  // If neither side yields a useful list, fall back to the older whole-page
  // reading rather than failing immediately (useful for single-column recipes).
  if (!best || best.ingredients.length < 2) {
    setPhotoImportStatus(`Trying full page · photo ${photoNumber} of ${photoCount}…`);
    const full = preparedOcrCrop(source, 0, 0.04, 1, 0.92, 1.25);
    const fullText = await recogniseOcrRegion(worker, full, "3");
    const recipe = recipeFromOcrText(fullText);
    return recipe ? { name: recipe.name, serves: recipe.serves, ingredients: recipe.ingredients } : null;
  }

  const metaText = titleText;
  const servesMatch = /\b(serves?|makes?)\s*[:|-]?\s*\d+\b/i.exec(metaText);
  return {
    name: recipeNameFromTitleOcr(titleText),
    serves: servesMatch ? servesMatch[0] : "",
    ingredients: best.ingredients
  };
}

function recipeFromOcrText(rawText) {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n").map(cleanOcrRecipeLine).filter(Boolean);
  if (!lines.length) return null;
  const ingredientHeading = /^(ingredients?|you(?:'|’)ll need|you will need|what you need|shopping list)\s*:?\s*$/i;
  const stopHeading = /^(method|directions|instructions|preparation|steps?|how to make|cooking method|to cook)\s*:?\s*$/i;
  let start = lines.findIndex(line => ingredientHeading.test(line));
  let ingredientLines = [];

  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (stopHeading.test(line)) break;
      if (/^for (?:the )?\w+(?:\s+\w+){0,3}:?$/i.test(line) && !/\d/.test(line)) continue;
      if (ocrLineLooksLikeMetadata(line)) continue;
      if (ocrLineLooksLikeIngredient(line)) ingredientLines.push(line);
    }
  } else {
    ingredientLines = lines.filter(ocrLineLooksLikeIngredient);
    start = ingredientLines.length ? lines.indexOf(ingredientLines[0]) : -1;
  }

  ingredientLines = dedupeOcrLines(ingredientLines
    .map(line => line.replace(/^\d+[.)]\s+/, ""))
    .filter(line => line.length > 1 && !stopHeading.test(line)));

  if (ingredientLines.length < 2) return null;

  const before = lines.slice(0, Math.max(0, start)).filter(line => !ingredientHeading.test(line) && !ocrLineLooksLikeMetadata(line) && line.length >= 3 && line.length <= 90);
  let name = before.length ? before[before.length - 1] : "Imported recipe";
  if (/^[A-Z0-9 '&-]{4,}$/.test(name)) name = name.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
  const serves = lines.find(line => /^(serves?|makes?)\b/i.test(line)) || "";
  return { name, ingredients: ingredientLines, serves, sourceUrl: null };
}

async function importRecipeFromPhotos() {
  if (!photoImportFiles.length) return;
  const button = $("#recipe-photo-read");
  button.disabled = true;
  button.textContent = "Reading photos…";
  setPhotoImportStatus("Loading the on-device photo reader…");
  let worker = null;
  let currentPhoto = 0;
  try {
    const Tesseract = await loadOcrLibrary();
    worker = await Tesseract.createWorker("eng", 1, {
      logger(message) {
        if (message.status === "recognizing text") {
          const percent = Math.round((message.progress || 0) * 100);
          setPhotoImportStatus(`Reading photo ${currentPhoto + 1} of ${photoImportFiles.length} · ${percent}%`);
        } else if (/loading|initializing/i.test(message.status || "")) {
          setPhotoImportStatus("Preparing the photo reader…");
        }
      }
    });

    const recipes = [];
    for (let index = 0; index < photoImportFiles.length; index += 1) {
      currentPhoto = index;
      setPhotoImportStatus(`Preparing photo ${index + 1} of ${photoImportFiles.length}…`);
      const image = await imageFileForOcr(photoImportFiles[index]);
      const recipe = await ocrCookbookPhoto(worker, image, index + 1, photoImportFiles.length);
      if (recipe) recipes.push(recipe);
    }

    if (!recipes.length) throw new Error("I could read text from the photos, but couldn't isolate a clear ingredient list. Try a straighter photo with the Ingredients section clearly visible.");
    const name = recipes.map(recipe => recipe.name).find(value => value && value !== "Imported recipe") || "Imported recipe";
    const serves = recipes.map(recipe => recipe.serves).find(Boolean) || "";
    const rawIngredients = dedupeOcrLines(recipes.flatMap(recipe => recipe.ingredients || []));
    const ingredients = rawIngredients.map(parseRecipeIngredient).filter(item => item.name);
    if (!ingredients.length) throw new Error("No usable shopping ingredients were found in those photos.");
    closeOverlay("recipe-import-overlay");
    openMealEditor(null, { name, ingredients });
    showToast(`Read ${ingredients.length} shopping item${ingredients.length === 1 ? "" : "s"} from ${photoImportFiles.length} photo${photoImportFiles.length === 1 ? "" : "s"}${serves ? ` · ${serves}` : ""}`);
  } catch (error) {
    setPhotoImportStatus(error?.message || "Those photos could not be read.", true);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    button.disabled = false;
    button.textContent = "Read photos";
  }
}

function openRecipeImporter() {
  $("#recipe-import-url").value = "";
  setRecipeImportStatus();
  photoImportFiles = [];
  $("#recipe-photo-files").value = "";
  setPhotoImportStatus();
  updatePhotoImportSelection();
  $("#recipe-import-submit").disabled = false;
  openOverlay("recipe-import-overlay");
}

async function importRecipeFromWebsite(event) {
  event.preventDefault();
  const button = $("#recipe-import-submit");
  const url = $("#recipe-import-url").value;
  button.disabled = true;
  button.textContent = "Reading recipe…";
  setRecipeImportStatus("Looking for the recipe name, ingredients and method…");
  try {
    const recipe = await extractRecipeFromUrl(url);
    const ingredients = recipe.ingredients.map(parseRecipeIngredient).filter(item => item.name);
    if (!ingredients.length) throw new Error("No usable ingredients were found on that page.");
    closeOverlay("recipe-import-overlay");
    openMealEditor(null, { name: recipe.name, ingredients, method: recipe.method || [], sourceUrl: recipe.sourceUrl });
    showToast(`Imported ${ingredients.length} shopping item${ingredients.length === 1 ? "" : "s"}${recipe.serves ? ` · ${recipe.serves}` : ""}`);
  } catch (error) {
    setRecipeImportStatus(error?.message || "That recipe could not be imported.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Read recipe";
  }
}

function openMealEditor(mealId = null, prefill = null) {
  const meal = mealId ? findMeal(mealId) : null;
  const draft = prefill && !meal ? prefill : null;
  $("#meal-editor-title").textContent = meal ? "Edit meal" : draft ? "Review imported meal" : "New meal";
  $("#meal-id").value = meal?.id || "";
  $("#meal-name").value = meal?.name || draft?.name || "";
  editingMealTags = normaliseMealTags(meal?.tags || []);
  mealTagRemoveMode = false;
  editingMealRating = normaliseMealRating(meal?.rating || 0);
  editingMealSourceUrl = meal?.sourceUrl || draft?.sourceUrl || "";
  renderMealSourceRow();
  $("#meal-tag-input").value = "";
  renderMealTagEditor();
  renderMealRatingEditor();
  $("#ingredient-list").innerHTML = "";
  const ingredients = meal?.ingredients?.length ? meal.ingredients : draft?.ingredients?.length ? draft.ingredients : [{}, {}, {}];
  ingredients.forEach(addIngredientRow);
  $("#meal-method").value = normaliseMethod(meal?.method || draft?.method || []).join("\n");
  $("#delete-meal").hidden = !meal;
  renderKnownItems();
  openOverlay("meal-editor-overlay");
}

function saveMealFromForm(event) {
  event.preventDefault();
  const name = titleStyleName(normaliseName($("#meal-name").value));
  if (!name) return;
  const ingredients = [];
  $$("#ingredient-list [data-ingredient-row]").forEach(row => {
    const itemName = titleStyleName(normaliseName(row.querySelector(".ingredient-name").value));
    if (!itemName) return;
    const category = row.querySelector(".ingredient-category").value;
    const item = ensureItem(itemName, category);
    ingredients.push({ itemId: item.id, qty: normaliseName(row.querySelector(".ingredient-qty").value), unit: normaliseName(row.querySelector(".ingredient-unit").value) });
  });
  const now = new Date().toISOString();
  const id = $("#meal-id").value;
  if (id) {
    const meal = findMeal(id);
    if (!meal) return;
    meal.name = name;
    meal.ingredients = ingredients;
    meal.tags = normaliseMealTags(editingMealTags);
    meal.rating = normaliseMealRating(editingMealRating);
    meal.sourceUrl = editingMealSourceUrl || null;
    meal.method = normaliseMethod($("#meal-method").value);
    touchRecord(meal, now);
  } else {
    data.meals.push({ id: uid("meal"), name, ingredients, method: normaliseMethod($("#meal-method").value), tags: normaliseMealTags(editingMealTags), rating: normaliseMealRating(editingMealRating), sourceUrl: editingMealSourceUrl || null, libraryRecipeId: null, librarySourceId: null, createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null, lastUsedAt: null });
    touchSharedState(now);
  }
  saveData();
  closeOverlay("meal-editor-overlay");
  renderAll();
  showToast("Meal saved");
}

function deleteCurrentMeal() {
  const id = $("#meal-id").value;
  const meal = findMeal(id);
  if (!meal || !confirm(`Delete “${meal.name}”?`)) return;
  const now = new Date().toISOString();
  meal.deletedAt = now;
  touchRecord(meal, now);
  Object.values(data.weeks).forEach(week => {
    week = normaliseWeek(week, week.startDate);
    ["dinner", "lunch"].forEach(slotType => {
      week.slots[slotType] = week.slots[slotType].map((assignments, dayIndex) => {
        let changed = false;
        const next = assignments.filter(assignment => {
          if (assignment.mealId === id) { changed = true; return false; }
          const before = assignmentSideMealIds(assignment);
          const after = before.filter(sideMealId => sideMealId !== id);
          if (after.length !== before.length) {
            assignment.sideMealIds = after;
            assignment.updatedAt = now;
            assignment.updatedBy = currentMemberId();
            changed = true;
          }
          return true;
        });
        if (changed) touchWeekField(week, slotType, dayIndex, now);
        return next;
      });
    });
    syncLegacyWeekSlots(week);
  });
  saveData();
  closeOverlay("meal-editor-overlay");
  renderAll();
  showToast("Meal deleted");
}

function parseNumber(value) {
  const clean = String(value || "").trim().replace(",", ".");
  if (!clean || !/^\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function consolidateShopping() {
  const week = getWeek();
  const map = new Map();
  const push = ({ itemId, qty = "", unit = "", source }) => {
    const item = findItem(itemId);
    if (!item) return;
    if (!map.has(itemId)) map.set(itemId, { item, parts: [], sources: new Set() });
    const entry = map.get(itemId);
    entry.parts.push({ qty: normaliseName(qty), unit: normaliseName(unit) });
    if (source) entry.sources.add(source);
  };

  ["dinner", "lunch"].forEach(slotType => {
    week.slots[slotType].forEach(assignments => {
      const mealIds = new Set();
      assignments.forEach(assignment => {
        if (assignment.mealId && assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING) mealIds.add(assignment.mealId);
        assignmentSideMealIds(assignment).forEach(id => mealIds.add(id));
      });
      mealIds.forEach(mealId => {
        const meal = findMeal(mealId);
        meal?.ingredients.forEach(ing => push({ ...ing, source: meal.name }));
      });
    });
  });
  week.regularItemIds.forEach(itemId => push({ itemId, source: "Regular" }));
  week.extras.forEach(extra => push({ ...extra, source: "Added" }));

  return Array.from(map.values()).map(entry => {
    const parts = entry.parts.filter(part => part.qty || part.unit);
    let qtyText = "";
    if (parts.length) {
      const numeric = parts.map(part => ({ ...part, n: parseNumber(part.qty) }));
      const units = new Set(numeric.map(part => keyName(part.unit)));
      if (numeric.every(part => part.n !== null) && units.size === 1) {
        const total = numeric.reduce((sum, part) => sum + part.n, 0);
        const unit = numeric[0].unit;
        qtyText = `${formatNumber(total)}${unit ? ` ${unit}` : ""}`;
      } else {
        qtyText = [...new Set(parts.map(part => `${part.qty}${part.qty && part.unit ? " " : ""}${part.unit}`.trim()).filter(Boolean))].join(" + ");
      }
    }
    return {
      itemId: entry.item.id,
      name: entry.item.name,
      category: CATEGORIES.includes(entry.item.category) ? entry.item.category : "Other",
      qtyText,
      sourceText: Array.from(entry.sources).join(" · "),
      hasExtra: week.extras.some(extra => extra.itemId === entry.item.id)
    };
  });
}

function renderShop() {
  const week = getWeek();
  const items = consolidateShopping();
  const checked = new Set(week.checkedItemIds);
  const notNeeded = new Set(week.notNeededItemIds);
  const visible = data.settings.hideChecked ? items.filter(item => !checked.has(item.itemId)) : items;
  const done = items.filter(item => checked.has(item.itemId)).length;
  const skipped = items.filter(item => notNeeded.has(item.itemId)).length;
  const remaining = items.filter(item => !checked.has(item.itemId) && !notNeeded.has(item.itemId)).length;
  $("#remaining-count").textContent = `${remaining} left`;
  $("#done-count").textContent = `${done} done`;
  $("#skipped-count").textContent = skipped ? `${skipped} not needed` : "";
  $("#toggle-checked").textContent = data.settings.hideChecked ? "Show checked" : "Hide checked";
  $("#shop-week-label").textContent = formatWeekRange(selectedWeekStart);
  $("#shop-empty").hidden = items.length !== 0;

  let html = "";
  CATEGORIES.forEach(category => {
    const categoryItems = visible.filter(item => item.category === category).sort((a, b) => a.name.localeCompare(b.name));
    if (!categoryItems.length) return;
    html += `<section class="shop-category"><div class="shop-category-title"><span>${escapeHtml(category)}</span><span>${categoryItems.length}</span></div><div class="shop-category-items">`;
    html += categoryItems.map(item => {
      const isChecked = checked.has(item.itemId);
      const isNotNeeded = notNeeded.has(item.itemId);
      const stateClass = isNotNeeded ? "not-needed" : (isChecked ? "checked" : "");
      return `<div class="shop-item-row ${stateClass}" data-check-item="${item.itemId}" role="button" tabindex="0" aria-pressed="${isChecked}" aria-label="${escapeHtml(item.name)}${isNotNeeded ? ", not needed" : isChecked ? ", bought" : ""}">
        <span class="check-circle" aria-hidden="true">${isNotNeeded ? "−" : "✓"}</span>
        <span><span class="shop-item-name">${escapeHtml(item.name)}</span><span class="shop-item-source">${escapeHtml(item.sourceText)}</span></span>
        <span class="shop-item-tail"><span class="shop-item-qty">${escapeHtml(item.qtyText)}</span><button class="skip-item-button ${isNotNeeded ? "restore" : ""}" type="button" data-skip-item="${item.itemId}" aria-label="${isNotNeeded ? "Restore" : "Mark as not needed"} ${escapeHtml(item.name)}">${isNotNeeded ? "Restore" : "Skip"}</button>${item.hasExtra ? `<button class="remove-extra-button" type="button" data-remove-extra="${item.itemId}" aria-label="Remove added ${escapeHtml(item.name)}">×</button>` : ""}</span>
      </div>`;
    }).join("");
    html += `</div></section>`;
  });
  $("#shopping-list").innerHTML = html;
}

function removeExtraItem(itemId) {
  const week = getWeek();
  week.extras = week.extras.filter(extra => extra.itemId !== itemId);
  touchWeekField(week, "extras");
  saveData();
  renderShop();
  showToast("Removed added item");
}

function toggleShoppingItem(itemId) {
  const week = getWeek();
  const notNeeded = new Set(week.notNeededItemIds);
  if (notNeeded.has(itemId)) {
    notNeeded.delete(itemId);
    week.notNeededItemIds = Array.from(notNeeded);
    touchWeekField(week, "notNeededItemIds");
    saveData();
    renderShop();
    showToast("Back on the list");
    return;
  }
  const set = new Set(week.checkedItemIds);
  if (set.has(itemId)) set.delete(itemId); else set.add(itemId);
  week.checkedItemIds = Array.from(set);
  touchWeekField(week, "checkedItemIds");
  saveData();
  renderShop();
}

function toggleNotNeededItem(itemId) {
  const week = getWeek();
  const skipped = new Set(week.notNeededItemIds);
  if (skipped.has(itemId)) {
    skipped.delete(itemId);
    showToast("Back on the list");
  } else {
    skipped.add(itemId);
    week.checkedItemIds = week.checkedItemIds.filter(id => id !== itemId);
    showToast("Marked as not needed");
  }
  week.notNeededItemIds = Array.from(skipped);
  const skipStamp = new Date().toISOString();
  touchWeekField(week, "notNeededItemIds", null, skipStamp);
  if (!skipped.has(itemId)) {
    // Restoring doesn't alter checked state.
  } else {
    touchWeekField(week, "checkedItemIds", null, skipStamp);
  }
  saveData();
  renderShop();
}

function populateCategorySelect(select, selected = "Other") {
  select.innerHTML = categoryOptions(selected);
}

function openShopItemEditor() {
  $("#shop-item-form").reset();
  populateCategorySelect($("#shop-item-category"), "Other");
  renderKnownItems();
  openOverlay("shop-item-overlay");
}

function syncShopCategoryFromKnownName() {
  const item = findItemByName($("#shop-item-name").value);
  if (!item) return;
  $("#shop-item-category").value = item.category;
  $("#shop-item-regular").checked = !!item.regular;
}

function addShopItem(event) {
  event.preventDefault();
  const name = normaliseName($("#shop-item-name").value);
  if (!name) return;
  const item = ensureItem(name, $("#shop-item-category").value, $("#shop-item-regular").checked);
  const week = getWeek();
  const existing = week.extras.find(extra => extra.itemId === item.id);
  const qty = normaliseName($("#shop-item-qty").value);
  const unit = normaliseName($("#shop-item-unit").value);
  if (existing && !existing.qty && !existing.unit) { existing.qty = qty; existing.unit = unit; }
  else if (!existing) week.extras.push({ id: uid("extra"), itemId: item.id, qty, unit });
  week.checkedItemIds = week.checkedItemIds.filter(id => id !== item.id);
  week.notNeededItemIds = week.notNeededItemIds.filter(id => id !== item.id);
  const addStamp = new Date().toISOString();
  touchWeekField(week, "extras", null, addStamp);
  touchWeekField(week, "checkedItemIds", null, addStamp);
  touchWeekField(week, "notNeededItemIds", null, addStamp);
  saveData();
  closeOverlay("shop-item-overlay");
  renderAll();
  showToast("Added to shopping list");
}

function renderRegularPicker() {
  const week = getWeek();
  const selected = new Set(week.regularItemIds);
  const regulars = data.items.filter(item => !item.deletedAt && item.regular).sort((a, b) => a.name.localeCompare(b.name));
  $("#regular-picker-list").innerHTML = regulars.length ? regulars.map(item => `<button class="regular-chip ${selected.has(item.id) ? "selected" : ""}" type="button" data-regular-pick="${item.id}"><span>${escapeHtml(item.name)}</span><span class="chip-mark">${selected.has(item.id) ? "✓" : "+"}</span></button>`).join("") : `<div class="empty-state"><strong>No regulars yet</strong><p>Add some from Manage regulars.</p></div>`;
}

function toggleRegularForWeek(itemId) {
  const week = getWeek();
  const set = new Set(week.regularItemIds);
  if (set.has(itemId)) set.delete(itemId); else set.add(itemId);
  week.regularItemIds = Array.from(set);
  week.checkedItemIds = week.checkedItemIds.filter(id => id !== itemId);
  week.notNeededItemIds = week.notNeededItemIds.filter(id => id !== itemId);
  const regularStamp = new Date().toISOString();
  touchWeekField(week, "regularItemIds", null, regularStamp);
  touchWeekField(week, "checkedItemIds", null, regularStamp);
  touchWeekField(week, "notNeededItemIds", null, regularStamp);
  saveData();
  renderRegularPicker();
  renderShop();
}

function renderRegularManager() {
  const items = data.items.filter(item => !item.deletedAt).sort((a, b) => Number(b.regular) - Number(a.regular) || a.name.localeCompare(b.name));
  $("#regular-manager-list").innerHTML = items.map(item => `<div class="regular-manager-row"><span>${escapeHtml(item.name)}</span><button class="switch ${item.regular ? "on" : ""}" type="button" data-toggle-regular="${item.id}" aria-label="${item.regular ? "Remove" : "Add"} ${escapeHtml(item.name)} ${item.regular ? "from" : "to"} regulars" aria-pressed="${item.regular}"></button></div>`).join("");
}

function toggleItemRegular(itemId) {
  const item = findItem(itemId);
  if (!item) return;
  item.regular = !item.regular;
  touchRecord(item);
  if (!item.regular) {
    Object.values(data.weeks).forEach(week => {
      if (Array.isArray(week.regularItemIds) && week.regularItemIds.includes(item.id)) {
        week.regularItemIds = week.regularItemIds.filter(id => id !== item.id);
        touchWeekField(week, "regularItemIds");
      }
    });
  }
  saveData();
  renderRegularManager();
  renderRegularPicker();
  renderShop();
}

function addRegularItem(event) {
  event.preventDefault();
  const input = $("#regular-add-name");
  const name = normaliseName(input.value);
  if (!name) return;
  ensureItem(name, findItemByName(name)?.category || "Other", true);
  input.value = "";
  saveData();
  renderKnownItems();
  renderRegularManager();
}

function openDataSharing() {
  renderHouseholdSummary();
  openOverlay("data-overlay");
}

function householdDisplayName() {
  return normaliseName(data.household?.name) || "Our household";
}

function renderHouseholdSummary() {
  const members = activeMembers();
  const appUsers = members.filter(member => member.appUser);
  $("#household-title").textContent = householdDisplayName();
  $("#household-members-preview").innerHTML = members.length
    ? `<div class="household-avatar-stack">${members.slice(0, 6).map(member => memberAvatar(member)).join("")}</div><div><strong>${members.length} ${members.length === 1 ? "person" : "people"}</strong><small>${appUsers.length ? `${appUsers.length} app user${appUsers.length === 1 ? "" : "s"}` : "No app users set yet"}</small></div>`
    : `<div class="household-empty-mini"><strong>Set up your household</strong><small>Add the adults and kids you plan meals for.</small></div>`;
  const current = findMember(data.settings.currentMemberId);
  $("#current-device-member").textContent = current ? `${current.name} on this copy` : "This copy isn’t assigned to an app user yet";
  $("#manage-household").textContent = members.length ? "Manage household" : "Set up household";
}

function renderHouseholdManager() {
  $("#household-name").value = householdDisplayName();
  const currentId = data.settings.currentMemberId;
  const members = activeMembers();
  $("#household-member-list").innerHTML = members.length ? members.map(member => `
    <div class="household-member-row">
      ${memberAvatar(member)}
      <div class="household-member-main"><strong>${escapeHtml(member.name)}</strong><span>${member.role === "child" ? "Child" : "Adult"}${member.appUser ? " · App user" : ""}${member.id === currentId ? " · This copy" : ""}${member.appUser && member.email ? ` · ${escapeHtml(member.email)}` : ""}</span></div>
      <button class="member-edit-button" type="button" data-edit-member="${escapeHtml(member.id)}" aria-label="Edit ${escapeHtml(member.name)}">•••</button>
    </div>`).join("") : `<div class="empty-state compact-empty"><strong>No people yet</strong><p>Add everyone you might plan meals for.</p></div>`;
}

function openHouseholdManager() {
  renderHouseholdManager();
  closeOverlay("data-overlay");
  openOverlay("household-manager-overlay");
}

function saveHouseholdName(event) {
  event.preventDefault();
  const name = normaliseName($("#household-name").value) || "Our household";
  data.household.name = name;
  data.household.weekStartDay = Number(data.settings.weekStartDay);
  touchRecord(data.household);
  saveData();
  renderHouseholdManager();
  showToast("Household saved");
}

function nextMemberColor() {
  const used = new Set(activeMembers().map(member => member.color));
  return MEMBER_COLORS.find(color => !used.has(color)) || MEMBER_COLORS[activeMembers().length % MEMBER_COLORS.length];
}

function renderMemberColorChoices(selected) {
  $("#member-color-choices").innerHTML = MEMBER_COLORS.map(color => `<button type="button" class="member-color-choice member-${color} ${color === selected ? "selected" : ""}" data-member-color="${color}" aria-label="Choose ${color} colour"><span></span></button>`).join("");
  $("#member-color").value = selected;
}

function openMemberEditor(memberId = null) {
  const member = memberId ? findMember(memberId) : null;
  $("#member-editor-title").textContent = member ? "Edit person" : "Add person";
  $("#member-id").value = member?.id || "";
  $("#member-name").value = member?.name || "";
  $("#member-role").value = member?.role || "adult";
  $("#member-app-user").checked = !!member?.appUser;
  $("#member-email").value = member?.email || "";
  $("#member-email-wrap").hidden = !member?.appUser;
  $("#member-this-device").checked = !!member && data.settings.currentMemberId === member.id;
  $("#member-this-device").disabled = !member?.appUser;
  $("#delete-member").hidden = !member;
  renderMemberColorChoices(member?.color || nextMemberColor());
  closeOverlay("household-manager-overlay");
  openOverlay("member-editor-overlay");
}

function saveMember(event) {
  event.preventDefault();
  const name = normaliseName($("#member-name").value);
  if (!name) return;
  const now = new Date().toISOString();
  const id = $("#member-id").value;
  let member = id ? findMember(id) : null;
  if (!member) {
    member = { id: uid("member"), name, role: "adult", appUser: false, color: nextMemberColor(), createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null };
    data.household.members.push(member);
  }
  member.name = name;
  member.role = $("#member-role").value === "child" ? "child" : "adult";
  member.appUser = $("#member-app-user").checked;
  member.email = member.appUser ? String($("#member-email").value || "").trim().toLowerCase() : "";
  member.color = MEMBER_COLORS.includes($("#member-color").value) ? $("#member-color").value : nextMemberColor();
  const wasCurrentDeviceMember = data.settings.currentMemberId === member.id;
  const markThisCopy = member.appUser && $("#member-this-device").checked;
  if (markThisCopy) data.settings.currentMemberId = member.id;
  else if (wasCurrentDeviceMember) data.settings.currentMemberId = null;
  touchRecord(member, now);
  touchRecord(data.household, now);
  saveData();
  closeOverlay("member-editor-overlay");
  renderHouseholdManager();
  openOverlay("household-manager-overlay");
  renderAll();
  showToast(id ? "Person updated" : "Person added");
}

function cleanMemberFromPlans(memberId) {
  Object.values(data.weeks).forEach(week => {
    const cleanWeek = normaliseWeek(week, week.startDate);
    ["dinner", "lunch"].forEach(slotType => {
      cleanWeek.slots[slotType] = cleanWeek.slots[slotType].map((assignments, dayIndex) => {
        let changed = false;
        const next = assignments.map(assignment => {
          if (assignment.memberIds === null || !assignment.memberIds.includes(memberId)) return assignment;
          changed = true;
          return { ...assignment, memberIds: assignment.memberIds.filter(id => id !== memberId) };
        }).filter(assignment => assignment.memberIds === null || assignment.memberIds.length);
        if (changed) touchWeekField(cleanWeek, slotType, dayIndex);
        return normaliseSplitSlot(next);
      });
    });
    syncLegacyWeekSlots(cleanWeek);
  });
}

function deleteMember() {
  const member = findMember($("#member-id").value);
  if (!member || !confirm(`Remove ${member.name} from this household? Existing meal assignments will be adjusted.`)) return;
  const now = new Date().toISOString();
  member.deletedAt = now;
  touchRecord(member, now);
  if (data.settings.currentMemberId === member.id) data.settings.currentMemberId = null;
  cleanMemberFromPlans(member.id);
  touchRecord(data.household, now);
  saveData();
  closeOverlay("member-editor-overlay");
  renderHouseholdManager();
  openOverlay("household-manager-overlay");
  renderAll();
  showToast("Person removed");
}

function openSplitMembers(dayIndex, slotType, assignmentId = null, returnMode = "card", initialIds = undefined) {
  const members = activeMembers();
  if (!members.length) {
    showToast("Add people to the household first");
    return;
  }

  splitDayIndex = Number(dayIndex);
  splitSlotType = slotType === "lunch" ? "lunch" : "dinner";
  splitAssignmentId = assignmentId || null;
  splitReturnMode = ["picker", "alternative", "remove", "notEating", "rejoinMain"].includes(returnMode) ? returnMode : "card";

  const week = getWeek();
  const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
  const assignment = splitAssignmentId ? assignments.find(entry => entry.id === splitAssignmentId) : null;

  if (splitReturnMode === "rejoinMain") {
    const source = assignments.find(entry => entry.id === splitAssignmentId && entry.mealId === NOT_EATING);
    const primary = assignments.find(entry => entry.mealId !== NO_MEAL && entry.mealId !== NOT_EATING && !!findMeal(entry.mealId));
    const returnMeal = primary ? findMeal(primary.mealId) : findMeal(source?.returnMealId);
    const sourceMembers = source ? assignmentMemberIds(source).map(findMember).filter(Boolean) : [];
    pendingAudienceAll = false;
    pendingSplitMemberIds = [];
    $("#split-members-title").textContent = "Rejoin main meal";
    $("#split-members-overlay .sheet-copy").textContent = returnMeal ? `Choose who is eating ${returnMeal.name} after all.` : "Choose who should rejoin the main meal.";
    $("#split-member-list").innerHTML = sourceMembers.map(member => `<button type="button" class="split-member-choice" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("");
  } else if (splitReturnMode === "notEating") {
    const alreadyNotEating = new Set(assignments.filter(entry => entry.mealId === NOT_EATING).flatMap(assignmentMemberIds));
    const availableMembers = members.filter(member => !alreadyNotEating.has(member.id));
    pendingAudienceAll = false;
    pendingSplitMemberIds = [];
    $("#split-members-title").textContent = `Who is not eating ${splitSlotType}?`;
    $("#split-members-overlay .sheet-copy").textContent = "Choose one or more people. They’ll be removed from any meal for this slot and shown as Not eating.";
    $("#split-member-list").innerHTML = availableMembers.map(member => `<button type="button" class="split-member-choice" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("");
  } else if (splitReturnMode === "alternative") {
    pendingAudienceAll = false;
    pendingSplitMemberIds = [];
    const meal = findMeal(pendingAlternativeMealId);
    $("#split-members-title").textContent = meal ? `Who is having ${meal.name}?` : "Who is having this meal?";
    $("#split-members-overlay .sheet-copy").textContent = "Choose one or more people. They’ll move from their current meal to this alternative.";
    $("#split-member-list").innerHTML = members.map(member => `<button type="button" class="split-member-choice" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("");
  } else if (splitReturnMode === "remove") {
    const sourceIndex = assignments.findIndex(entry => entry.id === splitAssignmentId);
    const source = sourceIndex >= 0 ? assignments[sourceIndex] : null;
    const target = sourceIndex === 0 ? assignments[1] : assignments[0];
    const sourceName = assignmentDisplayName(source);
    const targetName = assignmentDisplayName(target);
    const sourceMembers = source ? assignmentMemberIds(source).map(findMember).filter(Boolean) : [];
    pendingAudienceAll = false;
    pendingSplitMemberIds = [];
    $("#split-members-title").textContent = `Move people from ${sourceName}`;
    $("#split-members-overlay .sheet-copy").textContent = target
      ? `Choose who to move. They’ll be added to ${targetName}.`
      : "Choose who to move to the other meal.";
    $("#split-member-list").innerHTML = sourceMembers.map(member => `<button type="button" class="split-member-choice" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("");
  } else {
    const sourceIds = initialIds !== undefined
      ? normalisedAudienceIds(initialIds)
      : (assignment ? normalisedAudienceIds(assignment.memberIds) : pickerAudienceMemberIds);
    pendingAudienceAll = sourceIds === null;
    pendingSplitMemberIds = sourceIds === null ? [] : [...(sourceIds || [])];
    $("#split-members-title").textContent = `Who is this ${splitSlotType} for?`;
    $("#split-members-overlay .sheet-copy").textContent = "Choose everyone, one person, or any combination of people.";
    const allSelected = pendingAudienceAll;
    $("#split-member-list").innerHTML = `
      <button type="button" class="split-member-choice audience-all-choice ${allSelected ? "selected" : ""}" data-audience-all>
        <span class="audience-all-mark">All</span>
        <span><strong>All</strong><small>Everyone in the household</small></span>
        <span class="member-check">✓</span>
      </button>
      ${members.map(member => `<button type="button" class="split-member-choice ${pendingSplitMemberIds.includes(member.id) ? "selected" : ""}" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("")}`;
  }

  $("#split-members-next").textContent = "Done";
  updateSplitMemberButton();
  openOverlay("split-members-overlay");
}

function selectAllSplitMembers() {
  if (splitReturnMode === "alternative" || splitReturnMode === "remove" || splitReturnMode === "notEating" || splitReturnMode === "rejoinMain") return;
  pendingAudienceAll = true;
  pendingSplitMemberIds = [];
  updateSplitMemberSelection();
}

function toggleSplitMember(memberId) {
  if (splitReturnMode === "alternative" || splitReturnMode === "remove" || splitReturnMode === "notEating" || splitReturnMode === "rejoinMain") {
    const set = new Set(pendingSplitMemberIds);
    if (set.has(memberId)) set.delete(memberId); else set.add(memberId);
    pendingSplitMemberIds = Array.from(set);
    pendingAudienceAll = false;
    updateSplitMemberSelection();
    return;
  }

  if (pendingAudienceAll) {
    pendingAudienceAll = false;
    pendingSplitMemberIds = [memberId];
    updateSplitMemberSelection();
    return;
  }
  const set = new Set(pendingSplitMemberIds);
  if (set.has(memberId)) set.delete(memberId); else set.add(memberId);
  if (set.size === activeMembers().length) {
    pendingAudienceAll = true;
    pendingSplitMemberIds = [];
  } else {
    pendingSplitMemberIds = Array.from(set);
  }
  updateSplitMemberSelection();
}

function updateSplitMemberSelection() {
  const set = new Set(pendingSplitMemberIds);
  $$('[data-split-member]').forEach(button => button.classList.toggle("selected", !pendingAudienceAll && set.has(button.dataset.splitMember)));
  const allButton = $('[data-audience-all]');
  if (allButton) allButton.classList.toggle("selected", pendingAudienceAll);
  updateSplitMemberButton();
}

function updateSplitMemberButton() {
  const button = $("#split-members-next");
  const count = pendingAudienceAll ? activeMembers().length : pendingSplitMemberIds.length;
  if (splitReturnMode === "notEating") {
    button.disabled = count < 1;
    button.textContent = count ? `Mark ${count} not eating` : "Choose who is not eating";
    return;
  }
  if (splitReturnMode === "rejoinMain") {
    button.disabled = count < 1;
    button.textContent = count ? `Rejoin ${count} ${count === 1 ? "person" : "people"}` : "Choose who is eating";
    return;
  }
  if (splitReturnMode === "alternative") {
    button.disabled = count < 1 || count >= activeMembers().length;
    button.textContent = count ? `Use for ${count} ${count === 1 ? "person" : "people"}` : "Choose who is having it";
    return;
  }
  if (splitReturnMode === "remove") {
    button.disabled = count < 1;
    button.textContent = count ? `Move ${count} ${count === 1 ? "person" : "people"}` : "Choose people to move";
    return;
  }
  button.disabled = count < 1;
  button.textContent = "Done";
}

function continueSplitMeal() {
  if (!pendingAudienceAll && !pendingSplitMemberIds.length) return;

  if (splitReturnMode === "rejoinMain") {
    const week = getWeek();
    const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
    const now = new Date().toISOString();
    week.slots[splitSlotType][splitDayIndex] = rejoinNotEatingMembers(assignments, splitAssignmentId, pendingSplitMemberIds, now);
    touchWeekField(week, splitSlotType, splitDayIndex, now);
    syncLegacyWeekSlots(week);
    saveData({ immediateCloud: true });
    closeOverlay("split-members-overlay");
    renderAll();
    showToast("Back on the main meal");
    return;
  }

  if (splitReturnMode === "notEating") {
    const week = getWeek();
    const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
    const now = new Date().toISOString();
    week.slots[splitSlotType][splitDayIndex] = applyNotEatingToAudience(assignments, pendingSplitMemberIds, now);
    touchWeekField(week, splitSlotType, splitDayIndex, now);
    syncLegacyWeekSlots(week);
    saveData({ immediateCloud: true });
    closeOverlay("split-members-overlay");
    closeOverlay("meal-picker-overlay");
    renderAll();
    showToast("Marked not eating");
    return;
  }

  if (splitReturnMode === "alternative") {
    if (!pendingAlternativeMealId || pendingSplitMemberIds.length >= activeMembers().length) return;
    const week = getWeek();
    const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
    const now = new Date().toISOString();
    week.slots[splitSlotType][splitDayIndex] = applyMealToAudience(
      assignments,
      pendingAlternativeMealId,
      null,
      pendingSplitMemberIds,
      now
    );
    touchWeekField(week, splitSlotType, splitDayIndex, now);
    const meal = findMeal(pendingAlternativeMealId);
    if (meal) {
      meal.lastUsedAt = now;
      touchRecord(meal, now);
    }
    syncLegacyWeekSlots(week);
    saveData();
    pendingAlternativeMealId = null;
    pickerMode = "replace";
    closeOverlay("split-members-overlay");
    renderAll();
    return;
  }

  if (splitReturnMode === "remove") {
    if (!pendingSplitMemberIds.length) return;
    const week = getWeek();
    const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
    const now = new Date().toISOString();
    week.slots[splitSlotType][splitDayIndex] = movePeopleBetweenAssignments(
      assignments,
      splitAssignmentId,
      pendingSplitMemberIds,
      now
    );
    touchWeekField(week, splitSlotType, splitDayIndex, now);
    syncLegacyWeekSlots(week);
    saveData({ immediateCloud: true });
    closeOverlay("split-members-overlay");
    renderAll();
    showToast("People moved");
    return;
  }

  const selectedIds = pendingAudienceAll ? null : normalisedAudienceIds(pendingSplitMemberIds);
  if (splitReturnMode === "picker") {
    pickerAudienceMemberIds = selectedIds;
    renderPickerAudience();
    closeOverlay("split-members-overlay");
    return;
  }

  const week = getWeek();
  const assignments = getSlotAssignments(week, splitSlotType, splitDayIndex);
  const assignment = assignments.find(entry => entry.id === splitAssignmentId);
  if (!assignment) {
    closeOverlay("split-members-overlay");
    return;
  }

  const now = new Date().toISOString();
  week.slots[splitSlotType][splitDayIndex] = applyMealToAudience(
    assignments,
    assignment.mealId,
    assignment.id,
    selectedIds,
    now
  );
  touchWeekField(week, splitSlotType, splitDayIndex, now);
  syncLegacyWeekSlots(week);
  saveData();
  closeOverlay("split-members-overlay");
  renderAll();
}


let cloudUiState = { phase: "loading", email: "", householdName: "", detail: "Loading cloud sync…", foundHouseholdId: null };

function sharedDataSignature() {
  return JSON.stringify({
    household: data.household,
    items: data.items,
    meals: data.meals,
    weeks: data.weeks,
    savedWeeks: data.savedWeeks || [],
    savedDays: data.savedDays || []
  });
}

function cloudInviteEmails() {
  return Array.from(new Set(appUserMembers().map(member => String(member.email || "").trim().toLowerCase()).filter(Boolean)));
}

function renderCloudStatus() {
  const badge = $("#sync-badge");
  const state = $("#cloud-sync-state");
  const detail = $("#cloud-sync-detail");
  const account = $("#cloud-account");
  if (!badge || !state || !detail || !account) return;

  const phase = cloudUiState.phase || "signedOut";
  const labels = {
    loading: "Connecting…",
    signedOut: "Local only",
    verify: "Verify email",
    signedIn: "Ready to sync",
    inviteFound: "Household found",
    joining: "Joining…",
    connected: "Synced",
    syncing: "Syncing…",
    offline: "Offline",
    error: "Sync issue"
  };
  badge.textContent = labels[phase] || "Local only";
  badge.className = `manual-sync-badge sync-badge sync-${phase}`;
  state.textContent = labels[phase] || "Local only";
  detail.textContent = cloudUiState.detail || "";
  account.textContent = cloudUiState.email ? `Signed in as ${cloudUiState.email}` : "";

  $("#cloud-auth-open").hidden = phase !== "signedOut" && phase !== "error";
  $("#cloud-verify").hidden = phase !== "verify";
  $("#cloud-start").hidden = phase !== "signedIn";
  $("#cloud-join").hidden = phase !== "inviteFound";
  $("#cloud-sync-now").hidden = phase !== "connected" && phase !== "offline";
  $("#cloud-signout").hidden = !cloudUiState.email;
  if (phase === "inviteFound" && cloudUiState.householdName) {
    $("#cloud-join").textContent = `Join ${cloudUiState.householdName}`;
  }
}

function setCloudUiState(next) {
  cloudUiState = { ...cloudUiState, ...next };
  renderCloudStatus();
}

function cloudSetHouseholdId(householdId) {
  data.settings.cloudHouseholdId = householdId || null;
  saveData({ skipCloud: true });
}

function cloudAssignSignedInMember(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return;
  let member = appUserMembers().find(entry => entry.email === cleanEmail) || null;
  const current = findMember(data.settings.currentMemberId);
  if (!member && current?.appUser && !current.email) {
    current.email = cleanEmail;
    touchRecord(current);
    member = current;
  }
  if (!member) {
    const candidates = appUserMembers().filter(entry => !entry.email);
    if (candidates.length === 1) {
      candidates[0].email = cleanEmail;
      touchRecord(candidates[0]);
      member = candidates[0];
    }
  }
  if (member) data.settings.currentMemberId = member.id;
  saveData({ skipCloud: true });
  renderAll();
}

function cloudAdoptPayloads(payloads, householdId, authEmail) {
  const valid = (payloads || []).filter(payload => payload?.household?.id === householdId);
  if (!valid.length) throw new Error("This household does not have a cloud snapshot yet.");
  adoptHouseholdPayload(valid[0]);
  valid.slice(1).forEach(payload => mergeHouseholdPayload(payload));
  data.settings.cloudHouseholdId = householdId;
  const cleanEmail = String(authEmail || "").trim().toLowerCase();
  const matching = appUserMembers().find(member => member.email === cleanEmail);
  data.settings.currentMemberId = matching?.id || null;
  selectedWeekStart = startOfWeek(new Date(), data.household.weekStartDay);
  saveData({ skipCloud: true });
  renderAll();
  renderHouseholdSummary();
}

function cloudMergePayload(payload) {
  if (!payload?.household?.id || payload.household.id !== data.household.id) return false;
  const before = sharedDataSignature();
  mergeHouseholdPayload(payload);
  const after = sharedDataSignature();
  if (after === before) return false;
  selectedWeekStart = startOfWeek(selectedWeekStart, data.household.weekStartDay);
  saveData({ skipCloud: true });
  renderAll();
  renderHouseholdSummary();
  return true;
}

window.MealPlannerCloudAdapter = {
  getPayload: () => buildHouseholdPayload(),
  getHouseholdId: () => data.household?.id || null,
  getCloudHouseholdId: () => data.settings?.cloudHouseholdId || null,
  getHouseholdName: () => householdDisplayName(),
  getInviteEmails: () => cloudInviteEmails(),
  getCurrentMemberId: () => currentMemberId(),
  setHouseholdId: cloudSetHouseholdId,
  assignSignedInMember: cloudAssignSignedInMember,
  adoptPayloads: cloudAdoptPayloads,
  mergePayload: cloudMergePayload,
  setStatus: setCloudUiState
};

function openCloudAuth() {
  $("#cloud-email").value = cloudUiState.email || "";
  $("#cloud-password").value = "";
  closeOverlay("data-overlay");
  openOverlay("cloud-auth-overlay");
}

async function cloudSignIn(event) {
  event.preventDefault();
  const email = String($("#cloud-email").value || "").trim();
  const password = $("#cloud-password").value;
  try {
    await window.MealPlannerFirebase?.signIn(email, password);
    closeOverlay("cloud-auth-overlay");
    showToast("Signed in");
  } catch (error) {
    alert(window.MealPlannerFirebase?.friendlyError(error) || error?.message || "Sign in failed.");
  }
}

async function cloudCreateAccount() {
  const email = String($("#cloud-email").value || "").trim();
  const password = $("#cloud-password").value;
  try {
    await window.MealPlannerFirebase?.createAccount(email, password);
    closeOverlay("cloud-auth-overlay");
    showToast("Verification email sent");
  } catch (error) {
    alert(window.MealPlannerFirebase?.friendlyError(error) || error?.message || "Account creation failed.");
  }
}

async function cloudResetPassword() {
  const email = String($("#cloud-email").value || "").trim();
  if (!email) return alert("Enter your email address first.");
  try {
    await window.MealPlannerFirebase?.resetPassword(email);
    showToast("Password reset email sent");
  } catch (error) {
    alert(window.MealPlannerFirebase?.friendlyError(error) || error?.message || "Could not send reset email.");
  }
}

async function startCloudSync() {
  if (!activeMembers().length) {
    showToast("Set up your household first");
    return;
  }
  if (!confirm(`Start automatic sync for “${householdDisplayName()}” using the data in this copy? Other signed-in copies can then join this household.`)) return;
  try {
    await window.MealPlannerFirebase?.startHousehold();
  } catch (error) {
    alert(window.MealPlannerFirebase?.friendlyError(error) || error?.message || "Could not start cloud sync.");
  }
}

async function joinCloudHousehold() {
  const name = cloudUiState.householdName || "the shared household";
  if (!confirm(`Join “${name}”? The cloud household will replace the household data in this copy. You can export a full backup first if needed.`)) return;
  try {
    await window.MealPlannerFirebase?.joinFoundHousehold();
    showToast("Shared household joined");
  } catch (error) {
    alert(window.MealPlannerFirebase?.friendlyError(error) || error?.message || "Could not join the household.");
  }
}

function fileSafeDate(value = new Date()) {
  const date = value instanceof Date ? value : fromDateKey(value);
  return localDateKey(date);
}

function makeJsonFile(payload, filename) {
  const json = JSON.stringify(payload, null, 2);
  try {
    return new File([json], filename, { type: "application/json" });
  } catch (_) {
    const blob = new Blob([json], { type: "application/json" });
    blob.name = filename;
    return blob;
  }
}

function downloadJsonFile(file, filename) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || file.name || "meal-planner.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function shareOrDownloadJson(payload, filename, title, text) {
  const file = makeJsonFile(payload, filename);
  try {
    if (navigator.share && navigator.canShare && file instanceof File && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, text, files: [file] });
      return "shared";
    }
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
    console.warn("File sharing failed, downloading instead:", error);
  }
  downloadJsonFile(file, filename);
  return "downloaded";
}

async function exportBackup() {
  const payload = {
    format: "MealPlannerBackup",
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: clone(data)
  };
  const result = await shareOrDownloadJson(
    payload,
    `MealPlanner-backup-${fileSafeDate()}.json`,
    "Meal Planner backup",
    "Meal Planner backup containing meals, plans and shopping data."
  );
  if (result === "downloaded") showToast("Backup downloaded");
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "MealPlannerBackup" || payload.version !== 1 || !payload.data) throw new Error("This is not a Meal Planner backup file.");
    const imported = prepareDataObject(payload.data);
    if (!confirm("Import this backup? It will replace the Meal Planner data stored in this copy of the app.")) return;
    data = imported;
    selectedWeekStart = startOfWeek(new Date(), data.settings.weekStartDay);
    saveData();
    renderAll();
    switchTab(data.settings.lastTab || "week");
    closeOverlay("data-overlay");
    showToast("Backup imported");
  } catch (error) {
    alert(error?.message || "That backup could not be imported.");
  }
}


function buildHouseholdPayload() {
  return {
    format: "MealPlannerHousehold",
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    household: clone(data.household),
    items: clone(data.items),
    meals: clone(data.meals),
    weeks: clone(data.weeks),
    savedWeeks: clone(data.savedWeeks || []),
    savedDays: clone(data.savedDays || [])
  };
}

async function shareHouseholdUpdate() {
  if (!activeMembers().length) {
    closeOverlay("data-overlay");
    openHouseholdManager();
    showToast("Set up your household first");
    return;
  }
  const payload = buildHouseholdPayload();
  const result = await shareOrDownloadJson(
    payload,
    `MealPlanner-household-${fileSafeDate()}.json`,
    `${householdDisplayName()} · Meal Planner`,
    `Household update from Meal Planner. Import this file to merge meals, plans and shopping changes.`
  );
  if (result === "downloaded") showToast("Household update downloaded");
}

function newerRecord(local, incoming) {
  if (!local) return clone(incoming);
  const localStamp = String(local.updatedAt || local.createdAt || "");
  const incomingStamp = String(incoming.updatedAt || incoming.createdAt || "");
  return incomingStamp > localStamp ? clone(incoming) : local;
}

function mergeRecordArray(localArray, incomingArray) {
  const map = new Map((localArray || []).map(record => [record.id, record]));
  (incomingArray || []).forEach(record => {
    if (!record?.id) return;
    map.set(record.id, newerRecord(map.get(record.id), record));
  });
  return Array.from(map.values());
}

function adoptHouseholdPayload(payload) {
  const prepared = prepareDataObject({
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    bundledContentVersion: data.bundledContentVersion || BUNDLED_CONTENT_VERSION,
    household: payload.household,
    items: payload.items,
    meals: payload.meals,
    weeks: payload.weeks,
    savedWeeks: payload.savedWeeks || [],
    savedDays: payload.savedDays || [],
    settings: { ...data.settings, currentMemberId: null, weekStartDay: payload.household.weekStartDay }
  });
  data.household = prepared.household;
  data.items = prepared.items;
  data.meals = prepared.meals;
  data.weeks = prepared.weeks;
  data.savedWeeks = prepared.savedWeeks;
  data.savedDays = prepared.savedDays;
  data.settings.weekStartDay = prepared.household.weekStartDay;
  data.settings.currentMemberId = null;
}

function mergeWeekRecord(localWeek, incomingWeek, key) {
  const local = normaliseWeek(clone(localWeek), key);
  const incoming = normaliseWeek(clone(incomingWeek), key);
  const newer = (incomingStamp, localStamp) => String(incomingStamp || "") > String(localStamp || "");
  ["dinner", "lunch"].forEach(slotType => {
    for (let index = 0; index < 7; index += 1) {
      if (newer(incoming.fieldUpdatedAt[slotType][index], local.fieldUpdatedAt[slotType][index])) {
        local.slots[slotType][index] = clone(incoming.slots[slotType][index]);
        local.fieldUpdatedAt[slotType][index] = incoming.fieldUpdatedAt[slotType][index];
      }
    }
  });
  ["regularItemIds", "extras", "checkedItemIds", "notNeededItemIds"].forEach(field => {
    if (newer(incoming.fieldUpdatedAt[field], local.fieldUpdatedAt[field])) {
      local[field] = clone(incoming[field]);
      local.fieldUpdatedAt[field] = incoming.fieldUpdatedAt[field];
    }
  });
  if (newer(incoming.updatedAt, local.updatedAt)) {
    local.updatedAt = incoming.updatedAt;
    local.updatedBy = incoming.updatedBy || null;
  }
  syncLegacyWeekSlots(local);
  return local;
}

function mergeHouseholdPayload(payload) {
  const incoming = payload.household;
  const localMemberId = data.settings.currentMemberId;
  const incomingHouseholdNewer = String(incoming.updatedAt || "") > String(data.household.updatedAt || "");
  if (incomingHouseholdNewer) {
    data.household.name = incoming.name || data.household.name;
    data.household.weekStartDay = Number.isInteger(Number(incoming.weekStartDay)) ? Number(incoming.weekStartDay) : data.household.weekStartDay;
    data.household.hiddenMealTags = Array.isArray(incoming.hiddenMealTags)
      ? Array.from(new Set(incoming.hiddenMealTags.map(keyName).filter(Boolean)))
      : (data.household.hiddenMealTags || []);
    data.household.updatedAt = incoming.updatedAt;
    data.household.updatedBy = incoming.updatedBy || null;
  }
  data.household.members = mergeRecordArray(data.household.members, incoming.members || []);
  if (String(incoming.dataUpdatedAt || "") > String(data.household.dataUpdatedAt || "")) {
    data.household.dataUpdatedAt = incoming.dataUpdatedAt;
    data.household.dataUpdatedBy = incoming.dataUpdatedBy || null;
  }
  data.items = mergeRecordArray(data.items, payload.items || []).map(item => ({ ...item, name: titleStyleName(normaliseName(item.name)) }));
  data.meals = mergeRecordArray(data.meals, payload.meals || []).map(meal => {
    const { sides: _legacySides, ...mealWithoutLegacySides } = meal;
    return { ...mealWithoutLegacySides, name: titleStyleName(normaliseName(meal.name)) };
  });
  data.savedWeeks = mergeRecordArray(data.savedWeeks || [], (payload.savedWeeks || []).map(normaliseSavedWeek).filter(Boolean));
  data.savedDays = mergeRecordArray(data.savedDays || [], (payload.savedDays || []).map(normaliseSavedDay).filter(Boolean));
  Object.entries(payload.weeks || {}).forEach(([key, incomingWeek]) => {
    const localWeek = data.weeks[key];
    data.weeks[key] = localWeek ? mergeWeekRecord(localWeek, incomingWeek, key) : normaliseWeek(clone(incomingWeek), key);
  });
  data.settings.weekStartDay = data.household.weekStartDay;
  data.settings.currentMemberId = activeMembers().some(member => member.id === localMemberId && member.appUser) ? localMemberId : null;
}

async function importHouseholdFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "MealPlannerHousehold" || payload.version !== 1 || !payload.household?.id || !Array.isArray(payload.items) || !Array.isArray(payload.meals) || !payload.weeks) {
      throw new Error("This is not a Meal Planner household update.");
    }
    const sameHousehold = payload.household.id === data.household.id;
    if (!sameHousehold) {
      const existingConfigured = activeMembers().length > 0;
      const question = existingConfigured
        ? `This update belongs to “${payload.household.name || "another household"}”. Join it? This copy's current household meal data will be replaced.`
        : `Join “${payload.household.name || "this household"}”? Its meals, plans and shopping data will become the shared household in this copy.`;
      if (!confirm(question)) return;
      adoptHouseholdPayload(payload);
    } else {
      mergeHouseholdPayload(payload);
    }
    selectedWeekStart = startOfWeek(selectedWeekStart, data.household.weekStartDay);
    saveData();
    renderAll();
    renderHouseholdSummary();
    showToast(sameHousehold ? "Household update merged" : "Household joined");
  } catch (error) {
    alert(error?.message || "That household update could not be imported.");
  }
}

function buildSharedWeekPayload() {
  const week = getWeek();
  const usedMealIds = new Set();
  ["dinner", "lunch"].forEach(slotType => week.slots[slotType].forEach(assignments => assignments.forEach(assignment => {
    if (assignment.mealId && assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING) usedMealIds.add(assignment.mealId);
    assignmentSideMealIds(assignment).forEach(id => usedMealIds.add(id));
  })));
  const meals = data.meals
    .filter(meal => !meal.deletedAt && usedMealIds.has(meal.id))
    .map(meal => ({ id: meal.id, name: meal.name, ingredients: clone(meal.ingredients || []), method: clone(normaliseMethod(meal.method)), tags: clone(normaliseMealTags(meal.tags)), rating: normaliseMealRating(meal.rating), sourceUrl: meal.sourceUrl || null, libraryRecipeId: meal.libraryRecipeId || null, librarySourceId: meal.librarySourceId || null }));
  const usedItemIds = new Set();
  meals.forEach(meal => {
    meal.ingredients.forEach(ingredient => usedItemIds.add(ingredient.itemId));
  });
  const items = data.items
    .filter(item => !item.deletedAt && usedItemIds.has(item.id))
    .map(item => ({ id: item.id, name: item.name, category: item.category }));
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: localDateKey(addDays(selectedWeekStart, index)),
    dinnerAssignments: clone(week.slots.dinner[index]),
    lunchAssignments: clone(week.slots.lunch[index])
  }));
  return {
    format: "MealPlannerWeek",
    version: 3,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    startDate: localDateKey(selectedWeekStart),
    weekStartDay: Number(data.settings.weekStartDay),
    householdMembers: clone(activeMembers()),
    days,
    meals,
    items
  };
}

async function shareCurrentWeek() {
  const payload = buildSharedWeekPayload();
  const mealCount = payload.days.reduce((sum, day) => sum + day.dinnerAssignments.filter(assignment => assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING).length, 0);
  const lunchCount = payload.days.reduce((sum, day) => sum + day.lunchAssignments.filter(assignment => assignment.mealId !== NO_MEAL && assignment.mealId !== NOT_EATING).length, 0);
  const result = await shareOrDownloadJson(
    payload,
    `MealPlanner-week-${payload.startDate}.json`,
    `Meal plan · ${formatWeekRange(selectedWeekStart)}`,
    `${mealCount} dinner meal${mealCount === 1 ? "" : "s"}${lunchCount ? ` and ${lunchCount} lunch meal${lunchCount === 1 ? "" : "s"}` : ""}. Import this file in Meal Planner.`
  );
  if (result === "downloaded") showToast("Shared week downloaded");
}

function findMealByName(name) {
  const key = keyName(name);
  return data.meals.find(meal => !meal.deletedAt && keyName(meal.name) === key) || null;
}

function weekForCalendarDate(date) {
  const start = startOfWeek(date, data.settings.weekStartDay);
  const key = localDateKey(start);
  if (!data.weeks[key]) data.weeks[key] = emptyWeek(key);
  data.weeks[key] = normaliseWeek(data.weeks[key], key);
  return { week: data.weeks[key], index: dateDistance(start, date), start };
}

async function importSharedWeekFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "MealPlannerWeek" || ![1,2,3].includes(payload.version) || !Array.isArray(payload.days) || !Array.isArray(payload.meals) || !Array.isArray(payload.items)) {
      throw new Error("This is not a shared Meal Planner week file.");
    }
    if (!payload.days.length || payload.days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(String(day.date || "")))) throw new Error("The shared week does not contain valid calendar dates.");

    const firstDate = fromDateKey(payload.days[0].date);
    const lastDate = fromDateKey(payload.days[payload.days.length - 1].date);
    const range = `${formatDateShort(firstDate)} – ${formatDateShort(lastDate)}`;
    if (!confirm(`Import the shared meal plan for ${range}? Dinner and lunch choices on those dates will be replaced.`)) return;

    const itemMap = new Map();
    payload.items.forEach(sharedItem => {
      const item = ensureItem(sharedItem.name, sharedItem.category || "Other", false);
      if (item && sharedItem.id) itemMap.set(sharedItem.id, item.id);
    });

    const mealMap = new Map();
    payload.meals.forEach(sharedMeal => {
      const name = normaliseName(sharedMeal.name);
      if (!name || !sharedMeal.id) return;
      const ingredients = Array.isArray(sharedMeal.ingredients) ? sharedMeal.ingredients.map(ingredient => ({
        itemId: itemMap.get(ingredient.itemId), qty: normaliseName(ingredient.qty), unit: normaliseName(ingredient.unit)
      })).filter(ingredient => ingredient.itemId) : [];
      let meal = findMealByName(name);
      const now = new Date().toISOString();
      const sharedTags = normaliseMealTags(sharedMeal.tags || []);
      const sharedRating = normaliseMealRating(sharedMeal.rating || 0);
      if (!meal) {
        meal = { id: uid("meal"), name: titleStyleName(name), ingredients, method: normaliseMethod(sharedMeal.method), tags: sharedTags, rating: sharedRating, sourceUrl: sharedMeal.sourceUrl || null, libraryRecipeId: sharedMeal.libraryRecipeId || null, librarySourceId: sharedMeal.librarySourceId || null, createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null, lastUsedAt: null };
        data.meals.push(meal);
      } else {
        meal.ingredients = ingredients;
            meal.method = normaliseMethod(sharedMeal.method);
        meal.tags = sharedTags;
        meal.rating = sharedRating;
        if (sharedMeal.libraryRecipeId) meal.libraryRecipeId = sharedMeal.libraryRecipeId;
        if (sharedMeal.librarySourceId) meal.librarySourceId = sharedMeal.librarySourceId;
        touchRecord(meal, now);
      }
      if (sharedMeal.sourceUrl) meal.sourceUrl = sharedMeal.sourceUrl;
      mealMap.set(sharedMeal.id, meal.id);
    });

    const memberMap = new Map();
    if (payload.version >= 2 && Array.isArray(payload.householdMembers) && activeMembers().length) {
      payload.householdMembers.forEach(sharedMember => {
        const local = activeMembers().find(member => keyName(member.name) === keyName(sharedMember.name));
        if (local) memberMap.set(sharedMember.id, local.id);
      });
    }

    const convertAssignments = (day, slotType) => {
      if (payload.version === 1) {
        const mealId = slotType === "dinner" ? day.dinnerMealId : day.lunchMealId;
        if (!mealId) return [];
        return [makeAssignment(mealId === NO_MEAL ? NO_MEAL : (mealMap.get(mealId) || null), null)].filter(assignment => assignment.mealId);
      }
      const source = slotType === "dinner" ? day.dinnerAssignments : day.lunchAssignments;
      return (Array.isArray(source) ? source : []).map(assignment => {
        const mappedMealId = assignment.mealId === NO_MEAL ? NO_MEAL : assignment.mealId === NOT_EATING ? NOT_EATING : mealMap.get(assignment.mealId);
        if (!mappedMealId) return null;
        let memberIds = null;
        if (Array.isArray(assignment.memberIds) && memberMap.size) memberIds = assignment.memberIds.map(id => memberMap.get(id)).filter(Boolean);
        const sideMealIds = payload.version >= 3 ? cleanSideMealIds(assignment.sideMealIds).map(id => mealMap.get(id)).filter(Boolean) : [];
        return makeAssignment(mappedMealId, memberIds, new Date().toISOString(), null, currentMemberId(), sideMealIds);
      }).filter(Boolean);
    };

    payload.days.forEach(day => {
      const date = fromDateKey(day.date);
      const target = weekForCalendarDate(date);
      if (target.index < 0 || target.index > 6) return;
      target.week.slots.dinner[target.index] = convertAssignments(day, "dinner");
      target.week.slots.lunch[target.index] = convertAssignments(day, "lunch");
      const importStamp = new Date().toISOString();
      touchWeekField(target.week, "dinner", target.index, importStamp);
      touchWeekField(target.week, "lunch", target.index, importStamp);
      syncLegacyWeekSlots(target.week);
    });

    selectedWeekStart = startOfWeek(firstDate, data.settings.weekStartDay);
    saveData({ immediateCloud: true });
    renderAll();
    switchTab("week");
    closeOverlay("data-overlay");
    showToast("Shared week imported");
  } catch (error) {
    alert(error?.message || "That shared week could not be imported.");
  }
}


function weekHasReusableContent(week) {
  return weekHasMealPlan(week) || !!week?.regularItemIds?.length;
}

function freshAssignments(assignments, stamp) {
  return (assignments || []).map(assignment => makeAssignment(
    assignment.mealId,
    Array.isArray(assignment.memberIds) ? [...assignment.memberIds] : null,
    stamp,
    null,
    currentMemberId(),
    assignmentSideMealIds(assignment)
  ));
}

function remapReusableSlots(rawSlots, sourceWeekStartDay, targetWeekStartDay, stamp) {
  const mapped = {
    dinner: Array.from({ length: 7 }, () => []),
    lunch: Array.from({ length: 7 }, () => [])
  };
  const sourceStart = Number.isInteger(Number(sourceWeekStartDay)) ? Number(sourceWeekStartDay) : targetWeekStartDay;
  ["dinner", "lunch"].forEach(slotType => {
    for (let sourceIndex = 0; sourceIndex < 7; sourceIndex += 1) {
      const weekday = (sourceStart + sourceIndex) % 7;
      const targetIndex = (weekday - targetWeekStartDay + 7) % 7;
      mapped[slotType][targetIndex] = freshAssignments(rawSlots?.[slotType]?.[sourceIndex], stamp);
    }
  });
  return mapped;
}

function applyReusableWeek(targetWeek, slots, regularItemIds, sourceWeekStartDay) {
  const stamp = new Date().toISOString();
  targetWeek.slots = remapReusableSlots(slots, sourceWeekStartDay, data.settings.weekStartDay, stamp);
  targetWeek.regularItemIds = Array.from(new Set((regularItemIds || []).filter(id => !!findItem(id))));
  targetWeek.checkedItemIds = [];
  targetWeek.notNeededItemIds = [];
  for (let index = 0; index < 7; index += 1) {
    touchWeekField(targetWeek, "dinner", index, stamp);
    touchWeekField(targetWeek, "lunch", index, stamp);
  }
  touchWeekField(targetWeek, "regularItemIds", null, stamp);
  touchWeekField(targetWeek, "checkedItemIds", null, stamp);
  touchWeekField(targetWeek, "notNeededItemIds", null, stamp);
  syncLegacyWeekSlots(targetWeek);
  return targetWeek;
}

function updateCopyWeekTarget() {
  const input = $("#copy-week-date");
  const label = $("#copy-week-target");
  if (!input?.value) {
    label.textContent = "";
    return;
  }
  const targetStart = startOfWeek(fromDateKey(input.value), data.settings.weekStartDay);
  label.textContent = `Destination: ${formatWeekRange(targetStart)}`;
}

function openCopyWeek() {
  const sourceWeek = getWeek();
  if (!weekHasReusableContent(sourceWeek)) {
    showToast("There is nothing to copy yet");
    return;
  }
  $("#copy-week-from").textContent = formatWeekRange(selectedWeekStart);
  $("#copy-week-date").value = localDateKey(addDays(selectedWeekStart, 7));
  updateCopyWeekTarget();
  closeOverlay("settings-overlay");
  openOverlay("copy-week-overlay");
}

function copyCurrentWeek(event) {
  event.preventDefault();
  const rawDate = $("#copy-week-date").value;
  if (!rawDate) return;
  const sourceStart = startOfWeek(selectedWeekStart, data.settings.weekStartDay);
  const sourceKey = localDateKey(sourceStart);
  const sourceWeek = getWeek(sourceStart);
  if (!weekHasReusableContent(sourceWeek)) {
    closeOverlay("copy-week-overlay");
    showToast("There is nothing to copy yet");
    return;
  }
  const targetStart = startOfWeek(fromDateKey(rawDate), data.settings.weekStartDay);
  const targetKey = localDateKey(targetStart);
  if (targetKey === sourceKey) {
    showToast("Choose a different week");
    return;
  }
  const targetWeek = data.weeks[targetKey] ? normaliseWeek(data.weeks[targetKey], targetKey) : emptyWeek(targetKey);
  if (weekHasReusableContent(targetWeek) && !confirm(`The destination week (${formatWeekRange(targetStart)}) already has meals or selected regulars. Replace those with this week's plan?`)) return;
  applyReusableWeek(targetWeek, sourceWeek.slots, sourceWeek.regularItemIds, data.settings.weekStartDay);
  data.weeks[targetKey] = targetWeek;
  selectedWeekStart = targetStart;
  saveData({ immediateCloud: true });
  renderAll();
  closeOverlay("copy-week-overlay");
  switchTab("week");
  showToast("Week copied");
}

function openSaveWeek() {
  const week = getWeek();
  if (!weekHasReusableContent(week)) {
    showToast("There is nothing to save yet");
    return;
  }
  $("#saved-week-name").value = formatWeekRange(selectedWeekStart);
  closeOverlay("settings-overlay");
  openOverlay("save-week-overlay");
  requestAnimationFrame(() => $("#saved-week-name")?.select());
}

function saveCurrentWeekTemplate(event) {
  event.preventDefault();
  const week = getWeek();
  if (!weekHasReusableContent(week)) {
    closeOverlay("save-week-overlay");
    showToast("There is nothing to save yet");
    return;
  }
  const stamp = new Date().toISOString();
  const name = normaliseName($("#saved-week-name").value) || formatWeekRange(selectedWeekStart);
  const savedWeek = normaliseSavedWeek({
    id: uid("savedweek"),
    name,
    weekStartDay: data.settings.weekStartDay,
    sourceStartDate: week.startDate,
    slots: clone(week.slots),
    regularItemIds: clone(week.regularItemIds),
    createdAt: stamp,
    updatedAt: stamp,
    updatedBy: currentMemberId()
  }, (data.savedWeeks || []).length);
  if (!Array.isArray(data.savedWeeks)) data.savedWeeks = [];
  data.savedWeeks.push(savedWeek);
  touchSharedState(stamp, savedWeek.updatedBy);
  saveData({ immediateCloud: true });
  closeOverlay("save-week-overlay");
  showToast("Week saved");
}

function savedWeekSummary(savedWeek) {
  const dinners = savedWeek.slots.dinner.filter(assignments => assignments.length).length;
  const lunches = savedWeek.slots.lunch.filter(assignments => assignments.length).length;
  const regulars = savedWeek.regularItemIds.length;
  const parts = [];
  if (dinners) parts.push(`${dinners} dinner${dinners === 1 ? "" : "s"}`);
  if (lunches) parts.push(`${lunches} lunch${lunches === 1 ? "" : "es"}`);
  if (regulars) parts.push(`${regulars} regular${regulars === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Empty template";
}

function renderSavedWeeks() {
  const list = $("#saved-week-list");
  if (!list) return;
  $("#saved-weeks-target").textContent = formatWeekRange(selectedWeekStart);
  const saved = activeSavedWeeks().slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (!saved.length) {
    list.innerHTML = `<div class="empty-state compact-empty"><strong>No saved weeks yet</strong><span>Save a week you like, then reuse it here.</span></div>`;
    return;
  }
  list.innerHTML = saved.map(savedWeek => `
    <article class="saved-week-card">
      <div class="saved-week-copy">
        <strong>${escapeHtml(savedWeek.name)}</strong>
        <small>${escapeHtml(savedWeekSummary(savedWeek))}</small>
      </div>
      <div class="saved-week-actions">
        <button class="secondary-button saved-week-use" type="button" data-use-saved-week="${savedWeek.id}">Use</button>
        <button class="saved-week-delete" type="button" data-delete-saved-week="${savedWeek.id}" aria-label="Delete ${escapeHtml(savedWeek.name)}">Delete</button>
      </div>
    </article>`).join("");
}

function openSavedWeeks() {
  closeOverlay("settings-overlay");
  renderSavedWeeks();
  openOverlay("saved-weeks-overlay");
}

function useSavedWeek(id) {
  const savedWeek = findSavedWeek(id);
  if (!savedWeek) return;
  const targetWeek = getWeek();
  if (weekHasReusableContent(targetWeek) && !confirm(`Replace the meals and selected regulars for ${formatWeekRange(selectedWeekStart)} with “${savedWeek.name}”?`)) return;
  applyReusableWeek(targetWeek, savedWeek.slots, savedWeek.regularItemIds, savedWeek.weekStartDay);
  data.weeks[weekKey()] = targetWeek;
  saveData({ immediateCloud: true });
  renderAll();
  closeOverlay("saved-weeks-overlay");
  switchTab("week");
  showToast("Saved week applied");
}

function deleteSavedWeek(id) {
  const savedWeek = findSavedWeek(id);
  if (!savedWeek) return;
  if (!confirm(`Delete the saved week “${savedWeek.name}”?`)) return;
  const stamp = new Date().toISOString();
  savedWeek.deletedAt = stamp;
  touchRecord(savedWeek, stamp);
  saveData({ immediateCloud: true });
  renderSavedWeeks();
  showToast("Saved week deleted");
}

function dayHasReusableContent(week, dayIndex) {
  return getSlotAssignments(week, "dinner", dayIndex).length > 0 || getSlotAssignments(week, "lunch", dayIndex).length > 0;
}

function assignmentMealNames(assignments) {
  return (assignments || []).map(assignment => {
    if (assignment.mealId === NO_MEAL) return "No meal";
    if (assignment.mealId === NOT_EATING) return "Not eating";
    const meal = findMeal(assignment.mealId);
    if (!meal) return "";
    const sides = assignmentSideMealIds(assignment).map(id => findMeal(id)?.name).filter(Boolean);
    return sides.length ? `${meal.name} + ${sides.join(", ")}` : meal.name;
  }).filter(Boolean);
}

function defaultSavedDayName(dayIndex) {
  const week = getWeek();
  const date = addDays(selectedWeekStart, dayIndex);
  const dinnerNames = assignmentMealNames(getSlotAssignments(week, "dinner", dayIndex));
  const lunchNames = assignmentMealNames(getSlotAssignments(week, "lunch", dayIndex));
  const names = dinnerNames.length ? dinnerNames : lunchNames;
  return names.length ? `${formatDayLong(date)} · ${names.join(" / ")}` : `${formatDayLong(date)} · ${formatDateShort(date)}`;
}

function openSaveDay(dayIndex) {
  const index = Number(dayIndex);
  const week = getWeek();
  if (!dayHasReusableContent(week, index)) {
    showToast("There is nothing to save for this day");
    return;
  }
  dayTemplateTargetIndex = index;
  $("#saved-day-name").value = defaultSavedDayName(index);
  $("#save-day-date").textContent = `${formatDayLong(addDays(selectedWeekStart, index))} ${formatDateShort(addDays(selectedWeekStart, index))}`;
  openOverlay("save-day-overlay");
  requestAnimationFrame(() => $("#saved-day-name")?.select());
}

function saveCurrentDayTemplate(event) {
  event.preventDefault();
  const index = Number(dayTemplateTargetIndex);
  if (!Number.isInteger(index) || index < 0 || index > 6) return;
  const week = getWeek();
  if (!dayHasReusableContent(week, index)) {
    closeOverlay("save-day-overlay");
    showToast("There is nothing to save for this day");
    return;
  }
  const stamp = new Date().toISOString();
  const savedDay = normaliseSavedDay({
    id: uid("savedday"),
    name: normaliseName($("#saved-day-name").value) || defaultSavedDayName(index),
    slots: {
      dinner: clone(getSlotAssignments(week, "dinner", index)),
      lunch: clone(getSlotAssignments(week, "lunch", index))
    },
    createdAt: stamp,
    updatedAt: stamp,
    updatedBy: currentMemberId()
  }, (data.savedDays || []).length);
  if (!Array.isArray(data.savedDays)) data.savedDays = [];
  data.savedDays.push(savedDay);
  touchSharedState(stamp, savedDay.updatedBy);
  saveData({ immediateCloud: true });
  closeOverlay("save-day-overlay");
  showToast("Day saved");
}

function savedDaySummary(savedDay) {
  const dinnerNames = assignmentMealNames(savedDay.slots.dinner);
  const lunchNames = assignmentMealNames(savedDay.slots.lunch);
  const parts = [];
  if (dinnerNames.length) parts.push(`Dinner: ${dinnerNames.join(" / ")}`);
  if (lunchNames.length) parts.push(`Lunch: ${lunchNames.join(" / ")}`);
  return parts.join(" · ") || "Empty day";
}

function renderSavedDays() {
  const list = $("#saved-day-list");
  if (!list) return;
  const index = Number(dayTemplateTargetIndex);
  const date = addDays(selectedWeekStart, Number.isInteger(index) ? index : 0);
  $("#saved-days-target").textContent = `${formatDayLong(date)} ${formatDateShort(date)}`;
  const saved = activeSavedDays().slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (!saved.length) {
    list.innerHTML = `<div class="empty-state compact-empty"><strong>No saved days yet</strong><span>Save a day you like, then reuse it here.</span></div>`;
    return;
  }
  list.innerHTML = saved.map(savedDay => `
    <article class="saved-week-card">
      <div class="saved-week-copy">
        <strong>${escapeHtml(savedDay.name)}</strong>
        <small>${escapeHtml(savedDaySummary(savedDay))}</small>
      </div>
      <div class="saved-week-actions">
        <button class="secondary-button saved-week-use" type="button" data-use-saved-day="${savedDay.id}">Use</button>
        <button class="saved-week-delete" type="button" data-delete-saved-day="${savedDay.id}" aria-label="Delete ${escapeHtml(savedDay.name)}">Delete</button>
      </div>
    </article>`).join("");
}

function openSavedDays(dayIndex) {
  dayTemplateTargetIndex = Number(dayIndex);
  renderSavedDays();
  openOverlay("saved-days-overlay");
}

function applySavedDay(savedDay, dayIndex) {
  const week = getWeek();
  const stamp = new Date().toISOString();
  const validAssignments = assignments => freshAssignments((assignments || []).filter(assignment => assignment.mealId === NO_MEAL || assignment.mealId === NOT_EATING || !!findMeal(assignment.mealId)), stamp);
  week.slots.dinner[dayIndex] = validAssignments(savedDay.slots.dinner);
  week.slots.lunch[dayIndex] = validAssignments(savedDay.slots.lunch);
  touchWeekField(week, "dinner", dayIndex, stamp);
  touchWeekField(week, "lunch", dayIndex, stamp);
  syncLegacyWeekSlots(week);
}

function useSavedDay(id) {
  const savedDay = findSavedDay(id);
  const index = Number(dayTemplateTargetIndex);
  if (!savedDay || !Number.isInteger(index) || index < 0 || index > 6) return;
  const week = getWeek();
  const date = addDays(selectedWeekStart, index);
  if (dayHasReusableContent(week, index) && !confirm(`Replace the meals for ${formatDayLong(date)} ${formatDateShort(date)} with “${savedDay.name}”?`)) return;
  applySavedDay(savedDay, index);
  saveData({ immediateCloud: true });
  closeOverlay("saved-days-overlay");
  renderAll();
  showToast("Saved day applied");
}

function deleteSavedDay(id) {
  const savedDay = findSavedDay(id);
  if (!savedDay) return;
  if (!confirm(`Delete the saved day “${savedDay.name}”?`)) return;
  const stamp = new Date().toISOString();
  savedDay.deletedAt = stamp;
  touchRecord(savedDay, stamp);
  saveData({ immediateCloud: true });
  renderSavedDays();
  showToast("Saved day deleted");
}

function clearDayPlan(dayIndex) {
  const index = Number(dayIndex);
  const week = getWeek();
  const date = addDays(selectedWeekStart, index);
  if (!dayHasReusableContent(week, index)) {
    showToast("This day is already clear");
    return;
  }
  if (!confirm(`Clear lunch and dinner for ${formatDayLong(date)} ${formatDateShort(date)}?`)) return;
  const stamp = new Date().toISOString();
  week.slots.dinner[index] = [];
  week.slots.lunch[index] = [];
  touchWeekField(week, "dinner", index, stamp);
  touchWeekField(week, "lunch", index, stamp);
  syncLegacyWeekSlots(week);
  saveData({ immediateCloud: true });
  renderAll();
  showToast("Day cleared");
}

function openWeekSettings() {
  $("#week-start-day").value = String(data.settings.weekStartDay);
  openOverlay("settings-overlay");
}

function clearCurrentWeek() {
  const week = getWeek();
  const hasContent = weekHasMealPlan(week) ||
    week.regularItemIds.length ||
    week.extras.length ||
    week.checkedItemIds.length ||
    week.notNeededItemIds.length;

  if (!hasContent) {
    closeOverlay("settings-overlay");
    showToast("This week is already clear");
    return;
  }

  if (!confirm(`Clear ${formatWeekRange(selectedWeekStart)}? This removes its meals and resets its shopping list. Saved weeks and your meal library are not affected.`)) return;

  const stamp = new Date().toISOString();
  week.slots = {
    dinner: Array.from({ length: 7 }, () => []),
    lunch: Array.from({ length: 7 }, () => [])
  };
  week.regularItemIds = [];
  week.extras = [];
  week.checkedItemIds = [];
  week.notNeededItemIds = [];

  for (let index = 0; index < 7; index += 1) {
    touchWeekField(week, "dinner", index, stamp);
    touchWeekField(week, "lunch", index, stamp);
  }
  ["regularItemIds", "extras", "checkedItemIds", "notNeededItemIds"].forEach(field => touchWeekField(week, field, null, stamp));
  syncLegacyWeekSlots(week);
  data.weeks[weekKey()] = week;
  saveData({ immediateCloud: true });
  renderAll();
  closeOverlay("settings-overlay");
  switchTab("week");
  showToast("Week cleared");
}

function weekHasMealPlan(week) {
  if (!week) return false;
  const clean = normaliseWeek(week, week.startDate || "");
  return ["dinner", "lunch"].some(slotType => clean.slots[slotType].some(assignments => assignments.length));
}

function updateMoveWeekTarget() {
  const input = $("#move-week-date");
  const label = $("#move-week-target");
  if (!input?.value) {
    label.textContent = "";
    return;
  }
  const pickedDate = fromDateKey(input.value);
  const targetStart = startOfWeek(pickedDate, data.settings.weekStartDay);
  label.textContent = `Destination: ${formatWeekRange(targetStart)}`;
}

function openMoveWeek() {
  const sourceWeek = getWeek();
  if (!weekHasMealPlan(sourceWeek)) {
    showToast("There are no meals to move");
    return;
  }
  $("#move-week-from").textContent = formatWeekRange(selectedWeekStart);
  $("#move-week-date").value = localDateKey(addDays(selectedWeekStart, 7));
  updateMoveWeekTarget();
  closeOverlay("settings-overlay");
  openOverlay("move-week-overlay");
}

function moveCurrentWeekPlan(event) {
  event.preventDefault();
  const rawDate = $("#move-week-date").value;
  if (!rawDate) return;

  const sourceStart = startOfWeek(selectedWeekStart, data.settings.weekStartDay);
  const sourceKey = localDateKey(sourceStart);
  const sourceWeek = getWeek(sourceStart);
  if (!weekHasMealPlan(sourceWeek)) {
    closeOverlay("move-week-overlay");
    showToast("There are no meals to move");
    return;
  }

  const targetStart = startOfWeek(fromDateKey(rawDate), data.settings.weekStartDay);
  const targetKey = localDateKey(targetStart);
  if (targetKey === sourceKey) {
    showToast("Choose a different week");
    return;
  }

  const existingTarget = data.weeks[targetKey] ? normaliseWeek(data.weeks[targetKey], targetKey) : emptyWeek(targetKey);
  if (weekHasMealPlan(existingTarget) && !confirm(`The destination week (${formatWeekRange(targetStart)}) already has planned meals. Replace those dinners and lunches?`)) return;

  const now = new Date().toISOString();
  existingTarget.slots = clone(sourceWeek.slots);
  for (let index = 0; index < 7; index += 1) {
    touchWeekField(existingTarget, "dinner", index, now);
    touchWeekField(existingTarget, "lunch", index, now);
  }
  syncLegacyWeekSlots(existingTarget);
  data.weeks[targetKey] = existingTarget;

  sourceWeek.slots = { dinner: Array.from({ length: 7 }, () => []), lunch: Array.from({ length: 7 }, () => []) };
  for (let index = 0; index < 7; index += 1) {
    touchWeekField(sourceWeek, "dinner", index, now);
    touchWeekField(sourceWeek, "lunch", index, now);
  }
  syncLegacyWeekSlots(sourceWeek);
  data.weeks[sourceKey] = sourceWeek;

  selectedWeekStart = targetStart;
  saveData({ immediateCloud: true });
  renderAll();
  closeOverlay("move-week-overlay");
  switchTab("week");
  showToast("Meal plan moved");
}

function saveWeekSettings(event) {
  event.preventDefault();
  const nextStartDay = Number($("#week-start-day").value);
  if (!Number.isInteger(nextStartDay) || nextStartDay < 0 || nextStartDay > 6) return;

  const previousStartDay = Number(data.settings.weekStartDay);
  if (nextStartDay !== previousStartDay) {
    const viewAnchor = addDays(selectedWeekStart, 3);
    data.weeks = rebaseWeekMap(data.weeks, previousStartDay, nextStartDay);
    data.settings.weekStartDay = nextStartDay;
    data.household.weekStartDay = nextStartDay;
    touchRecord(data.household);
    selectedWeekStart = startOfWeek(viewAnchor, nextStartDay);
    saveData({ immediateCloud: true });
    renderAll();
    showToast("Week start updated");
  }
  closeOverlay("settings-overlay");
}

function switchTab(tab) {
  if (!['week', 'meals', 'shop'].includes(tab)) tab = 'week';
  $$(".screen").forEach(screen => { const active = screen.dataset.screen === tab; screen.hidden = !active; screen.classList.toggle("active", active); });
  $$(".nav-button").forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle("active", active); if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
  data.settings.lastTab = tab;
  saveData();
  if (tab === "shop") renderShop();
  if (tab === "meals") renderMeals();
  window.scrollTo(0, 0);
}

function renderAll() {
  renderKnownItems();
  renderWeek();
  renderMeals();
  renderShop();
  if ($("#household-title")) renderHouseholdSummary();
}

function changeWeek(offset) {
  selectedWeekStart = addDays(selectedWeekStart, offset * 7);
  renderWeek();
  renderShop();
}

function bindEvents() {
  document.addEventListener("click", event => {
    const libraryPackButton = event.target.closest("[data-library-pack]");
    if (libraryPackButton) { librarySelectedPackId = libraryPackButton.dataset.libraryPack; renderRecipeLibrary(); return; }
    const libraryRecipeButton = event.target.closest("[data-library-recipe]");
    if (libraryRecipeButton) return openLibraryRecipe(libraryRecipeButton.dataset.libraryRecipe);
    const addLibraryPackButton = event.target.closest("[data-add-library-pack]");
    if (addLibraryPackButton) return addLibraryPack(addLibraryPackButton.dataset.addLibraryPack);
    const editLibraryButton = event.target.closest("[data-library-edit]");
    if (editLibraryButton) return openLibraryAdminEditor(editLibraryButton.dataset.libraryEdit);
    const cookMealButton = event.target.closest("[data-cook-meal]");
    if (cookMealButton) return startCookingMeal(cookMealButton.dataset.cookMeal);
    const methodButton = event.target.closest("[data-view-method]");
    if (methodButton) return openMealMethod(methodButton.dataset.viewMethod);
    const addAlternative = event.target.closest("[data-add-alternative]");
    if (addAlternative) return openMealPicker(addAlternative.dataset.dayIndex, addAlternative.dataset.addAlternative, null, "alternative");
    const addSideMeal = event.target.closest("[data-add-side-meal]");
    if (addSideMeal) return openMealPicker(addSideMeal.dataset.sideDay, addSideMeal.dataset.addSideMeal, addSideMeal.dataset.sideAssignment, "side");
    const removeSideMeal = event.target.closest("[data-remove-side-meal]");
    if (removeSideMeal) return removeSideMealFromAssignment(Number(removeSideMeal.dataset.sideDay), removeSideMeal.dataset.sideSlot, removeSideMeal.dataset.sideAssignment, removeSideMeal.dataset.removeSideMeal);
    const slot = event.target.closest("[data-day-index][data-meal-slot]");
    if (slot) return openMealPicker(slot.dataset.dayIndex, slot.dataset.mealSlot, slot.dataset.assignmentId || null);
    const allAudience = event.target.closest("[data-audience-all]");
    if (allAudience) return selectAllSplitMembers();
    const splitMember = event.target.closest("[data-split-member]");
    if (splitMember) return toggleSplitMember(splitMember.dataset.splitMember);
    const pick = event.target.closest("[data-pick-meal]");
    if (pick) return chooseMealForDay(pick.dataset.pickMeal);
    const mealFilterTag = event.target.closest("[data-meal-tag-filter]");
    if (mealFilterTag) {
      const tag = mealFilterTag.dataset.mealTagFilter;
      if (tag === "all") mealTagFilters = [];
      else toggleTagFilter(mealTagFilters, tag);
      renderMeals();
      return;
    }
    const pickerFilterTag = event.target.closest("[data-picker-tag-filter]");
    if (pickerFilterTag) {
      const tag = pickerFilterTag.dataset.pickerTagFilter;
      if (tag === "all") pickerTagFilters = [];
      else toggleTagFilter(pickerTagFilters, tag);
      renderPicker();
      return;
    }
    const mealCardTag = event.target.closest("[data-meal-card-tag]");
    if (mealCardTag) {
      mealTagFilters = [mealCardTag.dataset.mealCardTag];
      switchTab("meals");
      renderMeals();
      return;
    }
    const editMealTag = event.target.closest("[data-edit-meal-tag]");
    if (editMealTag) {
      const tag = editMealTag.dataset.editMealTag;
      return mealTagRemoveMode ? removeMealTagFromLibrary(tag) : toggleEditingMealTag(tag);
    }
    const editMealRating = event.target.closest("[data-edit-meal-rating]");
    if (editMealRating) {
      const value = Number(editMealRating.dataset.editMealRating);
      editingMealRating = editingMealRating === value ? 0 : value;
      renderMealRatingEditor();
      return;
    }
    const edit = event.target.closest("[data-edit-meal]");
    if (edit) return openMealEditor(edit.dataset.editMeal);
    const editMember = event.target.closest("[data-edit-member]");
    if (editMember) return openMemberEditor(editMember.dataset.editMember);
    const saveDayButton = event.target.closest("[data-save-day]");
    if (saveDayButton) return openSaveDay(saveDayButton.dataset.saveDay);
    const loadDayButton = event.target.closest("[data-load-day]");
    if (loadDayButton) return openSavedDays(loadDayButton.dataset.loadDay);
    const clearDayButton = event.target.closest("[data-clear-day-plan]");
    if (clearDayButton) return clearDayPlan(clearDayButton.dataset.clearDayPlan);
    const useSavedDayButton = event.target.closest("[data-use-saved-day]");
    if (useSavedDayButton) return useSavedDay(useSavedDayButton.dataset.useSavedDay);
    const deleteSavedDayButton = event.target.closest("[data-delete-saved-day]");
    if (deleteSavedDayButton) return deleteSavedDay(deleteSavedDayButton.dataset.deleteSavedDay);
    const useSavedWeekButton = event.target.closest("[data-use-saved-week]");
    if (useSavedWeekButton) return useSavedWeek(useSavedWeekButton.dataset.useSavedWeek);
    const deleteSavedWeekButton = event.target.closest("[data-delete-saved-week]");
    if (deleteSavedWeekButton) return deleteSavedWeek(deleteSavedWeekButton.dataset.deleteSavedWeek);
    const memberColor = event.target.closest("[data-member-color]");
    if (memberColor) return renderMemberColorChoices(memberColor.dataset.memberColor);
    const removeExtra = event.target.closest("[data-remove-extra]");
    if (removeExtra) return removeExtraItem(removeExtra.dataset.removeExtra);
    const skipItem = event.target.closest("[data-skip-item]");
    if (skipItem) return toggleNotNeededItem(skipItem.dataset.skipItem);
    const check = event.target.closest("[data-check-item]");
    if (check) return toggleShoppingItem(check.dataset.checkItem);
    const regularPick = event.target.closest("[data-regular-pick]");
    if (regularPick) return toggleRegularForWeek(regularPick.dataset.regularPick);
    const regularToggle = event.target.closest("[data-toggle-regular]");
    if (regularToggle) return toggleItemRegular(regularToggle.dataset.toggleRegular);
    const nav = event.target.closest("[data-tab]");
    if (nav) return switchTab(nav.dataset.tab);
    const closer = event.target.closest("[data-close]");
    if (closer) return closeOverlay(closer.dataset.close);
  });

  $$(".overlay").forEach(overlay => overlay.addEventListener("click", event => { if (event.target === overlay) closeOverlay(overlay.id); }));
  document.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-check-item]")) {
      event.preventDefault();
      toggleShoppingItem(event.target.dataset.checkItem);
      return;
    }
    if (event.key === "Escape") { const overlay = $(".overlay:not([hidden])"); if (overlay) closeOverlay(overlay.id); }
  });

  $("#prev-week").addEventListener("click", () => changeWeek(-1));
  $("#next-week").addEventListener("click", () => changeWeek(1));
  $("#data-sharing").addEventListener("click", openDataSharing);
  $("#week-settings").addEventListener("click", openWeekSettings);
  $("#settings-form").addEventListener("submit", saveWeekSettings);
  $("#remove-people").addEventListener("click", openRemovePeopleFromMeal);
  $("#not-eating").addEventListener("click", () => {
    closeOverlay("meal-picker-overlay");
    openSplitMembers(pickerDayIndex, pickerSlotType, null, "notEating", []);
  });
  $("#rejoin-main").addEventListener("click", () => {
    const assignmentId = pickerAssignmentId;
    closeOverlay("meal-picker-overlay");
    openSplitMembers(pickerDayIndex, pickerSlotType, assignmentId, "rejoinMain", []);
  });
  $("#save-day-form").addEventListener("submit", saveCurrentDayTemplate);
  $("#copy-week-plan").addEventListener("click", openCopyWeek);
  $("#copy-week-date").addEventListener("change", updateCopyWeekTarget);
  $("#copy-week-form").addEventListener("submit", copyCurrentWeek);
  $("#save-week-plan").addEventListener("click", openSaveWeek);
  $("#save-week-form").addEventListener("submit", saveCurrentWeekTemplate);
  $("#open-saved-weeks").addEventListener("click", openSavedWeeks);
  $("#move-week-plan").addEventListener("click", openMoveWeek);
  $("#move-week-date").addEventListener("change", updateMoveWeekTarget);
  $("#move-week-form").addEventListener("submit", moveCurrentWeekPlan);
  $("#clear-week").addEventListener("click", clearCurrentWeek);
  $("#clear-day").addEventListener("click", () => chooseMealForDay(null));
  $("#no-dinner").addEventListener("click", () => chooseMealForDay(NO_MEAL));
  $("#picker-search").addEventListener("input", renderPicker);
  $("#meal-search").addEventListener("input", renderMeals);
  $("#meal-rating-filter").addEventListener("change", event => { mealRatingFilter = event.target.value; renderMeals(); });
  $("#picker-rating-filter").addEventListener("change", event => { pickerRatingFilter = event.target.value; renderPicker(); });
  $("#meal-tag-add").addEventListener("click", addCustomMealTag);
  $("#meal-tag-remove").addEventListener("click", toggleMealTagRemoveMode);
  $("#meal-tag-input").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); addCustomMealTag(); } });
  $("#add-meal").addEventListener("click", () => openMealEditor());
  $("#browse-library").addEventListener("click", openRecipeLibrary);
  $("#library-search").addEventListener("input", renderRecipeLibrary);
  $("#library-admin-toggle").addEventListener("click", () => { libraryAdminMode = !libraryAdminMode; renderRecipeLibrary(); });
  $("#library-admin-new").addEventListener("click", () => openLibraryAdminEditor());
  $("#library-admin-export").addEventListener("click", exportRecipeLibrary);
  $("#library-add-recipe").addEventListener("click", () => activeLibraryRecipeId && addLibraryRecipe(activeLibraryRecipeId));
  $("#library-admin-edit").addEventListener("click", () => activeLibraryRecipeId && openLibraryAdminEditor(activeLibraryRecipeId));
  $("#library-admin-form").addEventListener("submit", saveLibraryAdminRecipe);
  $("#library-admin-delete").addEventListener("click", deleteLibraryAdminRecipe);
  $("#meal-method-edit").addEventListener("click", () => { const id = activeMethodMealId; closeOverlay("meal-method-overlay"); if (id) openMealEditor(id); });
  $("#import-meal").addEventListener("click", openRecipeImporter);
  $("#recipe-import-form").addEventListener("submit", importRecipeFromWebsite);
  $("#recipe-photo-files").addEventListener("change", selectRecipePhotos);
  $("#recipe-photo-read").addEventListener("click", importRecipeFromPhotos);
  $("#add-ingredient").addEventListener("click", () => addIngredientRow({}));
  $("#ingredient-list").addEventListener("click", event => { const remove = event.target.closest(".remove-ingredient"); if (remove) remove.closest("[data-ingredient-row]").remove(); });
  $("#ingredient-list").addEventListener("change", event => {
    if (!event.target.classList.contains("ingredient-name")) return;
    applyTitleStyleToInput(event.target);
    const item = findItemByName(event.target.value);
    if (item) event.target.closest("[data-ingredient-row]").querySelector(".ingredient-category").value = item.category;
  });
  document.addEventListener("input", event => {
    if (event.target.matches("#meal-name, .ingredient-name, #library-admin-title")) applyTitleStyleToInput(event.target);
  });
  document.addEventListener("focusout", event => {
    if (event.target.matches("#meal-name, .ingredient-name")) applyTitleStyleToInput(event.target);
  });
  $("#meal-form").addEventListener("submit", saveMealFromForm);
  $("#delete-meal").addEventListener("click", deleteCurrentMeal);

  $("#split-members-next").addEventListener("click", continueSplitMeal);
  $("#picker-audience")?.addEventListener("click", () => openSplitMembers(pickerDayIndex, pickerSlotType, pickerAssignmentId, "picker", pickerAudienceMemberIds));

  $("#add-shop-item").addEventListener("click", openShopItemEditor);
  $("#shop-item-name").addEventListener("change", syncShopCategoryFromKnownName);
  $("#shop-item-form").addEventListener("submit", addShopItem);
  $("#toggle-checked").addEventListener("click", () => { data.settings.hideChecked = !data.settings.hideChecked; saveData(); renderShop(); });
  $("#add-regulars").addEventListener("click", () => { renderRegularPicker(); openOverlay("regular-picker-overlay"); });
  $("#regular-picker-done").addEventListener("click", () => closeOverlay("regular-picker-overlay"));
  $("#manage-regulars").addEventListener("click", () => { renderRegularManager(); openOverlay("regular-manager-overlay"); });
  $("#regular-add-form").addEventListener("submit", addRegularItem);

  $("#cloud-auth-open").addEventListener("click", openCloudAuth);
  $("#cloud-auth-form").addEventListener("submit", cloudSignIn);
  $("#cloud-create-account").addEventListener("click", cloudCreateAccount);
  $("#cloud-reset-password").addEventListener("click", cloudResetPassword);
  $("#cloud-verify").addEventListener("click", () => window.MealPlannerFirebase?.refreshVerification());
  $("#cloud-start").addEventListener("click", startCloudSync);
  $("#cloud-join").addEventListener("click", joinCloudHousehold);
  $("#cloud-sync-now").addEventListener("click", () => window.MealPlannerFirebase?.syncNow());
  $("#cloud-signout").addEventListener("click", () => window.MealPlannerFirebase?.signOut());

  $("#manage-household").addEventListener("click", openHouseholdManager);
  $("#household-name-form").addEventListener("submit", saveHouseholdName);
  $("#add-household-member").addEventListener("click", () => openMemberEditor());
  $("#member-form").addEventListener("submit", saveMember);
  $("#delete-member").addEventListener("click", deleteMember);
  $("#member-app-user").addEventListener("change", event => {
    $("#member-this-device").disabled = !event.target.checked;
    $("#member-email-wrap").hidden = !event.target.checked;
    if (!event.target.checked) $("#member-this-device").checked = false;
  });
  $("#share-household").addEventListener("click", shareHouseholdUpdate);
  $("#import-household").addEventListener("click", () => $("#household-file-input").click());
  $("#household-file-input").addEventListener("change", async event => {
    const file = event.target.files?.[0]; event.target.value = ""; await importHouseholdFile(file);
  });

  $("#export-backup").addEventListener("click", exportBackup);
  $("#import-backup").addEventListener("click", () => $("#backup-file-input").click());
  $("#backup-file-input").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await importBackupFile(file);
  });
  $("#share-week").addEventListener("click", shareCurrentWeek);
  $("#import-week").addEventListener("click", () => $("#week-file-input").click());
  $("#week-file-input").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await importSharedWeekFile(file);
  });

  $("#install-done").addEventListener("click", () => closeOverlay("install-overlay"));
  $("#install-button").addEventListener("click", handleInstallClick);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setupInstall() {
  const button = $("#install-button");
  if (isStandalone()) { button.hidden = true; return; }
  const ua = navigator.userAgent || "";
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  button.hidden = !isiOS;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.hidden = false;
  });
  window.addEventListener("appinstalled", () => { button.hidden = true; deferredInstallPrompt = null; });
}

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    return;
  }
  const shareIcon = `<strong>Share</strong> <span aria-hidden="true">□↑</span>`;
  $("#install-copy").innerHTML = `<p>In Safari, Meal Planner can live on your Home Screen and work offline.</p><div class="install-step">1. Tap ${shareIcon} in Safari.</div><div class="install-step">2. Choose <strong>Add to Home Screen</strong>.</div><div class="install-step">3. Tap <strong>Add</strong>.</div>`;
  openOverlay("install-overlay");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js?v=1.0.48", { scope: "./", updateViaCache: "none" });
      await registration.update();
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") registration.update(); });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!sessionStorage.getItem(`mealPlannerReloaded-${APP_VERSION}`)) {
          sessionStorage.setItem(`mealPlannerReloaded-${APP_VERSION}`, "1");
          window.location.reload();
        }
      });
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

function init() {
  const unitList = document.createElement("datalist");
  unitList.id = "unit-list";
  unitList.innerHTML = UNITS.map(unit => `<option value="${escapeHtml(unit)}"></option>`).join("");
  document.body.appendChild(unitList);
  populateCategorySelect($("#shop-item-category"));
  bindEvents();
  loadRecipeLibrary().catch(() => {});
  renderAll();
  renderCloudStatus();
  setupInstall();
  switchTab(data.settings.lastTab || "week");
  registerServiceWorker();
}

init();
