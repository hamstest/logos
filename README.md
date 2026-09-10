# Logos

状況に合う知識と実行方法を使って仕事を進め、その経験や新しい情報から、自身の知識・能力・構成を改善するためのローカル基盤。

主な入口はCodexやClaude Codeなどの対話から呼ぶCLI。文章はMarkdown、プログラムは実装ソースを原本とし、知識のMDはLogos側で管理し、MDの関係からソースの短いIDコメントへ接地する。ソースには意味や関係を埋め込まない。

初期実装として、知識の取得・編集・復元、プロジェクト接続、タスクの直接更新とプロセスへの委譲、改善タスクと知識化を接続した。ホストと4つの標準拡張に加え、ホストを変更せず追加する評価拡張の例を同梱している。

## 起動

Node.js 22以上が必要。

```powershell
npm ci
npm test
npm run logos -- operations
```

WindowsでJSONを渡す場合は、入力ファイルを使うとシェルの引用符に左右されない。

```powershell
'{"concepts":["concept/refund"]}' | Set-Content -Encoding utf8 context.json
npm run logos -- --project project/logos call knowledge.context '@context.json'
```

返金処理から「金銭処理」と「外部連携」を辿り、本文の語句が異なる2つの基準を取得できる。`knowledge.get` で全文、`knowledge.related` で文章と実装の関係を調べる。

```powershell
npm run demo
```

デモはローカルの例示用プロジェクトを接続し、ファイル一覧を読む外部プロセスへ委譲する。結果からプロジェクト限定の知識を保存し、次の取得に反映されることまで確認する。実行ごとに `.logos/` 以下へ実行記録、`knowledge/projects/` 以下へ知識を追加する。接続先リポジトリには書き込まない。

## 利用と実装

- [操作手順](docs/USAGE.md)：対話からの使い方、知識、タスク、削除・復元。
- [拡張と実行接続](docs/EXTENSIONS.md)：操作・読取器の追加、JSONプロセス接続。
- [確認結果と現在の範囲](docs/VALIDATION.md)：テスト、実例、制限。
- [全体設計](DESIGN.md) / [注釈の仕様](ONTOLOGY.md)。

原本と共有設定は通常のGitで管理する。接続先、タスク、試行、ごみ箱は `.logos/` に保存し、Gitから除外する。索引は毎回原本から作り直す。

現在の委譲先の実例はローカルコマンドであり、Codex・Claude Codeを自動起動する専用接続は含まない。対話中のエージェントはCLIを通して直接利用できる。WebUIと常駐の自律改善は後続の拡張とする。
