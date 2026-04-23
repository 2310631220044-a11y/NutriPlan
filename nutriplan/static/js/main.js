// TAG: DATA-SOURCE
const mealsDatabase = normalizeMealsData(
  parseJsonDataByAliases(["meals-data", "meals", "data/meals"], []),
);
const ingredientPrice = normalizePriceData(
  parseJsonDataByAliases(
    ["prices-data", "ingredient-prices", "data/ingredient-prices"],
    {},
  ),
);

// TAG: SLOT-LABELS
const mealSlots = ["breakfast", "main", "main", "snack"];
const slotLabel = {
  breakfast: "Sarapan",
  main: "Makan Utama",
  snack: "Snack",
};

// TAG: AKG-GOAL-PROFILE
const goalProfiles = {
  balanced: {
    macroRatio: { protein: 0.18, fat: 0.27, carb: 0.55 },
    kcalAdjustment: 0,
    scoreWeight: {
      kcal: 0.32,
      protein: 0.25,
      fat: 0.13,
      carb: 0.12,
      cost: 0.1,
      plant: 0.08,
    },
  },
  highProtein: {
    macroRatio: { protein: 0.25, fat: 0.25, carb: 0.5 },
    kcalAdjustment: 80,
    scoreWeight: {
      kcal: 0.22,
      protein: 0.42,
      fat: 0.08,
      carb: 0.08,
      cost: 0.08,
      plant: 0.12,
    },
  },
  budget: {
    macroRatio: { protein: 0.18, fat: 0.25, carb: 0.57 },
    kcalAdjustment: -60,
    scoreWeight: {
      kcal: 0.2,
      protein: 0.16,
      fat: 0.08,
      carb: 0.08,
      cost: 0.42,
      plant: 0.06,
    },
  },
  plantForward: {
    macroRatio: { protein: 0.2, fat: 0.25, carb: 0.55 },
    kcalAdjustment: 0,
    scoreWeight: {
      kcal: 0.2,
      protein: 0.22,
      fat: 0.08,
      carb: 0.1,
      cost: 0.1,
      plant: 0.3,
    },
  },
};

const form = document.getElementById("planner-form");
const outputs = document.getElementById("outputs");
const pdfButton = document.getElementById("pdf-btn");
let lastRecommendation = null;
let lastFormData = null;

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = getFormData();
  const recommendation = generatePlan(formData);

  renderMealPlan(recommendation, formData);
  renderShoppingList(recommendation, formData);
  renderPrepGuide(recommendation);
  renderNutritionSummary(recommendation, formData);

  lastRecommendation = recommendation;
  lastFormData = formData;

  outputs.hidden = false;
  outputs.scrollIntoView({ behavior: "smooth", block: "start" });
});

pdfButton.addEventListener("click", () => {
  if (!lastRecommendation || !lastFormData) {
    alert("Buat rencana terlebih dahulu sebelum mengekspor PDF.");
    return;
  }
  exportPdfReport(lastRecommendation, lastFormData);
});

function parseJsonData(elementId, defaultValue) {
  const el = document.getElementById(elementId);
  if (!el) return defaultValue;
  try {
    const firstPass = JSON.parse(el.textContent || "");
    // Hugo can emit JSON from data files as a quoted JSON string. Parse again if needed.
    if (typeof firstPass === "string") {
      return JSON.parse(firstPass);
    }
    return firstPass;
  } catch (error) {
    console.error(`Gagal membaca data ${elementId}`, error);
    return defaultValue;
  }
}

function parseJsonDataByAliases(elementIds, defaultValue) {
  for (const id of elementIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    return parseJsonData(id, defaultValue);
  }
  return defaultValue;
}

