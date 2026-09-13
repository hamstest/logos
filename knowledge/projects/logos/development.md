# Logosの変更

本体、拡張、知識、読取器、接続方法の変更を含む。この文書の概念と基準はLogosの開発で使う定義であり、実装への接地もLogosのプロジェクト範囲に置く。

~~~logos
def logos-change
  is change
  alias "Logos", "annotation", "注釈", "knowledge"
  governed-by explicit-execution, public-documentation, registered-capabilities
~~~

# 注釈は原本の対象に結び付ける

Markdownの見出しとTypeScriptの宣言を、それぞれの構文で読み取る。隣の対象に飛び越して結び付けず、説明用の文字列やコード例を定義として扱わない。ソースを索引化するときにコードを実行しない。

~~~logos
def annotation-boundaries
  is criterion
  implemented-by read-markdown, read-typescript
  verified-by verify-knowledge
~~~

# 語句の順位と概念からの適用を分ける

タスク本文を知識本文に検索し、その知識が扱う概念IDと呼び出し側の既知の概念IDを合流する。その後に全親の定義・属性・関係・基準を使って必要な知識を追加・除外する。検索のための概念対応を恒久的な分類として書き込まない。保存時に索引を更新し、未変更の原本を問い合わせごとに解析し直さない。タスクには実際に使った概念を記録する。

~~~logos
def semantic-context
  is criterion
  implemented-by knowledge-extension, knowledge-graph, knowledge-service
  verified-by verify-knowledge
~~~

# 原本を失わない変更

更新・削除は読込時点のハッシュと照合し、同時保存を排他する。削除する章と子節の範囲を確認し、参照先を連鎖して削除しない。原本の履歴・差分・復元はGitで扱い、独自のごみ箱や削除履歴は作らない。復元できる内容はGitへ記録した範囲であり、未記録の編集は自動保存されない。タスク・試行はローカルの実行記録として保持する。

~~~logos
def recoverable-changes
  is criterion
  implemented-by atomic-write
  verified-by verify-workflow
~~~

# 実行と結果確認を区別する

登録された操作・ランナーだけを呼び出す。注釈の実装関係だけではコードを実行しない。委譲前に試行IDを保存し、結果が不明なら利用者・エージェントが確認してから再開する。完了報告と確認結果は別に保持する。

~~~logos
def explicit-execution
  is criterion
  implemented-by run-process, execution-extension, tasks-extension, task-store
  verified-by verify-workflow
~~~

# 公開機能の説明を確認する

公開する機能について、利用目的と入力・出力を説明する。quality.documentation操作は、入力を省略すると登録済み公開操作の説明を確認する。メンバーを指定した場合はその説明と名前の重複を確認する。実際のコード全体を解析する評価ではない。非公開作業への適用は不要で、公開予定が不明なら適用判定も不明とする。

~~~logos
def public-documentation
  is criterion
  implemented-by check-public-documentation
~~~

# 説明と実行を同じ登録に結び付ける

機能一覧の入出力は、実際の呼出時に検査するスキーマから生成する。機能の追加には通常の拡張登録を用い、ホストの変更を必須にしない。実装IDから文章や検証へ辿れるようにする。ソースの注釈だけで、無効な拡張を実行可能として扱わない。

~~~logos
def registered-capabilities
  is criterion
  implemented-by host
  verified-by verify-workflow
~~~

# 変更

原本を変更する作業。変更前後を比較でき、参照先を連鎖して失わない。

~~~logos
def change
  governed-by recoverable-changes
~~~

# 知識の変更

知識の定義・構造・検索の変更。原本への付着と意味に基づく供給を維持する。

~~~logos
def knowledge-change
  is change
  governed-by annotation-boundaries, semantic-context
~~~

# Logosの知識の変更

Logos固有の変更基準と、知識変更の基準をすべて引き継ぐ。子には同じ基準のリンクを繰り返さない。

~~~logos
def logos-knowledge-change
  is logos-change, knowledge-change
~~~
