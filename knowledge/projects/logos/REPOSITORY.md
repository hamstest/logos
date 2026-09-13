# ファイル構成とLogosの管理範囲

[言語設計の判断](decisions/language-model.md) は採用した言語の基本構造の判断理由を記録する。現行仕様は [ONTOLOGY.md](ONTOLOGY.md) に集約する。

現時点のファイルの役割と、Logosから参照する方法をまとめる。配置や管理方針は運用に応じて変更できる。ファイルを読込範囲に入れることと、注釈・IDによってノードを作ることは両方必要である。

~~~logos
def logos-repository
  is document
  about logos-change
  concerns configuration, source-roots, load-graph, knowledge-service, task-store, build-workspace, audit-knowledge, logos-design, logos-ontology, logos-usage
  describes-files ".gitignore", ".gitattributes", "config/logos.json", "package.json", "package-lock.json", "tsconfig.json"
~~~

## 配置と役割

| ファイル・場所 | 役割 |
|---|---|
| [README.md](../../../README.md) | 起動方法と文書への入口 |
| [AGENTS.md](../../../AGENTS.md) | 指示から概念候補を調べ、定義を確認して関係探索へ進む手順 |
| [DESIGN.md](DESIGN.md) | 目的、構成、知識供給、実行・改善の設計 |
| [ONTOLOGY.md](ONTOLOGY.md) | 共通注釈、ソースID、関係、原本への接地 |
| [USAGE.md](USAGE.md) | 公開操作を使う手順 |
| [EXTENSIONS.md](EXTENSIONS.md) | 拡張、読取器、プロセス接続の契約 |
| [VALIDATION.md](VALIDATION.md) | 実施した確認と実装範囲 |
| `src/app.ts`、`src/cli.ts`、`src/config.ts` | 起動、CLI、設定・読込範囲の解決 |
| `src/host/` | 拡張登録と競合検出を伴うファイル保存 |
| `src/extensions/` | 知識、タスク、実行、改善の標準拡張 |
| `src/knowledge/` | 原本読取、全親の定義合成、日本語検索、概念候補・関係探索、出力スキーマ。`service.ts` がホストごとの索引を共有する |
| `src/tasks/store.ts` | タスクのスキーマ・保存・取得。知識・実行・改善の各拡張から共用する |
| `test/` | 統合、知識、ソース接地の確認 |
| `src/extensions/quality.ts` | 公開操作の説明と基準の適用を確認 |
| `scripts/inventory-runner.mjs` | 接続先のファイル一覧を読むランナー |
| `scripts/build.mjs` | `dist/` を再生成し、削除・移動済みソースの古い出力を残さない |
| `scripts/audit-knowledge.mjs` | リポジトリ内の管理漏れ・参照切れの点検 |
| `knowledge/shared/` | プロジェクトに依存しない言語語彙と、変更可能なADR標準 |
| `knowledge/projects/` | Logos内に保存するプロジェクト固有の知識・ADR。`logos/development.md` に開発概念と実装への接地、`logos/decisions/` に設計判断を置く |
| [config/logos.json](../../../config/logos.json) | 読込元、拡張、評価操作、ランナーの共有設定 |
| [package.json](../../../package.json) / [package-lock.json](../../../package-lock.json) | コマンド・依存関係と解決済みの依存バージョン |
| [tsconfig.json](../../../tsconfig.json) | TypeScriptのビルド設定 |
| [.gitignore](../../../.gitignore) / [.gitattributes](../../../.gitattributes) | 生成物の除外とテキストの改行方針 |

全体設計・言語仕様・操作・拡張契約・検証・配置の文書は `knowledge/projects/logos/` 直下に集める。開発概念と基準は同じ場所の `development.md`、判断理由は `decisions/` に置く。リポジトリ直下の文書は入口となる `README.md` と `AGENTS.md` とする。

索引管理とタスク保存は拡張登録モジュールから分離した。依存は各拡張 → タスク保存 → 索引サービスとなり、知識拡張とタスク拡張の循環参照をなくす。

