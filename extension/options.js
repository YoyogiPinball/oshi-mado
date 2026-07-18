// 推しリストの編集（アイコン＋名前の一覧・追加・削除）と APIキーの保存。
// 「外す」は「保存」を押すまで確定しない: 行に del フラグを立てるだけで、storage には
// 保存ボタンを押したときにまとめて書き込む。押す前なら「戻す」で del を外して元に戻せる。
const ta = document.getElementById('addbox');
const statusEl = document.getElementById('status');
const addStatusEl = document.getElementById('addStatus');
const listEl = document.getElementById('chlist');
const keyEl = document.getElementById('apikey');
const keyStatusEl = document.getElementById('keyStatus');
const openInAppEl = document.getElementById('openInApp');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 画面が握っている作業用の推しリスト。storage の中身とは独立していて、
// 保存を押して初めて storage.sync.channels（[{id}] の配列）へ反映する。
// row = { id, title, thumb, del, isNew }
let working = [];

/* ===== 同時実行数を絞るヘルパー ===== */
async function mapLimit(arr, limit, fn) {
  let cursor = 0;
  const worker = async () => { while (cursor < arr.length) { const i = cursor++; await fn(arr[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

/* ===== APIキー ===== */

// キーが実際に使えるか videos.list を1回だけ叩いて確かめる（消費1ユニット）。
// 保存しただけでは通らないキー（APIが有効化されていない・制限がきつい）をここで弾く。
async function testApiKey(key) {
  const url = 'https://www.googleapis.com/youtube/v3/videos'
    + '?part=snippet&id=jNQXAC9IVRw&key=' + encodeURIComponent(key);
  let res, body;
  try {
    res = await fetch(url);
    body = await res.json();
  } catch (e) {
    return { ok: false, msg: `通信に失敗しました（${e.message}）` };
  }
  if (res.ok) {
    if (!body.items || !body.items.length) return { ok: false, msg: '応答は返りましたが中身が空でした' };
    return { ok: true, msg: `OK（テスト取得: ${body.items[0].snippet.title}）` };
  }
  const err = (body && body.error) || {};
  const reason = (err.errors && err.errors[0] && err.errors[0].reason) || '';
  const hint = {
    badRequest: 'キーをコピーし損ねていないか確認してください。',
    ipRefererBlocked: 'キーの「アプリケーションの制限」を「なし」にしてください（拡張機能にはリファラー制限が効きません）。',
    accessNotConfigured: 'そのプロジェクトで YouTube Data API v3 を有効化してください。',
    forbidden: 'キーの制限設定を確認してください。',
    quotaExceeded: '本日のクォータを使い切っています。日付が変わるまで待つと戻ります。'
  }[reason];
  const msg = err.message || '(説明なし)';
  return { ok: false, msg: `HTTP ${res.status} — ${msg}${hint ? ` ／ ${hint}` : ''}` };
}

/* ===== 動画の開き方（アプリで開くトグル）===== */

// チェックした瞬間に storage.sync へ書く（保存ボタン不要の即時反映）。popup 側は次回の
// 読み込みで openInApp を読み、ON ならカードのクリックを chrome.tabs.create に切り替える。
openInAppEl.addEventListener('change', async () => {
  await chrome.storage.sync.set({ openInApp: openInAppEl.checked });
});

document.getElementById('toggleKey').addEventListener('click', () => {
  keyEl.type = keyEl.type === 'password' ? 'text' : 'password';
});

document.getElementById('saveKey').addEventListener('click', async () => {
  const key = keyEl.value.trim();
  if (!key) {
    await chrome.storage.sync.remove('apiKey');
    keyStatusEl.textContent = 'キーを削除しました（配信の判定は無効になります）';
    return;
  }
  keyStatusEl.textContent = 'テスト中…';
  const r = await testApiKey(key);
  if (r.ok) {
    await chrome.storage.sync.set({ apiKey: key });
    keyStatusEl.textContent = '保存しました — ' + r.msg;
  } else {
    keyStatusEl.textContent = '保存しませんでした — ' + r.msg;
  }
});

/* ===== チャンネルのメタ情報（アイコン＋名前）===== */

// APIキーがあれば channels.list で名前とアイコンをまとめて取る（id 50件で1ユニット）。
// 「このIDは誰か」を聞くだけなので公開情報＝APIキーで足りる（登録一覧の取得だけが OAuth 必須）。
async function fetchMetaViaApi(ids, apiKey) {
  const map = {};
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  await mapLimit(batches, 3, async (batch) => {
    const url = 'https://www.googleapis.com/youtube/v3/channels'
      + '?part=snippet&maxResults=50&id=' + batch.join(',') + '&key=' + encodeURIComponent(apiKey);
    try {
      const res = await fetch(url);
      const body = await res.json();
      (body.items || []).forEach((c) => {
        const sn = c.snippet || {};
        const th = (sn.thumbnails && (sn.thumbnails.default || sn.thumbnails.medium)) || {};
        map[c.id] = { title: sn.title || c.id, thumb: th.url || '' };
      });
    } catch (e) { /* このバッチは名前だけ諦めて ID 表示に落とす */ }
  });
  return map;
}

// キーが無いとき用。RSS の先頭 title がチャンネル名なので、名前だけ拾う（アイコンは出せない）。
async function fetchTitleViaRss(id) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);
    if (!res.ok) return '';
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    return xml.getElementsByTagName('title')[0]?.textContent || '';
  } catch (e) { return ''; }
}

async function loadMeta(ids) {
  if (!ids.length) return {};
  const { apiKey = '' } = await chrome.storage.sync.get('apiKey');
  if (apiKey) return fetchMetaViaApi(ids, apiKey);
  const map = {};
  await mapLimit(ids, 6, async (id) => { map[id] = { title: await fetchTitleViaRss(id) || id, thumb: '' }; });
  return map;
}

// working の各行に取得した名前・アイコンを流し込む。
function applyMeta(map) {
  working.forEach((w) => {
    const m = map[w.id];
    if (m) { if (m.title) w.title = m.title; if (m.thumb) w.thumb = m.thumb; }
  });
}

/* ===== 描画 ===== */

function renderList() {
  if (!working.length) {
    listEl.innerHTML = '<p class="meta">まだ登録がありません。下の欄から推しを追加してください。</p>';
    return;
  }
  listEl.innerHTML = working.map((w) => {
    const ico = w.thumb
      ? `<img class="ch-ico" src="${esc(w.thumb)}" alt="">`
      : `<span class="ch-ico ph">${esc((w.title || w.id).slice(0, 1))}</span>`;
    return `<div class="ch-row${w.del ? ' del' : ''}${w.isNew ? ' new' : ''}" data-id="${esc(w.id)}">`
      + ico
      + `<div class="ch-meta"><div class="ch-name">${esc(w.title || w.id)}`
      + (w.isNew ? ' <span class="tag-new">新規</span>' : '') + '</div>'
      + `<div class="ch-id">${esc(w.id)}</div></div>`
      + `<button class="ch-del" type="button" data-id="${esc(w.id)}">${w.del ? '戻す' : '外す'}</button>`
      + '</div>';
  }).join('');
}

/* ===== 追加 ===== */

// 行からチャンネルID（UC…）を取り出す。無ければ URL/ハンドルとしてページを取得して抽出。
async function resolve(line) {
  const s = line.trim();
  if (!s) return null;
  const direct = s.match(/(UC[\w-]{22})/);
  if (direct) return direct[1];
  let url = s;
  if (/^@/.test(url)) url = 'https://www.youtube.com/' + url;
  else if (!/^https?:\/\//.test(url)) url = 'https://www.youtube.com/' + url.replace(/^\//, '');
  try {
    const html = await (await fetch(url)).text();
    const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

document.getElementById('add').addEventListener('click', async () => {
  const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return;
  addStatusEl.textContent = '解決中…';
  const failed = [];
  const added = [];
  const known = new Set(working.map((w) => w.id));
  for (const line of lines) {
    const id = await resolve(line);
    if (!id) { failed.push(line); continue; }
    if (known.has(id)) continue;   // 既にリストにあるものは重複させない
    known.add(id);
    const row = { id, title: id, thumb: '', del: false, isNew: true };
    working.push(row);
    added.push(id);
  }
  renderList();
  ta.value = '';
  addStatusEl.textContent = `追加: ${added.length}件`
    + (failed.length ? ` ／ 解決できず: ${failed.join(', ')}` : '')
    + '（「保存」を押すと確定します）';
  // 追加分の名前・アイコンを後追いで埋める
  if (added.length) { applyMeta(await loadMeta(added)); renderList(); }
});

// 削除／取り消しトグル（行は作り直すので親で受ける＝イベント委譲）
listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.ch-del');
  if (!btn) return;
  const row = working.find((w) => w.id === btn.dataset.id);
  if (row) { row.del = !row.del; renderList(); }
});

/* ===== 保存 ===== */

document.getElementById('save').addEventListener('click', async () => {
  const keep = working.filter((w) => !w.del);
  await chrome.storage.sync.set({ channels: keep.map((w) => ({ id: w.id })) });
  const removed = working.length - keep.length;
  working = keep.map((w) => ({ ...w, isNew: false }));  // 保存後は「新規」バッジを落とす
  renderList();
  statusEl.textContent = `保存しました（${keep.length}件`
    + (removed ? ` ／ 外した ${removed}件` : '') + '）';
});

/* ===== 初期化 ===== */

async function init() {
  keyEl.value = (await chrome.storage.sync.get('apiKey')).apiKey || '';
  if (keyEl.value) keyStatusEl.textContent = '保存済み（未テスト）';

  openInAppEl.checked = (await chrome.storage.sync.get('openInApp')).openInApp || false;

  const { channels = [] } = await chrome.storage.sync.get('channels');
  working = channels.map((c) => ({ id: c.id, title: c.id, thumb: '', del: false, isNew: false }));
  renderList();  // まず ID だけで即描画（メタ取得を待たせない）
  applyMeta(await loadMeta(working.map((w) => w.id)));
  renderList();
}

init();
