import process from 'node:process';

const links = [
  ['警察相談 #9110', 'https://www.npa.go.jp/goiken_notes.html'],
  ['警察庁 SOS47', 'https://www.npa.go.jp/bureau/safetylife/sos47/'],
  ['消防庁 #7119', 'https://www.fdma.go.jp/mission/enrichment/appropriate/appropriate007.html'],
  ['こどもの救急 #8000', 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/newpage_55223.html'],
  ['海上保安庁 118', 'https://www.kaiho.mlit.go.jp/info/kouhou/post-1274.html'],
  ['道路緊急ダイヤル #9910', 'https://www.mlit.go.jp/road/dia/'],
  ['災害用伝言ダイヤル 171', 'https://www.ntt-east.co.jp/saigai/voice171/'],
  ['J-SHIS', 'https://www.j-shis.bosai.go.jp/'],
  ['ハザードマップポータル', 'https://disaportal.gsi.go.jp/'],
  ['気象庁 防災情報', 'https://www.jma.go.jp/bosai/']
];

async function checkLink(label, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'user-agent': 'EpsilonLab-MamoreruInochi-LinkCheck/0.3.0' }
    });
    return { label, url, status: response.status, finalUrl: response.url, hardFailure: [404, 410].includes(response.status) };
  } catch (error) {
    return { label, url, status: null, warning: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error), hardFailure: false };
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const [label, url] of links) results.push(await checkLink(label, url));
for (const item of results) {
  if (item.status) console.log(`${item.hardFailure ? 'ERROR' : 'OK'} ${item.status} ${item.label}: ${item.finalUrl || item.url}`);
  else console.warn(`WARN ${item.label}: ${item.warning}`);
}
const dead = results.filter((item) => item.hardFailure);
if (dead.length) {
  console.error(`\n${dead.length}件の公的リンクが404または410を返しました。`);
  process.exit(1);
}
console.log('\n404・410のリンクは確認されませんでした。通信エラーは警告として扱います。');
