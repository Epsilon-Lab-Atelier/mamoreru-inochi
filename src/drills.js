export const DRILL_DURATIONS = Object.freeze([3, 5, 10]);

export const DRILL_SCENARIOS = Object.freeze([
  {
    id: 'night-earthquake',
    title: '夜中に大きな地震',
    summary: '暗い寝室で強い揺れが起きた想定です。',
    steps: [
      '寝ている場所から手が届く範囲に、靴と明かりがあるか確認する。',
      '背の高い家具や割れ物が、寝る場所へ倒れないか見る。',
      '揺れが収まった後に通る玄関までの経路を歩く。',
      '家族が同じ場所にいない場合の連絡方法を声に出して確認する。'
    ],
    reflection: '寝室で最初に困りそうなことは何でしたか。'
  },
  {
    id: 'heavy-rain',
    title: '大雨で避難を考える',
    summary: '雨がさらに強くなる前に判断する想定です。',
    steps: [
      '洪水・土砂災害に対応する避難先を確認する。',
      '暗い時間や冠水時に通らない道を確認する。',
      '持出袋を実際に持ち、無理なく移動できる重さか確かめる。',
      '外へ出る方が危険な場合の、建物内の安全な場所を決める。'
    ],
    reflection: '避難を始める判断を、家族で同じ言葉にできましたか。'
  },
  {
    id: 'blackout-water',
    title: '停電と断水',
    summary: '電気と水が同時に使えない想定です。',
    steps: [
      '懐中電灯やランタンを、暗い状態でも取り出せるか確認する。',
      'スマホを何回充電できるか、モバイルバッテリーを確認する。',
      '携帯トイレの保管場所と使い方を確認する。',
      '冷暖房が止まる季節の対策を一つ決める。'
    ],
    reflection: '最初の24時間で不足しそうな物は何でしたか。'
  },
  {
    id: 'family-apart',
    title: '家族が別々の場所にいる',
    summary: '学校、職場、自宅などで離れて被災した想定です。',
    steps: [
      '第一と第二の集合場所を確認する。',
      '電話がつながらないときの連絡順を確認する。',
      '子どもや支援が必要な人の迎え担当を確認する。',
      '無理に帰宅せず待機する条件を決める。'
    ],
    reflection: '誰か一人と連絡が取れなくても行動できる計画ですか。'
  },
  {
    id: 'home-fire',
    title: '自宅で火災',
    summary: '煙や炎を見つけたときの行動を確認します。',
    steps: [
      '119へ伝える住所や目印を確認する。',
      '二方向の避難経路を確認する。',
      '消火器の場所と使用期限を確認する。',
      '煙を吸わないため低い姿勢で逃げることを確認する。'
    ],
    reflection: '玄関が使えない場合の出口を説明できますか。'
  },
  {
    id: 'road-isolation',
    title: '道路寸断・孤立',
    summary: '橋や道路が使えず、数日移動できない想定です。',
    steps: [
      '水・食料・携帯トイレが何日分あるか確認する。',
      '第二の移動経路や徒歩経路を確認する。',
      'ラジオなど、スマホ以外の情報手段を確認する。',
      '近隣で助け合う相手や連絡方法を確認する。'
    ],
    reflection: '物流が7日止まった場合に最初に不足する物は何ですか。'
  },
  {
    id: 'elevator-stop',
    title: 'エレベータ停止',
    summary: '高層住宅や建物で階段移動が必要な想定です。',
    steps: [
      '自宅階から地上までの階段を確認する。',
      '水や重い備蓄を分散して保管できているか確認する。',
      '携帯トイレとごみの保管方法を確認する。',
      '階段移動に支援が必要な人の対応を確認する。'
    ],
    reflection: '階段移動が難しい場合、誰へどう助けを求めますか。'
  },
  {
    id: 'no-network',
    title: 'スマホの通信がつながらない',
    summary: '通話やインターネットが使えない想定です。',
    steps: [
      '家族の集合場所を、スマホを見ずに説明する。',
      '171や災害用伝言板の使い方を確認する。',
      'ラジオや自治体の情報入手方法を確認する。',
      'このアプリをオフラインで開けるか確認する。'
    ],
    reflection: 'スマホ以外で確認できる情報を一つ以上用意できていますか。'
  }
]);

export function createDefaultDrillState() {
  return {
    active: null,
    history: [],
    nextReviewDate: '',
    lastCompletedAt: null
  };
}

export function createDrillSession(scenarioId, duration = 5) {
  const scenario = DRILL_SCENARIOS.find((item) => item.id === scenarioId) || DRILL_SCENARIOS[0];
  const normalizedDuration = DRILL_DURATIONS.includes(Number(duration)) ? Number(duration) : 5;
  return {
    id: `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: scenario.id,
    duration: normalizedDuration,
    startedAt: new Date().toISOString(),
    completedSteps: [],
    reflection: '',
    actionItem: ''
  };
}

export function drillProgress(session) {
  const scenario = DRILL_SCENARIOS.find((item) => item.id === session?.scenarioId);
  if (!scenario) return { completed: 0, total: 0, percent: 0 };
  const completed = new Set(session?.completedSteps || []).size;
  return { completed, total: scenario.steps.length, percent: Math.round(completed / scenario.steps.length * 100) };
}

export function completeDrillSession(session) {
  const scenario = DRILL_SCENARIOS.find((item) => item.id === session?.scenarioId);
  if (!scenario) throw new Error('訓練シナリオを確認できません。');
  const progress = drillProgress(session);
  return {
    ...session,
    title: scenario.title,
    completedAt: new Date().toISOString(),
    completedCount: progress.completed,
    totalCount: progress.total
  };
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dateToIcs(dateText) {
  const date = String(dateText || '').replace(/-/g, '');
  return /^\d{8}$/.test(date) ? date : '';
}

export function createDrillCalendarIcs(dateText, { title = '守れるいのち 防災訓練', description = '家族計画、備蓄、災害時の行動を短時間で確認します。' } = {}) {
  const date = dateToIcs(dateText);
  if (!date) throw new Error('次回の訓練日を選んでください。');
  const uid = `mamoreru-inochi-${date}-${Date.now()}@epsilonlab`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EpsilonLab//Mamoreru Inochi//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}
