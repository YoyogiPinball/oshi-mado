// 監視チャンネルの最近の投稿を、日毎ダイジェストとして並べる。
//
// 時刻の基準 =「本体が視聴可能になった時刻」（GAS版 digest.gs の classifyVideo_ と同じ規則）:
//   動画・Shorts … 公開時刻(publishedAt)
//   配信中・アーカイブ … 配信開始時刻(actualStartTime)
//   配信予定・プレミア … 開始予定時刻(scheduledStartTime)
//
// データ源は2つに分けている:
//   新着の発見 … 各チャンネルの公開RSS（クォータ消費なし）
//   種類判定と配信時刻 … YouTube Data API v3 の videos.list（50件で1ユニット）
// RSS には配信中/予定/尺の情報が無く、published は「枠を立てた時刻」でしかないため後者が要る。
// APIキーが無ければ RSS だけで動き、配信も公開時刻のまま・種類判定なしに落ちる（degraded）。

const DAYS = 7;
const RSS_LIMIT = 8;            // RSS の同時取得数
const API_LIMIT = 3;            // videos.list の同時実行数
const API_BATCH = 50;           // videos.list は1回50件まで（＝1ユニット）
const SHORTS_MAX_SECONDS = 60;  // RSS で Shorts と分からなかったときの保険（尺による近似）
const CACHE_KEY = 'videoCache';
const CACHE_MAX = 2000;

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const p2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} (${WD[d.getDay()]})`;
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 種類別タブ（GAS版 digest.gs と同じ構成）。動画タブは Shorts 込み、全部タブは公開済み全種。
// 予定は未来の話なので「全部」には混ぜず、独立したタブに隔離する。
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '動画' },
  { key: 'live', label: '配信中' },
  { key: 'archive', label: 'アーカイブ' },
  { key: 'upcoming', label: '予定' }
];
let BUCKETS = { all: [], video: [], live: [], archive: [], upcoming: [] };
let ACTIVE = 'all';
let OPEN_IN_APP = false;  // ⚙の設定。ON ならカードを chrome.tabs.create で開く（下のクリック委譲）

// 同時実行数を limit 本に抑えて配列を写像する。全件を一斉 fetch しないための歯止め。
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < arr.length) {
      const i = cursor++;
      out[i] = await fn(arr[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return out;
}

/* ===== 新着の発見（RSS） ===== */

// 1チャンネルの RSS を取得して投稿配列に変換する。link が /shorts/ なら Shorts と確定できる。
async function fetchChannel(id) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const channel = xml.getElementsByTagName('title')[0]?.textContent || id; // 先頭 title = チャンネル名
  const out = [];
  for (const e of xml.getElementsByTagName('entry')) {
    const vid = (e.getElementsByTagName('yt:videoId')[0] || e.getElementsByTagName('videoId')[0])?.textContent;
    const title = e.getElementsByTagName('title')[0]?.textContent || '';
    const pub = e.getElementsByTagName('published')[0]?.textContent;
    const href = e.getElementsByTagName('link')[0]?.getAttribute('href') || '';
    if (!vid || !pub) continue;
    out.push({ videoId: vid, title, channel, published: new Date(pub), isShort: href.includes('/shorts/') });
  }
  return out;
}

/* ===== 種類判定（YouTube Data API v3） ===== */

// videos.list を1回叩く。id は最大50件で、何件渡しても消費は1ユニット。
async function fetchVideoDetails(ids, apiKey) {
  const url = 'https://www.googleapis.com/youtube/v3/videos'
    + '?part=snippet,contentDetails,liveStreamingDetails&maxResults=50'
    + '&id=' + ids.join(',')
    + '&key=' + encodeURIComponent(apiKey);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error || {};
    const reason = (err.errors && err.errors[0] && err.errors[0].reason) || '';
    throw new Error(`HTTP ${res.status}${reason ? ` (${reason})` : ''}: ${err.message || ''}`);
  }
  return body.items || [];
}

// ISO8601 duration（例 "PT1H2M3S"）を秒に変換する。
function parseDurationSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// 1本を種類判定する。GAS版 digest.gs の classifyVideo_ と同じ規則。
// 戻り値: { type:'video'|'short'|'live'|'archive'|'upcoming', time:Date }
function classify(v, item) {
  const sn = (v && v.snippet) || {};
  const live = (v && v.liveStreamingDetails) || null;
  const broadcast = sn.liveBroadcastContent || 'none';
  const published = sn.publishedAt ? new Date(sn.publishedAt) : item.published;

  // 未開始の配信予定・プレミア
  if (broadcast === 'upcoming' || (live && live.scheduledStartTime && !live.actualStartTime)) {
    const t = (live && live.scheduledStartTime) ? new Date(live.scheduledStartTime) : published;
    return { type: 'upcoming', time: t };
  }
  // 配信中
  if (broadcast === 'live' || (live && live.actualStartTime && !live.actualEndTime)) {
    const t = (live && live.actualStartTime) ? new Date(live.actualStartTime) : published;
    return { type: 'live', time: t };
  }
  // アーカイブ（配信終了）— 視聴可能になったのは配信開始時
  if (live && live.actualEndTime) {
    const t = live.actualStartTime ? new Date(live.actualStartTime) : published;
    return { type: 'archive', time: t };
  }
  // 通常アップロード。RSS の /shorts/ リンクが最も確実で、尺60秒はその取りこぼしの保険。
  if (item.isShort) return { type: 'short', time: published };
  const dur = parseDurationSeconds((v && v.contentDetails && v.contentDetails.duration) || 'PT0S');
  if (dur > 0 && dur <= SHORTS_MAX_SECONDS) return { type: 'short', time: published };
  return { type: 'video', time: published };
}

/* ===== 判定結果のキャッシュ =====
 * 動画・アーカイブは種類が二度と変わらないので使い回す。
 * 配信中・予定は状態が変わる途中なので毎回引き直す。Shorts は RSS だけで分かるので入れない。 */
const TERMINAL = { video: true, archive: true };

async function readCache() {
  const { [CACHE_KEY]: c = {} } = await chrome.storage.local.get(CACHE_KEY);
  return c;
}

async function writeCache(cache) {
  const ids = Object.keys(cache);
  if (ids.length > CACHE_MAX) {
    ids.sort((a, b) => (cache[b].at || 0) - (cache[a].at || 0))
      .slice(CACHE_MAX)
      .forEach((id) => delete cache[id]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

/* ===== 組み立て ===== */

// RSS の項目に種類と時刻を与える。APIを使うのは「Shorts でなく、キャッシュにも無い」ものだけ。
async function resolveAll(raw, apiKey, cache, onProgress) {
  const resolved = new Array(raw.length);
  const needApi = [];

  raw.forEach((item, i) => {
    if (item.isShort) { resolved[i] = { ...item, type: 'short', time: item.published }; return; }
    const hit = cache[item.videoId];
    if (hit && TERMINAL[hit.type]) { resolved[i] = { ...item, type: hit.type, time: new Date(hit.time) }; return; }
    needApi.push(i);
  });

  if (!needApi.length) return { resolved, units: 0, error: null };

  // キーが無ければ判定できない。RSS で分かる範囲（＝通常動画・公開時刻）に落とす。
  if (!apiKey) {
    needApi.forEach((i) => { resolved[i] = { ...raw[i], type: 'video', time: raw[i].published, degraded: true }; });
    return { resolved, units: 0, error: 'nokey' };
  }

  const batches = [];
  for (let i = 0; i < needApi.length; i += API_BATCH) batches.push(needApi.slice(i, i + API_BATCH));

  let apiError = null;
  let done = 0;
  await mapLimit(batches, API_LIMIT, async (idx) => {
    let items = [];
    try {
      items = await fetchVideoDetails(idx.map((i) => raw[i].videoId), apiKey);
    } catch (e) {
      apiError = apiError || e.message;
    }
    const byId = {};
    items.forEach((v) => { byId[v.id] = v; });
    idx.forEach((i) => {
      const v = byId[raw[i].videoId];
      // API が返さなかった＝削除済み・非公開など。RSS の情報だけで置く。
      if (!v) { resolved[i] = { ...raw[i], type: 'video', time: raw[i].published, degraded: true }; return; }
      resolved[i] = { ...raw[i], ...classify(v, raw[i]), title: (v.snippet && v.snippet.title) || raw[i].title };
    });
    done += idx.length;
    if (onProgress) onProgress(done, needApi.length);
  });

  resolved.forEach((r) => {
    if (r && TERMINAL[r.type] && !r.degraded) cache[r.videoId] = { type: r.type, time: r.time.toISOString(), at: Date.now() };
  });

  return { resolved, units: batches.length, error: apiError };
}

async function load() {
  const app = document.getElementById('app');
  const meta = document.getElementById('meta');
  const { channels = [], apiKey = '', openInApp = false } = await chrome.storage.sync.get(['channels', 'apiKey', 'openInApp']);
  OPEN_IN_APP = openInApp;
  if (!channels.length) {
    app.innerHTML = '<p class="empty">推しがまだ登録されていません。<br>右上の ⚙ から追加してください。</p>';
    meta.textContent = '';
    return;
  }

  const t0 = performance.now();
  const cutoff = Date.now() - DAYS * 86400000;

  // 1) RSS で新着を集める（published での粗い足切り。配信は後で開始時刻に直す）
  app.innerHTML = `<p class="empty">チャンネルを確認中… 0 / ${channels.length}</p>`;
  const raw = [];
  let ok = 0, ng = 0, seen = 0;
  await mapLimit(channels, RSS_LIMIT, async (ch) => {
    try {
      (await fetchChannel(ch.id)).forEach((it) => { if (it.published.getTime() >= cutoff) raw.push(it); });
      ok++;
    } catch (e) { ng++; }
    app.innerHTML = `<p class="empty">チャンネルを確認中… ${++seen} / ${channels.length}</p>`;
  });

  // 2) 種類と「視聴可能になった時刻」を決める
  const cache = await readCache();
  const { resolved, units, error } = await resolveAll(raw, apiKey, cache, (d, n) => {
    app.innerHTML = `<p class="empty">動画の情報を取得中… ${d} / ${n}</p>`;
  });
  await writeCache(cache);

  // 3) 種類ごとに仕分ける。公開済みは新しい順・直近N日。
  //    予定だけは未来なので日付で絞らず、開始が早い順（次に何が来るかを見たいため）。
  const byTimeDesc = (a, b) => b.time - a.time;
  const pub = resolved.filter((i) => i.type !== 'upcoming' && i.time.getTime() >= cutoff);
  BUCKETS = {
    all: pub.slice().sort(byTimeDesc),
    video: pub.filter((i) => i.type === 'video' || i.type === 'short').sort(byTimeDesc),
    live: pub.filter((i) => i.type === 'live').sort(byTimeDesc),
    archive: pub.filter((i) => i.type === 'archive').sort(byTimeDesc),
    upcoming: resolved.filter((i) => i.type === 'upcoming').sort((a, b) => a.time - b.time)
  };

  buildChannelFilter(resolved);
  renderTabs();
  render();

  const counts = {};
  resolved.forEach((r) => { counts[r.type] = (counts[r.type] || 0) + 1; });
  console.log('[oshi-mado] %s秒 / %sch(失敗%s) / %s件 / APIユニット %s / 内訳 %o',
    ((performance.now() - t0) / 1000).toFixed(1), ok, ng, resolved.length, units, counts);

  let note = '';
  if (error === 'nokey') note = '（⚙でAPIキーを設定すると配信を判定します）';
  else if (error) note = `（API失敗: ${error}）`;
  // 種類ごとの件数はタブ側が出すので、ここは全体像だけ
  meta.textContent = `${ok}ch / ${BUCKETS.all.length}件 / 直近${DAYS}日`
    + (ng ? `（取得失敗${ng}ch）` : '') + note;
}

// タブの件数は「チャンネル絞り込みを適用したあと」の数を出す。
// 表示は0件なのにタブに件数が残っていると、どこを見ればいいのか分からなくなるため。
function itemsFor(key) {
  const chFilter = document.getElementById('f-ch').value;
  const items = BUCKETS[key] || [];
  return chFilter ? items.filter((i) => i.channel === chFilter) : items;
}

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map((t) =>
    `<button class="tab${t.key === ACTIVE ? ' active' : ''}" data-tab="${t.key}">` +
    `${esc(t.label)} <span class="cnt">${itemsFor(t.key).length}</span></button>`
  ).join('');
}

function badgeFor(it) {
  if (it.type === 'live') return '<span class="badge live">🔴 配信中</span>';
  if (it.type === 'upcoming') return `<span class="badge up">予定 ${it.time.getMonth() + 1}/${it.time.getDate()} ${hhmm(it.time)}</span>`;
  if (it.type === 'archive') return '<span class="badge arc">アーカイブ</span>';
  if (it.type === 'short') return '<span class="badge sh">Shorts</span>';
  return '';
}

function render() {
  const app = document.getElementById('app');
  const view = itemsFor(ACTIVE);
  if (!view.length) { app.innerHTML = '<p class="empty">該当なし</p>'; return; }

  const groups = {};
  const order = [];
  view.forEach((it) => {
    const k = dateKey(it.time);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(it);
  });

  let html = '';
  order.forEach((k) => {
    html += `<section class="day"><h2>${esc(k)}</h2><div class="grid">`;
    groups[k].forEach((it) => {
      const link = `https://www.youtube.com/watch?v=${it.videoId}`;
      const thumb = `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`;
      const badge = badgeFor(it);
      html += `<a class="card" href="${link}" target="_blank" rel="noopener">` +
        `<div class="thumb"><img loading="lazy" src="${thumb}" alt="">` +
        (badge ? `<div class="badges">${badge}</div>` : '') + '</div>' +
        `<div class="info"><div class="ch">${esc(it.channel)}</div>` +
        `<div class="vtitle">${esc(it.title)}</div>` +
        `<div class="time">${hhmm(it.time)}</div></div></a>`;
    });
    html += '</div></section>';
  });
  app.innerHTML = html;
}

