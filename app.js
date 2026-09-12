"use strict";

const APP_VERSION = "1.0.4";
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
    meals: Array(7).fill(null),
    lunches: Array(7).fill(null),
    regularItemIds: [],
    extras: [],
    checkedItemIds: [],
    notNeededItemIds: [],
    createdAt: now,
    updatedAt: now
  };
}

function normaliseWeek(week, key) {
  const clean = week && typeof week === "object" ? week : {};
  clean.startDate = clean.startDate || clean.monday || key;
  clean.meals = Array.isArray(clean.meals) ? [...clean.meals, ...Array(7).fill(null)].slice(0, 7) : Array(7).fill(null);
  clean.lunches = Array.isArray(clean.lunches) ? [...clean.lunches, ...Array(7).fill(null)].slice(0, 7) : Array(7).fill(null);
  clean.regularItemIds = Array.isArray(clean.regularItemIds) ? clean.regularItemIds : [];
  clean.extras = Array.isArray(clean.extras) ? clean.extras : [];
  clean.checkedItemIds = Array.isArray(clean.checkedItemIds) ? clean.checkedItemIds : [];
  clean.notNeededItemIds = Array.isArray(clean.notNeededItemIds) ? clean.notNeededItemIds : [];
  clean.createdAt = clean.createdAt || new Date().toISOString();
  clean.updatedAt = clean.updatedAt || clean.createdAt;
  delete clean.monday;
  return clean;
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

    ["meals", "lunches"].forEach(slotName => {
      week[slotName].forEach((mealId, index) => {
        if (mealId === null || mealId === undefined) return;
        const date = addDays(sourceStart, index);
        const targetStart = startOfWeek(date, newStartDay);
        const target = ensureTarget(targetStart);
        const targetIndex = dateDistance(targetStart, date);
        if (targetIndex >= 0 && targetIndex < 7) target[slotName][targetIndex] = mealId;
      });
    });

    const shoppingStart = startOfWeek(sourceStart, newStartDay);
    const shoppingTarget = ensureTarget(shoppingStart);
    shoppingTarget.regularItemIds = Array.from(new Set([...shoppingTarget.regularItemIds, ...week.regularItemIds]));
    shoppingTarget.checkedItemIds = Array.from(new Set([...shoppingTarget.checkedItemIds, ...week.checkedItemIds]));
    shoppingTarget.notNeededItemIds = Array.from(new Set([...shoppingTarget.notNeededItemIds, ...week.notNeededItemIds]));
    const existingExtraIds = new Set(shoppingTarget.extras.map(extra => extra.id));
    week.extras.forEach(extra => {
      if (!existingExtraIds.has(extra.id)) {
        shoppingTarget.extras.push(extra);
        existingExtraIds.add(extra.id);
      }
    });
    shoppingTarget.updatedAt = week.updatedAt || shoppingTarget.updatedAt;
  });

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

  const seeded = {
    schemaVersion: 3,
    appVersion: APP_VERSION,
    bundledContentVersion: 0,
    items,
    meals,
    weeks: {},
    settings: { hideChecked: false, lastTab: "week", weekStartDay: DEFAULT_WEEK_START_DAY }
  };
  return applyBundledContent(seeded);
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items) || !Array.isArray(parsed.meals)) return seedData();

    const oldSchema = Number(parsed.schemaVersion) || 1;
    const hadWeekStartSetting = Number.isInteger(Number(parsed.settings?.weekStartDay));
    const oldStartDay = hadWeekStartSetting ? Number(parsed.settings.weekStartDay) : 1;
    const weekStartDay = hadWeekStartSetting ? Number(parsed.settings.weekStartDay) : DEFAULT_WEEK_START_DAY;

    parsed.weeks = parsed.weeks && typeof parsed.weeks === "object" ? parsed.weeks : {};
    if (oldSchema < 2 || !hadWeekStartSetting) {
      parsed.weeks = rebaseWeekMap(parsed.weeks, oldStartDay, weekStartDay);
    } else {
      Object.entries(parsed.weeks).forEach(([key, week]) => { parsed.weeks[key] = normaliseWeek(week, key); });
    }

    parsed.schemaVersion = 3;
    parsed.appVersion = APP_VERSION;
    parsed.settings = { hideChecked: false, lastTab: "week", weekStartDay: DEFAULT_WEEK_START_DAY, ...(parsed.settings || {}), weekStartDay };
    return applyBundledContent(parsed);
  } catch (_) {
    return seedData();
  }
}

let data = loadData();
let selectedWeekStart = startOfWeek(new Date(), data.settings.weekStartDay);
let pickerDayIndex = null;
let pickerSlotType = "dinner";
let toastTimer = null;
let deferredInstallPrompt = null;

