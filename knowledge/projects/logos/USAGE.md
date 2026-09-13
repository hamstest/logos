# 操作手順

リポジトリのルートで `npm ci` と `npm run build` を実行する。CLIは `npm run logos -- ...` または `node dist/src/cli.js ...`。別の場所から呼ぶ場合は `--workspace PATH_TO_LOGOS` を付け、`PATH_TO_LOGOS` を対象のリポジトリパスに置き換える。

`operations` は有効な拡張、読取器、公開操作と実際に検査する入出力スキーマを返す。入力はJSONファイルに保存し、`call 操作名 @ファイル名` で渡す。`-` なら標準入力、省略すれば `{}`。CLIはJSONを標準出力へ返し、エラー時は標準エラーへJSONを出して終了コード1になる。

~~~logos
def logos-usage
  is document
  about logos-change
  concerns cli, knowledge-extension, tasks-extension, improvement-extension, atomic-write, task-store, logos-repository
~~~

## 対話から使う

ユーザーの指示本文を `knowledge.context` の `query` に渡す。既知のIDがあれば `concepts`、既知のソース接地点は `targets`、補助語は `terms` に渡せる。本文検索から得たIDと合流し、継承・判定後の知識を返す。

候補の根拠は `knowledge.discover`、全文と継承した文は `knowledge.get`、参照は `knowledge.related` で調べる。候補からIDを先に選ぶ手順は必須ではない。診断、不明判定、自然文の条件を確認する。検索結果は恒久的な分類事実にはしない。

~~~logos
def logos-usage-conversation
  is document
  part-of logos-usage
~~~

## プロジェクトを接続する

`project.list` で接続済みプロジェクトを確認する。Logos自身は `logos` として登録される。外部プロジェクトは `project.connect` にID、表示名、既存ディレクトリのパス、ソースの読込範囲を渡して接続する。CLIの `--project` で対象を指定する。

知識はLogos内の `knowledge/projects/` に保存する。接続解除は `project.disconnect` で行い、外部ソースと記録は保持する。外部リポジトリのMarkdownを自動で知識に取り込まない。

~~~logos
def logos-usage-projects
  is document
  part-of logos-usage
~~~

## MDからソースへ接地する

ソースは対象の宣言直後に、独立した行でIDコメントだけを置く。LogosのMDから `implemented-by`、テストには `verified-by` で参照する。ソースの位置が変わってもIDを保持すれば逆引きできる。

このプロジェクトでは [開発概念と基準](development.md) の各基準が実装・検証IDを参照している。そこから `knowledge.get` と `knowledge.related` で実際のコードを取得できる。

~~~logos
def logos-usage-source-grounding
  is document
  part-of logos-usage
~~~

## 知識の追加と修正

`knowledge.create` は `rootId`、`path`、`definition`、`body` を受け取る。`definition` は `def` から始まる言語の文字列、`body` は見出しから始まるMarkdown本文とする。処理系が説明末尾、子見出しがあればその手前に定義を挿入する。作成先は登録されたLogos内の知識ルートに限る。

`knowledge.update` には対象の `id`、取得した `origin.hash` を `expectedHash` として渡し、見出しを含む新しい `body` を指定する。自身の定義を再挿入し、既存の子節のIDが失われる更新や競合を拒否する。意味上の文の変更は原本の定義を直接編集する。保存後は索引へ反映する。

~~~logos
def logos-usage-editing
  is document
  part-of logos-usage
~~~

## ADRを記録する

ADRは [共有標準](../../shared/adr.md) に従って記録できる。実際の [ADR活用方針](decisions/adr-as-knowledge.md) が記述対象となっている。

文書は `is` で共通定義を受け取り、従う標準を `follows`、話題と実装への対応を通常の文で記す。現在は特定のADR形式を取得・検索の必須構造にはしない。運用に応じてこの判断と標準を変更できる。

~~~logos
def logos-usage-adr
  is document
  part-of logos-usage
~~~

## 文書とファイル構成を調べる

