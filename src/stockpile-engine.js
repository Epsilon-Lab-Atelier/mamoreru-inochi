import { STOCKPILE_FIELDS } from './data.js';
import { daysUntil, toNonNegativeInteger, toNonNegativeNumber } from './utils.js';

export function createDefaultHousehold() {
  return {
    adults: 1,
    children: 0,
    infants: 0,
    olderAdults: 0,
    pregnant: 0,
    mobilitySupport: 0,
    regularMedication: 0,
    medicalPower: 0,
    allergies: 0,
    pets: 0
  };
}

export function createDefaultStockpile() {
  return {
    quantities: Object.fromEntries(STOCKPILE_FIELDS.map((field) => [field.id, 0])),
    advanced: {
      enabled: false,
      waterDays: 7,
      foodDays: 7,
      powerDays: 3,
      gasDays: 7,
      isolationDays: 7,
      elevatorDays: 3
    },
    inventory: [],
    result: null,
    lastCheckedAt: null
  };
}

export function normalizeHousehold(household = {}) {
  const normalized = createDefaultHousehold();
  for (const key of Object.keys(normalized)) {
    normalized[key] = toNonNegativeInteger(household[key], normalized[key]);
  }
  return normalized;
}

export function householdPeople(household = {}) {
  const normalized = normalizeHousehold(household);
  return normalized.adults + normalized.children + normalized.infants + normalized.olderAdults;
}

function practicalTargets(people, household, days) {
  const activePeople = Math.max(1, people);
  return {
    waterLiters: 3 * people * days,
    foodServings: 3 * people * days,
    toiletUses: 5 * people * days,
    medicationDays: household.regularMedication > 0 ? days : 0,
    babySupplyDays: household.infants > 0 ? days : 0,
    petSupplyDays: household.pets > 0 ? days : 0,
    lights: Math.max(days >= 7 ? 2 : 1, Math.ceil(activePeople / 2)),
    radios: 1,
    powerBankCharges: activePeople * (days >= 7 ? 3 : 1),
    helmets: people,
    gloves: Math.max(1, people),
    gasCanisters: days >= 7 ? 7 : 3,
    waterContainers: Math.max(1, Math.ceil(activePeople / 2)),
    firstAidKits: 1
  };
}

function targetForAdvanced(fieldId, people, household, advanced) {
  const activePeople = Math.max(1, people);
  const isolationDays = Math.max(1, toNonNegativeInteger(advanced.isolationDays, 7));
  const waterDays = Math.max(1, toNonNegativeInteger(advanced.waterDays, 7));
  const powerDays = Math.max(1, toNonNegativeInteger(advanced.powerDays, 3));
  const gasDays = Math.max(1, toNonNegativeInteger(advanced.gasDays, 7));

  const targets = {
    waterLiters: 3 * people * waterDays,
    foodServings: 3 * people * isolationDays,
    toiletUses: 5 * people * waterDays,
    medicationDays: household.regularMedication > 0 ? isolationDays : 0,
    babySupplyDays: household.infants > 0 ? isolationDays : 0,
    petSupplyDays: household.pets > 0 ? isolationDays : 0,
    lights: Math.max(2, Math.ceil(activePeople / 2)),
    radios: 1,
    powerBankCharges: activePeople * Math.max(1, Math.ceil(powerDays / 2)),
    helmets: people,
    gloves: Math.max(1, people),
    gasCanisters: Math.max(3, gasDays),
    waterContainers: Math.max(1, Math.ceil(activePeople / 2)),
    firstAidKits: 1
  };
  return targets[fieldId] ?? 0;
}

function isFieldActive(field, household) {
  if (!field.conditional) return true;
  return Number(household[field.conditional] ?? 0) > 0;
}

function fieldStatus(current, minimum, comfort) {
  if (comfort > 0 && current >= comfort) return 'comfort';
  if (minimum > 0 && current >= minimum) return 'minimum';
  if (current > 0) return 'partial';
  return 'none';
}

