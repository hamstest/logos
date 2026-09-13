# 言語の基本構造の再検討

言語の設計判断を記録する。採用中の構文と処理契約は [ONTOLOGY.md](../ONTOLOGY.md) に集約する。

名前は対象の識別に必要だが、継承される意味上の属性ではない。意味上の値と参照は、述語と順序付き引数の文に統一した。これにより同じ述語を継承・検査する処理を共有し、多項関係を組のまま保持できる。Markdownの見出し・位置・スコープは出現の情報として分離する。

概念、具体的な記録、述語に排他的な種類を強制しない。具体的な文書が共通条件を受け取ることも `is` で表す。話題を扱うことは `about` で表し、継承とは意味を分ける。言語の核には参照解決、全内容の継承、述語の署名、一意性の検査を残す。

過去の設計からは名前と文を統一する構造を採った。継承は現在の要求に従い、親の全属性・全関係・全条件を無条件に受け取る。旧版の部分的な関係共有には戻さない。仕様変更に合わせて原本・読取器・索引・APIを更新し、並存する旧形式は設けない。

Logos自身の [共通概念と基準](../development.md)、[語彙](../../../shared/language.md)、[ADRの記録](adr-as-knowledge.md) がこの言語の利用対象であり、説明専用の見本は別に置かない。

~~~logos
def logos-language-review
  is architecture-decision
  follows adr-format
  status "accepted"
  about logos-knowledge-change
  concerns logos-ontology, logos-design, parse-annotation, resolve-inheritance, knowledge-graph
~~~