Logos自身の設計・仕様・操作文書は `knowledge/projects/logos/` に置き、`logos-knowledge` ルートで読み込む。リポジトリ直下の `README.md` と `AGENTS.md` は `self-docs` ルートで読み込む。文書と章にはIDがあり、`--project logos` で取得・検索できる。全体設計は `logos-design`、言語仕様は `logos-ontology`、利用手順は `logos-usage` で取得する。`knowledge.related` で文書間や実装への対応を辿る。

[ファイル構成と管理範囲](REPOSITORY.md) は設定ファイルなど、直接ノードにしない原本の役割も説明する。`npm run audit:knowledge` で文書・ソースの管理漏れと参照切れを確認できる。ソースのIDは必要な処理への接地点であり、ファイル内の全宣言を網羅するものではない。

~~~logos
def logos-usage-documents
  is document
  part-of logos-usage
~~~

## タスクと結果

`task.create` に目的と対象プロジェクトを渡す。`task.get` の `revision` を `expectedHash` に指定し、`task.update` で進捗・結果・実際の確認を記録する。完了報告と確認済み状態は別に扱う。

CLIの `--task` でタスクを指定した `knowledge.context` は、実際に使った概念を記録する。委譲は `execution.runners` で接続先を確認し、`execution.run` にタスクIDとランナーIDを渡す。必要に応じて既知の概念と状況も渡せる。

タイムアウトや不正な出力は結果不明とする。`execution.inspect` で試行を確認し、停止と影響を確認した後に `execution.reconcile` で結果を記録する。自動再試行は行わない。

~~~logos
def logos-usage-tasks
  is document
  part-of logos-usage
~~~

## 改善を残す

`improvement.propose` に目的、きっかけ `trigger`、期待する効果 `expectedEffect`、関連ID `targets` を渡す。通常のタスクとして変更と確認を進める。自分の改善には `logos` を指定する。

実装による判定をタスクに残すには `execution.evaluate` に `taskId`、登録された `operation`、その `input` を渡す。`quality.documentation` は入力を省略すると登録された公開操作の説明を確認し、結果と実装IDをタスクへ記録する。

`improvement.learn` はエージェントが取り出した再利用可能な文章を保存する。入力は `taskId`、`rootId`、`path`、新しい `id`、`title`、`body`、`concepts`、`scope`。タスクを出典として結び、指定したプロジェクトまたは明示した共有範囲へ保存する。生ログの自動一般化は行わない。

~~~logos
def logos-usage-improvement
  is document
  part-of logos-usage
~~~

## 削除とGitによる復元

1. `knowledge.deletePreview` に `id` を渡し、対象範囲と子節を含む `affectedIds` を確認する。
2. `knowledge.delete` に `id` とプレビューの `expectedHash` を渡す。対象範囲だけを除き、`id`、保存後の `hash`、`affectedIds` を返す。参照元の文書は変更しない。ファイル全体が対象なら空のMDが残る。
3. 差分はGitで確認する。復元時はGitに記録した版から必要なファイル・箇所を戻す。保存後の索引へ自動で反映され、同じIDで取得できる。

取得できなくなったIDは `unavailable`、その参照先は `unresolved` になる。現在の原本だけで判断し、削除済みか未定義かを独自の履歴で区別しない。

Logosは自動コミット・自動退避を行わない。Gitに記録していない新規ファイルや変更は、Gitだけでは復元できない。復元操作の前には対象版と現在の差分を確認する。

タスクは `task.update` の `status` に `completed` または `cancelled` を渡して保持する。タスク・試行は `.logos/` 内のGit管理外の実行記録であり、原本の版管理とは保存の目的が異なる。タスク削除・ごみ箱・独自復元の公開操作は設けない。

保存途中でプロセスが強制終了した場合、原本横に `.logos-lock` が残ることがある。別の保存処理が動いていないことを確認し、原本・一時ファイルを確認してから、そのロックだけを取り除く。自動でロックを破棄して競合を隠す処理は行わない。

~~~logos
def logos-usage-recovery
  is document
  part-of logos-usage
~~~
