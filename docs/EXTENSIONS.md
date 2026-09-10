# 拡張と実行接続

## 通常の拡張

[quality.ts](../examples/quality.ts) が、ホストを編集せずに追加した拡張の実例。TypeScriptをビルドし、`config/logos.json` の `plugins` に生成されたモジュールを指定する。明示したモジュールだけを読み込む。

```json
{"module":"dist/examples/quality.js","enabled":true}
```

モジュールは `Extension` をdefault exportする。`id`、`description`、必要な拡張の `requires`、任意の `implementationId` と `setup(host, options)` を持つ。`setup` 内で `host.register` を呼び、操作の `name`、`description`、Zodの `input` と `output`、`handler` を登録する。操作単位の `implementationId` は拡張の指定を上書きできる。

ホストは同じスキーマを実行時の検査と `operations` のJSON Schemaに使う。拡張の依存がない、循環している、操作名が重複している場合は起動エラーにする。`plugins[].enabled:false` にした拡張の操作は呼び出せない。

標準拡張の無効化には `disabledExtensions` にIDを指定する。依存する拡張も無効化するか、代替実装を登録する。標準拡張は `knowledge`、`tasks`、`execution`、`improvement`。新しい拡張と読取器は同じホストAPIを使う。

同じプロセス・権限で動く信頼した拡張を前提とする。隔離、hot reload、リモート配布は初期版に含めない。動作するソースを変更したら、ビルドして次のCLI起動から利用する。

## 読取器

`host.addReader({id, extensions, read})` で拡張子と読取関数を登録する。`read` は `rootId`、`path`、`text`、`scope` を受け取り、ノードと診断を返す。構文の解釈は読取器、IDの解決・関係探索は共通知識グラフの担当。既存の拡張子を重ねて登録すると起動エラーにする。

`host.sources.push(async () => sources)` でタスクなどの派生した参照元も供給できる。標準タスク拡張は記録から読取専用の原文ビューを生成する。原本と位置がない派生記録を、Markdownの章編集操作で変更しない。

`contextFilters` に登録操作名を並べると、`knowledge.context` が明示的にその操作を呼ぶ。入力は `query`、解決済み `concepts`、`situation`、当該ページの `candidates`。戻り値は `judgments` へ添付する。標準例は `quality.applicability`。未知の条件を `unknown` として返す。リンクから任意コードを探索実行したり、判定結果を理由なく使って知識を消したりしない。

## JSONプロセス接続

標準の実行アダプターは、外部プロセスとのJSON入出力を扱う。既存ツールやエージェントへ接続する場合は、このプロトコルと接続先のインターフェースを変換する小さなランナープログラムを用意する。

設定例は同梱の読取専用ランナー。

```json
{"id":"local-inventory","command":"node","args":["${workspace}/examples/inventory-runner.mjs"],"description":"対象プロジェクトのファイル一覧を取得する","timeoutMs":30000}
```

`${workspace}` はLogosの場所へ置換する。コマンドはシェルを経由せず起動し、カレントディレクトリはタスクのプロジェクトとする。作業ディレクトリが異なるため、ランナースクリプトは絶対パスまたはこの置換を使う。`command` には実行ファイルを指定し、シェル組み込みやWindowsの `.cmd` を直接指定しない。

標準入力へ一つのJSONを渡す。

```text
{ protocol: 1, attemptId, task, project, context, situation }
```

標準出力には次の形式のJSONを一つだけ返す。ログは標準エラーへ出す。

```json
{"status":"completed","summary":"行った作業と結果","artifacts":[],"checks":[{"description":"実際に行った確認","outcome":"passed","evidence":"確認内容"}]}
```

`status` は `completed` / `failed` / `waiting`、確認の `outcome` は `passed` / `failed` / `unverified`。これはランナーの報告であり、独立した検証の証明ではない。

標準出力は2 MBまで。タイムアウト・異常終了・不正なJSONは `unknown` になり、再実行を止める。試行とタスクは別のファイルに保存する。起動前後でアプリが停止しても未解決の試行を残す。自動的な再起動・再試行は行わない。

タイムアウト時は直接の子プロセスへ停止を要求し、入出力を閉じる。ランナーがさらに起動したプロセスの停止までは保証しない。`execution.reconcile` の前に接続先の実行状態も確認する。外部への公開や破壊的な変更では、接続先の通常の確認・認証手段をランナー側で維持する。

現在同梱するのはファイル一覧を読む実例であり、Codex・Claude Codeの専用ランナーではない。両者の自動起動や認証設定をこの実装で変更しない。