function normalizeMealsData(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function normalizePriceData(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

function getFormData() {
  // TAG: INPUT-READ
  return {
    gender: document.getElementById("gender").value,
    age: Number(document.getElementById("age").value),
    weight: Number(document.getElementById("weight").value),
    duration: Number(document.getElementById("duration").value),
    servings: Number(document.getElementById("servings").value),
    mealsPerDay: Number(document.getElementById("mealsPerDay").value),
    dislikes: normalizeTags(document.getElementById("dislikes").value),
    allergies: normalizeTags(document.getElementById("allergies").value),
    budget: Number(document.getElementById("budget").value),
    cookTime: document.getElementById("cookTime").value,
    dietGoal: document.getElementById("dietGoal").value,
    stock: normalizeTags(document.getElementById("stock").value),
  };
}

function normalizeTags(raw) {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function estimateNutritionNeeds(data) {
  const goalProfile = buildGoalProfile(data);
  const base = data.gender === "male" ? data.weight * 33 : data.weight * 30;

  let ageAdjustment = 0;
  if (data.age >= 40) {
    ageAdjustment = -120;
  } else if (data.age <= 22) {
    ageAdjustment = 80;
  }

  const targetKcal = Math.round(
    base + ageAdjustment + goalProfile.kcalAdjustment,
  );
  const protein = Math.round((targetKcal * goalProfile.macroRatio.protein) / 4);
  const fat = Math.round((targetKcal * goalProfile.macroRatio.fat) / 9);
  const carb = Math.round((targetKcal * goalProfile.macroRatio.carb) / 4);

  return {
    targetKcal,
    protein,
    fat,
    carb,
    scoreWeight: goalProfile.scoreWeight,
    goal: data.dietGoal,
    budgetBand: goalProfile.budgetBand,
  };
}

function buildGoalProfile(data) {
  const baseProfile = goalProfiles[data.dietGoal] || goalProfiles.balanced;
  const pressure = getBudgetPressure(data);
  const dynamicWeights = { ...baseProfile.scoreWeight };

  // Saat budget makin ketat, bobot biaya otomatis naik tanpa menghilangkan kualitas gizi.
  if (pressure === "tight") {
    dynamicWeights.cost = Math.min(dynamicWeights.cost + 0.12, 0.5);
    dynamicWeights.kcal = Math.max(dynamicWeights.kcal - 0.04, 0.1);
    dynamicWeights.carb = Math.max(dynamicWeights.carb - 0.03, 0.05);
  } else if (pressure === "loose") {
    dynamicWeights.cost = Math.max(dynamicWeights.cost - 0.05, 0.05);
    dynamicWeights.protein = Math.min(dynamicWeights.protein + 0.03, 0.5);
    dynamicWeights.plant = Math.min(dynamicWeights.plant + 0.02, 0.4);
  }

  normalizeWeights(dynamicWeights);
  return {
    ...baseProfile,
    scoreWeight: dynamicWeights,
    budgetBand: pressure,
  };
}

function getBudgetPressure(data) {
  const costPerMeal =
    data.budget / Math.max(data.duration * data.mealsPerDay * data.servings, 1);
  if (costPerMeal < 12500) return "tight";
  if (costPerMeal > 22000) return "loose";
  return "moderate";
}

function normalizeWeights(weightObj) {
  const total = Object.values(weightObj).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return;
  Object.keys(weightObj).forEach((key) => {
    weightObj[key] = weightObj[key] / total;
  });
}

function generatePlan(data) {
  if (!mealsDatabase.length) {
    return {
      days: [],
      needs: estimateNutritionNeeds(data),
      notes: [
        "Data menu tidak tersedia. Pastikan JSON dari folder data berhasil dirender oleh Hugo.",
      ],
      slots: getSlotsByMealsPerDay(data.mealsPerDay),
    };
  }

  const needs = estimateNutritionNeeds(data);
  const notes = [];
  const filteredMeals = mealsDatabase.filter((meal) => {
    const ingredientSet = meal.ingredients.map((item) => item.toLowerCase());
    const hasDisliked = ingredientSet.some((item) =>
      data.dislikes.includes(item),
    );
    const hasAllergyIngredient = ingredientSet.some((item) =>
      data.allergies.includes(item),
    );
    const hasAllergyTag = meal.allergies.some((tag) =>
      data.allergies.includes(tag),
    );
    return !hasDisliked && !hasAllergyIngredient && !hasAllergyTag;
  });

  const pool = filteredMeals.length ? filteredMeals : mealsDatabase;
  if (!filteredMeals.length) {
    notes.push(
      "Filter preferensi/alergi terlalu ketat, sistem memakai seluruh menu yang tersedia agar rencana tetap terbentuk.",
    );
  }
  const maxAvgCost = Math.max(
    8000,
    Math.round(
      data.budget / (data.duration * data.mealsPerDay * data.servings),
    ),
  );
  const slots = getSlotsByMealsPerDay(data.mealsPerDay);
  const targetPerMeal = {
    kcal: Math.round(needs.targetKcal / data.mealsPerDay),
    protein: Math.round(needs.protein / data.mealsPerDay),
    fat: Math.round(needs.fat / data.mealsPerDay),
    carb: Math.round(needs.carb / data.mealsPerDay),
  };

  notes.push(`Model target AKG aktif: ${labelDietGoal(data.dietGoal)}.`);
  notes.push(`Level budget terdeteksi: ${labelBudgetBand(needs.budgetBand)}.`);

  const selectedByDay = [];
  const usageCounter = new Map();
  const previousDaySlotPick = {};
  for (let day = 1; day <= data.duration; day += 1) {
    const dailyMeals = [];
    const usedInDay = new Set();
    const todaySlotPick = {};
    for (let i = 0; i < data.mealsPerDay; i += 1) {
      const slot = slots[i] || "main";
      const candidates = pool.filter(
        (meal) =>
          meal.slot === slot || (slot === "main" && meal.slot !== "snack"),
      );
      const affordableFirst = candidates.filter(
        (meal) => meal.estimatedCost <= maxAvgCost + 6000,
      );
      const scored = scoreMealsByGoal(
        affordableFirst.length ? affordableFirst : candidates,
        needs,
        targetPerMeal,
        maxAvgCost,
        usageCounter,
        previousDaySlotPick[slot],
      );

      const pick =
        scored.find((meal) => !usedInDay.has(meal.name)) || scored[0];
      if (pick) {
        usedInDay.add(pick.name);
        usageCounter.set(pick.name, (usageCounter.get(pick.name) || 0) + 1);
        todaySlotPick[slot] = pick.name;
      }
      dailyMeals.push(pick || pool[(day + i) % pool.length]);
    }
    selectedByDay.push(dailyMeals);
    Object.assign(previousDaySlotPick, todaySlotPick);
  }

  const estimatedDaily = estimateDailyMealCost(selectedByDay, data.servings);
  if (estimatedDaily * data.duration > data.budget) {
    notes.push(
      "Estimasi biaya masih tinggi dibanding budget. Gunakan fokus Super Hemat atau kurangi durasi/porsi.",
    );
  }

  return {
    days: selectedByDay,
    needs,
    notes,
    slots,
  };
}

function getSlotsByMealsPerDay(mealsPerDay) {
  if (mealsPerDay === 2) return ["breakfast", "main"];
  if (mealsPerDay === 3) return ["breakfast", "main", "main"];
  return ["breakfast", "main", "main", "snack"];
}

function scoreMealsByGoal(
  candidates,
  needs,
  targetPerMeal,
  maxAvgCost,
  usageCounter,
  previousSlotMeal,
) {
  // TAG: SCORING-ENGINE
  const weights = needs.scoreWeight;
  const scoredMeals = candidates.map((meal) => {
    const kcalFit = fitScore(meal.nutrition.kcal, targetPerMeal.kcal);
    const proteinFit = fitScore(meal.nutrition.protein, targetPerMeal.protein);
    const fatFit = fitScore(meal.nutrition.fat, targetPerMeal.fat);
    const carbFit = fitScore(meal.nutrition.carb, targetPerMeal.carb);
    const costFit =
      1 -
      clamp((meal.estimatedCost - maxAvgCost) / Math.max(maxAvgCost, 1), 0, 1);
    const plantDensity =
      countPlantIngredients(meal.ingredients) /
      Math.max(meal.ingredients.length, 1);
    const repeatPenalty = clamp(
      (usageCounter.get(meal.name) || 0) * 0.08,
      0,
      0.32,
    );
    const sameSlotPenalty = previousSlotMeal === meal.name ? 0.18 : 0;

    const totalScore =
      kcalFit * weights.kcal +
      proteinFit * weights.protein +
      fatFit * weights.fat +
      carbFit * weights.carb +
      costFit * weights.cost +
      plantDensity * weights.plant -
      repeatPenalty -
      sameSlotPenalty;

    return { ...meal, score: totalScore };
  });

  return scoredMeals.sort((a, b) => b.score - a.score);
}

function fitScore(actual, target) {
  const diff = Math.abs(actual - target);
  const ratio = diff / Math.max(target, 1);
  return 1 - clamp(ratio, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function countPlantIngredients(ingredients) {
  const animalTerms = ["ayam", "ikan", "telur", "susu", "yogurt"];
  return ingredients.filter(
    (item) => !animalTerms.some((term) => item.includes(term)),
  ).length;
}

function estimateDailyMealCost(days, servings) {
  const total = days
    .flat()
    .reduce((sum, meal) => sum + meal.estimatedCost * servings, 0);
  return Math.round(total / days.length);
}

function renderMealPlan(recommendation, data) {
  // TAG: OUTPUT-CARD-1
  const container = document.getElementById("meal-plan");
  const prepHint =
    data.cookTime === "short"
      ? "Fokus menu cepat: pilih teknik rebus, tumis, dan panggang singkat."
      : data.cookTime === "long"
        ? "Anda punya waktu lebih: lakukan batch prep bahan 2-3 hari sekaligus."
        : "Meal prep bertahap: siapkan bahan inti untuk 2 hari sekali.";

  let html = `<p class="highlight">${prepHint}</p>`;
  if (recommendation.notes.length) {
    html += `<p class="highlight">Catatan sistem: ${recommendation.notes.join(" ")}</p>`;
  }

  if (!recommendation.days.length) {
    container.innerHTML = `${html}<p>Rencana belum bisa dibuat karena data menu kosong.</p>`;
    return;
  }

  recommendation.days.forEach((dayMeals, index) => {
    html += `<div class="day-plan"><h3>Hari ${index + 1}</h3><ul>`;
    dayMeals.forEach((meal, mealIndex) => {
      const label = slotLabel[recommendation.slots[mealIndex] || "main"];
      html += `<li><strong>${label}:</strong> ${meal.name} (estimasi Rp${formatNumber(meal.estimatedCost * data.servings)})</li>`;
    });
    html += "</ul></div>";
  });

  container.innerHTML = html;
}

function renderShoppingList(recommendation, data) {
  // TAG: OUTPUT-CARD-2
  const container = document.getElementById("shopping-list");
  if (!recommendation.days.length) {
    container.innerHTML =
      '<p class="highlight">Daftar belanja tidak tersedia karena rencana menu belum terbentuk.</p>';
    return;
  }
  const ingredientsCounter = {};

  recommendation.days.flat().forEach((meal) => {
    meal.ingredients.forEach((ingredient) => {
      const key = ingredient.toLowerCase();
      ingredientsCounter[key] = (ingredientsCounter[key] || 0) + data.servings;
    });
  });

  const stockSet = new Set(data.stock);
  const rows = Object.keys(ingredientsCounter)
    .sort((a, b) => a.localeCompare(b, "id"))
    .map((ingredient) => {
      const qty = ingredientsCounter[ingredient];
      const priceUnit = ingredientPrice[ingredient] || 10000;
      const estimated = Math.round(priceUnit * (qty / data.duration));
      return {
        ingredient,
        qty,
        estimated,
        inStock: stockSet.has(ingredient),
      };
    });

  const totalCost = rows
    .filter((item) => !item.inStock)
    .reduce((sum, item) => sum + item.estimated, 0);

  const budgetStatus =
    totalCost > data.budget
      ? "Estimasi melebihi budget. Turunkan durasi/porsi atau tambah bahan ekonomis seperti tempe, telur, tahu."
      : "Estimasi sesuai budget Anda.";

  let html = `<p class="highlight">Total estimasi: Rp${formatNumber(totalCost)} dari budget Rp${formatNumber(data.budget)}. ${budgetStatus}</p><ul>`;

  rows.forEach((item) => {
    if (item.inStock) {
      html += `<li>${capitalize(item.ingredient)} - ${item.qty} unit menu (sudah tersedia di rumah)</li>`;
    } else {
      html += `<li>${capitalize(item.ingredient)} - ${item.qty} unit menu (Rp${formatNumber(item.estimated)})</li>`;
    }
  });

  html += "</ul>";
  container.innerHTML = html;
}

function renderPrepGuide(recommendation) {
  // TAG: OUTPUT-CARD-3
  const container = document.getElementById("prep-guide");
  if (!recommendation.days.length) {
    container.innerHTML =
      '<p class="highlight">Panduan prep tidak tersedia karena rencana menu belum terbentuk.</p>';
    return;
  }
  const uniqueMeals = [];
  const mealNames = new Set();
  const rawIngredients = [];

  recommendation.days.flat().forEach((meal) => {
    if (!mealNames.has(meal.name)) {
      mealNames.add(meal.name);
      uniqueMeals.push(meal);
    }
    rawIngredients.push(...meal.ingredients);
  });

  const prepBuckets = buildPrepBuckets(rawIngredients);

  let html =
    '<p class="highlight">Tahapan meal prep mingguan: Siapkan mentah -> Masak setengah jadi -> Finishing saat makan.</p>';
  html += "<ul>";
  html += `<li><strong>Siapkan mentah:</strong> ${prepBuckets.raw.join(", ")}.</li>`;
  html += `<li><strong>Masak setengah jadi:</strong> ${prepBuckets.halfCook.join(", ")}.</li>`;
  html += `<li><strong>Masak penuh:</strong> ${prepBuckets.fullCook.join(", ")}.</li>`;
  html += "</ul><hr><ul>";

  uniqueMeals.forEach((meal) => {
    html += `<li><strong>${meal.name}</strong><br>Meal prep: ${meal.prep}<br>Penyimpanan: ${meal.storage}</li>`;
  });
  html += "</ul>";

  container.innerHTML = html;
}

function renderNutritionSummary(recommendation, data) {
  // TAG: OUTPUT-CARD-4
  const container = document.getElementById("nutrition-summary");
  if (!recommendation.days.length) {
    container.innerHTML =
      '<p class="highlight">Ringkasan gizi tidak tersedia karena rencana menu belum terbentuk.</p>';
    return;
  }
  const totals = recommendation.days.flat().reduce(
    (acc, meal) => {
      acc.kcal += meal.nutrition.kcal;
      acc.protein += meal.nutrition.protein;
      acc.fat += meal.nutrition.fat;
      acc.carb += meal.nutrition.carb;
      return acc;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 },
  );

  const mealCount = recommendation.days.length * data.mealsPerDay;
  const avgPerMeal = {
    kcal: Math.round(totals.kcal / mealCount),
    protein: Math.round(totals.protein / mealCount),
    fat: Math.round(totals.fat / mealCount),
    carb: Math.round(totals.carb / mealCount),
  };

  const perDay = {
    kcal: Math.round(
      (totals.kcal / recommendation.days.length) * data.servings,
    ),
    protein: Math.round(
      (totals.protein / recommendation.days.length) * data.servings,
    ),
    fat: Math.round((totals.fat / recommendation.days.length) * data.servings),
    carb: Math.round(
      (totals.carb / recommendation.days.length) * data.servings,
    ),
  };

  const needs = recommendation.needs;

  const needPerMeal = {
    kcal: Math.round(needs.targetKcal / data.mealsPerDay),
    protein: Math.round(needs.protein / data.mealsPerDay),
    fat: Math.round(needs.fat / data.mealsPerDay),
    carb: Math.round(needs.carb / data.mealsPerDay),
  };

  const comparison = compareNeeds(perDay, needs);

  container.innerHTML = `
		<p class="highlight">Estimasi rata-rata per porsi: ${avgPerMeal.kcal} kkal | Protein ${avgPerMeal.protein} g | Lemak ${avgPerMeal.fat} g | Karbohidrat ${avgPerMeal.carb} g</p>
		<ul>
      <li>Model perhitungan: target AKG adaptif dengan fokus ${labelDietGoal(data.dietGoal)}.</li>
			<li>Kebutuhan harian target: ${needs.targetKcal} kkal, Protein ${needs.protein} g, Lemak ${needs.fat} g, Karbohidrat ${needs.carb} g.</li>
			<li>Target per makan (${data.mealsPerDay}x/hari): ${needPerMeal.kcal} kkal, Protein ${needPerMeal.protein} g, Lemak ${needPerMeal.fat} g, Karbohidrat ${needPerMeal.carb} g.</li>
			<li>Asupan rencana per hari (sesuai porsi): ${perDay.kcal} kkal, Protein ${perDay.protein} g, Lemak ${perDay.fat} g, Karbohidrat ${perDay.carb} g.</li>
			<li>Status kecocokan: ${comparison}</li>
		</ul>
	`;
}

function buildPrepBuckets(ingredients) {
  const uniq = [...new Set(ingredients)];
  const rawTerms = [
    "wortel",
    "kol",
    "kembang kol",
    "bayam",
    "brokoli",
    "tomat",
    "timun",
    "selada",
    "pisang",
    "apel",
    "pepaya",
    "stroberi",
  ];
  const halfTerms = ["ayam fillet", "ikan", "tempe", "tahu", "edamame"];
  const fullTerms = ["beras", "beras merah", "oat", "telur", "jagung"];

  const raw = uniq.filter((item) => rawTerms.includes(item));
  const halfCook = uniq.filter((item) => halfTerms.includes(item));
  const fullCook = uniq.filter((item) => fullTerms.includes(item));

  return {
    raw: raw.length ? raw : ["sayuran segar"],
    halfCook: halfCook.length ? halfCook : ["protein utama"],
    fullCook: fullCook.length ? fullCook : ["karbohidrat utama"],
  };
}

function compareNeeds(perDay, needs) {
  const kcalDiff = perDay.kcal - needs.targetKcal;
  if (Math.abs(kcalDiff) <= 180) {
    return "Mendekati kebutuhan harian. Komposisi sudah relatif seimbang.";
  }
  if (kcalDiff > 180) {
    return "Cenderung di atas kebutuhan. Kurangi snack tinggi energi atau turunkan porsi.";
  }
  return "Cenderung di bawah kebutuhan. Tambah 1 snack protein atau naikkan porsi lauk utama.";
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function capitalize(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function exportPdfReport(recommendation, data) {
  // TAG: EXPORT-PDF
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Library PDF belum termuat. Coba refresh halaman.");
    return;
  }

  const doc = new window.jspdf.jsPDF("p", "mm", "a4");
  const margin = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Laporan NutriPlan", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Solusi praktis menu sehat, terjangkau, dan terencana", margin, y);
  y += 5;
  doc.text(`Tanggal: ${new Date().toLocaleDateString("id-ID")}`, margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.text("Ringkasan Input", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  const inputLines = [
    `Jenis kelamin: ${data.gender === "male" ? "Laki-laki" : "Perempuan"}`,
    `Usia/Berat: ${data.age} tahun / ${data.weight} kg`,
    `Durasi: ${data.duration} hari | Porsi: ${data.servings} | Makan/hari: ${data.mealsPerDay}`,
    `Budget: Rp${formatNumber(data.budget)} | Waktu prep: ${labelCookTime(data.cookTime)} | Fokus: ${labelDietGoal(data.dietGoal)}`,
    `Alergi: ${data.allergies.length ? data.allergies.join(", ") : "-"}`,
    `Tidak disukai: ${data.dislikes.length ? data.dislikes.join(", ") : "-"}`,
    `Stok rumah: ${data.stock.length ? data.stock.join(", ") : "-"}`,
  ];

  inputLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, 180);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4.2;
  });

  y += 2;
  doc.setFont("helvetica", "bold");
  doc.text("Rencana Meal Prep", margin, y);
  y += 5;

  const mealRows = [];
  recommendation.days.forEach((dayMeals, dayIndex) => {
    dayMeals.forEach((meal, idx) => {
      mealRows.push([
        `Hari ${dayIndex + 1}`,
        slotLabel[recommendation.slots[idx] || "main"],
        meal.name,
        `Rp${formatNumber(meal.estimatedCost * data.servings)}`,
      ]);
    });
  });

  doc.autoTable({
    startY: y,
    head: [["Hari", "Waktu Makan", "Menu", "Estimasi"]],
    body: mealRows,
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: [37, 96, 59] },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 6;
  const nutrition = getNutritionReportData(recommendation, data);

  doc.setFont("helvetica", "bold");
  doc.text("Ringkasan Gizi", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(
    `Target harian: ${nutrition.needs.targetKcal} kkal | Protein ${nutrition.needs.protein} g | Lemak ${nutrition.needs.fat} g | Karbohidrat ${nutrition.needs.carb} g`,
    margin,
    y,
  );
  y += 4.8;
  doc.text(
    `Rencana per hari: ${nutrition.perDay.kcal} kkal | Protein ${nutrition.perDay.protein} g | Lemak ${nutrition.perDay.fat} g | Karbohidrat ${nutrition.perDay.carb} g`,
    margin,
    y,
  );
  y += 4.8;
  doc.text(`Status: ${nutrition.comparison}`, margin, y);

  const filename = `NutriPlan-Report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

function getNutritionReportData(recommendation, data) {
  const totals = recommendation.days.flat().reduce(
    (acc, meal) => {
      acc.kcal += meal.nutrition.kcal;
      acc.protein += meal.nutrition.protein;
      acc.fat += meal.nutrition.fat;
      acc.carb += meal.nutrition.carb;
      return acc;
    },
    { kcal: 0, protein: 0, fat: 0, carb: 0 },
  );

  const perDay = {
    kcal: Math.round(
      (totals.kcal / recommendation.days.length) * data.servings,
    ),
    protein: Math.round(
      (totals.protein / recommendation.days.length) * data.servings,
    ),
    fat: Math.round((totals.fat / recommendation.days.length) * data.servings),
    carb: Math.round(
      (totals.carb / recommendation.days.length) * data.servings,
    ),
  };

  const needs = recommendation.needs;
  return {
    perDay,
    needs,
    comparison: compareNeeds(perDay, needs),
  };
}

function labelCookTime(cookTime) {
  if (cookTime === "short") return "30-60 menit";
  if (cookTime === "long") return "2-3 jam";
  return "1-2 jam";
}

function labelDietGoal(goal) {
  if (goal === "highProtein") return "Tinggi Protein";
  if (goal === "budget") return "Super Hemat";
  if (goal === "plantForward") return "Lebih Banyak Nabati";
  return "Seimbang";
}

function labelBudgetBand(band) {
  if (band === "tight") return "Ketat";
  if (band === "loose") return "Longgar";
  return "Sedang";
}
