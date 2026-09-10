```logos
format: 1
id: concept/money-operation
kind: concept
title: 金銭処理
aliases: [money operation]
```
# 金銭処理

金額の変化を伴う処理。この例では返金を下位概念にする。

```logos
format: 1
id: concept/external-operation
kind: concept
title: 外部連携
aliases: [external operation]
```
# 外部連携

プロセス外部へ要求を渡す処理。

```logos
format: 1
id: concept/refund
kind: concept
title: 返金処理
aliases: [refund]
links:
  - relation: is_a
    target: concept/money-operation
  - relation: is_a
    target: concept/external-operation
```
# 返金処理

本文に同じ語句がなくても、両方の上位概念から知識を得るためのサンプル。

```logos
format: 1
id: criterion/reconciliation
kind: criterion
links:
  - relation: applies_to
    target: concept/money-operation
```
# 処理前後の対応を確認する

このサンプルプロジェクトでは、変更前の値、変更量、変更後の値を対応付けて確認する。

```logos
format: 1
id: criterion/retry-awareness
kind: criterion
links:
  - relation: applies_to
    target: concept/external-operation
```
# 重複した要求を考慮する

このサンプルプロジェクトでは、応答が失われた場合も考慮し、同じ要求を繰り返したときの挙動を確認する。

```logos
format: 1
id: concept/logos-change
kind: concept
title: Logosの変更
aliases: [Logos, annotation, 注釈, knowledge]
```
# Logosの変更

本体、拡張、知識、読取器、接続方法の変更を含む。

```logos
format: 1
id: criterion/annotation-boundaries
kind: criterion
links:
  - relation: applies_to
    target: concept/logos-change
```
# 注釈は原本の対象に結び付ける

Markdownの見出しとTypeScriptの宣言を、それぞれの構文で読み取る。隣の対象に飛び越して結び付けず、説明用の文字列やコード例を定義として扱わない。ソースを索引化するときにコードを実行しない。

```logos
format: 1
id: criterion/semantic-context
kind: criterion
links:
  - relation: applies_to
    target: concept/logos-change
```
# 語句の順位と概念からの適用を分ける

明示された概念とそのすべての上位概念から、適用対象の一致する知識を集める。本文検索の上位件数でその探索を切らない。出力量を超えたときは続きの位置を返す。プロジェクト固有の情報は、共有知識とそのプロジェクトの範囲で供給する。

```logos
format: 1
id: criterion/recoverable-changes
kind: criterion
links:
  - relation: applies_to
    target: concept/logos-change
```
# 原本を失わない変更

更新は読込時点のハッシュと照合する。管理操作で削除する原文は、原本を変更する前に復元情報とともに保存する。復元先の本文やIDが変わったときは上書きしない。リンク先を連鎖して削除しない。

```logos
format: 1
id: criterion/explicit-execution
kind: criterion
links:
  - relation: applies_to
    target: concept/logos-change
```
# 実行と結果確認を区別する

登録された操作・ランナーだけを呼び出す。注釈の実装関係だけではコードを実行しない。委譲前に試行IDを保存し、結果が不明なら利用者・エージェントが確認してから再開する。完了報告と確認結果は別に保持する。

```logos
format: 1
id: criterion/public-documentation
kind: criterion
links:
  - relation: applies_to
    target: concept/logos-change
```
# 公開機能の説明を確認する

公開する機能について、利用目的と入力・出力を説明する。サンプルのquality.documentation操作は、渡された公開メンバーの説明と名前の重複を確認する。実際のコード全体を解析する評価ではない。非公開作業への適用は不要で、公開予定が不明なら適用判定も不明とする。
