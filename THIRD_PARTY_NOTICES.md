# Third-Party Notices

v0.3.1は、実行時に外部CDNからJavaScript、CSS、Webフォントを読み込みません。広告SDKとアクセス解析SDKも使用しません。

## QR Code Generator

家族の防災計画とスマホ転送用のQRコード生成に、Kazuhiko Arase氏の`qrcode-generator`を基にしたJavaScriptをリポジトリ内へ同梱しています。

- Project: QR Code Generator for JavaScript
- Copyright: Kazuhiko Arase
- License: MIT License
- Upstream: https://github.com/kazuhikoarase/qrcode-generator
- Bundled file: `vendor/qrcode.js`

同梱コードは外部通信を行いません。

## 公的な地図・防災情報

利用者が地域情報の取得、地点検索、地図表示を許可した場合、ブラウザから次の公的サービスへ直接アクセスします。

- 防災科学技術研究所 J-SHIS
- 国土地理院 地理院タイル、地名検索、逆ジオコーダ
- 国土交通省・国土地理院 ハザードマップポータル関連データ
- 気象庁 防災情報

アプリは公的機関の資料を参照し、資料名、組織、URL、利用箇所、確認日を`src/data.js`とアプリ内の「根拠と出典」に表示します。リンク先の文章、画像、地図、データの権利と利用条件は、それぞれの提供元に帰属します。

地図画面では出典を表示します。指定緊急避難場所、指定避難所、指定福祉避難所、ハザード関連データには、最新でない場合や未掲載の場合があるため、自治体の最新情報と受入条件を確認する注意を表示します。

## GitHub Actions

継続的検証とGitHub Pages公開に、GitHub公式のActionsを使用します。

- actions/checkout
- actions/setup-node
- actions/configure-pages
- actions/upload-pages-artifact
- actions/deploy-pages

内容確認日: 2026-08-01
