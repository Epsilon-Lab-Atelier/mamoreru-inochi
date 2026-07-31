export const HAZARDS = {
  earthquake: {
    id: 'earthquake',
    name: '地震・家具転倒',
    shortName: '地震',
    icon: '揺',
    description: '強い揺れ、家具や家電の転倒、建物や室内でのけがへの備えです。'
  },
  flood: {
    id: 'flood',
    name: '洪水・内水氾濫',
    shortName: '洪水',
    icon: '水',
    description: '川の増水、排水しきれない雨水、低い土地への浸水への備えです。'
  },
  tsunami: {
    id: 'tsunami',
    name: '津波・高潮',
    shortName: '津波',
    icon: '波',
    description: '海岸や河口付近で、短時間に安全な高所へ移動するための備えです。'
  },
  landslide: {
    id: 'landslide',
    name: '土砂災害',
    shortName: '土砂',
    icon: '山',
    description: '崖崩れ、地すべり、土石流から早めに離れるための備えです。'
  },
  wind: {
    id: 'wind',
    name: '台風・暴風',
    shortName: '暴風',
    icon: '風',
    description: '飛来物、窓ガラス、停電、屋外での転倒などへの備えです。'
  },
  fire: {
    id: 'fire',
    name: '火災・通電火災',
    shortName: '火災',
    icon: '火',
    description: '初期消火、避難、地震後の電気火災などへの備えです。'
  },
  lifeline: {
    id: 'lifeline',
    name: '停電・断水・生活継続',
    shortName: '生活継続',
    icon: '灯',
    description: '電気、水、ガス、通信が止まったときに生活を続けるための備えです。'
  },
  evacuation: {
    id: 'evacuation',
    name: '避難・孤立・連絡',
    shortName: '避難',
    icon: '道',
    description: '安全な移動、家族との連絡、道路寸断や孤立への備えです。'
  }
};

export const RISK_SECTIONS = [
  { id: 'area', name: '地域・地形', description: '自宅周辺の地形や、過去の災害を確認します。' },
  { id: 'home', name: '住まい', description: '建物と室内の条件を確認します。' },
  { id: 'people', name: '家族・支援', description: '避難や生活継続で必要になる支援を確認します。' },
  { id: 'lifeline', name: 'ライフライン', description: '停電・断水・通信障害の影響を確認します。' },
  { id: 'evacuation', name: '避難・連絡', description: '避難先、経路、家族の連絡方法を確認します。' }
];

