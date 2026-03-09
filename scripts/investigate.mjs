import { Octokit } from "@octokit/rest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

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

function buildUserMessage(issueBody, fetchedPages) {
  let msg = `以下の不動産情報を分析してください。厳しめに評価してください。\n\n`;
  msg += `## 物件情報（Issue本文）\n${issueBody}\n`;
  if (fetchedPages && fetchedPages.length > 0) {
    msg += `\n## 物件ページから取得した詳細情報\n`;
    for (const page of fetchedPages) {
      msg += `\n### 取得元: ${page.url}\n`;
      msg += `${page.content}\n`;
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

function extractUrls(issueBody) {
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  const matches = issueBody.match(urlRegex);
  return matches || [];
}

async function fetchPageContent(url) {
  try {
    console.log(`🌐 Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Ponopo/1.0; +https://github.com/komiyasa/Ponopo)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      console.warn(`⚠️ Skipping non-HTML content: ${contentType}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $("script, style, nav, footer, header, iframe, noscript, svg, [role='navigation'], [role='banner'], .ad, .advertisement, .sidebar").remove();

    // Try to get the page title
    const title = $("title").text().trim();

    // Extract text from the main content area
    // Try common content selectors first, fall back to body
    let textContent = "";
    const contentSelectors = [
      "main", "article", "#main", "#content", ".main",
      ".property-detail", ".bukken", ".detail",
      "[role='main']", ".content",
    ];

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        textContent = el.text();
        break;
      }
    }

    if (!textContent) {
      textContent = $("body").text();
    }

    // Clean up whitespace: collapse multiple spaces/newlines
    textContent = textContent
      .replace(/[ \t]+/g, " ")
      .replace(/(\n\s*){3,}/g, "\n\n")
      .trim();

    // Also extract table data (common in Japanese real estate sites)
    const tables = [];
    $("table").each((_, table) => {
      const rows = [];
      $(table).find("tr").each((_, tr) => {
        const cells = [];
        $(tr).find("th, td").each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0) {
          rows.push(cells.join(" | "));
        }
      });
      if (rows.length > 0) {
        tables.push(rows.join("\n"));
      }
    });

    let result = "";
    if (title) {
      result += `タイトル: ${title}\n\n`;
    }
    if (tables.length > 0) {
      result += `### テーブルデータ\n${tables.join("\n\n")}\n\n`;
    }
    result += `### ページ本文\n${textContent}`;

    // Truncate to avoid exceeding token limits (roughly 12000 chars per page)
    const MAX_CHARS = 12000;
    if (result.length > MAX_CHARS) {
      result = result.substring(0, MAX_CHARS) + "\n\n（…以降省略）";
    }

    console.log(`✅ Fetched ${url} (${result.length} chars)`);
    return { url, content: result };
  } catch (err) {
    console.warn(`⚠️ Error fetching ${url}: ${err.message}`);
    return null;
  }
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
  const urls = extractUrls(issueBody);

  // Fetch actual content from URLs
  console.log(`🔗 Found ${urls.length} URL(s) in issue body. Fetching content...`);
  const fetchResults = await Promise.all(urls.map((url) => fetchPageContent(url)));
  const fetchedPages = fetchResults.filter((r) => r !== null);
  console.log(`📄 Successfully fetched ${fetchedPages.length}/${urls.length} page(s).`);

  const userMessage = buildUserMessage(issueBody, fetchedPages);

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
