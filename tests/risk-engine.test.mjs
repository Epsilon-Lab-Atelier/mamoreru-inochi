import test from 'node:test';
import assert from 'node:assert/strict';
import { RISK_QUESTIONS } from '../src/data.js';
import { calculateRiskAssessment, emptyRiskAnswers } from '../src/risk-engine.js';

test('empty answers are treated as information gaps, not low risk', () => {
  const result = calculateRiskAssessment(emptyRiskAnswers());
  assert.equal(result.confidence, 'C');
  assert.equal(result.overallPriority, 0);
  assert.equal(result.followUps.length, RISK_QUESTIONS.length);
  assert.ok(result.hazards.every((hazard) => hazard.level === 0));
});

test('tsunami zone creates a highest-priority tsunami review', () => {
  const answers = emptyRiskAnswers();
  answers['tsunami-zone'] = 'yes';
  const result = calculateRiskAssessment(answers);
  const tsunami = result.hazards.find((hazard) => hazard.id === 'tsunami');
  assert.equal(tsunami.level, 5);
  assert.ok(tsunami.reasons.some((reason) => reason.text.includes('津波')));
});

test('unfixed furniture creates an early earthquake action', () => {
  const answers = emptyRiskAnswers();
  answers['furniture-fixed'] = 'no';
  const result = calculateRiskAssessment(answers);
  const earthquake = result.hazards.find((hazard) => hazard.id === 'earthquake');
  assert.ok(earthquake.level >= 4);
  assert.ok(result.recommendations.some((item) => item.text.includes('家具')));
});

test('unknown answers lower confidence without adding hazard points', () => {
  const answers = emptyRiskAnswers();
  answers['flood-zone'] = 'unknown';
  const result = calculateRiskAssessment(answers);
  const flood = result.hazards.find((hazard) => hazard.id === 'flood');
  assert.equal(flood.raw, 0);
  assert.equal(flood.level, 0);
  assert.ok(result.followUps.some((item) => item.id === 'flood-zone'));
});

test('risk assessment is deterministic for the same answers', () => {
  const answers = emptyRiskAnswers();
  answers['flood-zone'] = 'yes';
  answers['furniture-fixed'] = 'no';
  answers['family-contact'] = 'yes';
  const first = calculateRiskAssessment(answers);
  const second = calculateRiskAssessment(answers);
  const stripTime = ({ generatedAt, ...rest }) => rest;
  assert.deepEqual(stripTime(first), stripTime(second));
});