export const RISK_QUESTIONS = [
  {
    id: 'flood-zone',
    section: 'area',
    title: '自宅は、洪水または内水氾濫の浸水想定区域に入っていますか。',
    help: '自治体のハザードマップで確認できます。内水氾濫は、短時間の大雨で道路や住宅地に水がたまる現象です。',
    effects: { yes: { flood: 5, lifeline: 1 }, no: {} },
    floors: { yes: { flood: 5 } },
    reasons: { yes: '自宅が浸水想定区域にあるため、早めの避難判断と上階への移動計画が重要です。' },
    recommendations: { yes: '洪水・内水氾濫に対応する避難先と、夜間でも通れる経路を確認する。', unknown: '自治体の洪水・内水ハザードマップで自宅周辺を確認する。', later: '洪水・内水ハザードマップを後で確認する。' }
  },
  {
    id: 'lowland-river',
    section: 'area',
    title: '自宅の近くに、大きな川、用水路、海、周囲より低い土地がありますか。',
    help: '距離だけで危険度は決まりません。浸水想定区域と避難経路をあわせて確認します。',
    effects: { yes: { flood: 3, tsunami: 1, evacuation: 1 }, no: {} },
    reasons: { yes: '水が集まりやすい場所や河川・海の近くでは、大雨や高潮時の移動経路に注意が必要です。' },
    recommendations: { yes: '大雨時に通らない場所と、浸水を避けられる経路を家族で決める。' }
  },
  {
    id: 'tsunami-zone',
    section: 'area',
    title: '自宅は、津波または高潮の浸水想定区域に入っていますか。',
    help: '海岸だけでなく、河口や川沿いを津波が遡上する場合があります。',
    effects: { yes: { tsunami: 6, evacuation: 2 }, no: {} },
    floors: { yes: { tsunami: 5 } },
    reasons: { yes: '津波・高潮の浸水想定区域では、迷わず高い場所へ移動できる準備が必要です。' },
    recommendations: { yes: '津波避難場所まで実際に歩き、所要時間と夜間の経路を確認する。', unknown: '自治体の津波・高潮ハザードマップで自宅周辺を確認する。', later: '津波・高潮ハザードマップを後で確認する。' }
  },
  {
    id: 'slope-zone',
    section: 'area',
    title: '自宅の近くに崖や急な斜面がある、または土砂災害警戒区域に入っていますか。',
    help: '斜面の上側でも下側でも影響を受ける場合があります。自治体の地図で確認してください。',
    effects: { yes: { landslide: 6, evacuation: 2 }, no: {} },
    floors: { yes: { landslide: 5 } },
    reasons: { yes: '崖や斜面の近くでは、雨が強くなる前に斜面から離れる判断が重要です。' },
    recommendations: { yes: '土砂災害に対応した避難先と、斜面から離れる経路を確認する。', unknown: '自治体の土砂災害ハザードマップで自宅周辺を確認する。', later: '土砂災害警戒区域を後で確認する。' }
  },
  {
    id: 'past-disaster',
    section: 'area',
    title: '自宅周辺で、過去に浸水、土砂災害、高潮、道路寸断などが起きたことがありますか。',
    help: '昔の災害記録、近隣の方の話、自治体の災害履歴も参考になります。',
    effects: { yes: { flood: 2, landslide: 2, tsunami: 1, evacuation: 2 }, no: {} },
    reasons: { yes: '周辺で過去に被害があったため、同じ経路や低い場所を避ける具体的な計画が役立ちます。' },
    recommendations: { yes: '過去に被害が出た場所と、そのとき使えなかった道路を地図に記録する。', unknown: '自治体の災害履歴や近隣の過去の被害を調べる。' }
  },
  {
    id: 'single-route',
    section: 'area',
    title: '自宅から出る道路が少ない、橋や踏切を必ず通るなど、経路が限られていますか。',
    help: '一本道、山間部、島、橋の多い地域、高架下や地下道を通る経路などを含みます。',
    effects: { yes: { evacuation: 5, lifeline: 2 }, no: {} },
    floors: { yes: { evacuation: 4 } },
    reasons: { yes: '道路寸断や渋滞で孤立する可能性があるため、複数の移動方法と在宅継続の準備が重要です。' },
    recommendations: { yes: '徒歩を含む第二の避難経路と、孤立した場合の連絡・備蓄計画を決める。' }
  },
  {
    id: 'old-building',
    section: 'home',
    title: '建物は1981年5月以前に建てられ、耐震診断や耐震改修をしていませんか。',
    help: '建築年だけで安全性は断定できません。不明な場合は、契約書類や管理会社で確認できます。',
    effects: { yes: { earthquake: 6 }, no: {} },
    floors: { yes: { earthquake: 5 } },
    reasons: { yes: '古い耐震基準の可能性があるため、専門家による耐震性の確認を優先したい条件です。' },
    recommendations: { yes: '自治体の耐震相談や専門家による耐震診断を確認する。', unknown: '建築年と耐震診断・改修の有無を確認する。', later: '建築年と耐震対策を後で確認する。' }
  },
  {
    id: 'wood-before-2000',
    section: 'home',
    title: '木造住宅で、2000年5月以前に建てられていますか。',
    help: '2000年には木造住宅の地盤、接合部、耐力壁配置に関する基準が明確化されました。建築年だけで危険とは断定しません。',
    effects: { yes: { earthquake: 3 }, no: {} },
    reasons: { yes: '木造住宅の接合部や壁配置を含め、耐震性を確認する価値があります。' },
    recommendations: { yes: '住宅の図面や耐震診断の記録を確認し、必要なら専門家へ相談する。' }
  },
  {
    id: 'furniture-fixed',
    section: 'home',
    title: '寝室や居間の背の高い家具、テレビ、冷蔵庫などを固定していますか。',
    help: '固定が難しい場合も、倒れる向きや寝る位置を変えるだけで被害を減らせることがあります。',
    effects: { yes: {}, no: { earthquake: 5 } },
    floors: { no: { earthquake: 4 } },
    reasons: { no: '強い揺れで家具や家電が倒れ、けがや避難経路の閉塞につながる可能性があります。' },
    recommendations: { no: '寝室と避難経路から優先して、家具固定または配置変更を行う。' },
    strengths: { yes: '主要な家具・家電の転倒対策ができています。' }
  },
  {
    id: 'glass-safety',
    section: 'home',
    title: '寝る場所や避難経路の近くで、窓ガラスや割れ物への対策をしていますか。',
    help: '飛散防止フィルム、厚手のカーテン、割れ物の配置変更、枕元の靴などが対策になります。',
    effects: { yes: {}, no: { earthquake: 2, wind: 2 } },
    reasons: { no: '割れたガラスがけがや避難の妨げになる可能性があります。' },
    recommendations: { no: '窓の飛散対策と、枕元に歩きやすい靴を置く。' },
    strengths: { yes: 'ガラス飛散と足元のけがへの対策ができています。' }
  },
  {
    id: 'fire-protection',
    section: 'home',
    title: '住宅用火災警報器を点検し、消火器や感震ブレーカーなどを検討していますか。',
    help: '設備の必要性は住宅によって異なります。まず警報器の作動確認と避難経路の確保を行います。',
    effects: { yes: {}, no: { fire: 4, earthquake: 1 } },
    floors: { no: { fire: 3 } },
    reasons: { no: '火災の早期発見と地震後の電気火災への備えに、確認できていない点があります。' },
    recommendations: { no: '火災警報器の作動を確認し、消火器と感震ブレーカーの必要性を調べる。' },
    strengths: { yes: '火災の早期発見や初期対応を意識した設備確認ができています。' }
  },
  {
    id: 'basement',
    section: 'home',
    title: '地下室、半地下、地下駐車場などを日常的に利用しますか。',
    help: '地下空間は短時間で浸水し、扉が開きにくくなる場合があります。',
    effects: { yes: { flood: 5, evacuation: 3 }, no: {} },
    floors: { yes: { flood: 4 } },
    reasons: { yes: '地下空間は浸水が始まってからの移動が難しくなるため、早期の退避が重要です。' },
    recommendations: { yes: '大雨時は地下へ入らず、地下から地上へ移動する基準を決める。' }
  },
  {
    id: 'high-rise',
    section: 'home',
    title: '6階以上の高層階に住む、または日常生活でエレベーターへの依存が大きいですか。',
    help: '高層住宅では、長周期地震動、エレベーター停止、断水、階段移動への備えが必要です。',
    effects: { yes: { lifeline: 4, evacuation: 2, earthquake: 1 }, no: {} },
    floors: { yes: { lifeline: 3 } },
    reasons: { yes: 'エレベーター停止や給水停止が生活に直結するため、在宅継続の準備が重要です。' },
    recommendations: { yes: '水・携帯トイレを多めに置き、階段で持ち運べる重量に分散して保管する。' }
  },
  {
    id: 'multiple-exits',
    section: 'home',
    title: '玄関以外の脱出方法や、家具でふさがれにくい避難経路を確認していますか。',
    help: '窓やベランダが常に安全な脱出経路とは限りません。建物の構造に合わせて確認します。',
    effects: { yes: {}, no: { earthquake: 2, fire: 3, evacuation: 2 } },
    reasons: { no: '玄関や廊下がふさがれた場合の代替手段が確認できていません。' },
    recommendations: { no: '寝室から屋外までの経路を歩き、倒れそうな物を移動する。' },
    strengths: { yes: '避難経路がふさがれた場合の代替手段を確認しています。' }
  },
  {
    id: 'mobility-support',
    section: 'people',
    title: '家族の中に、避難や階段移動に時間がかかる人、移動の支援が必要な人がいますか。',
    help: '高齢、けが、障害、妊娠、乳幼児の同伴などを含みます。個人名は入力しません。',
    effects: { yes: { evacuation: 5, lifeline: 2 }, no: {} },
    floors: { yes: { evacuation: 4 } },
    reasons: { yes: '移動に時間がかかる可能性があるため、一般より早い判断と支援者の確認が役立ちます。' },
    recommendations: { yes: '誰が、どの方法で、いつ支援するかを家族計画に記録する。' }
  },
  {
    id: 'medical-power',
    section: 'people',
    title: '電源が必要な医療機器、冷蔵保管が必要な薬、継続的な医療ケアがありますか。',
    help: '具体的な病名や薬名は入力不要です。緊急時の対応は、平常時に医療機関と相談してください。',
    effects: { yes: { lifeline: 7, evacuation: 2 }, no: {} },
    floors: { yes: { lifeline: 5 } },
    reasons: { yes: '停電や交通途絶が健康へ直接影響する可能性があるため、個別の電源・連絡計画が最優先です。' },
    recommendations: { yes: '医療機関や機器事業者と、停電時の電源・連絡先・避難方法を事前に確認する。' }
  },
  {
    id: 'regular-medication',
    section: 'people',
    title: '家族の中に、常用薬や日常的に必要な衛生・介護用品がある人がいますか。',
    help: '備蓄日数は自己判断で変更せず、医師・薬剤師などへ相談してください。',
    effects: { yes: { lifeline: 4, evacuation: 1 }, no: {} },
    floors: { yes: { lifeline: 3 } },
    reasons: { yes: '物流や通院が止まった場合に、薬や用品の不足が生活へ影響します。' },
    recommendations: { yes: '持出用と在宅用を分け、補充方法を医師・薬剤師・事業者へ相談する。' }
  },
  {
    id: 'infant-elderly',
    section: 'people',
    title: '乳幼児、高齢者、妊娠中の人、アレルギー対応が必要な人がいますか。',
    help: '一般的な配給だけでは合わない食品・用品や、温度管理が必要になる場合があります。',
    effects: { yes: { lifeline: 4, evacuation: 2 }, no: {} },
    floors: { yes: { lifeline: 3 } },
    reasons: { yes: '一般的な備蓄に加えて、個別の食品・衛生用品・温度管理が必要です。' },
    recommendations: { yes: '普段使っている食品と用品を、少し多めに回しながら保管する。' }
  },
  {
    id: 'pets',
    section: 'people',
    title: '一緒に避難または在宅避難するペットがいますか。',
    help: '避難所ごとに受入条件が異なるため、ケージやフードだけでなく避難先の確認も必要です。',
    effects: { yes: { evacuation: 3, lifeline: 2 }, no: {} },
    reasons: { yes: 'ペット用品と避難先の受入条件を事前に確認する必要があります。' },
    recommendations: { yes: '自治体の同行避難方針を確認し、ケージ・薬・フード・排泄用品をまとめる。' }
  },
  {
    id: 'family-separated',
    section: 'people',
    title: '昼間は家族が職場、学校、施設など別々の場所にいることが多いですか。',
    help: '通信が混雑した場合に備え、集合場所と連絡方法を複数決めます。',
    effects: { yes: { evacuation: 3 }, no: {} },
    reasons: { yes: '災害発生時に家族が別の場所にいる可能性が高く、連絡ルールが重要です。' },
    recommendations: { yes: '自宅へ戻らない場合を含め、第一・第二の集合場所と連絡手段を決める。' }
  },
  {
    id: 'all-electric',
    section: 'lifeline',
    title: '調理、給湯、暖房、移動など、停電すると使えないものが多いですか。',
    help: 'オール電化に限らず、エレベーター、電動シャッター、電気式給湯、介護機器なども含みます。',
    effects: { yes: { lifeline: 5 }, no: {} },
    floors: { yes: { lifeline: 4 } },
    reasons: { yes: '停電が調理・温度管理・移動へ広く影響するため、代替手段の準備が重要です。' },
    recommendations: { yes: '照明、充電、調理、暑さ・寒さへの代替手段を一つずつ用意する。' }
  },
  {
    id: 'toilet-plan',
    section: 'lifeline',
    title: '断水や排水設備の停止時に使える携帯トイレを用意していますか。',
    help: '水が出ても排水管が壊れている場合があります。安全確認前に流すと逆流することがあります。',
    effects: { yes: {}, no: { lifeline: 6 } },
    floors: { no: { lifeline: 5 } },
    reasons: { no: '断水時にすぐ困りやすいトイレの代替手段が不足しています。' },
    recommendations: { no: 'まず1人1日5回を目安に、3日分の携帯トイレから用意する。' },
    strengths: { yes: '断水時のトイレ手段を用意しています。' }
  },
  {
    id: 'information-methods',
    section: 'lifeline',
    title: 'スマートフォン以外にも、ラジオや自治体の情報手段を確認していますか。',
    help: '停電、通信混雑、端末故障を想定し、複数の情報経路を持つと安心です。',
    effects: { yes: {}, no: { lifeline: 2, evacuation: 3 } },
    reasons: { no: 'スマートフォンが使えない場合の情報手段が限られています。' },
    recommendations: { no: '電池式ラジオや自治体の防災情報の入手方法を確認する。' },
    strengths: { yes: '情報の入手手段を複数用意しています。' }
  },
  {
    id: 'heat-cold-plan',
    section: 'lifeline',
    title: '停電時の暑さ・寒さへの対策を、季節ごとに考えていますか。',
    help: '乳幼児、高齢者、持病がある人は特に早めの移動判断が必要になる場合があります。',
    effects: { yes: {}, no: { lifeline: 4 } },
    reasons: { no: '停電が長引いた場合の熱中症や低体温への対策が確認できていません。' },
    recommendations: { no: '季節ごとの避難先、保冷・保温用品、移動開始の目安を決める。' },
    strengths: { yes: '季節による停電時の影響を考えています。' }
  },
  {
    id: 'nearby-support',
    section: 'lifeline',
    title: '近所や建物内に、災害時に声を掛け合える人がいますか。',
    help: '個人情報を登録する必要はありません。顔を知っている、管理人へ相談できる程度でも役立ちます。',
    effects: { yes: {}, no: { evacuation: 2, lifeline: 2 } },
    reasons: { no: '孤立やけがの際に、近くで助けを求められる相手が未確認です。' },
    recommendations: { no: '管理人、近隣、自治会など、緊急時に声を掛けられる相手を一つ確認する。' },
    strengths: { yes: '近隣で声を掛け合える関係があります。' }
  },
  {
    id: 'hazard-specific-shelter',
    section: 'evacuation',
    title: '災害の種類ごとに、安全な避難先を確認していますか。',
    help: '地震、洪水、津波、土砂災害では、安全な場所が同じとは限りません。指定緊急避難場所と避難所の役割も異なります。',
    effects: { yes: {}, no: { evacuation: 6, flood: 1, tsunami: 1, landslide: 1 } },
    floors: { no: { evacuation: 5 } },
    reasons: { no: '災害の種類に合う避難先が未確認のため、発災時に迷う可能性があります。' },
    recommendations: { no: '自治体の情報で、地震・洪水・津波・土砂災害ごとの避難先を確認する。' },
    strengths: { yes: '災害の種類ごとに避難先を確認しています。' }
  },
  {
    id: 'walked-route',
    section: 'evacuation',
    title: '避難経路を昼と夜に歩き、危険な場所を確認したことがありますか。',
    help: 'ブロック塀、狭い道、川沿い、地下道、崖、街灯の少ない場所などを確認します。',
    effects: { yes: {}, no: { evacuation: 4 } },
    floors: { no: { evacuation: 3 } },
    reasons: { no: '暗い時間や道路障害を想定した経路確認ができていません。' },
    recommendations: { no: '無理のない日に、昼と夜の経路を一度ずつ歩く。' },
    strengths: { yes: '実際に避難経路を歩いて確認しています。' }
  },
  {
    id: 'family-contact',
    section: 'evacuation',
    title: '家族の集合場所と、電話がつながらないときの連絡方法を決めていますか。',
    help: '災害用伝言ダイヤル171、災害用伝言板、遠方の親族、SMSなど複数の方法を決めます。',
    effects: { yes: {}, no: { evacuation: 5 } },
    floors: { no: { evacuation: 4 } },
    reasons: { no: '通信混雑時に家族が別々に動いてしまう可能性があります。' },
    recommendations: { no: '第一・第二の集合場所と、171を含む連絡順を家族計画に記録する。' },
    strengths: { yes: '家族が連絡できない場合のルールを決めています。' }
  },
  {
    id: 'go-bag',
    section: 'evacuation',
    title: '非常持出品を、すぐ持てる重さと場所にまとめていますか。',
    help: '在宅備蓄のすべてを持つ必要はありません。薬、眼鏡、照明、充電、雨具などを優先します。',
    effects: { yes: {}, no: { evacuation: 3, lifeline: 1 } },
    reasons: { no: '急いで避難するときに必要品を探す時間がかかる可能性があります。' },
    recommendations: { no: '非常持出品を一か所にまとめ、実際に背負える重さか確認する。' },
    strengths: { yes: '非常持出品をすぐ持てる状態にしています。' }
  },
  {
    id: 'bedside-items',
    section: 'evacuation',
    title: '寝る場所の近くに、履物、照明、眼鏡などを置いていますか。',
    help: '夜間の地震では、割れた物や停電で移動しにくくなります。',
    effects: { yes: {}, no: { earthquake: 3, evacuation: 1 } },
    reasons: { no: '夜間の停電やガラス破損時に、最初の移動が難しくなる可能性があります。' },
    recommendations: { no: '枕元に底のしっかりした履物、ライト、必要な眼鏡を置く。' },
    strengths: { yes: '夜間に安全に動き始めるための物を用意しています。' }
  },
  {
    id: 'early-evacuation-rule',
    section: 'evacuation',
    title: '雨・風が強くなる前に移動する条件や、避難を始める人を決めていますか。',
    help: '支援が必要な人がいる家庭では、周囲より早く動き始める計画が役立ちます。',
    effects: { yes: {}, no: { flood: 2, landslide: 2, wind: 2, evacuation: 4 } },
    reasons: { no: '悪天候になってから判断すると、移動そのものが危険になる可能性があります。' },
    recommendations: { no: '誰が情報を確認し、どの段階で移動を始めるかを家族で決める。' },
    strengths: { yes: '悪天候になる前の避難判断を家族で決めています。' }
  }
];

