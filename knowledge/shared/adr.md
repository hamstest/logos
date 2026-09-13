# 設計上の意思決定記録

ある状況で何を選び、なぜ選んだか、その影響と適用範囲を残す知識。設計、構成、運用方針などの判断を対象とする。

~~~logos
def architecture-decision
  is document
  alias "ADR", "Architecture Decision Record", "設計判断", "設計決定"
~~~

# ADRの標準形式

現時点のADR標準は、背景、判断、理由、影響、再検討条件を文章で記す。状態と日付、参照した標準改訂番号、話題と実装への対応を定義ブロック内の通常の文で表せる。

`is` で `architecture-decision` の共通条件を受け取り、`follows` でこの標準を参照する。`status`、`date`、`standard-revision` も同じ文の構造を使う。

特定のADR形式をシステムの取得・検索の必須構造には現時点では組み込まない。標準とこの判断は運用に応じて変更できる。Logosで運用する記録は [ADR活用方針](../projects/logos/decisions/adr-as-knowledge.md) にある。

~~~logos
def adr-format
  is standard
  about architecture-decision
  revision 1
~~~
