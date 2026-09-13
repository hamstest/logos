# 実装の確認結果

採用中の定義・文のモデルと、見出し・説明・ブロックの順序、ソースIDの後置、短いIDとカンマでの列挙を対象として確認する。確認コマンドは `npm test` と `npm run audit:knowledge`。旧版の試験結果を新しい処理系の検証として扱わない。

今回の確認結果は、`npm test` が38件成功、`npm run audit:knowledge` が46ファイル（索引化40件・ファイル記述6件）を確認し、問題0件。Logos自身の `logos-knowledge-change` から6基準の継承と、公開操作の説明検査も確認した。

~~~logos
def logos-validation
  is document
  concerns verify-inheritance-search, verify-workflow, verify-knowledge, verify-source-id-format, verify-source-grounding, verify-external-knowledge, verify-knowledge-root-boundary, verify-anchor-conflicts
  about logos-change
~~~

## 実施した確認

テストはMarkdownの章境界、配置違反、ソースのID接地、全親の継承と衝突、型と多項関係、検索起点の合流、保存時の索引更新、変更競合、タスクと実行記録を確認する。実際の一時Gitリポジトリで章の削除・復元と索引更新を確認し、独自復元APIの撤去、参照元の非変更、完了・取消後のタスク保持も検査する。

リポジトリ監査は管理対象ファイル、名前の定義、MDからソースへの参照、語彙と継承の診断を確認する。テストのための一時データは本番の知識ベースに登録しない。

~~~logos
def logos-validation-checks
  is document
  part-of logos-validation
~~~

## 実際の一周

Logos自身の知識で確認する。`logos-knowledge-change` はLogosの変更と知識の変更を同時に継承し、共通の変更基準を重複させずに受け取る。各基準の実装・検証への接地、公開操作の説明、リポジトリの管理範囲を実際の索引から点検する。

~~~logos
def logos-validation-workflow
  is document
  part-of logos-validation
~~~

## 現在の範囲

自然文の条件は出典付きで供給するが、自動証明は行わない。標準検索はBM25と名称・別名の補助検索であり、埋め込みモデルは同梱しない。追加の検索プロバイダーは登録できる。

索引は原本変更時に派生グラフを再計算する。大規模グラフの部分更新は未実装。IDを置いた接地点と文書の対応を検査するもので、全行の意味的な完全性を保証しない。

~~~logos
def logos-validation-limits
  is document
  part-of logos-validation
~~~