export const ANSWER_OPTIONS = [
  { value: 'yes', label: 'はい' },
  { value: 'no', label: 'いいえ' },
  { value: 'unknown', label: 'わからない' },
  { value: 'later', label: 'あとで確認' }
];

export const STOCKPILE_FIELDS = [
  { id: 'waterLiters', label: '飲料水', unit: 'L', step: 0.5, essential: true, description: '飲用と最低限の調理用。生活用水は別に考えます。' },
  { id: 'foodServings', label: '主食・保存食', unit: '食', step: 1, essential: true, description: 'そのまま食べられる物と、加熱が必要な物を組み合わせます。' },
  { id: 'toiletUses', label: '携帯トイレ・簡易トイレ', unit: '回分', step: 1, essential: true, description: '便器へ袋を取り付け、凝固剤などで処理するタイプを含みます。' },
  { id: 'medicationDays', label: '常用薬・医療用品', unit: '日分', step: 1, conditional: 'regularMedication', description: '必要日数は医師・薬剤師などへ相談してください。' },
  { id: 'babySupplyDays', label: '乳幼児用の食品・おむつ等', unit: '日分', step: 1, conditional: 'infants', description: '普段使っている物をローリングストックします。' },
  { id: 'petSupplyDays', label: 'ペットフード・薬・排泄用品', unit: '日分', step: 1, conditional: 'pets', description: '避難先の受入条件とあわせて準備します。' },
  { id: 'lights', label: '懐中電灯・ランタン', unit: '個', step: 1, description: '手に持つ照明と、部屋を照らす照明を分けると便利です。' },
  { id: 'radios', label: '電池式・手回しラジオ', unit: '台', step: 1, description: 'スマートフォン以外の情報手段として確認します。' },
  { id: 'powerBankCharges', label: 'モバイル電源', unit: 'スマホ充電回分', step: 0.5, description: '容量表記ではなく、普段の端末を何回充電できるかで入力します。' },
  { id: 'helmets', label: 'ヘルメット・防災頭巾', unit: '個', step: 1, description: '家族がすぐ手に取れる場所に置きます。' },
  { id: 'gloves', label: '厚手の手袋', unit: '組', step: 1, description: '割れ物やがれきから手を守ります。' },
  { id: 'gasCanisters', label: 'カセットボンベ', unit: '本', step: 1, description: '消費量は器具・火力・気温で大きく変わるため、実際の使用時間も確認します。' },
  { id: 'waterContainers', label: '給水容器', unit: '個', step: 1, description: '持ち運べる重さに分けます。' },
  { id: 'firstAidKits', label: '救急用品セット', unit: '組', step: 1, description: '使い方を確認し、期限や不足品を点検します。' }
];

