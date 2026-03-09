# 🏢 Ponopo — 不動産調査オーケストレーションシステム

> "……フッ、この物件の真実を暴いてやろう" — 御剣怜侍

GitHub Issue に不動産情報を投稿するだけで、**逆転裁判**のキャラクターたちが多角的に物件を調査・分析してくれるシステムです。

## 🎮 調査チーム（逆転裁判キャラクター）

| エージェント | キャラクター | 役割 | 分析観点 |
|------------|------------|------|---------|
| 先生（オーケストレーター） | 🔴 **御剣怜侍** | 総合評価・統括 | 全エージェントの結果を統合し最終判断 |
| Agent A | 🔵 **成歩堂龍一** | 資産価値分析 | 立地・建物・市場価値・出口戦略 |
| Agent B | 🟣 **狩魔冥** | 収益性分析 | 利回り・CF・投資効率 |
| Agent C | 🟢 **綾里真宵** | 住民属性・エリア分析 | 人口動態・需要・生活環境 |
| Agent D | 🟤 **ゴドー** | 融資開拓分析 | 担保評価・金融機関・金利リスク |
| Agent E | ⚫ **狩魔豪** | 最終判断・数字分析 | 返済比率・10年後CF |

## 📋 判定基準（狩魔豪の「法」）

### 基準1：返済比率 ≤ 50%
```
返済比率 = 年間ローン返済額 ÷ 年間家賃収入（満室想定） × 100
```

### 基準2：10年後CF＋所得税 ≥ 借入金額の2%
```
判定値 = (10年後CF + 10年後所得税) ÷ 借入金額 × 100
```

**両方クリアしなければ「有罪（不合格）」**

## 🚀 使い方

### 1. リポジトリのセットアップ

```bash
# このリポジトリを GitHub に "Ponopo" として作成
gh repo create Ponopo --public --source=. --push
```

### 2. Anthropic API キーの設定

GitHub リポジトリの Settings → Secrets and variables → Actions で以下を設定：

| Secret名 | 説明 |
|----------|------|
| `ANTHROPIC_API_KEY` | Anthropic API キー |

> `GITHUB_TOKEN` は GitHub Actions が自動で提供するため設定不要です。

### 3. 依存関係のインストール（ロックファイル生成）

```bash
npm install
```

> `package-lock.json` をコミットしてください。workflow で `npm ci` を使用するために必要です。

### 4. Issue を作成して調査開始

Issue を作成すると自動的に調査が始まります。

**Issue の書き方例：**

```markdown
## 物件情報

- 所在地: 東京都世田谷区○○ 1-2-3
- 物件種別: 一棟マンション
- 構造: RC造
- 築年数: 15年
- 総戸数: 12戸
- 価格: 1億5000万円
- 表面利回り: 7.2%
- 最寄り駅: ○○線 △△駅 徒歩8分
- 土地面積: 200㎡
- 建物面積: 480㎡

## 参考リンク
- https://example.com/property-listing

## 補足
マイソクは添付画像を参照
```

または、リンクだけでもOK：

```markdown
https://suumo.jp/xxxxx
https://homes.co.jp/xxxxx
```

### 5. 既存 Issue を再調査

Issue に `investigate` ラベルを付けると再調査が実行されます。

## 🏗️ プロジェクト構造

```
.
├── .github/
│   └── workflows/
│       └── investigate.yml    # GitHub Actions ワークフロー
├── prompts/
│   ├── orchestrator.md        # 御剣怜侍（オーケストレーター）
│   ├── agent-a-asset.md       # 成歩堂龍一（資産価値）
│   ├── agent-b-profit.md      # 狩魔冥（収益性）
│   ├── agent-c-demographics.md # 綾里真宵（住民属性）
│   ├── agent-d-financing.md   # ゴドー（融資開拓）
│   └── agent-e-judgment.md    # 狩魔豪（最終判断）
├── scripts/
│   └── investigate.mjs        # メイン調査スクリプト
├── package.json
└── README.md
```

## ⚙️ 技術スタック

- **AI Model**: Claude Opus 4 (Anthropic)
- **CI/CD**: GitHub Actions
- **Runtime**: Node.js 20
- **API**: Anthropic Messages API + GitHub REST API

## ⚠️ 注意事項

- この調査は AI による自動分析です。投資判断は必ずご自身の責任で行ってください
- 提供された情報が少ない場合、エージェントは一般的な市場データに基づいて推定します
- Anthropic API の利用料金が発生します（1物件あたり約$1〜3程度）
- 各エージェントは「厳しめ」に設定されています。甘い評価は出ません

## 📜 ライセンス

MIT
