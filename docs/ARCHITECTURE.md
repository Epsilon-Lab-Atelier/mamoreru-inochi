# Architecture

## 目的

「守れるいのち」v0.1.0は、バックエンドを持たない静的PWAです。診断、備蓄、家の安全、家族計画を端末内で完結させ、災害時の主要コンテンツをオフラインで利用できることを優先します。

## 実行構成

```text
GitHub Pages
  └─ HTML / CSS / JavaScript / icons / manifest / Service Worker
          ↓ 初回読込
利用者のブラウザー
  ├─ Cache Storage: アプリ本体と防災コンテンツ
  ├─ IndexedDB: 選択された保存データ
  └─ Web Crypto API: パスフレーズ保護
```

v0.1.0には、サーバーAPI、アカウント、クラウド同期、現在地取得、外部防災API、解析、広告がありません。

## モジュール

- `src/app.js`
  - Hash Router
  - 画面描画
  - フォーム処理
  - PWAインストールと更新
  - バックアップ・設定UI
- `src/data.js`
  - 質問
  - 災害分野
  - 備蓄項目
  - 災害時ガイド
  - 公的出典
- `src/risk-engine.js`
  - 決定論的な診断計算
  - 優先度、確かさ、理由、確認項目
- `src/stockpile-engine.js`
  - 3日・7日・任意日数の必要量
  - 必須項目のゲート判定
  - 賞味期限分析
- `src/storage.js`
  - IndexedDB
  - 保存モード
  - バックアップ
  - 永続ストレージ要求
- `src/crypto.js`
  - PBKDF2-SHA-256
  - AES-GCM
- `service-worker.js`
  - アプリシェルの事前キャッシュ
  - 同一オリジンGETのRuntime Cache
  - オフライン時のナビゲーションフォールバック

## ルーティング

Hash Routerを使います。GitHub Pagesでサーバー側リライトを必要としません。

例:

- `#/`
- `#/diagnosis/area`
- `#/diagnosis/results`
- `#/stockpile/items`
- `#/emergency/earthquake`

## データモデル

保存する主な要素:

- `preferences`
- `diagnosis.answers`
- `diagnosis.result`
- `household`
- `stockpile.quantities`
- `stockpile.advanced`
- `stockpile.inventory`
- `homeSafety.items`
- `familyPlan`

`schemaVersion`を持ち、将来のデータ移行に備えます。

## 保存モード

- `none`: IndexedDBへ保存しない
- `result`: 回答を除いた診断結果と表示設定のみ保存
- `full`: 全状態を平文の構造化データとしてIndexedDBへ保存
- `protected`: 全状態をAES-GCMで暗号化して保存

パスフレーズは保存しません。復号鍵はページを開いているセッションのメモリー内だけにあります。

## オフライン更新

Service Workerのキャッシュ名へアプリバージョンを含めます。新しいWorkerのinstall後、利用者が適用すると`skipWaiting`し、`controllerchange`で再読み込みします。

更新時には、`service-worker.js`の`VERSION`を必ず変更します。

## ビルド

実行時依存ライブラリはありません。GitHub Actionsはテスト後、公開に必要なファイルだけを`_site`へコピーします。