export const INVENTORY_CATEGORIES = [
  '水・飲料',
  '食品',
  '携帯トイレ・衛生',
  '薬・医療',
  '照明・電源・情報',
  '調理',
  '安全・避難',
  '乳幼児',
  '高齢者・介護',
  'ペット',
  'その他'
];

export const HOME_SAFETY_GROUPS = [
  {
    id: 'bedroom',
    name: '寝室・夜間',
    items: [
      { id: 'bed-furniture', label: '家具やテレビが、寝る場所へ倒れない配置または固定になっている。' },
      { id: 'bed-shoes', label: '枕元に底のしっかりした履物、ライト、眼鏡などがある。' },
      { id: 'bed-window', label: '窓や鏡の飛散対策、または寝る位置の見直しができている。' }
    ]
  },
  {
    id: 'living',
    name: '居間・キッチン',
    items: [
      { id: 'living-furniture', label: '背の高い家具、テレビ、冷蔵庫などを固定している。' },
      { id: 'cabinet-latch', label: '食器棚や吊り戸棚に、扉が開きにくい対策をしている。' },
      { id: 'fire-alarm', label: '住宅用火災警報器の作動を定期的に確認している。' },
      { id: 'extinguisher', label: '消火器の場所と使い方を確認している。' },
      { id: 'heat-appliance', label: '停電復旧時に危険となる暖房・調理器具を確認している。' }
    ]
  },
  {
    id: 'exit',
    name: '玄関・避難経路',
    items: [
      { id: 'exit-clear', label: '玄関、廊下、階段に避難を妨げる物を置いていない。' },
      { id: 'exit-furniture', label: '家具が倒れて玄関やドアをふさがない配置になっている。' },
      { id: 'night-route', label: '停電した状態でも避難経路をたどれる照明がある。' },
      { id: 'second-route', label: '玄関が使えない場合の行動を家族で確認している。' }
    ]
  },
  {
    id: 'weather',
    name: '大雨・台風',
    items: [
      { id: 'outdoor-items', label: '強風前に、ベランダや屋外の物を固定・収納できる。' },
      { id: 'drain', label: '側溝、排水口、ベランダの排水を定期的に確認している。' },
      { id: 'high-storage', label: '重要書類、電源、薬などを浸水しにくい高さへ置いている。' },
      { id: 'window-distance', label: '暴風時に窓から離れて過ごせる場所を決めている。' }
    ]
  },
  {
    id: 'utilities',
    name: '電気・水・ガス',
    items: [
      { id: 'breaker', label: '分電盤の場所と、避難時に安全に操作できる条件を確認している。' },
      { id: 'gas', label: 'ガス臭がするときに火や電気スイッチを使わないことを家族が知っている。' },
      { id: 'toilet', label: '排水設備の安全確認前は水洗トイレを流さない場合があると知っている。' },
      { id: 'generator', label: '発電機や炭を屋内・車庫・テント内で使わないと理解している。' }
    ]
  }
];

