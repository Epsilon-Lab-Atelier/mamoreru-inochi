import { HAZARDS, RISK_QUESTIONS } from './data.js';
import { uniqueBy } from './utils.js';

export const RISK_LEVELS = {
  0: { label: '情報不足', shortLabel: '未判定', guidance: '回答や地域情報を追加すると、優先順位を整理できます。' },
  1: { label: '確認を継続', shortLabel: '確認', guidance: '現時点で強い注意条件は多くありませんが、安全を保証するものではありません。' },
  2: { label: '少し見直す', shortLabel: '見直し', guidance: 'いくつかの備えを見直すと、対応しやすくなります。' },
  3: { label: '優先して確認', shortLabel: '優先', guidance: '近いうちに確認したい条件があります。できる対策から進めてください。' },
  4: { label: '早めに対策', shortLabel: '早めに', guidance: '被害や避難へ影響しやすい条件があります。早めの確認と対策を勧めます。' },
  5: { label: '最優先で確認', shortLabel: '最優先', guidance: '命や生活継続へ大きく影響しうる条件があります。公的情報や専門家も利用して確認してください。' }
};

function createHazardAccumulator(id) {
  return {
    id,
    ...HAZARDS[id],
    raw: 0,
    maxRaw: 0,
    floor: 0,
    relevant: 0,
    known: 0,
    unknown: 0,
    reasons: [],
    recommendations: []
  };
}

function ratioToLevel(ratio) {
  if (ratio <= 0.08) return 1;
  if (ratio <= 0.22) return 2;
  if (ratio <= 0.42) return 3;
  if (ratio <= 0.65) return 4;
  return 5;
}

function confidenceGrade(known, relevant) {
  if (!relevant || known === 0) return 'C';
  const ratio = known / relevant;
  if (ratio >= 0.85) return 'A';
  if (ratio >= 0.6) return 'B';
  return 'C';
}

function normalizeRecommendation(question, answer, weight) {
  const text = question.recommendations?.[answer];
  if (!text) return null;
  return {
    id: `${question.id}-${answer}`,
    questionId: question.id,
    text,
    score: weight,
    answer
  };
}

export function calculateRiskAssessment(answers = {}) {
  const accumulators = Object.fromEntries(
    Object.keys(HAZARDS).map((id) => [id, createHazardAccumulator(id)])
  );
  const strengths = [];
  const followUps = [];
  const allRecommendations = [];
  let answeredCount = 0;
  let knownCount = 0;

  for (const question of RISK_QUESTIONS) {
    const answer = answers[question.id];
    if (answer) answeredCount += 1;
    if (answer === 'yes' || answer === 'no') knownCount += 1;

    const relevantHazards = new Set([
      ...Object.keys(question.effects?.yes ?? {}),
      ...Object.keys(question.effects?.no ?? {}),
      ...Object.keys(question.floors?.yes ?? {}),
      ...Object.keys(question.floors?.no ?? {})
    ]);

    for (const hazardId of relevantHazards) {
      const accumulator = accumulators[hazardId];
      accumulator.relevant += 1;
      if (answer === 'yes' || answer === 'no') accumulator.known += 1;
      if (answer === 'unknown' || answer === 'later' || !answer) accumulator.unknown += 1;

      const maximumEffect = Math.max(
        Number(question.effects?.yes?.[hazardId] ?? 0),
        Number(question.effects?.no?.[hazardId] ?? 0)
      );
      accumulator.maxRaw += maximumEffect;
    }

    if (answer === 'yes' || answer === 'no') {
      const effects = question.effects?.[answer] ?? {};
      const floors = question.floors?.[answer] ?? {};
      const reason = question.reasons?.[answer];
      const strength = question.strengths?.[answer];
      const largestWeight = Math.max(1, ...Object.values(effects), ...Object.values(floors).map((value) => value * 1.4));

      for (const [hazardId, weight] of Object.entries(effects)) {
        accumulators[hazardId].raw += Number(weight);
        if (reason && Number(weight) > 0) {
          accumulators[hazardId].reasons.push({
            questionId: question.id,
            text: reason,
            weight: Number(weight)
          });
        }
      }
      for (const [hazardId, floor] of Object.entries(floors)) {
        accumulators[hazardId].floor = Math.max(accumulators[hazardId].floor, Number(floor));
      }

      const recommendation = normalizeRecommendation(question, answer, largestWeight);
      if (recommendation) {
        allRecommendations.push(recommendation);
        for (const hazardId of new Set([...Object.keys(effects), ...Object.keys(floors)])) {
          accumulators[hazardId].recommendations.push(recommendation);
        }
      }
      if (strength) strengths.push({ id: question.id, text: strength });
    } else if (answer === 'unknown' || answer === 'later' || !answer) {
      const effectiveAnswer = answer || 'unanswered';
      const text = question.recommendations?.[answer]
        || (answer === 'later' ? `${question.title.replace(/。$/, '')}を後で確認する。` : `${question.title.replace(/。$/, '')}を確認する。`);
      followUps.push({
        id: question.id,
        section: question.section,
        answer: effectiveAnswer,
        title: question.title,
        text
      });
      const recommendation = normalizeRecommendation(question, answer, 1.2);
      if (recommendation) allRecommendations.push(recommendation);
    }
  }

  const hazards = Object.values(accumulators).map((accumulator) => {
    const ratio = accumulator.maxRaw > 0 ? accumulator.raw / accumulator.maxRaw : 0;
    const calculatedLevel = accumulator.known > 0 ? ratioToLevel(ratio) : 0;
    const level = Math.max(calculatedLevel, accumulator.floor);
    const confidence = confidenceGrade(accumulator.known, accumulator.relevant);
    return {
      ...accumulator,
      ratio,
      level,
      levelInfo: RISK_LEVELS[level],
      confidence,
      reasons: accumulator.reasons.sort((a, b) => b.weight - a.weight).slice(0, 4),
      recommendations: uniqueBy(
        accumulator.recommendations.sort((a, b) => b.score - a.score),
        (item) => item.text
      ).slice(0, 3)
    };
  }).sort((a, b) => b.level - a.level || b.raw - a.raw);

  const overallPriority = Math.max(0, ...hazards.map((hazard) => hazard.level));
  const topHazards = hazards.filter((hazard) => hazard.level > 0).slice(0, 3);
  const overallConfidence = confidenceGrade(knownCount, RISK_QUESTIONS.length);
  const completion = Math.round((answeredCount / RISK_QUESTIONS.length) * 100);
  const knownCompletion = Math.round((knownCount / RISK_QUESTIONS.length) * 100);
  const recommendations = uniqueBy(
    allRecommendations.sort((a, b) => b.score - a.score),
    (item) => item.text
  ).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    totalQuestions: RISK_QUESTIONS.length,
    answeredCount,
    knownCount,
    completion,
    knownCompletion,
    overallPriority,
    overallLevelInfo: RISK_LEVELS[overallPriority],
    confidence: overallConfidence,
    hazards,
    topHazards,
    strengths: uniqueBy(strengths, (item) => item.text).slice(0, 8),
    followUps,
    recommendations,
    disclaimer: 'この結果は、入力内容から備えの優先順位を整理するための目安です。災害の発生や被害を予測したり、安全を保証したりするものではありません。自治体のハザードマップや専門家の確認も利用してください。'
  };
}

export function emptyRiskAnswers() {
  return Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, '']));
}
