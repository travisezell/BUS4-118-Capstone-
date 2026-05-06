/**
 * Jira REST API v3 client.
 *
 * Uses Basic-auth (email + API token). Falls back gracefully when the env
 * vars are not configured so the app continues to work in mock mode.
 *
 * Configuration (add to .env.local):
 *   JIRA_BASE_URL=https://group-5-capstone.atlassian.net
 *   JIRA_EMAIL=travis.ezell@sjsu.edu
 *   JIRA_API_TOKEN=<your Atlassian API token>
 *   JIRA_PROJECT_KEY=B1GC
 */

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    status: { name: string };
    assignee?: { displayName: string; emailAddress: string } | null;
    reporter?: { displayName: string; emailAddress: string } | null;
    issuetype: { name: string };
    priority?: { name: string } | null;
    created: string;
    updated: string;
    comment?: {
      comments: Array<{
        id: string;
        body: unknown;
        author: { displayName: string };
        created: string;
      }>;
    };
    resolution?: { name: string } | null;
  };
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

export interface CreateIssuePayload {
  summary: string;
  description?: string;
  issuetype?: string; // e.g. "Task", "Service Request", "Bug"
  priority?: string;
}

export interface CreateIssueResult {
  id: string;
  key: string;
  self: string;
}

function getConfig(): {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
} | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!baseUrl || !email || !token || !projectKey) return null;

  return { baseUrl, email, token, projectKey };
}

/** Returns true when all Jira env vars are set. */
export function isJiraConfigured(): boolean {
  return getConfig() !== null;
}

function authHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const cfg = getConfig();
  if (!cfg) {
    throw new Error(
      "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_PROJECT_KEY."
    );
  }

  const url = `${cfg.baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authHeader(cfg.email, cfg.token),
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(
      `Jira API error ${res.status} ${res.statusText} — ${body}`
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch a single issue by its key (e.g. B1GC-42) or numeric id.
 */
export async function getIssue(idOrKey: string): Promise<JiraIssue> {
  return jiraFetch<JiraIssue>(
    `/rest/api/3/issue/${encodeURIComponent(idOrKey)}?fields=summary,status,assignee,reporter,issuetype,priority,created,updated,comment,resolution,description`
  );
}

/**
 * Search for issues using JQL.
 */
export async function searchIssues(
  jql: string,
  maxResults = 50
): Promise<JiraSearchResult> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(maxResults),
    fields:
      "summary,status,assignee,reporter,issuetype,priority,created,updated,resolution",
  });
  return jiraFetch<JiraSearchResult>(`/rest/api/3/search?${params.toString()}`);
}

/**
 * List all non-done issues in the configured project.
 */
export async function listProjectIssues(
  maxResults = 50
): Promise<JiraSearchResult> {
  const cfg = getConfig();
  if (!cfg) throw new Error("Jira is not configured.");
  return searchIssues(
    `project = ${cfg.projectKey} ORDER BY created DESC`,
    maxResults
  );
}

/**
 * Create a new issue in the configured project.
 * Returns the created issue's key and id.
 */
export async function createIssue(
  payload: CreateIssuePayload
): Promise<CreateIssueResult> {
  const cfg = getConfig();
  if (!cfg) throw new Error("Jira is not configured.");

  // Build Atlassian Document Format description when provided.
  const descriptionAdf = payload.description
    ? {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: payload.description }],
          },
        ],
      }
    : undefined;

  const body = {
    fields: {
      project: { key: cfg.projectKey },
      summary: payload.summary,
      issuetype: { name: payload.issuetype ?? "Task" },
      ...(payload.priority ? { priority: { name: payload.priority } } : {}),
      ...(descriptionAdf ? { description: descriptionAdf } : {}),
    },
  };

  return jiraFetch<CreateIssueResult>("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Add a comment to an existing issue.
 */
export async function addComment(
  idOrKey: string,
  text: string
): Promise<void> {
  const body = {
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(idOrKey)}/comment`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
