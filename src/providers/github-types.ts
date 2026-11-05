/** The parts of GitHub REST responses these tools read, and nothing else. */

export type GitHubUser = { login: string };

export type GitHubPull = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  labels?: Array<{ name: string }>;
  assignees?: GitHubUser[] | null;
  requested_reviewers?: GitHubUser[] | null;
};

export type GitHubPullFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  sha: string;
};

export type GitHubCommit = {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string } | null;
  };
  author: GitHubUser | null;
  html_url: string;
};

export type GitHubComment = {
  id: number;
  body: string;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  side?: "LEFT" | "RIGHT" | null;
  start_line?: number | null;
  commit_id?: string;
  in_reply_to_id?: number;
  pull_request_review_id?: number;
};

export type GitHubReview = {
  id: number;
  user: GitHubUser | null;
  body: string | null;
  state: string;
  submitted_at?: string;
  html_url: string;
};

export type GitHubContents = {
  type: string;
  encoding?: string;
  content?: string;
  size: number;
  name: string;
  path: string;
  sha: string;
  download_url: string | null;
};

export type GitHubCompare = {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: GitHubCommit[];
  files?: GitHubPullFile[];
  merge_base_commit?: { sha: string };
};

export type GitHubCodeSearchItem = {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  text_matches?: Array<{
    fragment: string;
    matches?: Array<{ text: string; indices: [number, number] }>;
  }>;
};

export type GitHubErrorBody = { message?: string };
