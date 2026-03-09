import { Octokit } from "@octokit/rest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

// --- Configuration ---
const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const MODEL = process.env.AI_MODEL || "gpt-4.1";
const MAX_TOKENS = 4096;

const AGENTS = [
  {
    id: "agent-a",
    name: "成歩堂龍一",
    role: "資産価値分析",
    promptFile: "agent-a-asset.md",
    emoji: "🏢",
  },
  {
    id: "agent-b",
    name: "狩魔冥",
    role: "収益性分析",
    promptFile: "agent-b-profit.md",
    emoji: "💰",
  },
  {
    id: "agent-c",
    name: "綾里真宵",
    role: "住民属性・エリア分析",
    promptFile: "agent-c-demographics.md",
    emoji: "👥",
  },
  {
    id: "agent-d",
    name: "ゴドー",
    role: "融資開拓分析",
    promptFile: "agent-d-financing.md",
    emoji: "☕",
  },
  {
    id: "agent-e",
    name: "狩魔豪",
    role: "最終判断・数字分析",
    promptFile: "agent-e-judgment.md",
    emoji: "⚖️",
  },
];

// --- Helpers ---

function loadPrompt(filename) {
  return readFileSync(join(PROMPTS_DIR, filename), "utf-8");
}

function buildUserMessage(issueBody, attachments) {
  let msg = `以下の不動産情報を分析してください。厳しめに評価してください。\n\n`;
  msg += `## 物件情報\n${issueBody}\n`;
  if (attachments && attachments.length > 0) {
    msg += `\n## 添付資料・リンク\n`;
    for (const att of attachments) {
      msg += `- ${att}\n`;
    }
  }
  return msg;
}

async function callAgent(token, systemPrompt, userMessage) {
  const response = await fetch(`${GITHUB_MODELS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function postComment(octokit, owner, repo, issueNumber, body) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

function extractAttachments(issueBody) {
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  const matches = issueBody.match(urlRegex);
  return matches || [];
}

// --- Main ---

async function main() {
  // Validate environment
  const githubToken = process.env.GITHUB_TOKEN;
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const repoFullName = process.env.GITHUB_REPOSITORY; // "owner/repo"

  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!issueNumber || !repoFullName) {
    throw new Error("ISSUE_NUMBER and GITHUB_REPOSITORY are required");
  }

  const [owner, repo] = repoFullName.split("/");
  const octokit = new Octokit({ auth: githubToken });

  // Fetch the issue
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  console.log(`📋 Investigating issue #${issueNumber}: ${issue.title}`);

  const issueBody = issue.body || "(内容なし)";
  const attachments = extractAttachments(issueBody);
  const userMessage = buildUserMessage(issueBody, attachments);

  // Post initial comment
  await postComment(
    octokit,
    owner,
    repo,
    issueNumber,
    `# 🔍 不動産調査開始\n\n` +
      `御剣怜侍（オーケストレーター）が調査チームを招集しました。\n\n` +
      `## 調査メンバー\n` +
      AGENTS.map((a) => `- ${a.emoji} **${a.name}**（${a.role}）`).join("\n") +
      `\n\n各エージェントが順次分析を開始します。しばらくお待ちください……\n\n` +
      `> "……フッ、この物件の真実を暴いてやろう" — 御剣怜侍`
  );

  // Run each agent and collect results
  const agentResults = [];

  for (const agent of AGENTS) {
    console.log(`🔄 Running ${agent.name} (${agent.role})...`);

    const systemPrompt = loadPrompt(agent.promptFile);

    try {
      const result = await callAgent(githubToken, systemPrompt, userMessage);
      agentResults.push({ agent, result });

      // Post individual agent comment
      const commentBody =
        `# ${agent.emoji} ${agent.name}の分析レポート\n` +
        `> **担当**: ${agent.role}\n\n` +
        `---\n\n` +
        result;

      await postComment(octokit, owner, repo, issueNumber, commentBody);
      console.log(`✅ ${agent.name} completed.`);
    } catch (err) {
      const errorMsg = `${agent.emoji} ${agent.name}の分析中にエラーが発生しました: ${err.message}`;
      console.error(errorMsg);
      agentResults.push({
        agent,
        result: `（エラー: 分析を完了できませんでした - ${err.message}）`,
      });

      await postComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `# ${agent.emoji} ${agent.name}\n\n⚠️ 分析中にエラーが発生しました。\n\n\`\`\`\n${err.message}\n\`\`\``
      );
    }
  }

  // Orchestrator final summary
  console.log("🎯 Running orchestrator (御剣怜侍)...");

  const orchestratorPrompt = loadPrompt("orchestrator.md");
  const orchestratorInput =
    `以下は5人のエージェントによる不動産分析結果です。これらを統合して最終評価レポートを作成してください。\n\n` +
    `## 元の物件情報\n${issueBody}\n\n` +
    agentResults
      .map(
        (r) =>
          `## ${r.agent.emoji} ${r.agent.name}（${r.agent.role}）の分析結果\n${r.result}`
      )
      .join("\n\n---\n\n");

  try {
    const finalResult = await callAgent(
      githubToken,
      orchestratorPrompt,
      orchestratorInput
    );

    const finalComment =
      `# ⚡ 最終調査報告書\n` +
      `> **報告者**: 御剣怜侍（オーケストレーター）\n\n` +
      `---\n\n` +
      finalResult +
      `\n\n---\n` +
      `*この調査は AI エージェントによる自動分析です。投資判断は必ずご自身の責任で行ってください。*`;

    await postComment(octokit, owner, repo, issueNumber, finalComment);
    console.log("✅ Final report posted.");
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    await postComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `# ⚡ オーケストレーターエラー\n\n御剣怜侍による最終レポート生成中にエラーが発生しました。\n\n\`\`\`\n${err.message}\n\`\`\``
    );
  }

  console.log("🏁 Investigation complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
