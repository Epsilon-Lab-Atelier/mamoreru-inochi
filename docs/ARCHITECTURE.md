# Architecture

## 目的

「守れるいのち」v0.2.0は、GitHub Pagesで公開する静的PWAです。診断、備蓄、家の安全、家族計画、緊急連絡先を端末内で扱い、災害時の主要コンテンツをオフラインで利用できることを優先します。

地域情報だけは、利用者が内容を確認して許可した場合に限り、公的機関へ直接問い合わせます。

## 実行構成

```text
GitHub Pages
  └─ HTML / CSS / JavaScript / icons / manifest / Service Worker
          ↓ 初回読込
利用者のブラウザ
  ├─ Cache Storage: アプリ本体と防災コンテンツ
  ├─ IndexedDB: 選択された保存データ
  ├─ Web Crypto API: パスフレーズ保護
  ├─ Geolocation API: 利用者が許可した場合の地点入力
  └─ 公的機関への直接通信: 利用者が個別に許可した場合だけ
       ├─ J-SHIS
       ├─ 国土地理院
       └─ 気象庁
```

EpsilonLabのバックエンド、アカウント、クラウド同期、広告、アクセス解析はありません。

## モジュール

- `src/app.js`
  - Hash Router
  - 画面描画とフォーム処理
  - 文字サイズと表示設定
  - 地域情報、通信確認、通信履歴
  - 緊急連絡先
  - PWAインストールと更新
  - バックアップ・設定UI
- `src/data.js`
  - 診断質問
  - 災害分野
  - 備蓄項目
  - 災害時ガイド
  - 緊急連絡先
  - 公的出典
- `src/public-data.js`
  - J-SHIS API
  - 国土地理院GeoJSONタイル
  - 気象庁警報JSON
  - 座標、タイル、距離、応答解析
- `src/risk-engine.js`
  - 決定論的な診断計算
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
  - 同一オリジンの静的ファイルキャッシュ
  - オフライン時のナビゲーションフォールバック
  - 利用者操作による新Service Workerへの切り替え

## ルーティング

Hash Routerを使い、GitHub Pagesでサーバ側リライトを必要としません。

主な例:

- `#/`
- `#/diagnosis/area`
- `#/stockpile/items`
- `#/locations`
- `#/contacts`
- `#/emergency/earthquake`
- `#/install`

## データモデル

保存する主な要素:

- `preferences`
- `diagnosis`
- `household`
- `stockpile`
- `homeSafety`
- `familyPlan`
- `locations`
- `network.consents`
- `network.logs`
- `contacts.custom`
- `audit`

v0.2.0は`schemaVersion: 2`です。v0.1.0の保存内容は、既定値を補う形で読み込みます。

## 外部通信の境界

アプリ本体から任意の送信先へ通信できないよう、Content Security Policyの`connect-src`を次へ限定します。

- 同一オリジン
- `www.j-shis.bosai.go.jp`
- `cyberjapandata.gsi.go.jp`
- `www.jma.go.jp`

地図画像も国土地理院に限定します。外部通信は`src/public-data.js`に集約し、広告、解析、WebSocket、送信ビーコンは使用しません。

## オフライン更新

Service Workerのキャッシュ名にアプリバージョンを含めます。

1. 新しいWorkerを検出してinstallする
2. 既存ページを強制再読込せず、waiting状態で待つ
3. 画面上部に更新案内を表示する
4. 利用者が「更新する」を押す
5. `SKIP_WAITING`メッセージで新Workerへ切り替える
6. `controllerchange`後に一度だけ再読込する

起動時、オンライン復帰時、画面復帰時、一定時間ごと、手動操作時に`registration.update()`を実行します。

## GitHub Pagesの公開物

GitHub Actionsはテスト後、実行に必要な次のファイルだけを`_site`へコピーします。

- HTML
- manifest
- Service Worker
- `version.json`
- robots / sitemap / `.nojekyll`
- `assets/`
- `src/`

`LOCAL_ONLY/`、テスト、管理文書はPagesへ含めません。