~~~logos
def logos-repository-layout
  is document
  part-of logos-repository
~~~

## 管理する範囲

- `self-docs`：リポジトリ直下の `README.md` と `AGENTS.md`。
- `logos-knowledge`：`knowledge/projects/logos/` 以下の設計・仕様・操作文書、開発概念、設計判断。通常のプロジェクト知識ルートで読み込み、文書と章のIDから検索・取得する。章と文書は `part-of`、別文書や実装への対応は `concerns` などをブロック内に記す。
- `self`：`src/`、`test/`、`scripts/` のソース。必要な処理に短いIDコメントを置き、意味と関係はMDから参照する。全関数・全行を個別ノードにする方針ではない。
- `shared` と各プロジェクトの知識ルート：共有知識、標準、プロジェクトの記録を通常のMDとして扱う。
- 設定・ロックファイル：上表で役割と原本のパスを記述する。この文書の `describes-files` は、ファイルの相対パスを記す述語で、点検スクリプトが使う。これらのJSONなどを直接ノード化する読取器は現在ないため、内容は原本を読む。

対象プロジェクトが未接続の場合、そのプロジェクトの知識は通常の読込対象にならない。点検では保存済みのMDの注釈を確認し、未接続による非表示と注釈の不足を分けて報告する。外部プロジェクトのMDまで自動で読む設定にはしない。

~~~logos
def logos-repository-coverage
  is document
  part-of logos-repository
~~~

## 生成物と過去の作業ファイル

`node_modules/`、`dist/`、`.npm-cache/` は依存物・ビルド出力・キャッシュで、知識索引の対象外。`.logos/index.json` は再生成可能な派生索引。`.logos/local/` は接続設定、`.logos/tasks/` と `.logos/attempts/` は作業・実行記録を保持する。これらはGit管理外の原本であり、再生成可能な索引と同じ扱いで削除しない。

説明用のプロジェクト知識とデモ生成スクリプトは配置しない。過去の知識の退避資料は `.logos/archive/` に残り、現在の言語仕様・検索対象には含めない。旧形式用の一回限りの移行スクリプトと重複した監査・検索出力は整理して撤去する。

Git導入後の役割分担は次のとおり。

| 機能 | 判断と理由 |
|---|---|
| 独自ごみ箱・復元・削除台帳 | 撤去。記録済み原本の差分・復元はGitで扱う |
| 知識の章削除と範囲プレビュー | 維持。対象IDから原本の編集範囲を特定し、子節と競合を確認する |
| タスクの削除・復元 | 撤去。Git管理外の記録は完了・取消で保持する |
| ファイルのハッシュ・排他保存 | 維持。進行中の同時編集はGitの履歴で保護できない |
| 試行ID・結果不明の確認 | 維持。外部処理が既に実行されたかはGitでは判定できない |
| 永続索引・使用概念の記録 | 維持。検索の派生データとタスクの実行情報であり、版管理ではない |

ビルドは毎回 `dist/` だけを再生成する。廃止した機能のコンパイル済みファイルや旧配置の出力も残さない。

~~~logos
def logos-repository-generated
  is document
  part-of logos-repository
~~~

## 管理漏れの点検

`npm run audit:knowledge` を実行する。Gitの管理対象と未追跡・非除外ファイルを列挙し、Markdown・ソースのノード、MDからソースへの参照、その他のファイルの記述、プロジェクト範囲、診断を確認する。説明用コードブロック内の見本は登録対象に数えない。

点検は読取専用で、結果をJSONとして表示する。新しい管理対象の文書に注釈がない、読込設定から漏れている、ソースに接地点がない、参照が切れている場合は終了コード1を返す。設定などの非対応形式には、この文書のように役割とパスを記述する。これはファイル単位の管理漏れの確認であり、全コードの意味や全関係の完全性を保証するものではない。

~~~logos
def logos-repository-audit
  is document
  part-of logos-repository
~~~