function saveData() {
  data.appVersion = APP_VERSION;
  data.schemaVersion = 3;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

function findMeal(id) { return data.meals.find(meal => meal.id === id) || null; }
function findItem(id) { return data.items.find(item => item.id === id) || null; }
function findItemByName(name) { const key = keyName(name); return data.items.find(item => keyName(item.name) === key) || null; }

function ensureItem(name, category = "Other", regular = false) {
  const clean = normaliseName(name);
  if (!clean) return null;
  let item = findItemByName(clean);
  if (!item) {
    item = { id: uid("item"), name: clean, category: CATEGORIES.includes(category) ? category : "Other", regular: !!regular, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    data.items.push(item);
  } else {
    if (category && CATEGORIES.includes(category)) item.category = category;
    if (regular) item.regular = true;
    item.updatedAt = new Date().toISOString();
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
  const names = [...data.items].sort((a, b) => a.name.localeCompare(b.name));
  const options = names.map(item => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  $("#known-items").innerHTML = options;
  $("#ingredient-known-items").innerHTML = options;
}

function renderWeek() {
  const week = getWeek();
  const todayKey = localDateKey(new Date());
  $("#week-range").textContent = formatWeekRange(selectedWeekStart);
  $("#week-list").innerHTML = week.meals.map((mealId, index) => {
    const date = addDays(selectedWeekStart, index);
    const noDinner = mealId === NO_MEAL;
    const dinner = noDinner ? null : findMeal(mealId);
    const lunchId = week.lunches[index];
    const lunch = lunchId ? findMeal(lunchId) : null;
    const dinnerName = dinner ? dinner.name : noDinner ? "No meal / eating out" : "Choose meal";
    const dinnerClass = dinner || noDinner ? "" : "empty";
    const lunchMarkup = lunch
      ? `<button class="meal-slot lunch" type="button" data-day-index="${index}" data-meal-slot="lunch"><span class="slot-label">Lunch</span><strong>${escapeHtml(lunch.name)}</strong><span class="slot-arrow" aria-hidden="true">›</span></button>`
      : `<button class="add-lunch-button" type="button" data-day-index="${index}" data-meal-slot="lunch">＋ Lunch</button>`;

    return `<article class="day-card ${localDateKey(date) === todayKey ? "today" : ""}">
      <div class="day-meta"><strong>${escapeHtml(formatDay(date))}</strong><span>${escapeHtml(formatDateShort(date))}</span></div>
      <div class="day-slots">
        <button class="meal-slot dinner ${dinnerClass}" type="button" data-day-index="${index}" data-meal-slot="dinner"><span class="slot-label">Dinner</span><strong>${escapeHtml(dinnerName)}</strong><span class="slot-arrow" aria-hidden="true">›</span></button>
        ${lunchMarkup}
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
  const meals = [...data.meals]
    .filter(meal => !query || keyName(meal.name).includes(query))
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
  const recent = [...data.meals].filter(meal => meal.lastUsedAt).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt))).slice(0, 4);
  const recentIds = new Set(recent.map(meal => meal.id));
  const all = [...data.meals].sort((a, b) => a.name.localeCompare(b.name));
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

function openMealPicker(dayIndex, slotType = "dinner") {
  pickerDayIndex = Number(dayIndex);
  pickerSlotType = slotType === "lunch" ? "lunch" : "dinner";
  const date = addDays(selectedWeekStart, pickerDayIndex);
  const slotLabel = pickerSlotType === "lunch" ? "Lunch" : "Dinner";
  $("#meal-picker-title").textContent = `${formatDayLong(date)} ${slotLabel.toLowerCase()} · ${formatDateShort(date)}`;
  $("#clear-day").textContent = pickerSlotType === "lunch" ? "Remove lunch" : "Clear dinner";
  $("#no-dinner").hidden = pickerSlotType === "lunch";
  $("#picker-search").value = "";
  renderPicker();
  openOverlay("meal-picker-overlay");
}

function chooseMealForDay(mealId) {
  const week = getWeek();
  if (pickerSlotType === "lunch") {
    week.lunches[pickerDayIndex] = mealId === NO_MEAL ? null : (mealId || null);
  } else {
    week.meals[pickerDayIndex] = mealId === NO_MEAL ? NO_MEAL : (mealId || null);
  }
  week.updatedAt = new Date().toISOString();
  const meal = mealId === NO_MEAL ? null : findMeal(mealId);
  if (meal) meal.lastUsedAt = new Date().toISOString();
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
    meal.updatedAt = now;
  } else {
    data.meals.push({ id: uid("meal"), name, ingredients, createdAt: now, updatedAt: now, lastUsedAt: null });
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
  data.meals = data.meals.filter(entry => entry.id !== id);
  Object.values(data.weeks).forEach(week => {
    if (Array.isArray(week.meals)) week.meals = week.meals.map(mealId => mealId === id ? null : mealId);
    if (Array.isArray(week.lunches)) week.lunches = week.lunches.map(mealId => mealId === id ? null : mealId);
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

  week.meals.forEach(mealId => {
    const meal = findMeal(mealId);
    meal?.ingredients.forEach(ing => push({ ...ing, source: meal.name }));
  });
  week.lunches.forEach(mealId => {
    const meal = findMeal(mealId);
    meal?.ingredients.forEach(ing => push({ ...ing, source: meal.name }));
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
  week.updatedAt = new Date().toISOString();
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
    week.updatedAt = new Date().toISOString();
    saveData();
    renderShop();
    showToast("Back on the list");
    return;
  }
  const set = new Set(week.checkedItemIds);
  if (set.has(itemId)) set.delete(itemId); else set.add(itemId);
  week.checkedItemIds = Array.from(set);
  week.updatedAt = new Date().toISOString();
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
  week.updatedAt = new Date().toISOString();
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
  week.updatedAt = new Date().toISOString();
  saveData();
  closeOverlay("shop-item-overlay");
  renderAll();
  showToast("Added to shopping list");
}

function renderRegularPicker() {
  const week = getWeek();
  const selected = new Set(week.regularItemIds);
  const regulars = data.items.filter(item => item.regular).sort((a, b) => a.name.localeCompare(b.name));
  $("#regular-picker-list").innerHTML = regulars.length ? regulars.map(item => `<button class="regular-chip ${selected.has(item.id) ? "selected" : ""}" type="button" data-regular-pick="${item.id}"><span>${escapeHtml(item.name)}</span><span class="chip-mark">${selected.has(item.id) ? "✓" : "+"}</span></button>`).join("") : `<div class="empty-state"><strong>No regulars yet</strong><p>Add some from Manage regulars.</p></div>`;
}

function toggleRegularForWeek(itemId) {
  const week = getWeek();
  const set = new Set(week.regularItemIds);
  if (set.has(itemId)) set.delete(itemId); else set.add(itemId);
  week.regularItemIds = Array.from(set);
  week.checkedItemIds = week.checkedItemIds.filter(id => id !== itemId);
  week.notNeededItemIds = week.notNeededItemIds.filter(id => id !== itemId);
  week.updatedAt = new Date().toISOString();
  saveData();
  renderRegularPicker();
  renderShop();
}

function renderRegularManager() {
  const items = [...data.items].sort((a, b) => Number(b.regular) - Number(a.regular) || a.name.localeCompare(b.name));
  $("#regular-manager-list").innerHTML = items.map(item => `<div class="regular-manager-row"><span>${escapeHtml(item.name)}</span><button class="switch ${item.regular ? "on" : ""}" type="button" data-toggle-regular="${item.id}" aria-label="${item.regular ? "Remove" : "Add"} ${escapeHtml(item.name)} ${item.regular ? "from" : "to"} regulars" aria-pressed="${item.regular}"></button></div>`).join("");
}

function toggleItemRegular(itemId) {
  const item = findItem(itemId);
  if (!item) return;
  item.regular = !item.regular;
  item.updatedAt = new Date().toISOString();
  if (!item.regular) {
    Object.values(data.weeks).forEach(week => {
      if (Array.isArray(week.regularItemIds)) week.regularItemIds = week.regularItemIds.filter(id => id !== item.id);
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

function openWeekSettings() {
  $("#week-start-day").value = String(data.settings.weekStartDay);
  openOverlay("settings-overlay");
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
}

function changeWeek(offset) {
  selectedWeekStart = addDays(selectedWeekStart, offset * 7);
  renderWeek();
  renderShop();
}

function bindEvents() {
  document.addEventListener("click", event => {
    const slot = event.target.closest("[data-day-index][data-meal-slot]");
    if (slot) return openMealPicker(slot.dataset.dayIndex, slot.dataset.mealSlot);
    const pick = event.target.closest("[data-pick-meal]");
    if (pick) return chooseMealForDay(pick.dataset.pickMeal);
    const edit = event.target.closest("[data-edit-meal]");
    if (edit) return openMealEditor(edit.dataset.editMeal);
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
  $("#week-settings").addEventListener("click", openWeekSettings);
  $("#settings-form").addEventListener("submit", saveWeekSettings);
  $("#today-week").addEventListener("click", () => { selectedWeekStart = startOfWeek(new Date(), data.settings.weekStartDay); renderWeek(); renderShop(); });
  $("#week-to-shop").addEventListener("click", () => switchTab("shop"));
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

  $("#add-shop-item").addEventListener("click", openShopItemEditor);
  $("#shop-item-name").addEventListener("change", syncShopCategoryFromKnownName);
  $("#shop-item-form").addEventListener("submit", addShopItem);
  $("#toggle-checked").addEventListener("click", () => { data.settings.hideChecked = !data.settings.hideChecked; saveData(); renderShop(); });
  $("#add-regulars").addEventListener("click", () => { renderRegularPicker(); openOverlay("regular-picker-overlay"); });
  $("#regular-picker-done").addEventListener("click", () => closeOverlay("regular-picker-overlay"));
  $("#manage-regulars").addEventListener("click", () => { renderRegularManager(); openOverlay("regular-manager-overlay"); });
  $("#regular-add-form").addEventListener("submit", addRegularItem);

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
  setupInstall();
  switchTab(data.settings.lastTab || "week");
  registerServiceWorker();
}

init();