export const EMERGENCY_GUIDES = [
  {
    id: 'earthquake',
    name: '地震',
    symbol: '揺',
    summary: 'まず頭を守り、揺れが収まってから火・出口・津波を確認します。',
    immediate: [
      '丈夫な机の下などで頭と体を守る。机がなければ、落下物や倒れる物から離れて頭を守る。',
      'あわてて外へ飛び出さず、ガラス、棚、照明から離れる。',
      '揺れている最中に、無理に火を消しに行かない。',
      '海岸や河口付近で強い揺れ、または長く続く揺れを感じたら、警報を待たず高い場所へ向かう。'
    ],
    avoid: [
      'エレベーターを使う。',
      '割れ物のある床を裸足で歩く。',
      '安全を確認せず、ブレーカーやガス器具を操作する。'
    ],
    after: [
      '揺れが収まったら、けが、火災、出口を確認する。',
      '避難する場合は、可能で安全なら電気器具を切り、ブレーカーを落とす。',
      'ガス臭がするときは、火気や電気スイッチを使わず、窓を開けて事業者へ連絡する。',
      '公的機関の情報を確認し、余震で倒れそうな物へ近づかない。'
    ]
  },
  {
    id: 'tsunami',
    name: '津波',
    symbol: '波',
    summary: '海や川から離れ、より高い安全な場所へ、すぐに移動します。',
    immediate: [
      '強い揺れ、長く続く揺れ、津波警報などを知ったら、海岸や河口から直ちに離れる。',
      '高台または津波に対応した避難場所・避難ビルへ向かう。',
      '家族を待ったり、荷物を取りに戻ったりせず、まず自分が避難する。',
      '徒歩で避難できる地域では、渋滞を避けるため自治体の計画に従う。'
    ],
    avoid: [
      '海や川の様子を見に行く。',
      '一度波が引いたからといって戻る。',
      '警報・注意報が解除される前に低い場所へ戻る。'
    ],
    after: [
      '津波は繰り返し来るため、安全な場所にとどまる。',
      'ラジオや自治体など、信頼できる情報で解除を確認する。',
      '避難先で家族の連絡方法を使い、無理に迎えに行かない。'
    ]
  },
  {
    id: 'flood',
    name: '大雨・洪水',
    symbol: '水',
    summary: '暗くなる前、雨風が強くなる前に、危険な場所から離れます。',
    immediate: [
      '自治体や気象機関の情報を確認し、危険な場所にいる場合は早めに避難する。',
      '川、用水路、海岸、地下道、アンダーパス、地下室へ近づかない。',
      '浸水が始まり屋外移動がかえって危険な場合は、丈夫な建物の高い階など、より安全な場所へ移る。',
      '支援が必要な人がいる場合は、周囲より早く移動を始める。'
    ],
    avoid: [
      '水の深さを確かめるために歩く、車で進入する。',
      '川や側溝の様子を見に行く。',
      '地下空間や低い道路へ移動する。'
    ],
    after: [
      '冠水した場所は、ふたの外れた側溝や感電の危険があるため避ける。',
      '自宅へ戻る前に、自治体の情報と建物周辺の安全を確認する。',
      '浸水した食品や電気設備を、自己判断ですぐ使用しない。'
    ]
  },
  {
    id: 'landslide',
    name: '土砂災害',
    symbol: '山',
    summary: '雨が強くなる前に斜面から離れます。異変を見てからでは間に合わない場合があります。',
    immediate: [
      '土砂災害警戒区域や崖の近くにいる場合は、早めに斜面から離れた避難先へ移動する。',
      '移動が危険な場合は、建物の上階で、崖や沢と反対側の部屋へ移る。',
      '地鳴り、湧き水の変化、小石が落ちるなどの異変を感じたら、直ちに離れて通報する。'
    ],
    avoid: [
      '崖、沢、谷、山沿いの道路へ近づく。',
      '雨が弱くなっただけで、すぐ戻る。',
      '異変の撮影や確認のために斜面へ近づく。'
    ],
    after: [
      '斜面は再び崩れる可能性があるため、解除や安全確認まで近づかない。',
      '道路の土砂や倒木を自分だけで動かそうとしない。',
      '自治体・消防・警察の案内に従う。'
    ]
  },
  {
    id: 'wind',
    name: '台風・暴風',
    symbol: '風',
    summary: '風が強くなる前に屋内へ入り、窓と飛来物から離れます。',
    immediate: [
      '外出を控え、窓から離れた場所で過ごす。',
      '停電に備えて照明、充電、ラジオ、暑さ・寒さ対策を手元へ置く。',
      '避難が必要な地域では、風雨が強くなる前に移動する。'
    ],
    avoid: [
      '風が強くなってから屋根、雨戸、ベランダを直す。',
      '飛来物の多い窓際で過ごす。',
      '増水した川や海岸へ近づく。'
    ],
    after: [
      '切れた電線、倒木、壊れた看板へ近づかない。',
      '屋外を確認するときは、風が十分弱まり安全情報を確認してから行う。',
      '停電復旧後の電気器具と、雨漏りした場所の電気設備に注意する。'
    ]
  },
  {
    id: 'fire',
    name: '火災',
    symbol: '火',
    summary: '周囲へ知らせ、119番。初期消火に固執せず、煙を避けて逃げます。',
    immediate: [
      '大声や非常ベルで周囲へ知らせ、119番へ通報する。',
      '消火器などで安全に消せる小さな火だけを初期消火する。危険を感じたら直ちに避難する。',
      '煙の下を低い姿勢で進み、可能なら扉を閉めて延焼と煙を遅らせる。',
      '避難を最優先し、取り残された人の情報は消防へ伝える。'
    ],
    avoid: [
      '煙が充満した場所へ戻る。',
      'エレベーターを使う。',
      '一度避難した建物へ、物を取りに戻る。'
    ],
    after: [
      '安全な場所から、住所、燃えている場所、逃げ遅れの可能性を伝える。',
      '消防の許可なく建物へ戻らない。',
      'やけどや煙を吸った症状がある場合は、医療機関・救急へ相談する。'
    ]
  },
  {
    id: 'power',
    name: '停電',
    symbol: '灯',
    summary: '火災と一酸化炭素中毒を避け、照明・通信・温度管理を確保します。',
    immediate: [
      '懐中電灯やランタンを使い、ろうそくなど裸火はなるべく避ける。',
      '復旧時の火災を防ぐため、使用中だった電熱器具などのスイッチやプラグを確認する。',
      '医療機器が必要な場合は、事前計画に従い、緊急なら119番へ相談する。',
      '夏・冬は室温を確認し、危険になる前に安全な施設や場所へ移動する。'
    ],
    avoid: [
      '発電機、炭、練炭を屋内、車庫、テント内で使う。',
      'ガス臭や浸水がある場所で電気スイッチを操作する。',
      '冷蔵庫を何度も開ける。'
    ],
    after: [
      '地域全体か自宅だけかを、安全な範囲で確認する。',
      '浸水・焦げ臭さ・破損がある電気器具は使用しない。',
      '停電情報と復旧見込みを、電力会社や自治体の公式情報で確認する。'
    ]
  },
  {
    id: 'water',
    name: '断水',
    symbol: '滴',
    summary: '飲料水を守り、排水設備の安全が分かるまでトイレを流さない場合があります。',
    immediate: [
      '飲料水を用途別に分け、開封した物から計画的に使う。',
      '排水管や下水設備の安全が確認できない場合は、水洗トイレを流さず携帯トイレを使う。',
      '自治体の給水場所、容器、時間を確認する。',
      '手洗い、歯みがき、食品衛生に必要な水を優先する。'
    ],
    avoid: [
      '安全確認前に大量の水を排水する。',
      '飲用可否が不明な水をそのまま飲む。',
      '重すぎる容器を一人で運ぶ。'
    ],
    after: [
      '復旧直後は濁りや案内を確認し、自治体・水道事業者の指示に従う。',
      '使用した携帯トイレは、自治体の分別・回収方法に従う。',
      '不足した水、衛生用品、携帯トイレを補充する。'
    ]
  },
  {
    id: 'trapped',
    name: '閉じ込め・孤立',
    symbol: '助',
    summary: '呼吸を守り、音・光・通信で居場所を伝え、体力を温存します。',
    immediate: [
      'けがと周囲の倒壊・火災・ガス臭を確認し、むやみに動かない。',
      '電話やメッセージが使える場合は、119番または家族へ場所と状況を短く伝える。',
      '笛、物をたたく音、ライトなどで、間隔をあけて居場所を知らせる。',
      'ほこりがある場合は、布などで口と鼻を覆う。'
    ],
    avoid: [
      '火を使う。',
      '大声を出し続けて体力を消耗する。',
      '不安定ながれきや扉を無理に動かす。'
    ],
    after: [
      '救助者の声が聞こえたら、人数、けが、危険物の有無を伝える。',
      '孤立時は、水、薬、電池を計画的に使い、公式情報の受信を続ける。',
      '救助後は、症状が軽く見えても必要に応じて医療確認を受ける。'
    ]
  }
];

