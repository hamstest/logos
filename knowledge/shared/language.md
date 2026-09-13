# 全内容を継承する

親の全ての文と本文を子へ適用する。複数の親は同時に満たす。循環や親の欠落は診断する。

~~~logos
def is
  signature (reference, reference)
~~~

# 述語の役割を定義する

主体から順に全引数の型を参照で記述する。この述語自体は可変長で、主体と少なくとも一つの引数の型を要求する。

~~~logos
def signature
  unique true
~~~

# 主体ごとの一意性

trueの述語は、一つの主体に対して異なる引数列を一組まで持てる。異なる親からの値も上書きせず衝突として扱う。

~~~logos
def unique
  signature (reference, boolean)
  unique true
~~~

# 検索で使う別名

名称検索を補助する文字列。通常の文として継承される。

~~~logos
def alias
  signature (reference, string)
~~~

# 定義への参照

可視範囲で解決できる名前への参照。

~~~logos
def reference
~~~

# 文字列値

JSONの二重引用符で囲んだ文字列。

~~~logos
def string
~~~

# 数値

有限のJSON数値。

~~~logos
def number
~~~

# 真偽値

trueまたはfalse。

~~~logos
def boolean
~~~

# ソースの接地点

コード読取器がIDコメントと宣言の対応を確認した参照。コード側に意味上の分類を書き込まない。

~~~logos
def source
~~~

# knowledge

再利用する意味や説明を持つ知識。文書と判断基準がこの概念を共有する。

~~~logos
def knowledge
~~~

# document

人が記述した説明文書。文書の分類と、本文が扱う話題を区別する。

~~~logos
def document
  is knowledge
~~~

# criterion

作業の判断に用いる条件。継承した条件はすべて同時に適用する。

~~~logos
def criterion
  is knowledge
~~~

# standard

変更可能な文書上の取り決め。処理系に固定した必須形式とは限らない。

~~~logos
def standard
  is document
~~~

# task

具体的な目的と進捗・結果を記録する。検索で使った概念はタスクの分類とは別に記録する。

~~~logos
def task
~~~

# about

知識の本文が扱う概念を指す。知識本文の検索から話題の概念を取り出すために使い、個体の分類や継承を意味しない。

~~~logos
def about
  signature (reference, reference)
~~~

# governed-by

概念が満たす判断基準を指す。この関係は全子へ継承される。基準から概念へも逆引きする。

~~~logos
def governed-by
  signature (reference, criterion)
~~~

# used-concept

タスクで実際に検索・判断に使った概念を記録する。タスクがその概念の個体であるとは主張しない。

~~~logos
def used-concept
  signature (task, reference)
~~~

# implemented-by

意味や基準を実装するコードのIDへ接地する。参照だけではコードを実行せず、挙動の正しさも保証しない。

~~~logos
def implemented-by
  signature (reference, source)
~~~

# verified-by

意味や基準を確認するテストのコードIDへ接地する。実際に検証済みかどうかは確認記録で判断する。

~~~logos
def verified-by
  signature (reference, source)
~~~

# concerns

関連する知識・語彙・ソースを参照する。関連していることだけから継承や検索の話題を推定しない。

~~~logos
def concerns
  signature (reference, reference)
~~~

# part-of

文書・章などの個体の包含を表す。上位文書の意味上の属性や基準の継承は行わない。

~~~logos
def part-of
  signature (reference, reference)
~~~

# depends-on

処理や知識の依存先を表す。依存先の属性・関係・条件を主体へ無条件に引き継がない。

~~~logos
def depends-on
  signature (reference, reference)
~~~

# derived-from

知識や記録の出典を示す。出典の全意味を継承する関係ではない。

~~~logos
def derived-from
  signature (reference, reference)
~~~

# follows

個体が従う変更可能な標準を示す。特定の標準形式を取得・検索の必須条件にはしない。

~~~logos
def follows
  signature (reference, standard)
~~~

# describes-files

この知識が役割を説明するリポジトリ内の相対パス一覧。ファイル管理範囲の監査に用いる。

~~~logos
def describes-files
  signature (reference, string)
~~~

# standard-revision

個体を記述するときに参照した標準の改訂番号。

~~~logos
def standard-revision
  signature (reference, number)
  unique true
~~~

# status

個体の状態を記述する。値から処理系の状態遷移を自動的に起こさない。

~~~logos
def status
  signature (reference, string)
  unique true
~~~

# date

個体が記録する日付。文字列として記述する。

~~~logos
def date
  signature (reference, string)
  unique true
~~~

# revision

文書標準の改訂番号。

~~~logos
def revision
  signature (reference, number)
  unique true
~~~
