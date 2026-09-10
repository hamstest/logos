# 操作手順

リポジトリのルートで `npm ci` と `npm run build` を実行する。CLIは `npm run logos -- ...` または `node dist/src/cli.js ...`。別の場所から呼ぶ場合は `--workspace C:/develop/logos` を付ける。

`operations` は有効な拡張、読取器、公開操作と実際に検査する入出力スキーマを返す。以下の入力例はJSONファイルに保存し、`call 操作名 @ファイル名` で渡す。`-` なら標準入力、省略すれば `{}`。CLIはJSONを標準出力へ返し、エラー時は標準エラーへJSONを出して終了コード1になる。

## 対話から使う

CodexやClaude Codeで作業するときは、最初に `knowledge.context` から知識を取得する。対象プロジェクトを選び、分かっている概念や状況を渡す。取得した資料の条件を判断し、必要な全文を `knowledge.get` で読み、現在の対話で作業する。途中で分かったことを追加して再取得できる。参照だけならタスク登録は不要。

```json
{"query":"返金処理の変更","concepts":["concept/refund"],"situation":{"publicApi":true},"limit":20,"offset":0}
```

```powershell
node dist/src/cli.js --project project/logos call knowledge.context '@context.json'
```

`items` には概要、出典、理由、利用可能な操作名が入る。`applicable` は概念の関係から関連すると判定した項目であり、文章中の条件すべてを満たす保証ではない。追加の実装による判定は `judgments` に別に返す。`incomplete`、`diagnostics`、`ambiguities` を確認し、`nextOffset` があれば同じ入力の `offset` を替えて続きを取得する。

| 操作 | 入力例・用途 |
|---|---|
| `knowledge.get` | `{"id":"criterion/public-documentation"}` で文章やコードの全文を取得 |
| `knowledge.related` | `{"id":"criterion/public-documentation","direction":"both"}` で実装・検証へ辿る |
| `knowledge.search` | `{"query":"注釈","limit":20,"offset":0}` で語句検索 |
| `knowledge.diagnostics` | `{}` で参照切れ、重複ID、読取エラーを確認 |

Logos自身の実装を調べるときは `--project project/logos` を使う。例えば `implementation/host`、`implementation/atomic-write`、`implementation/public-documentation` を取得できる。操作が有効かどうかの正本は登録情報であり、注釈だけの実装は自動実行されない。

## プロジェクトを接続する

`project.connect` に既存フォルダを渡す。例のパスは実際の対象へ変更する。

```json
{"id":"project/sample","title":"Sample","path":"C:/develop/sample","sources":["src"]}
```

ソースをLogosへコピーせず、その場所からIDとコードを読む。知識のMDはLogos内で管理し、接続先リポジトリのMarkdownは索引化しない。以降は `--project project/sample` を付ける。固有の知識と共有知識を併せて取得し、他プロジェクトの固有知識を混ぜない。`project.list` で接続先を確認する。`project.disconnect` は `{"id":"project/sample"}` で接続だけを外し、原本や履歴を削除しない。

`config/logos.json` の `roots` は共有する読込設定。`role: knowledge` はLogos内のMarkdown、`role: source` はソースを読む。知識ルートをLogosの外には指定できない。`.logos/local/projects.json` はローカルの接続先。`include` / `sources` はフォルダ・ファイルの相対パスで、globではない。同じファイルを異なるルートで二重登録すると診断が出る。

## MDからソースへ接地する

対象の直前へ短いIDコメントを置く。例えば `// @logos-id implementation/refund`。ソースには関係やプロジェクト範囲を書かない。

Logos側のMDの `links` に `{relation: implemented_by, target: implementation/refund}` を追加する。ソースIDを `knowledge.related` で問い合わせれば、そのIDに言及するMDを逆引きできる。テストのIDへの参照には `verified_by` を使える。IDは接続する全プロジェクトで重複しない名前にする。

旧方式のソースコメントは、関係をMDへ移してから同じIDの1行コメントへ置き換える。旧ブロックの残存は診断として表示する。既存の他プロジェクトのMDは勝手に移動せず、必要な知識をLogos内の保存先へ移す。今回の同梱デモのMDは移行済み。

## 知識の追加と修正

文章と注釈は通常のエディターで編集できる。管理操作で新しい文章を作る場合は `knowledge.create` を使う。

