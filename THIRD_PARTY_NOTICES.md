# Third-Party Notices

v0.2.0は、実行時の第三者JavaScript、CSS、Webフォント、広告SDK、解析SDKを使用しません。

利用者が地域情報の取得や地図表示を許可した場合、次の公的サービスへブラウザから直接アクセスします。

- 防災科学技術研究所 J-SHIS
- 国土地理院 地理院タイル
- 気象庁 防災情報

アプリは公的機関の資料を参照し、資料名、組織、URL、利用箇所、確認日を`src/data.js`とアプリ内の「根拠と出典」に表示します。リンク先の文章、画像、地図、データの権利と利用条件は、それぞれの提供元に帰属します。

地理院タイルを表示する画面では、国土地理院を出典として示します。指定緊急避難場所・指定避難所・指定福祉避難所データには、最新でない場合や未掲載の場合があるため、自治体の最新情報と受入条件を確認する注意を表示します。

GitHub Actionsでは、GitHub公式のActionsを使用します。

- actions/checkout
- actions/setup-node
- actions/configure-pages
- actions/upload-pages-artifact
- actions/deploy-pages
