# 拡張と実行接続

Logosの操作・読取器・検索・判定と外部プロセスを接続する契約を記述する。

~~~logos
def logos-extensions
  is document
  about logos-change
  concerns host, execution-extension, run-process, check-public-documentation, inventory-runner
~~~

## 通常の拡張

[quality.ts](../../../src/extensions/quality.ts) は公開操作の説明と適用基準を確認する拡張。TypeScriptをビルドし、`config/logos.json` の `plugins` に生成されたモジュールを指定する。明示したモジュールだけを読み込む。

モジュールは `Extension` をdefault exportする。`id`、`description`、必要な拡張の `requires`、任意の `implementationId` と `setup(host, options)` を持つ。`setup` 内で `host.register` を呼び、操作の `name`、`description`、Zodの `input` と `output`、`handler` を登録する。操作単位の `implementationId` は拡張の指定を上書きできる。

ホストは同じスキーマを実行時の検査と `operations` のJSON Schemaに使う。拡張の依存がない、循環している、操作名が重複している場合は起動エラーにする。`plugins[].enabled:false` にした拡張の操作は呼び出せない。

標準拡張の無効化には `disabledExtensions` にIDを指定する。依存する拡張も無効化するか、代替実装を登録する。標準拡張は `knowledge`、`tasks`、`execution`、`improvement`。新しい拡張と読取器は同じホストAPIを使う。

同じプロセス・権限で動く信頼した拡張を前提とする。隔離、hot reload、リモート配布は初期版に含めない。動作するソースを変更したら、ビルドして次のCLI起動から利用する。

~~~logos
def logos-extensions-extensions
  is document
  part-of logos-extensions
~~~

## 読取器

`host.addReader` でID、拡張子、読取関数を登録する。読取関数は `rootId`、`path`、`text`、`scope` を受け取り、定義と診断を返す。構文解釈と出現の特定は読取器、名前解決・継承・文の検査は共通知識グラフが担当する。

ソース読取器はID・コード・位置だけを返す。タスク読取器はJSON記録から定義と文を直接作り、同じ索引に追加する。生成された記録は元のタスク操作で変更し、Markdownの章編集操作には渡さない。

読取器を追加する拡張の契約は [host.ts](../../../src/host/host.ts)、実際の読取器は [markdown.ts](../../../src/knowledge/markdown.ts)、[typescript.ts](../../../src/knowledge/typescript.ts)、[tasks.ts](../../../src/extensions/tasks.ts) にある。既存の拡張子の重複登録は起動エラーとする。

~~~logos
def logos-extensions-readers
  is document
  part-of logos-extensions
~~~

## JSONプロセス接続

標準の実行アダプターは外部プロセスとのJSON入出力を扱う。現在の接続設定は [logos.json](../../../config/logos.json)、対象プロジェクトのファイル一覧取得は [inventory-runner.mjs](../../../scripts/inventory-runner.mjs) に実装している。

ランナー設定の `${workspace}` はLogosの場所に置換する。コマンドはシェルを経由せず、タスクのプロジェクトを作業ディレクトリとして起動する。標準入力にはプロトコル番号、試行ID、タスク、プロジェクト、選ばれた知識、状況をJSONで渡す。

標準出力には状態、要約、成果物、実際の確認結果をJSONで返す。状態は completed・failed・waiting、確認結果は passed・failed・unverified。ログは標準エラーへ出す。契約は [execution.ts](../../../src/extensions/execution.ts) の実行時スキーマに定義している。

出力上限は2MB。タイムアウト・異常終了・不正な出力は結果不明となり、自動再試行しない。直接の子プロセスへ停止を要求するが、さらに起動されたプロセスの停止までは保証しない。`execution.reconcile` の前に実行状態と成果物を確認する。Codex・Claude Codeへの専用ランナーは同梱していない。

~~~logos
def logos-extensions-process
  is document
  part-of logos-extensions
~~~

## 検索プロバイダーと判定操作

標準検索はNFKC、日本語の語分割、本文のBM25方式の採点、名称・別名の補助加点を使う。継承した定義・文も検索本文に含める。索引が変わった時に本文と語句を準備し、未変更の問い合わせでは再利用する。

意味検索は拡張の `setup(host)` で `host.addSearchProvider` に登録できる。現在の型は [search.ts](../../../src/knowledge/search.ts)。`search` に `query`、`terms`、`project` と範囲内の `documents: {id,title,text}[]` を渡し、`{id,score}[]` を返す。全体スナップショット引数はない。モデルとベクトル索引の更新はプロバイダー側が担当する。標準構成には外部検索サービスや埋め込みモデルを含めない。

語句検索と追加方式の順位はRRF（定数60）で統合する。存在しないID、範囲外ID、非正・非有限スコアは除外する。失敗は診断に残し、語句検索を継続する。外部処理のタイムアウトはプロバイダーが設定する。

`contextFilters` に登録する公開操作は、`query`、`concepts`、`situation`、候補のID配列 `candidates` を受け取り、ID、判定 `decision`、理由 `reason` を持つ要素の配列を返す。実装は `quality.applicability` にある。

`decision` は `include / exclude / unknown`。`include` は範囲内の既存知識を追加できる。`exclude` は結果から除外する。複数判定が衝突すれば除外を優先し、理由を残す。`unknown` は未確定として `incomplete` に反映する。判定後に出力をページ分割する。

実行時も `execution.run` の任意の `concepts`、`terms`、`targets` をタスク本文の検索と合流する。試行・タスクには使った概念IDを保存する。プログラムからホストを常駐利用した場合、終了時に `host.close()` で索引の監視を終了する。

~~~logos
def logos-extensions-search
  is document
  part-of logos-extensions
  concerns search-knowledge
~~~