function buildChannelFilter(items) {
  const sel = document.getElementById('f-ch');
  const names = [...new Set(items.map((i) => i.channel))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">全ch</option>' + names.map((n) => `<option>${esc(n)}</option>`).join('');
  sel.value = cur;
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('opt').addEventListener('click', () => chrome.runtime.openOptionsPage());

// 「タブで開く」= 推し窓本体（このダイジェスト画面）を、小さいポップアップではなく
// ブラウザの通常タブで開く。同じ popup.html を ?view=tab 付きで開き、タブ側では横幅の
// 制限を外して（下の tabview 判定）広い画面でカードを並べられるようにする。
document.getElementById('openTabs').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
});

// 「動画をアプリで開く」がONのとき、カードの左クリックを横取りする。
// 既定の <a target="_blank"> は「補助ブラウジングコンテキスト」扱いで、Chrome のリンク
// キャプチャ（インストール済みアプリで対応リンクを開く仕組み）の対象外＝必ずブラウザに開く。
// 代わりに opener を持たない新規タブ（chrome.tabs.create）で開くとキャプチャの土俵に乗り、
// YouTube をアプリとしてインストール＋「対応リンクをアプリで開く」を有効にしていればアプリで開く。
// Ctrl/⌘/中クリック等の修飾クリック（バックグラウンドで開く操作）は横取りせず従来どおり。
document.getElementById('app').addEventListener('click', (e) => {
  if (!OPEN_IN_APP) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const card = e.target.closest('a.card');
  if (!card) return;
  e.preventDefault();
  chrome.tabs.create({ url: card.href });
});

// チャンネルを絞ると各タブの件数も変わるので、タブ側も描き直す。
document.getElementById('f-ch').addEventListener('change', () => { renderTabs(); render(); });

// タブは中身ごと作り直すため、個々のボタンではなく親で受ける（委譲）。
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  ACTIVE = btn.dataset.tab;
  renderTabs();
  render();
});

// ?view=tab で開かれたときは通常タブ表示。横幅制限を外し（tabview）、自分自身を開く
// 「タブで開く」ボタンは不要なので消す。
if (new URLSearchParams(location.search).get('view') === 'tab') {
  document.body.classList.add('tabview');
  document.getElementById('openTabs')?.remove();
}

load();