export const PREPAREDNESS_ARTICLES = [
  {
    id: 'first-10-minutes',
    category: '災害時',
    title: '最初の10分で優先すること',
    summary: '情報を集める前に、まず自分と周囲の命を守ります。',
    points: [
      '落下物、火、煙、水、斜面など、目の前の危険から離れる。',
      'けが人と出口を確認し、無理な救助はせず119番などへ知らせる。',
      '海岸・河口では、強いまたは長い揺れの後に直ちに高い場所へ移動する。',
      '不確かなSNS情報だけで動かず、自治体・気象機関・消防などの情報を確認する。'
    ]
  },
  {
    id: 'evacuation-types',
    category: '避難',
    title: '避難所へ行くことだけが避難ではありません',
    summary: '危険から離れる方法は、災害と現在地によって変わります。',
    points: [
      '安全な親族・知人宅、宿泊施設、指定された避難先へ早めに移動する方法があります。',
      '屋外移動が危険になった後は、丈夫な建物の高い階や斜面と反対側へ移る方が安全な場合があります。',
      '自宅が安全で生活を続けられる場合は、在宅避難も選択肢です。',
      '指定緊急避難場所は危険から逃れる場所、指定避難所は被災後に生活する場所で、役割が異なります。'
    ]
  },
  {
    id: 'rolling-stock',
    category: '備蓄',
    title: 'ローリングストックを続けるコツ',
    summary: '特別な非常食だけでなく、普段使う物を少し多めに持ちます。',
    points: [
      '食べ慣れた食品、飲料、衛生用品を少し多めに買い、古い物から使います。',
      '賞味期限だけでなく、加熱・水・食器が必要かも確認します。',
      '水、食品、携帯トイレ、薬は、他の用品で代えにくい重要項目です。',
      '一か所に集めず、寝室・玄関・車などへ目的別に分散する方法もあります。'
    ]
  },
  {
    id: 'family-contact',
    category: '家族',
    title: '連絡が取れない前提で決める',
    summary: '電話がつながらなくても、家族が同じ判断をできるようにします。',
    points: [
      '第一・第二の集合場所を決めます。危険区域内の場所は避けます。',
      '災害用伝言ダイヤル171、携帯電話会社の災害用伝言板、SMSなどを確認します。',
      '学校・施設・職場の引渡しや待機方針を確認します。',
      '迎えに行く人、支援が必要な人、ペットの担当を事前に決めます。'
    ]
  },
  {
    id: 'information-literacy',
    category: '情報',
    title: '災害情報の確かめ方',
    summary: '速さだけでなく、発信元と時刻を確認します。',
    points: [
      '自治体、気象庁、消防、警察、ライフライン事業者などの公式情報を優先します。',
      '画像や投稿が、別の地域・別の日付ではないか確認します。',
      '「拡散希望」だけを理由に共有せず、元の発表を確認します。',
      '古い避難情報や警報を現在の情報として使わないよう、発表時刻を見ます。'
    ]
  },
  {
    id: 'sanitation',
    category: '生活継続',
    title: '断水時はトイレと衛生を先に考える',
    summary: '飲料水だけでなく、排泄と手指衛生が生活継続を左右します。',
    points: [
      '排水設備の安全が分からないときは、水が出てもトイレを流さない場合があります。',
      '携帯トイレは1人1日5回を基本目安に、まず3日分、できれば7日分を確認します。',
      '手指衛生、歯みがき、食品の取り扱いに使う水や用品を分けます。',
      '使用済み携帯トイレの保管袋と、自治体の廃棄方法も確認します。'
    ]
  }
];

