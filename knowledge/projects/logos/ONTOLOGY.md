# 概念・継承・知識供給の言語仕様

2026-09-14改訂。言語の基本単位は名前の定義、値、述語と引数の文、原本上の出現である。Markdown、索引、取得API、タスクの知識表現に同じモデルを使う。説明用の架空データは置かず、この文書とLogos自身の知識定義を実際の利用対象とする。

~~~logos
def logos-ontology
  is document
  concerns resolve-inheritance, read-markdown, read-typescript, parse-annotation, make-node, knowledge-node-schema, knowledge-context-schema, logos-design, adr-format, logos-language-review
  about logos-knowledge-change
~~~

## 1. 原本と識別

知識の原本はLogos内のMarkdown、ソースの原本は対象リポジトリのコードとする。IDは安定した名前であり、表示名・パス・行番号から独立する。接頭辞で種類を判定しない。名前の定義は一箇所に置き、参照しただけの名前を自動生成しない。

共通の意味は既存の親から組み立てる。章の編集単位を識別することと、新しい意味を定義することは区別する。所在、表示見出し、可視範囲は出現の情報であり、意味の継承に混ぜない。

~~~logos
def logos-ontology-originals
  is document
  part-of logos-ontology
~~~

## 2. 定義と値の記法

定義の先頭行は `def`、半角空白、ID。続く各行は半角空白2個、述語ID、半角空白、値とする。同じ述語の値はカンマでまとめる。[開発概念と基準](development.md) の `logos-knowledge-change` は、二つの親を一行の `is` で指定している。

IDと述語名は英字またはアンダースコアで始まり、以降は英数字・アンダースコア・ハイフンを使える。種類を示す接頭辞は付けず、スラッシュ・パーセント・ピリオドは使わない。`true` と `false` は真偽値のためIDには使わない。プロジェクトIDも同じ規則に従い、そのまま `knowledge/projects/` 以下のディレクトリ名にする。

裸の名前は参照、二重引用符で囲むJSON文字列は文字列、有限のJSON数値と真偽値はリテラルとして区別する。一つの多項関係は括弧内に役割順の引数をカンマで並べる。[language.md](../../shared/language.md) の `signature` の記述で使っている。括弧の外のカンマは別の文、括弧の中のカンマは一つの文の別の引数を表す。現在の定義対象が暗黙の第一引数（主体）となる。

排他的な種類欄や、属性用と参照用に分かれた欄はない。述語も同じ名前付き定義であり、継承できる。内部・公開APIでは定義を `id` と `statements`、各文を `predicate` と `arguments` で表す。参照値は `ref` を持つオブジェクト、リテラルはそのままの値で表す。

~~~logos
def logos-ontology-model
  is document
  part-of logos-ontology
~~~

## 3. Markdownへの付着

Markdownは「見出し → 説明 → 定義ブロック」の順にする。言語名 `logos` のフェンスを、その見出しに続く説明の末尾に置く。子見出しがある場合は、その手前に置く。説明中には段落・リスト・表・コードブロックを使える。見出し前の定義、定義の後に続く同じ節の説明、同じ見出しへの複数定義は診断する。ATX見出しとSetext見出しを扱う。

章の本文と編集範囲は見出しから次の同じか浅い見出しの直前までとする。取得本文には子節の文章を含め、管理用のフェンスは除く。引用や別のコードフェンス内の文字列は定義にならない。作成と更新も説明の末尾へ定義を配置する。子節のIDが失われる更新は拒否する。

~~~logos
def logos-ontology-attachment
  is document
  part-of logos-ontology
~~~

## 4. 属性・関係・コードとの接地

述語の `signature` は主体を含む全役割の型を順に指定する。型は `reference`、`string`、`number`、`boolean`、`source`、または継承すべき定義ID。`source` はコード読取器による接地点を指す。`unique true` は、一つの主体についてその述語の異なる引数列を一組までとする。指定しない場合は複数の文を保持する。述語の宣言、参照先、引数数と型、一意性を索引で検査する。

言語の核が解釈するのは継承、署名、一意性と値型。`signature` 自体は可変長で、主体と少なくとも一つの引数の型を要求する。名称検索に用いる `alias` も通常の文として継承する。通常の語彙を追加するだけで新しい外部処理を実行可能にはしない。

ソースでは関数・クラス・メソッド・変数宣言・式文の直後に、独立した行の短いIDコメントを置く。読取器は直前の対象を構文から特定し、別の構文を飛び越して結び付けない。[markdown.ts](../../../src/knowledge/markdown.ts) の `read-markdown` を、この文書の定義から参照している。意味の記述はMD側に置く。参照の逆引きは索引から行い、読取時にコードは実行しない。

~~~logos
def logos-ontology-grounding
  is document
  part-of logos-ontology
~~~

## 5. 全内容を引き継ぐ複数継承

`is` は全内容を無条件で受け取るMixinの継承を表す。子は全親の文、自然文の定義・条件を受け取る。具体的な文書や判断基準も同じ継承で表す。主体は子へ適用するが、引数に書かれた参照先は変更しない。

同一の文は重複を除き、宣言元と継承経路を保持する。共通祖先は一度だけ取り込む。一意性に反する異なる文は全部保持し、衝突として診断する。子による上書き、親の順序による優先、部分的な継承除外はない。一部だけ必要なら、その共通部分を親として分離する。循環と取得できない親も診断する。

`about` は本文の話題、`governed-by` は適用基準、`used-concept` はタスクで使った概念を表す。包含や依存の参照だけでは継承しない。`knowledge.get` の `statements` は直接の記述、`effective.statements` は出典付き合成結果。`knowledge.related` は参照引数を辿るための派生表示で、元の文の引数列と参照位置も返す。

~~~logos
def logos-ontology-relations
  is document
  part-of logos-ontology
~~~

## 6. 保存と索引更新

`.logos/index.json` に解析済みの定義と原本の変更情報を保存する。管理操作の保存後、外部エディターの変更通知後に同期する。起動時とアクセス時にも変更情報を照合し、監視の取りこぼしを補う。未変更の本文を読み直さず、継承・検索データを再利用する。

現在はファイル単位の解析結果を永続化し、原本の変更時に派生グラフと検索データを再計算する。再起動時は保存済み定義から合成する。大規模索引の差分グラフ更新は未実装。

タスクJSONは同じ文のモデルで直接索引へ追加する。Markdownなどへの変換と再解析を挟まない。索引は再生成できる派生物で、原本の履歴はGitで管理する。編集競合には原本の `origin.hash` を使う。

~~~logos
def logos-ontology-loading
  is document
  part-of logos-ontology
~~~

## 7. タスク本文からの知識供給

1. タスク本文で知識本文をBM25検索する。名称・別名は補助に用い、検索プロバイダーがあればRRFで順位を統合する。
2. ヒットした知識の `about`、基準への対応、定義自身のIDから起点を得る。コードIDはMDからの参照を逆引きする。
3. 呼び出し側が既知の `concepts` を同時に渡した場合、取得したIDと合流する。
4. 継承した全文・基準と関連知識を取得し、登録した判定操作で追加・除外・不明を判断する。その後にページ分割する。
5. タスクを指定した検索では、実際に使った概念を `usedConcepts` に記録し、同じ索引へ反映する。

`knowledge.context` は `query` だけで呼べる。候補を確認する `knowledge.discover` は任意の操作。類似度は分類の真偽を証明しない。自然文の条件や判定不明はエージェントが確認する。検索全体のスナップショットは要求しない。

~~~logos
def logos-ontology-execution
  is document
  part-of logos-ontology
~~~
