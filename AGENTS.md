# このリポジトリでの知識の調べ方

設計・実装の変更時は、元のタスク本文を `knowledge.context` の `query` に渡す。既に概念IDを特定できている場合は `concepts` に同時に渡す。本文検索で得たIDと合流してから、継承と判断で知識を取捨選択する。IDを新造して検索の不足を埋めない。

未ビルド、または実装変更後は `npm run build` を先に行う。候補の根拠は `knowledge.discover`、全文は `knowledge.get` で必要に応じて読む。診断、曖昧さ、判定理由、自然文の条件を確認する。

概念は共通の意味を再利用するために定義する。`is` では全親の文・本文・条件を無条件に引き継ぐ。一部だけ必要なら共通部分を親として切り出す。文書が扱う話題は `about` で記す。

定義は `def` と文の記法に統一し、「見出し → 説明 → ブロック」の順に置く。IDは種類の接頭辞とスラッシュを使わず、同じ述語の値はカンマでまとめる。ソースのIDコメントは対象の直後へ置く。説明専用の概念や見本ファイルは用意せず、Logos自身を記述する。開発中の変更で旧形式や互換APIを併設しない。変更後は対応するテストと `npm run audit:knowledge` を実行する。仕様は [ONTOLOGY.md](knowledge/projects/logos/ONTOLOGY.md)、操作は [USAGE.md](knowledge/projects/logos/USAGE.md) を参照する。

~~~logos
def logos-agent-workflow
  is document
  about logos-knowledge-change
  concerns logos-usage, search-knowledge, knowledge-graph
~~~
