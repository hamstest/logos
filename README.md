# Logos

状況に合う知識と実行方法を使って仕事を進め、その経験や新しい情報から、自身の知識・能力・構成を改善するためのローカル基盤。

主な入口はCodexやClaude Codeなどの対話から呼ぶCLI。文章はMarkdown、プログラムは実装ソースを原本とし、知識のMDはLogos側で管理し、MDの関係からソースの短いIDコメントへ接地する。ソースには意味や関係を埋め込まない。

初期実装として、知識の取得・編集、プロジェクト接続、タスクの直接更新とプロセスへの委譲、改善タスクと知識化を接続した。ホストと4つの標準拡張に加え、公開操作の説明を確認する品質拡張を同梱している。

~~~logos
def logos-readme
  is document
  concerns logos-agent-workflow, logos-design, logos-ontology, logos-usage, logos-extensions, logos-validation, logos-repository, adr-format
  about logos-change
~~~

## 起動

Node.js 22以上で `npm install`、`npm run build` を実行する。`npm test` で動作を確認し、`npm run audit:knowledge` でこのリポジトリの記述と参照を点検する。

`node dist/src/cli.js operations` は現在登録されている操作の説明と入出力スキーマを表示する。操作は `call` と操作名、JSON入力で呼ぶ。CLIは `@ファイルパス` でJSONを読み込める。

タスク本文は `knowledge.context` の `query` へ渡す。既知の概念IDがあれば `concepts` に同時に渡す。本文検索から得たIDと合流して継承・判定を行う。Logosの知識変更では [開発概念と基準](knowledge/projects/logos/development.md) の `logos-knowledge-change` が実際の共通定義を組み合わせている。

~~~logos
def logos-readme-startup
  is document
  part-of logos-readme
~~~

## 利用と実装

- [操作手順](knowledge/projects/logos/USAGE.md)：対話からの使い方、知識、タスク、削除・Git復元。
- [拡張と実行接続](knowledge/projects/logos/EXTENSIONS.md)：操作・読取器の追加、JSONプロセス接続。
- [確認結果と現在の範囲](knowledge/projects/logos/VALIDATION.md)：テストと実装の範囲。
- [全体設計](knowledge/projects/logos/DESIGN.md) / [現行注釈の仕様](knowledge/projects/logos/ONTOLOGY.md) / [言語設計の判断](knowledge/projects/logos/decisions/language-model.md)。
- [ADRの標準形式](knowledge/shared/adr.md)：変更可能な文書標準と、ブロック内に対応関係を記述する方法。
- [ファイル構成と管理範囲](knowledge/projects/logos/REPOSITORY.md)：各ファイルの役割と、`npm run audit:knowledge` による管理漏れの確認。

原本と共有設定は通常のGitで管理する。接続先、タスク、試行、ごみ箱は `.logos/` に保存し、Gitから除外する。解析済みのノードを `.logos/index.json` に永続化し、保存・変更時に更新する。未変更の問い合わせは同じグラフを使う。

現在の委譲先はファイル一覧を取得するローカルコマンドであり、Codex・Claude Codeを自動起動する専用接続は含まない。対話中のエージェントはCLIを通して直接利用できる。WebUIと常駐の自律改善は後続の拡張とする。

~~~logos
def logos-readme-navigation
  is document
  part-of logos-readme
~~~
