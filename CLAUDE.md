> 最終更新: 2026-07-18（Sat）22:42

# CLAUDE.md — 推し窓（oshi-mado）

推しの YouTube 新着を横断チェックする **Chrome 拡張機能**。企画・運用の詳細は個人 vault の `40-Projects/oshi-mado/`（MOC + `core/`）を参照。

## これは何か

- 登録した推しのチャンネルの最近の投稿を集め、種類別タブ（全部/動画/配信中/アーカイブ/予定）＋フィルタ（チャンネル・日付・時刻）付きで、ツールバーのポップアップに表示する拡張機能。
- 旧 GAS 版（監視スプレッドシート＋Drive HTML＋Web アプリ）は畳んで `_Archives/oshi-mado-gas/` へ退避済み。**この repo は拡張機能が本体**。

## 実行環境（重要）

- **Chrome 拡張機能（Manifest V3）**。`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で `extension/` を読み込む。コード変更後は同画面で**リロード**すると反映される（ビルド不要）。
- 保存先：`chrome.storage.sync` = 推しリスト（`channels: [{id}]`）・API キー（`apiKey`）・設定（`openInApp`）／`chrome.storage.local` = 判定キャッシュ（`videoCache`）。
- データ源は2系統：**新着の発見** = 公開 RSS（`youtube.com/feeds/videos.xml?channel_id=`・クォータ消費なし）／**種類判定と配信時刻** = YouTube Data API v3 `videos.list`（キー任意。無ければ新着一覧だけ degraded で出る）。
- API キーはユーザーが ⚙ で入れる runtime 値。**ファイルに秘密情報は持たない**（コミット対象に鍵は無い）。

## 主要ファイル / エントリ

- `extension/manifest.json` — MV3 定義（permissions=storage / host=youtube.com / popup / options）
- `extension/popup.js` — `load()`：RSS 収集 → `classify()` で種類判定 → 種類別タブ＋フィルタで描画。`?view=tab` で通常タブ表示。`openInApp` ON 時はカードを `chrome.tabs.create` で開く
- `extension/popup.html` / `extension/styles.css` — ポップアップの骨組みと配色（light/dark）
- `extension/options.js` — 推しリスト編集（アイコン＋名前・追加・「外す」は保存まで確定しない）／API キー保存＋接続テスト／「動画をアプリで開く」トグル
- `extension/options.html` — 設定画面

## 種類判定（`popup.js` の `classify`）

- `upcoming`（未開始予定）/ `live`（配信中）/ `archive`（配信終了）/ `short`（RSS の `/shorts/` リンク、無ければ尺60秒以下の近似）/ `video`
- 時刻の基準 =「視聴可能になった時刻」（動画=公開時刻、配信=開始時刻、予定=開始予定時刻）。旧 GAS 版 `digest.gs` の `classifyVideo_` と同じ規則（退避済みコードに原典あり）。

## Gotcha

- **Shorts 判定は尺60秒の近似**（公式フラグ無し）。3分 Shorts は取りこぼす。
- **「動画をアプリで開く」は Chrome 側の準備も必須**。拡張機能側 ON だけでは足りず、YouTube をアプリとしてインストール＋「対応リンクをこのアプリで開く」を有効化して初めてアプリで開く。`target="_blank"` は補助ブラウジングコンテキスト扱いでキャプチャ対象外のため、ON 時は `chrome.tabs.create`（opener 無し）で開いている。
- **「外す」は保存を押すまで確定しない**（`options.js` は行に del フラグを立てるだけ）。
- `.md` 編集は Edit/Write ツールで行う（timestamp 更新 hook のため）。

## テスト

- API を叩かない純粋ロジック（種類判定・尺パース）が対象。静的チェック（`node --check` ＋ `tsc` の未定義変数スキャン）で確認する。ブラウザ実機の挙動（`chrome.storage`・API 通信・アプリ起動）は手動確認。

## ドキュメント

設計・運用ドキュメントは repo ではなく個人 vault（`40-Projects/oshi-mado/`）で管理する。

- `oshi-mado.md` — MOC（フォーカス・保留中・資料リンク）
- `core/project-brief.md` — 統合ドキュメント（現状・方向性・課題・技術メモ）