```json
{"rootId":"shared","path":"knowledge/shared/example.md","annotation":{"format":1,"id":"guidance/example","kind":"guidance","links":[{"relation":"applies_to","target":"concept/logos-change"}]},"body":"# 変更時の確認\n\n変更対象に対応するテストを実行する。"}
```

接続プロジェクトの知識保存先IDは `project/sample/knowledge`。`path` はそこからの相対パスで、`example.md` などを指定する。実ファイルはLogos内の `knowledge/projects/project%2Fsample/` に保存する。ディレクトリ名はプロジェクトID全体をURLエンコードしたもので、接続先の場所や関数名に依存しない。`project/sample/source` はソース読取専用であり、知識を作成できない。接続を解除しても中央のMDを残し、同じIDで再接続すると再び読める。初期の管理操作は新しいMarkdownファイルを作る。複数の章を持つ既存ファイルへ追加する場合は、[注釈仕様](../ONTOLOGY.md)に従って通常の編集を行う。

`knowledge.update` は `id`、取得した `origin.hash` を `expectedHash` として、見出しを含む新しい `body` を受け取る。注釈を含む子節を失う変更は拒否するので、子節だけの変更にはそのIDを指定する。親章の `get.content` には子節の注釈を含めないため、それをそのまま親章へ書き戻す用途には使わない。注釈自体やソースコードの編集は原本を通常の方法で変更し、次の取得で読み直す。

## タスクと結果

`task.create` に `{"objective":"公開操作を追加する","project":"project/logos"}` を渡す。返された `id` と `revision` を使い、直接作業の結果を `task.update` で記録する。

```json
{"id":"task/返されたUUID","expectedHash":"返されたrevision","status":"completed","note":"入力の扱いを修正した","artifacts":["src/example.ts"],"checks":[{"description":"関連テスト","outcome":"passed","evidence":"実際の確認内容"}],"result":"変更の内容"}
```

`checks` は実際に行った確認を記す。完了報告だけなら `verification` は `unverified` のまま。更新前に `task.get` で最新の `revision` を取得する。`task.list` は選択したプロジェクトのタスクを返し、未指定なら全体を返す。

委譲時は `execution.runners` で接続先を確認し、`execution.run` に `taskId`、`runnerId`、必要なら `concepts` と `situation` を渡す。試行IDを保存してから、対象プロジェクトの作業ディレクトリで外部コマンドを起動する。

タイムアウト、異常終了、出力形式の不正は結果不明として扱う。`execution.inspect` へ `attemptId` を渡し、プロセスと成果物を確認する。プロセスが停止したことを確認してから `execution.reconcile` へ `taskId`、`attemptId`、`status`、観測した `summary`、`runnerStopped:true` を渡す。その後、必要な場合だけ明示的に再実行する。自動で再試行しない。

## 改善を残す

`improvement.propose` に目的、きっかけ `trigger`、期待する効果 `expectedEffect`、関連ID `targets` を渡す。通常のタスクとして変更と確認を進める。自分の改善には `project/logos` を指定する。

実装による判定をタスクに残すには `execution.evaluate` に `taskId`、登録された `operation`、その `input` を渡す。例えば `quality.documentation` は、渡されたメンバーの説明を確認し、結果と実装IDをタスクへ記録する。

`improvement.learn` はエージェントが取り出した再利用可能な文章を保存する。入力は `taskId`、`rootId`、`path`、新しい `id`、`title`、`body`、`concepts`、`scope`。タスクを出典として結び、指定したプロジェクトまたは明示した共有範囲へ保存する。生ログの自動一般化は行わない。

## 削除と復元

1. `knowledge.deletePreview` に `id` を渡し、対象範囲と子節を含む `affectedIds` を確認する。
2. `knowledge.delete` に `id` とプレビューの `expectedHash` を渡す。原文を `.logos/trash` に保存してから対象範囲を除く。
3. `trash.list` で記録を確認し、`trash.restore` に `trashId` を渡す。本文やIDが衝突すると上書きせず停止する。

タスクは `task.delete` に `id` と最新の `expectedHash` を渡して同じごみ箱へ保存する。参照先を連鎖して削除しない。ごみ箱を完全消去する公開操作は設けていない。`prepared` は途中失敗の可能性を示すので、保存された原文と現在の原本を比較する。

保存途中でプロセスが強制終了した場合、原本横に `.logos-lock` が残ることがある。別の保存処理が動いていないことを確認し、原本・ごみ箱・一時ファイルを確認してから、そのロックだけを取り除く。自動でロックを破棄して競合を隠す処理は行わない。
