# Architecture

## 目的

「守れるいのち」v0.3.0は、GitHub Pagesで公開する静的PWAです。スマホへインストールし、診断、備蓄、家の安全、家族計画、防災訓練、緊急連絡先を端末内で扱い、災害時の主要コンテンツをオフラインで利用できることを優先します。

地域情報と地図だけは、利用者が送信先、内容、目的を確認して許可した場合に、公的機関へ直接問い合わせます。

## 実行構成

```text
GitHub Pages
  └─ HTML / CSS / JavaScript / icons / manifest / Service Worker
          ↓ 初回読込
利用者のブラウザ
  ├─ Cache Storage: アプリ本体、防災コンテンツ、明示保存した周辺地図
  ├─ IndexedDB: 選択された保存データ
  ├─ Web Crypto API: パスフレーズ保護
  ├─ Geolocation API: 利用者が許可した場合の地点入力
  ├─ QR生成: 端末内のローカルJavaScript
  └─ 公的機関への直接通信: 利用者が個別に許可した場合だけ
       ├─ J-SHIS
       ├─ 国土地理院
       ├─ ハザードマップポータル
       └─ 気象庁
```

EpsilonLabのバックエンド、アカウント、クラウド同期、広告、アクセス解析はありません。

## モジュール

- `src/app.js`: Hash Router、画面描画、フォーム、インストール、更新、設定
- `src/data.js`: 診断質問、災害時ガイド、備蓄項目、緊急連絡先、出典
- `src/public-data.js`: J-SHIS、国土地理院、住所検索、気象庁、公的通信
- `src/map.js`: Web Mercator計算、地図タイル、災害レイヤ、マーカー
- `src/share.js`: 家族計画の選択共有、URL・ファイル形式、取込
- `src/drills.js`: 防災訓練、進行、記録、カレンダー書き出し
- `src/risk-engine.js`: 決定論的なリスク診断
- `src/stockpile-engine.js`: 3日・7日・状況別備蓄、期限分析
- `src/storage.js`: IndexedDB、保存モード、バックアップ、移行
- `src/crypto.js`: PBKDF2-SHA-256、AES-GCM
- `vendor/qrcode.js`: MIT LicenseのQR Code Generator
- `service-worker.js`: アプリシェル、更新、オフライン、明示保存地図

## ルーティング

GitHub Pagesでサーバ側リライトを必要としないHash Routerを使います。

主な例:

- `#/`
- `#/diagnosis/area`
- `#/stockpile/items`
- `#/family/share`
- `#/family/import`
- `#/drills/run`
- `#/locations`
- `#/contacts`
- `#/emergency/earthquake`
- `#/install`

## データモデル

保存する主な要素:

- `preferences`
- `install`
- `diagnosis`
- `household`
- `stockpile`
- `homeSafety`
- `familyPlan`
- `drills`
- `locations`
- `network.consents`
- `network.logs`
- `contacts`
- `audit`

v0.3.0は`schemaVersion: 3`です。v0.2.0以前の保存内容を読み込み、メモリ上で既定値を補完し、整合性を確認してから新形式で保存します。

## 外部通信の境界

Content Security Policyで、実行コード、画像、通信先を同一オリジンと承認済みの公的提供元へ限定します。

- `www.j-shis.bosai.go.jp`
- `cyberjapandata.gsi.go.jp`
- `disaportaldata.gsi.go.jp`
- `msearch.gsi.go.jp`
- `mreversegeocoder.gsi.go.jp`
- `www.jma.go.jp`

動的な`fetch`は`src/public-data.js`へ集約します。広告、解析、WebSocket、送信ビーコンは使用しません。

## 地図

外部地図ライブラリを使わず、Web Mercatorのタイル計算を`src/map.js`で行います。標準表示時は地図タイルを自動で永続保存しません。

利用者が「周辺地図をオフライン用に保存」を選んだ場合だけ、登録地点、災害レイヤ、縮尺の限られたタイルを専用Cache Storageへ保存します。

## 家族共有

家族計画は、選択項目だけをJSONへ変換し、Base64URL形式で共有リンクへ格納できます。QRコードはその共有リンクを端末内で描画します。受信時は内容を表示し、利用者が取り込みを選ぶまで保存しません。

## オフライン更新

1. 新しいWorkerを検出してinstallする
2. 既存ページを強制再読込せずwaiting状態で待つ
3. 画面上部に更新案内を表示する
4. 利用者が「更新する」を押す
5. `SKIP_WAITING`で新Workerへ切り替える
6. `controllerchange`後に一度だけ再読込する

起動時、オンライン復帰時、画面復帰時、一定時間ごと、手動操作時に更新を確認します。

## GitHub Pagesの公開物

GitHub Actionsは自動テスト後、実行に必要な次だけを`_site`へコピーします。

- HTML、manifest、Service Worker、`version.json`
- robots、sitemap、`.nojekyll`
- `assets/`
- `src/`
- `vendor/`

`LOCAL_ONLY/`、テスト、管理者向け文書はPagesへ含めません。
