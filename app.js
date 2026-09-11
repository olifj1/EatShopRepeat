"use strict";

const APP_VERSION = "1.0.18";
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
const DEFAULT_WEEK_START_DAY = 5; // Friday
const BUNDLED_CONTENT_VERSION = 1;
const SCHEMA_VERSION = 6;
const MEMBER_COLORS = ["sage", "terracotta", "blue", "gold", "rose", "plum"];

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const normaliseName = value => String(value || "").trim().replace(/\s+/g, " ");
const keyName = value => normaliseName(value).toLocaleLowerCase();
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

function makeAssignment(mealId, memberIds = null, updatedAt = new Date().toISOString(), id = null, updatedBy = null) {
  return {
    id: id || uid("assign"),
    mealId,
    memberIds: Array.isArray(memberIds) ? Array.from(new Set(memberIds.filter(Boolean))) : null,
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
      item = { id: preferredId, name, category, regular: false, createdAt: now, updatedAt: now };
      target.items.push(item);
    }
    itemIds[preferredId] = item.id;
  });

  if (!target.meals.some(meal => meal.id === "meal_sweet_potato_soup")) {
    target.meals.push({
      id: "meal_sweet_potato_soup",
      name: "Sweet potato soup",
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
    settings: { hideChecked: false, lastTab: "week", weekStartDay: DEFAULT_WEEK_START_DAY, currentMemberId: null }
  };
  return applyBundledContent(seeded);
}

function createEmptyHousehold() {
  const now = new Date().toISOString();
  return {
    id: uid("household"),
    name: "Our household",
    weekStartDay: DEFAULT_WEEK_START_DAY,
    members: [],
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

  clean.items = clean.items.map(item => ({
    ...item,
    createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    updatedBy: item.updatedBy || null,
    deletedAt: item.deletedAt || null
  }));
  clean.meals = clean.meals.map(meal => ({
    ...meal,
    createdAt: meal.createdAt || meal.updatedAt || new Date().toISOString(),
    updatedAt: meal.updatedAt || meal.createdAt || new Date().toISOString(),
    updatedBy: meal.updatedBy || null,
    deletedAt: meal.deletedAt || null
  }));

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
let pendingSplitMemberIds = [];
let toastTimer = null;
let deferredInstallPrompt = null;

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
  if (!options.skipCloud) window.dispatchEvent(new CustomEvent("mealplanner:localchange"));
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

function ensureItem(name, category = "Other", regular = false) {
  const clean = normaliseName(name);
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

function audienceControlMarkup(memberIds, slotType, dayIndex) {
  const info = audienceInfo(memberIds);
  const all = memberIds === null || info.label === "Everyone";
  const content = all
    ? `<span class="audience-control-label">All</span>`
    : `<span class="audience-avatars">${info.members.slice(0, 4).map(member => memberAvatar(member, true)).join("")}</span>`;
  return `<button class="audience-control" type="button" data-split-slot="${slotType}" data-day-index="${dayIndex}" aria-label="Choose who has this ${slotType}" title="${escapeHtml(info.label)}">${content}<svg class="audience-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.5 6 6l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
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
    const meal = noMeal ? null : findMeal(assignment.mealId);
    const name = meal ? meal.name : noMeal ? "No meal / eating out" : "Choose meal";
    const canSplit = !noMeal && activeMembers().length > 1;
    return `<div class="meal-period single ${slotType} ${canSplit ? "has-audience-control" : ""}">
      <button class="meal-slot ${slotType} ${meal || noMeal ? "" : "empty"}" type="button" data-day-index="${dayIndex}" data-meal-slot="${slotType}" data-assignment-id="${escapeHtml(assignment.id)}">
        <span class="meal-slot-copy"><span class="slot-label">${label}</span><strong>${escapeHtml(name)}</strong></span><span class="slot-arrow" aria-hidden="true">›</span>
      </button>
      ${canSplit ? audienceControlMarkup(assignment.memberIds, slotType, dayIndex) : ""}
    </div>`;
  }

  const rows = assignments.map(assignment => {
    const meal = findMeal(assignment.mealId);
    if (!meal) return "";
    return `<button class="split-assignment-row" type="button" data-day-index="${dayIndex}" data-meal-slot="${slotType}" data-assignment-id="${escapeHtml(assignment.id)}">
      <strong>${escapeHtml(meal.name)}</strong>${audienceAvatarsMarkup(assignment.memberIds)}<span class="slot-arrow" aria-hidden="true">›</span>
    </button>`;
  }).join("");
  return `<div class="meal-period split ${slotType}">
    <div class="split-period-heading"><span>${label}</span><button type="button" data-split-slot="${slotType}" data-day-index="${dayIndex}">＋ Different</button></div>
    ${rows}
  </div>`;
}

function renderWeek() {
  const week = getWeek();
  const todayKey = localDateKey(new Date());
  $("#week-range").textContent = formatWeekRange(selectedWeekStart);
  $("#week-list").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    const dinner = getSlotAssignments(week, "dinner", index);
    const lunch = getSlotAssignments(week, "lunch", index);
    return `<article class="day-card ${localDateKey(date) === todayKey ? "today" : ""}">
      <div class="day-meta"><strong>${escapeHtml(formatDay(date))}</strong><span>${escapeHtml(formatDateShort(date))}</span></div>
      <div class="day-slots">
        ${mealPeriodMarkup("dinner", index, dinner)}
        ${mealPeriodMarkup("lunch", index, lunch)}
      </div>
    </article>`;
  }).join("");
}

function mealUsageText(meal) {
  if (!meal.lastUsedAt) return `${meal.ingredients.length} item${meal.ingredients.length === 1 ? "" : "s"}`;
  const date = new Date(meal.lastUsedAt);
  return `Last used ${formatDateShort(date)} · ${meal.ingredients.length} item${meal.ingredients.length === 1 ? "" : "s"}`;
}

function renderMeals() {
  const query = keyName($("#meal-search").value);
  const meals = data.meals
    .filter(meal => !meal.deletedAt && (!query || keyName(meal.name).includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name));
  $("#meal-list").innerHTML = meals.length ? meals.map(meal => {
    const names = meal.ingredients.slice(0, 4).map(ing => findItem(ing.itemId)?.name).filter(Boolean).join(", ");
    return `<article class="meal-card">
      <div class="meal-card-main"><h3>${escapeHtml(meal.name)}</h3><p>${escapeHtml(names || "No shopping items yet")}${meal.ingredients.length > 4 ? "…" : ""}</p></div>
      <button type="button" data-edit-meal="${meal.id}" aria-label="Edit ${escapeHtml(meal.name)}">•••</button>
    </article>`;
  }).join("") : `<div class="empty-state"><strong>No meals found</strong><p>Try another search or add a new meal.</p></div>`;
}

function renderPicker() {
  const query = keyName($("#picker-search").value);
  const recent = data.meals.filter(meal => !meal.deletedAt && meal.lastUsedAt).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt))).slice(0, 4);
  const recentIds = new Set(recent.map(meal => meal.id));
  const all = data.meals.filter(meal => !meal.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const matches = meal => !query || keyName(meal.name).includes(query);
  let html = "";
  if (!query && recent.length) {
    html += `<div class="picker-section-title">Recent</div>`;
    html += recent.map(meal => pickerRow(meal)).join("");
    html += `<div class="picker-section-title">All meals</div>`;
    html += all.filter(meal => !recentIds.has(meal.id)).map(meal => pickerRow(meal)).join("");
  } else {
    const filtered = all.filter(matches);
    html = filtered.length ? filtered.map(meal => pickerRow(meal)).join("") : `<div class="empty-state"><strong>No meals found</strong><p>Add it from the Meals tab first.</p></div>`;
  }
  $("#picker-list").innerHTML = html;
}

function pickerRow(meal) {
  return `<button class="picker-row" type="button" data-pick-meal="${meal.id}"><strong>${escapeHtml(meal.name)}</strong><span>${meal.ingredients.length} item${meal.ingredients.length === 1 ? "" : "s"}</span></button>`;
}

function openMealPicker(dayIndex, slotType = "dinner", assignmentId = null, mode = "replace") {
  pickerDayIndex = Number(dayIndex);
  pickerSlotType = slotType === "lunch" ? "lunch" : "dinner";
  pickerAssignmentId = assignmentId || null;
  pickerMode = mode;
  const date = addDays(selectedWeekStart, pickerDayIndex);
  const slotLabel = pickerSlotType === "lunch" ? "Lunch" : "Dinner";
  const suffix = pickerMode === "split-new" && pendingSplitMemberIds.length ? ` for ${audienceInfo(pendingSplitMemberIds).label}` : "";
  $("#meal-picker-title").textContent = `${formatDayLong(date)} ${slotLabel.toLowerCase()}${suffix} · ${formatDateShort(date)}`;
  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const splitAssignmentIndex = pickerAssignmentId ? assignments.findIndex(assignment => assignment.id === pickerAssignmentId) : -1;
  const editingSplitAssignment = splitAssignmentIndex >= 0 && assignments.length > 1;
  const canRejoinOriginal = editingSplitAssignment && splitAssignmentIndex > 0;
  $("#rejoin-original").hidden = !canRejoinOriginal;
  $("#clear-day").hidden = canRejoinOriginal;
  $("#clear-day").textContent = editingSplitAssignment ? "Remove this meal" : (pickerSlotType === "lunch" ? "Remove lunch" : "Clear dinner");
  $("#no-dinner").hidden = pickerSlotType === "lunch" || editingSplitAssignment || pickerMode === "split-new";
  $("#picker-search").value = "";
  renderPicker();
  openOverlay("meal-picker-overlay");
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
  if (clean.length === 1 && members.length) {
    const ids = clean[0].memberIds;
    if (ids === null || (ids.length === members.length && members.every(member => ids.includes(member.id)))) clean[0].memberIds = null;
  }
  return clean;
}

function chooseMealForDay(mealId) {
  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const now = new Date().toISOString();

  if (pickerMode === "split-new") {
    if (!mealId || mealId === NO_MEAL || !pendingSplitMemberIds.length) return;
    const selected = new Set(pendingSplitMemberIds);
    const allIds = activeMembers().map(member => member.id);
    let next = assignments.map(assignment => {
      const explicitIds = assignment.memberIds === null ? allIds : assignment.memberIds;
      return { ...assignment, memberIds: explicitIds.filter(id => !selected.has(id)), updatedAt: now, updatedBy: currentMemberId() };
    }).filter(assignment => assignment.memberIds.length);
    next.push(makeAssignment(mealId, pendingSplitMemberIds, now, null, currentMemberId()));
    week.slots[pickerSlotType][pickerDayIndex] = normaliseSplitSlot(next);
    pendingSplitMemberIds = [];
  } else if (pickerAssignmentId) {
    const index = assignments.findIndex(assignment => assignment.id === pickerAssignmentId);
    if (index >= 0) {
      if (!mealId) {
        if (assignments.length > 1) {
          const keep = assignments.filter((_, assignmentIndex) => assignmentIndex !== index);
          if (keep.length === 1) keep[0].memberIds = null;
          week.slots[pickerSlotType][pickerDayIndex] = keep;
        } else {
          week.slots[pickerSlotType][pickerDayIndex] = [];
        }
      } else {
        assignments[index].mealId = mealId;
        assignments[index].updatedAt = now;
        assignments[index].updatedBy = currentMemberId();
      }
    }
  } else if (!mealId) {
    week.slots[pickerSlotType][pickerDayIndex] = [];
  } else {
    week.slots[pickerSlotType][pickerDayIndex] = [makeAssignment(mealId, null, now, null, currentMemberId())];
  }

  touchWeekField(week, pickerSlotType, pickerDayIndex, now);
  const meal = mealId === NO_MEAL ? null : findMeal(mealId);
  if (meal) {
    meal.lastUsedAt = now;
    touchRecord(meal, now);
  }
  syncLegacyWeekSlots(week);
  saveData();
  closeOverlay("meal-picker-overlay");
  renderAll();
}

function ingredientRow(ingredient = {}) {
  const item = findItem(ingredient.itemId);
  const selectedCategory = item?.category || ingredient.category || "Other";
  return `<div class="ingredient-row" data-ingredient-row>
    <div class="ingredient-row-main">
      <input class="text-input ingredient-name" list="ingredient-known-items" type="text" placeholder="Item" value="${escapeHtml(item?.name || ingredient.name || "")}" autocomplete="off" aria-label="Ingredient name">
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

function openMealEditor(mealId = null) {
  const meal = mealId ? findMeal(mealId) : null;
  $("#meal-editor-title").textContent = meal ? "Edit meal" : "New meal";
  $("#meal-id").value = meal?.id || "";
  $("#meal-name").value = meal?.name || "";
  $("#ingredient-list").innerHTML = "";
  (meal?.ingredients?.length ? meal.ingredients : [{}, {}, {}]).forEach(addIngredientRow);
  $("#delete-meal").hidden = !meal;
  renderKnownItems();
  openOverlay("meal-editor-overlay");
}

function saveMealFromForm(event) {
  event.preventDefault();
  const name = normaliseName($("#meal-name").value);
  if (!name) return;
  const ingredients = [];
  $$("#ingredient-list [data-ingredient-row]").forEach(row => {
    const itemName = normaliseName(row.querySelector(".ingredient-name").value);
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
    touchRecord(meal, now);
  } else {
    data.meals.push({ id: uid("meal"), name, ingredients, createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null, lastUsedAt: null });
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
        const next = assignments.filter(assignment => assignment.mealId !== id);
        if (next.length !== assignments.length) touchWeekField(week, slotType, dayIndex, now);
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
      const mealIds = new Set(assignments.map(assignment => assignment.mealId).filter(id => id && id !== NO_MEAL));
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
  if (!member || !confirm(`Remove ${member.name} from this household? Existing split meal plans will be adjusted.`)) return;
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

function openSplitMembers(dayIndex, slotType) {
  const members = activeMembers();
  if (members.length < 2) {
    showToast("Add at least two people to split a meal");
    return;
  }
  const week = getWeek();
  const assignments = getSlotAssignments(week, slotType, Number(dayIndex));
  if (!assignments.length || assignments.every(assignment => assignment.mealId === NO_MEAL)) return;
  splitDayIndex = Number(dayIndex);
  splitSlotType = slotType === "lunch" ? "lunch" : "dinner";
  pendingSplitMemberIds = [];
  const date = addDays(selectedWeekStart, splitDayIndex);
  $("#split-members-title").textContent = `Split ${splitSlotType} · ${formatDayLong(date)}`;
  $("#split-member-list").innerHTML = members.map(member => `<button type="button" class="split-member-choice" data-split-member="${escapeHtml(member.id)}">${memberAvatar(member)}<span><strong>${escapeHtml(member.name)}</strong><small>${member.role === "child" ? "Child" : "Adult"}</small></span><span class="member-check">✓</span></button>`).join("");
  updateSplitMemberButton();
  openOverlay("split-members-overlay");
}

function toggleSplitMember(memberId) {
  const set = new Set(pendingSplitMemberIds);
  if (set.has(memberId)) set.delete(memberId); else set.add(memberId);
  pendingSplitMemberIds = Array.from(set);
  $$("[data-split-member]").forEach(button => button.classList.toggle("selected", set.has(button.dataset.splitMember)));
  updateSplitMemberButton();
}

function updateSplitMemberButton() {
  const button = $("#split-members-next");
  const total = activeMembers().length;
  const count = pendingSplitMemberIds.length;
  button.disabled = count < 1 || count >= total;
  button.textContent = count ? `Choose meal for ${audienceInfo(pendingSplitMemberIds).label}` : "Choose who is eating differently";
}

function continueSplitMeal() {
  if (!pendingSplitMemberIds.length || pendingSplitMemberIds.length >= activeMembers().length) return;
  closeOverlay("split-members-overlay");
  openMealPicker(splitDayIndex, splitSlotType, null, "split-new");
}

function rejoinOriginalMeal() {
  const week = getWeek();
  const assignments = getSlotAssignments(week, pickerSlotType, pickerDayIndex);
  const index = assignments.findIndex(assignment => assignment.id === pickerAssignmentId);
  if (index <= 0 || assignments.length < 2) return;

  const now = new Date().toISOString();
  const returning = assignments[index];
  const original = assignments[0];
  const allIds = activeMembers().map(member => member.id);
  const originalIds = original.memberIds === null ? allIds : original.memberIds;
  const returningIds = returning.memberIds === null ? allIds : returning.memberIds;
  original.memberIds = Array.from(new Set([...originalIds, ...returningIds]));
  original.updatedAt = now;
  original.updatedBy = currentMemberId();

  const next = normaliseSplitSlot(assignments.filter((_, assignmentIndex) => assignmentIndex !== index));
  week.slots[pickerSlotType][pickerDayIndex] = next;
  touchWeekField(week, pickerSlotType, pickerDayIndex, now);
  syncLegacyWeekSlots(week);
  saveData();
  closeOverlay("meal-picker-overlay");
  renderAll();
  showToast("Rejoined original meal");
}


let cloudUiState = { phase: "loading", email: "", householdName: "", detail: "Loading cloud sync…", foundHouseholdId: null };

function sharedDataSignature() {
  return JSON.stringify({
    household: data.household,
    items: data.items,
    meals: data.meals,
    weeks: data.weeks,
    savedWeeks: data.savedWeeks || []
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
    savedWeeks: clone(data.savedWeeks || [])
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
    settings: { ...data.settings, currentMemberId: null, weekStartDay: payload.household.weekStartDay }
  });
  data.household = prepared.household;
  data.items = prepared.items;
  data.meals = prepared.meals;
  data.weeks = prepared.weeks;
  data.savedWeeks = prepared.savedWeeks;
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
    data.household.updatedAt = incoming.updatedAt;
    data.household.updatedBy = incoming.updatedBy || null;
  }
  data.household.members = mergeRecordArray(data.household.members, incoming.members || []);
  if (String(incoming.dataUpdatedAt || "") > String(data.household.dataUpdatedAt || "")) {
    data.household.dataUpdatedAt = incoming.dataUpdatedAt;
    data.household.dataUpdatedBy = incoming.dataUpdatedBy || null;
  }
  data.items = mergeRecordArray(data.items, payload.items || []);
  data.meals = mergeRecordArray(data.meals, payload.meals || []);
  data.savedWeeks = mergeRecordArray(data.savedWeeks || [], (payload.savedWeeks || []).map(normaliseSavedWeek).filter(Boolean));
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
    if (assignment.mealId && assignment.mealId !== NO_MEAL) usedMealIds.add(assignment.mealId);
  })));
  const meals = data.meals
    .filter(meal => !meal.deletedAt && usedMealIds.has(meal.id))
    .map(meal => ({ id: meal.id, name: meal.name, ingredients: clone(meal.ingredients || []), sourceUrl: meal.sourceUrl || null }));
  const usedItemIds = new Set();
  meals.forEach(meal => meal.ingredients.forEach(ingredient => usedItemIds.add(ingredient.itemId)));
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
    version: 2,
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
  const mealCount = payload.days.reduce((sum, day) => sum + day.dinnerAssignments.filter(assignment => assignment.mealId !== NO_MEAL).length, 0);
  const lunchCount = payload.days.reduce((sum, day) => sum + day.lunchAssignments.length, 0);
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
    if (payload?.format !== "MealPlannerWeek" || ![1,2].includes(payload.version) || !Array.isArray(payload.days) || !Array.isArray(payload.meals) || !Array.isArray(payload.items)) {
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
      if (!meal) {
        meal = { id: uid("meal"), name, ingredients, createdAt: now, updatedAt: now, updatedBy: currentMemberId(), deletedAt: null, lastUsedAt: null };
        data.meals.push(meal);
      } else {
        meal.ingredients = ingredients;
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
        const mappedMealId = assignment.mealId === NO_MEAL ? NO_MEAL : mealMap.get(assignment.mealId);
        if (!mappedMealId) return null;
        let memberIds = null;
        if (Array.isArray(assignment.memberIds) && memberMap.size) memberIds = assignment.memberIds.map(id => memberMap.get(id)).filter(Boolean);
        return makeAssignment(mappedMealId, memberIds);
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
    saveData();
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
    currentMemberId()
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
  saveData();
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
  saveData();
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
  saveData();
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
  saveData();
  renderSavedWeeks();
  showToast("Saved week deleted");
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
  saveData();
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
  saveData();
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
    saveData();
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
    const splitButton = event.target.closest("[data-split-slot]");
    if (splitButton) return openSplitMembers(splitButton.dataset.dayIndex, splitButton.dataset.splitSlot);
    const slot = event.target.closest("[data-day-index][data-meal-slot]");
    if (slot) return openMealPicker(slot.dataset.dayIndex, slot.dataset.mealSlot, slot.dataset.assignmentId || null);
    const splitMember = event.target.closest("[data-split-member]");
    if (splitMember) return toggleSplitMember(splitMember.dataset.splitMember);
    const pick = event.target.closest("[data-pick-meal]");
    if (pick) return chooseMealForDay(pick.dataset.pickMeal);
    const edit = event.target.closest("[data-edit-meal]");
    if (edit) return openMealEditor(edit.dataset.editMeal);
    const editMember = event.target.closest("[data-edit-member]");
    if (editMember) return openMemberEditor(editMember.dataset.editMember);
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
  $("#add-meal").addEventListener("click", () => openMealEditor());
  $("#add-ingredient").addEventListener("click", () => addIngredientRow({}));
  $("#ingredient-list").addEventListener("click", event => { const remove = event.target.closest(".remove-ingredient"); if (remove) remove.closest("[data-ingredient-row]").remove(); });
  $("#ingredient-list").addEventListener("change", event => {
    if (!event.target.classList.contains("ingredient-name")) return;
    const item = findItemByName(event.target.value);
    if (item) event.target.closest("[data-ingredient-row]").querySelector(".ingredient-category").value = item.category;
  });
  $("#meal-form").addEventListener("submit", saveMealFromForm);
  $("#delete-meal").addEventListener("click", deleteCurrentMeal);

  $("#split-members-next").addEventListener("click", continueSplitMeal);
  $("#rejoin-original").addEventListener("click", rejoinOriginalMeal);

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
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
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
  renderAll();
  renderCloudStatus();
  setupInstall();
  switchTab(data.settings.lastTab || "week");
  registerServiceWorker();
}

init();