export function calculateStockpile(householdInput = {}, stockpileInput = {}) {
  const household = normalizeHousehold(householdInput);
  const people = householdPeople(household);
  const quantities = Object.fromEntries(
    STOCKPILE_FIELDS.map((field) => [field.id, toNonNegativeNumber(stockpileInput.quantities?.[field.id], 0)])
  );
  const advanced = {
    ...createDefaultStockpile().advanced,
    ...(stockpileInput.advanced ?? {})
  };
  const minimumTargets = practicalTargets(people, household, 3);
  const comfortTargets = practicalTargets(people, household, 7);

  const items = STOCKPILE_FIELDS
    .filter((field) => isFieldActive(field, household))
    .map((field) => {
      const current = quantities[field.id] ?? 0;
      const minimum = minimumTargets[field.id] ?? 0;
      const comfort = comfortTargets[field.id] ?? 0;
      const advancedTarget = advanced.enabled
        ? targetForAdvanced(field.id, people, household, advanced)
        : null;
      return {
        ...field,
        current,
        minimum,
        comfort,
        advancedTarget,
        missingMinimum: Math.max(0, minimum - current),
        missingComfort: Math.max(0, comfort - current),
        missingAdvanced: advancedTarget === null ? null : Math.max(0, advancedTarget - current),
        status: fieldStatus(current, minimum, comfort),
        minimumRatio: minimum > 0 ? Math.min(1, current / minimum) : 1,
        comfortRatio: comfort > 0 ? Math.min(1, current / comfort) : 1
      };
    });

  const criticalIds = ['waterLiters', 'foodServings', 'toiletUses'];
  if (household.regularMedication > 0) criticalIds.push('medicationDays');
  if (household.infants > 0) criticalIds.push('babySupplyDays');
  if (household.pets > 0) criticalIds.push('petSupplyDays');

  const criticalItems = items.filter((item) => criticalIds.includes(item.id));
  const minimumMet = people > 0 && criticalItems.every((item) => item.current >= item.minimum);
  const comfortMet = people > 0 && criticalItems.every((item) => item.current >= item.comfort);
  const advancedMet = advanced.enabled
    ? people > 0 && criticalItems.every((item) => item.current >= (item.advancedTarget ?? 0))
    : null;

  const weightedScore = criticalItems.length
    ? Math.round(criticalItems.reduce((sum, item) => sum + item.comfortRatio, 0) / criticalItems.length * 100)
    : 0;

  let level;
  if (people <= 0) {
    level = { id: 'incomplete', label: '家族構成を入力してください', tone: 'warning' };
  } else if (!minimumMet) {
    level = { id: 'below-minimum', label: '最低3日ラインを整えている途中', tone: 'danger' };
  } else if (!comfortMet) {
    level = { id: 'minimum', label: '最低3日ライン達成', tone: 'warning' };
  } else {
    level = { id: 'comfort', label: '安心7日ライン達成', tone: 'success' };
  }

  const deficits = items
    .filter((item) => item.missingMinimum > 0)
    .sort((a, b) => (b.essential === true) - (a.essential === true) || b.minimumRatio - a.minimumRatio)
    .slice(0, 6);
  const nextComfort = items
    .filter((item) => item.missingMinimum <= 0 && item.missingComfort > 0)
    .sort((a, b) => b.missingComfort - a.missingComfort)
    .slice(0, 6);

  const comments = [];
  if (people > 0 && deficits.length > 0) {
    comments.push(`まずは、${deficits.slice(0, 3).map((item) => item.label).join('、')}の3日分を優先してください。`);
  }
  if (minimumMet && !comfortMet) {
    comments.push('最低3日分は整っています。広域災害や物流停止も考え、無理のない範囲で7日分へ増やしましょう。');
  }
  if (comfortMet) {
    comments.push('水・食料・トイレなどの重要項目は7日分の目安を満たしています。賞味期限、保管場所、家族が使い方を知っているかも確認してください。');
  }
  if (household.medicalPower > 0) {
    comments.push('電源が必要な医療機器については、備蓄点数では判断できません。医療機関や機器事業者と停電時の電源・避難方法を確認してください。');
  }
  if (advanced.enabled && !advancedMet) {
    comments.push('アドバンス設定の日数に対して不足があります。設定値は生活環境に合わせ、保管スペースや持ち運びも考えて調整してください。');
  }

  return {
    generatedAt: new Date().toISOString(),
    household,
    people,
    quantities,
    advanced,
    minimumDays: 3,
    comfortDays: 7,
    items,
    criticalItems,
    minimumMet,
    comfortMet,
    advancedMet,
    score: weightedScore,
    level,
    deficits,
    nextComfort,
    comments,
    notes: [
      '飲料水は1人1日3L、食料は1人1日3食、携帯トイレは1人1日5回を基本目安として計算しています。',
      '照明、電源、ヘルメット、カセットボンベなどは家庭差が大きいため、アプリ内の実用目安です。器具・住宅・季節に合わせて調整してください。',
      '薬、医療機器、アレルギー、乳幼児用品は、医療機関や製品の案内を優先してください。'
    ]
  };
}

export function analyzeInventory(inventory = [], now = new Date()) {
  const normalized = inventory.map((item) => ({
    ...item,
    quantity: toNonNegativeNumber(item.quantity, 0),
    daysRemaining: daysUntil(item.expirationDate, now)
  }));
  const expired = normalized.filter((item) => item.daysRemaining !== null && item.daysRemaining < 0);
  const within30 = normalized.filter((item) => item.daysRemaining !== null && item.daysRemaining >= 0 && item.daysRemaining <= 30);
  const within60 = normalized.filter((item) => item.daysRemaining !== null && item.daysRemaining > 30 && item.daysRemaining <= 60);
  const within90 = normalized.filter((item) => item.daysRemaining !== null && item.daysRemaining > 60 && item.daysRemaining <= 90);
  const noDate = normalized.filter((item) => item.daysRemaining === null);
  const sorted = [...normalized].sort((a, b) => {
    if (a.daysRemaining === null && b.daysRemaining === null) return a.name.localeCompare(b.name, 'ja');
    if (a.daysRemaining === null) return 1;
    if (b.daysRemaining === null) return -1;
    return a.daysRemaining - b.daysRemaining;
  });

  const suggestions = [];
  if (expired.length) suggestions.push('期限切れの品を確認し、安全に処分または交換してください。');
  if (within30.length) suggestions.push('30日以内の品は、普段の食事で使い、同じ物を買い足すとローリングストックを続けやすくなります。');
  if (noDate.length) suggestions.push('期限を記録していない品は、外箱や本体の表示を確認してください。');
  if (!expired.length && !within30.length && normalized.length) suggestions.push('直近30日に交換が必要な品はありません。月に一度、数量と保管場所も確認してください。');

  return { items: sorted, expired, within30, within60, within90, noDate, suggestions };
}
