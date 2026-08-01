import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeInventory,
  calculateStockpile,
  createDefaultHousehold,
  createDefaultStockpile
} from '../src/stockpile-engine.js';

test('one-person minimum and comfort formulas use 3L, 3 meals, and 5 toilet uses per day', () => {
  const household = createDefaultHousehold();
  const result = calculateStockpile(household, createDefaultStockpile());
  const water = result.items.find((item) => item.id === 'waterLiters');
  const food = result.items.find((item) => item.id === 'foodServings');
  const toilet = result.items.find((item) => item.id === 'toiletUses');
  assert.equal(water.minimum, 9);
  assert.equal(water.comfort, 21);
  assert.equal(food.minimum, 9);
  assert.equal(food.comfort, 21);
  assert.equal(toilet.minimum, 15);
  assert.equal(toilet.comfort, 35);
});

test('critical item gating prevents a false minimum achievement', () => {
  const household = { ...createDefaultHousehold(), adults: 2 };
  const stockpile = createDefaultStockpile();
  stockpile.quantities.waterLiters = 100;
  stockpile.quantities.foodServings = 100;
  stockpile.quantities.toiletUses = 0;
  const result = calculateStockpile(household, stockpile);
  assert.equal(result.minimumMet, false);
  assert.equal(result.level.id, 'below-minimum');
});

test('four people with seven days of critical supplies reach the comfort line', () => {
  const household = { ...createDefaultHousehold(), adults: 2, children: 2 };
  const stockpile = createDefaultStockpile();
  stockpile.quantities.waterLiters = 84;
  stockpile.quantities.foodServings = 84;
  stockpile.quantities.toiletUses = 140;
  const result = calculateStockpile(household, stockpile);
  assert.equal(result.minimumMet, true);
  assert.equal(result.comfortMet, true);
  assert.equal(result.level.id, 'comfort');
});

test('conditional medication, infant, and pet fields become critical when needed', () => {
  const household = {
    ...createDefaultHousehold(),
    infants: 1,
    regularMedication: 1,
    pets: 1
  };
  const stockpile = createDefaultStockpile();
  stockpile.quantities.waterLiters = 100;
  stockpile.quantities.foodServings = 100;
  stockpile.quantities.toiletUses = 100;
  const result = calculateStockpile(household, stockpile);
  assert.equal(result.minimumMet, false);
  assert.ok(result.criticalItems.some((item) => item.id === 'medicationDays'));
  assert.ok(result.criticalItems.some((item) => item.id === 'babySupplyDays'));
  assert.ok(result.criticalItems.some((item) => item.id === 'petSupplyDays'));
});

test('advanced water target follows the custom outage duration', () => {
  const household = { ...createDefaultHousehold(), adults: 2 };
  const stockpile = createDefaultStockpile();
  stockpile.advanced.enabled = true;
  stockpile.advanced.waterDays = 10;
  const result = calculateStockpile(household, stockpile);
  const water = result.items.find((item) => item.id === 'waterLiters');
  assert.equal(water.advancedTarget, 60);
});

test('inventory analysis groups expired and near-expiry items', () => {
  const now = new Date('2026-07-31T12:00:00+09:00');
  const inventory = [
    { id: 'a', name: 'expired', expirationDate: '2026-07-01', quantity: 1 },
    { id: 'b', name: 'soon', expirationDate: '2026-08-15', quantity: 1 },
    { id: 'c', name: 'later', expirationDate: '2026-11-01', quantity: 1 },
    { id: 'd', name: 'unknown', expirationDate: '', quantity: 1 }
  ];
  const result = analyzeInventory(inventory, now);
  assert.equal(result.expired.length, 1);
  assert.equal(result.within30.length, 1);
  assert.equal(result.noDate.length, 1);
  assert.equal(result.items[0].name, 'expired');
});

test('advanced presets apply scenario days and report water weight', async () => {
  const { applyStockpileScenario, stockpileScenario } = await import('../src/stockpile-engine.js');
  const household = { ...createDefaultHousehold(), adults: 2 };
  const stockpile = applyStockpileScenario(createDefaultStockpile(), 'isolation');
  const result = calculateStockpile(household, stockpile);
  assert.equal(stockpile.advanced.enabled, true);
  assert.equal(stockpile.advanced.waterDays, 10);
  assert.equal(result.scenario.id, 'isolation');
  assert.equal(result.waterWeightKg, 60);
  assert.match(stockpileScenario('high-rise').description, /階段/);
});
