> 最終更新: 2026-07-21（Tue）00:45

# CLAUDE.md — 推し窓（oshi-mado）

推しの YouTube 新着を横断チェックする **Chrome 拡張機能**。企画・運用の詳細は個人 vault の `40-Projects/oshi-mado/`（MOC + `core/`）を参照。

## これは何か

- 登録した推しのチャンネルの直近7日（`popup.js` の `DAYS`）の投稿を集め、種類別タブ（配信中/全て/動画/アーカイブ/予定）＋チャンネル絞り込みで、ツールバーのポップアップに表示する拡張機能。
- **絞り込みはチャンネルのみ**（`popup.html` の `#f-ch`）。日付は絞り込みではなく `dateKey()` による見出しのグルーピング。日付・時刻でのフィルタは無い。
- 旧 GAS 版（監視スプレッドシート＋Drive HTML＋Web アプリ）は畳んで `_Archives/oshi-mado-gas/` へ退避済み。**この repo は拡張機能が本体**。

## 実行環境（重要）

- **Chrome 拡張機能（Manifest V3）**。`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で `extension/` を読み込む。コード変更後は同画面で**リロード**すると反映される（ビルド不要）。
- 保存先：`chrome.storage.sync` = 推しリスト（`channels: [{id}]`）・API キー（`apiKey`）／`chrome.storage.local` = 判定キャッシュ（`videoCache`）。**この3キーが全て**。
- 配布：`bash package.sh` で `extension/` の中身だけを `oshi-mado-{version}.zip` に固める（README・dotfile は除外）。アイコン4枚が非空か・`manifest.json` に `icons` があるかを検査し、欠けたら ZIP を作らず止まる。
- データ源は2系統：**新着の発見** = 公開 RSS（`youtube.com/feeds/videos.xml?channel_id=`・クォータ消費なし）／**種類判定と配信時刻** = YouTube Data API v3 `videos.list`（キー任意。無ければ新着一覧だけ degraded で出る）。
- API キーはユーザーが ⚙ で入れる runtime 値。**ファイルに秘密情報は持たない**（コミット対象に鍵は無い）。

## 主要ファイル / エントリ

- `extension/manifest.json` — MV3 定義（version / icons / permissions=storage / host=youtube.com / popup / options）
- `extension/popup.js` — `load()`：RSS 収集 → `classify()` で種類判定 → 種類別タブ＋チャンネル絞り込みで描画。`?view=tab` で通常タブ表示（`chrome.tabs.create` を使うのはこのボタンだけ）。カードは素の `<a target="_blank" rel="noopener">`
- `extension/popup.html` / `extension/styles.css` — ポップアップの骨組みと配色（既定ダーク、`prefers-color-scheme:light` でライト）
- `extension/options.js` — 推しリスト編集（アイコン＋名前・追加・「外す」は保存まで確定しない）／API キー保存＋接続テスト
- `extension/options.html` — 設定画面
- `extension/icons/` — PNG 4枚（16/32/48/128）。原本は repo 直下の `oshi_mado_icons/*.svg`（`extension/` の外なので ZIP に入らない）
- `PRIVACY.md` — ストア掲載用のプライバシーポリシー。保存キー・通信先を書いているので、**データの扱いを変えたらここも直す**

## 種類判定（`popup.js` の `classify`）

- `upcoming`（未開始予定）/ `live`（配信中）/ `archive`（配信終了）/ `short`（RSS の `/shorts/` リンク、無ければ尺60秒以下の近似）/ `video`
- 時刻の基準 =「視聴可能になった時刻」（動画=公開時刻、配信=開始時刻、予定=開始予定時刻）。旧 GAS 版 `digest.gs` の `classifyVideo_` と同じ規則（退避済みコードに原典あり）。

## Gotcha

- **Shorts 判定は尺60秒の近似**（公式フラグ無し）。3分 Shorts は取りこぼす。
- **「動画をアプリで開く」に拡張機能側の実装は無い**。`options.html` にあるのは Chrome 側でやる手順（YouTube をアプリとしてインストール＋「対応リンクをこのアプリで開く」）の説明だけで、トグルも `openInApp` 設定も存在しない。カードは `target="_blank"` で開くが、これは補助ブラウジングコンテキスト扱いでリンクキャプチャの対象外なので、Chrome 側を設定してもブラウザのタブで開くことがある。
- **開始予定時刻が無い配信枠は「枠を立てた時刻」に落ちる**（`classify()` の `published` フォールバック）。「時刻不明」とは表示しない。実際の開始時刻とずれた時刻がそのまま出る。
- **サムネイルは `i.ytimg.com` から読む**。`host_permissions` には入っていないが、画像表示にホスト権限は不要。通信先を数えるとき（プライバシーポリシー等）は見落としやすい。
- **「外す」は保存を押すまで確定しない**（`options.js` は行に del フラグを立てるだけ）。
- `.md` 編集は Edit/Write ツールで行う（timestamp 更新 hook のため）。

## テスト

- API を叩かない純粋ロジック（種類判定・尺パース）が対象。静的チェック（`node --check` ＋ `tsc` の未定義変数スキャン）で確認する。ブラウザ実機の挙動（`chrome.storage`・API 通信・アイコンの見え方）は手動確認。

## ドキュメント

設計・運用ドキュメントは repo ではなく個人 vault（`40-Projects/oshi-mado/`）で管理する。

- `oshi-mado.md` — MOC（フォーカス・保留中・資料リンク）
- `core/project-brief.md` — 統合ドキュメント（現状・方向性・課題・技術メモ）
- `outputs/store-listing.md` — Chrome ウェブストアの掲載文（概要・詳細説明・権限の使用理由・スクショ指示）
- `outputs/release-checklist.html` — 公開前チェックリスト

repo 側の `README.md` / `PRIVACY.md` / `outputs/store-listing.md` は**ユーザーが読む公開文書**。機能を足し引きしたら3つとも実装と突き合わせる（2026-07-21 に、未実装の日付・時刻フィルタと存在しない `openInApp` が3文書に伝播していた事故あり）。
