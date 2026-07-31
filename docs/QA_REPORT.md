# v0.1.0 QA report

確認日: 2026-07-31

## 結果

公開初版のローカル検証では、次を完了しています。

- `npm run check`: 成功
- Node.js自動テスト: 17件成功、失敗0件
- GitHub Actionsと同じ公開用成果物（21ファイル）に対するヘッドレスChromium確認: 36項目成功、失敗0件
- GitHub Pagesのプロジェクト配下を模した `/mamoreru-inochi/` での表示: 成功
- Service Workerによるオフライン再読込: 成功
- 実行時の外部HTTP通信: 検出なし
- 実行時JavaScriptエラー: 検出なし

実際のGitHub Pages URL、iPhone、Android、支援技術による最終確認は、初回push後に行います。

## 自動テスト

`npm run check` では、静的検証とNode.js標準テストを実行します。

### リスク診断

- 情報不足を低リスクとして扱わないこと
- 津波浸水想定区域を最優先確認へ反映すること
- 家具未固定を地震対策へ反映すること
- 「わからない」が点数を上げず、判定の確かさを下げること
- 同じ回答に同じ結果を返すこと

### 備蓄計算

- 水1人1日3L、食料1人1日3食、携帯トイレ1人1日5回の基本式
- 3日・7日の必要量
- 重要項目不足時の必須条件方式
- 乳幼児、常用薬、ペットの条件付き必須項目
- アドバンスモードの日数
- 賞味期限・使用期限の分類

### 保存・暗号化

- AES-GCM暗号化バックアップの往復
- 平文が暗号化データへ残らないこと
- 誤ったパスフレーズで復号できないこと

### 静的構成

- 必須ファイル、PWAアイコン、公開文書、Actions、Issueテンプレート
- GitHub Pagesで動く相対パス
- `Epsilon-Lab-Atelier/mamoreru-inochi`のURL
- versionの一致
- READMEへの管理者向けpush手順の混入防止
- `LOCAL_ONLY/`のGit除外
- 外部CDN、広告、解析、外部通信APIの不在
- 個人の絶対PATH、秘密鍵、GitHubトークンらしき文字列の不在

## ブラウザー動作試験

GitHub Actionsの`deploy.yml`と同じコピー手順で公開用成果物を作成し、ヘッドレスChromiumを使ってGitHub Pagesのプロジェクトサイトを模した次のURL構造で確認しました。

`http://127.0.0.1:4173/mamoreru-inochi/`

確認した主な内容:

- 初回案内とプライバシー説明
- 初回設定を経由しない災害時モード
- 31問の診断完走と結果表示
- 診断結果の再読込後の復元
- 3人分の備蓄計算
- 最低3日ラインと安心7日ライン
- スマートフォン幅と文字サイズ200%での横方向オーバーフロー
- Service Workerのscopeとv0.1.0キャッシュ
- オフラインでの結果再読込と災害時ガイド
- 暗号化保存、再起動ロック、誤ったパスフレーズの拒否
- ロック中の災害時ガイド
- 正しいパスフレーズによる解除
- ホーム、災害時、備蓄、備蓄リスト、家の安全、家族計画、防災ガイド、ヘルプ、設定、出典、このアプリについて、印刷ページの描画
- 全確認中の外部HTTP通信がないこと
- 全確認中の実行時JavaScriptエラーがないこと

診断完了や備蓄計算など、利用者が明示的に保存する操作では、IndexedDBへの保存完了後に画面遷移または完了表示を行うことも確認しました。

## GitHub Pagesデプロイ構成

GitHub Actionsでは、次を実行します。

1. Node.js 20で`npm run check`
2. 公開用の`_site`を作成
3. HTML、PWA、CSS、画像、JavaScriptだけをPages artifactへ格納
4. GitHub Pagesへデプロイ

管理者向けの`LOCAL_ONLY/`、テスト、READMEなどは、実行時サイトへ配信しません。

## push後に必要な確認

公開前のローカル環境では代替できないため、初回push後に次を確認します。

- 実在するGitHub Pages URLでActionsとPagesが成功すること
- iPhone Safariからホーム画面へ追加し、機内モードで起動すること
- Android Chromeからインストールし、機内モードで起動すること
- PC ChromeまたはEdgeでインストールできること
- VoiceOverまたはTalkBackで見出し、フォーム、エラー、結果を確認すること
- A4印刷またはPDF保存の改ページと文字欠け
- バックアップを別ブラウザーへ読み込むこと

具体的な公開・実機確認手順は、納品ZIP内の `LOCAL_ONLY/PUBLISH_AND_OPERATIONS_GUIDE.txt` と `LOCAL_ONLY/POST_DEPLOY_VERIFICATION.md` にあります。これらはGit管理対象外です。