export const OFFICIAL_SOURCES = [
  {
    id: 'cabinet-stockpile',
    organization: '内閣府 防災情報のページ',
    title: 'できることから始めよう！防災対策 第3回 備蓄品を備える',
    url: 'https://www.bousai.go.jp/kohou/kouhoubousai/h28/83/special_03.html',
    usedFor: '飲料水1人1日3L、食料最低3日分、できれば1週間分という備蓄の基本目安',
    checkedAt: '2026-07-31'
  },
  {
    id: 'cabinet-toilet',
    organization: '内閣府 防災情報のページ',
    title: '災害時のトイレ、備えていますか？',
    url: 'https://www.bousai.go.jp/kohou/kouhoubousai/r06/111/news_08.html',
    usedFor: '携帯トイレ1人1日5回、1週間35回分という備蓄目安',
    checkedAt: '2026-07-31'
  },
  {
    id: 'jma-earthquake',
    organization: '気象庁',
    title: '地震から身を守るために',
    url: 'https://www.jma.go.jp/jma/kishou/know/jishin/jishin_bosai/index.html',
    usedFor: '地震時の安全確保と、津波からの避難に関する行動ガイド',
    checkedAt: '2026-07-31'
  },
  {
    id: 'jma-rain',
    organization: '気象庁',
    title: '大雨・台風では、どのような災害が起こるのか',
    url: 'https://www.jma.go.jp/jma/kishou/know/ame_chuui/ame_chuui_p10.html',
    usedFor: '大雨、洪水、土砂災害、暴風時の行動ガイド',
    checkedAt: '2026-07-31'
  },
  {
    id: 'fdma-119',
    organization: '総務省消防庁',
    title: '119番緊急通報',
    url: 'https://www.fdma.go.jp/mission/enrichment/appropriate/appropriate007.html',
    usedFor: '火災・救急・救助を求める119番の案内',
    checkedAt: '2026-07-31'
  },
  {
    id: 'npa-110',
    organization: '警察庁',
    title: '110番の適切な利用',
    url: 'https://www.npa.go.jp/bureau/safetylife/110ban/index.html',
    usedFor: '事件・事故など緊急時の110番の案内',
    checkedAt: '2026-07-31'
  },
  {
    id: 'ntt-171',
    organization: 'NTT東日本・NTT西日本',
    title: '災害用伝言ダイヤル（171）',
    url: 'https://www.ntt-east.co.jp/saigai/voice171/',
    usedFor: '電話がつながりにくい災害時の伝言サービス',
    checkedAt: '2026-07-31'
  },
  {
    id: 'mlit-seismic',
    organization: '国土交通省',
    title: '住宅・建築物の耐震化について',
    url: 'https://www.mlit.go.jp/jutakukentiku/house/jutakukentiku_house_fr_000043.html',
    usedFor: '1981年以前の旧耐震基準と住宅の耐震確認に関する案内',
    checkedAt: '2026-07-31'
  },
  {
    id: 'gsi-shelter',
    organization: '国土地理院',
    title: '指定緊急避難場所データ',
    url: 'https://www.gsi.go.jp/bousaichiri/hinanbasho.html',
    usedFor: '災害種別ごとに指定される緊急避難場所と避難所の区別',
    checkedAt: '2026-07-31'
  }
];
