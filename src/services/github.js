const DEFAULT_REPO_OWNER =
  import.meta.env.VITE_GITHUB_REPO_OWNER || "innovation-showcase-2026";
const DEFAULT_REPO_NAME =
  import.meta.env.VITE_GITHUB_REPO_NAME || "quiz_sync";
const DEFAULT_BRANCH = import.meta.env.VITE_GITHUB_BRANCH || "main";
const LEADERBOARD_FILE_PATH = "public/data/leaderboard.json";

export const LOCAL_STORAGE_TOKEN_KEY = "quiz_sync_github_token";
export const LOCAL_STORAGE_AUTO_COMMIT_KEY = "quiz_sync_auto_commit_enabled";

export function getStoredGitHubToken() {
  const local = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (local && local.trim()) return local.trim();

  const envToken = import.meta.env.VITE_GITHUB_TOKEN;
  if (envToken && typeof envToken === "string" && envToken.trim()) {
    return envToken.trim();
  }

  return "";
}

export function saveStoredGitHubToken(token) {
  if (!token || !token.trim()) {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  } else {
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token.trim());
  }
}

export function getAutoCommitPreference() {
  const saved = localStorage.getItem(LOCAL_STORAGE_AUTO_COMMIT_KEY);
  if (saved === null) return true; // Default to enabled
  return saved === "true";
}

export function saveAutoCommitPreference(enabled) {
  localStorage.setItem(LOCAL_STORAGE_AUTO_COMMIT_KEY, enabled ? "true" : "false");
}

function utf8ToBase64(str) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_match, p1) =>
      String.fromCharCode(Number.parseInt(p1, 16)),
    ),
  );
}

function base64ToUtf8(str) {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str), (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    return atob(str);
  }
}

export async function fetchCurrentLeaderboardSha(
  token,
  owner = DEFAULT_REPO_OWNER,
  repo = DEFAULT_REPO_NAME,
  branch = DEFAULT_BRANCH,
) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${LEADERBOARD_FILE_PATH}?ref=${branch}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) {
    return { sha: null, content: null };
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.message ||
        `GitHub API returned status ${response.status} while fetching current file.`,
    );
  }

  const data = await response.json();
  const rawContent = data.content ? data.content.replace(/\s/g, "") : "";
  const decodedContent = rawContent ? base64ToUtf8(rawContent) : "";

  return {
    sha: data.sha,
    content: decodedContent,
  };
}

export async function commitLeaderboardToGitHub({
  participants,
  token,
  customMessage,
  owner = DEFAULT_REPO_OWNER,
  repo = DEFAULT_REPO_NAME,
  branch = DEFAULT_BRANCH,
}) {
  const activeToken = (token || getStoredGitHubToken() || "").trim();
  if (!activeToken) {
    throw new Error(
      "GitHub Personal Access Token is required to commit leaderboard.json. Please enter your token in Settings or set VITE_GITHUB_TOKEN in .env.",
    );
  }

  const jsonString = `${JSON.stringify(participants, null, 2)}\n`;

  // 1. Fetch current file to get sha and verify if content is already identical
  const current = await fetchCurrentLeaderboardSha(activeToken, owner, repo, branch);

  if (current.sha && current.content === jsonString) {
    return {
      status: "unchanged",
      message: "Leaderboard in GitHub is already up to date.",
      sha: current.sha,
      commitUrl: null,
    };
  }

  // 2. Commit file via GitHub Contents API
  const message =
    customMessage ||
    `chore: sync leaderboard data (${participants.length} participants) [skip ci]`;

  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${LEADERBOARD_FILE_PATH}`;
  const putBody = {
    message,
    content: utf8ToBase64(jsonString),
    branch,
  };

  if (current.sha) {
    putBody.sha = current.sha;
  }

  const response = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${activeToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(putBody),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error(
        "Invalid GitHub token or expired credentials. Please update your token.",
      );
    }
    if (response.status === 404 || response.status === 403) {
      throw new Error(
        errorBody.message ||
          "GitHub permissions error: Ensure the token has 'Contents: Read and Write' permission for " +
            `${owner}/${repo}.`,
      );
    }
    throw new Error(
      errorBody.message ||
        `Failed to commit to GitHub (HTTP ${response.status}).`,
    );
  }

  const result = await response.json();

  return {
    status: "committed",
    message: "Successfully committed leaderboard.json to GitHub!",
    commitSha: result.commit?.sha?.slice(0, 7) || "unknown",
    fullCommitSha: result.commit?.sha,
    commitUrl: result.commit?.html_url,
    timestamp: new Date().toISOString(),
  };
}
