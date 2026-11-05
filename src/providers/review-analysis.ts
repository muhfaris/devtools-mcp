/**
 * Heuristics for reviewing a unified-diff patch.
 *
 * These are deliberately provider-neutral: a GitLab MR and a GitHub pull request hand over
 * the same kind of patch, and two copies of "what looks suspicious in an added line" would
 * drift apart. They are heuristics, not a review: they point at lines a human would look
 * at first, and never at files the API withheld.
 */

export const detectLanguage = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript (React)",
    js: "JavaScript",
    jsx: "JavaScript (React)",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    c: "C",
    cpp: "C++",
    h: "C/C++ Header",
    rb: "Ruby",
    php: "PHP",
    css: "CSS",
    scss: "SCSS",
    less: "LESS",
    html: "HTML",
    vue: "Vue",
    svelte: "Svelte",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    md: "Markdown",
    sh: "Shell",
    bash: "Bash",
    zsh: "Zsh",
    sql: "SQL",
  };
  return map[ext] || ext || "Unknown";
};

/** How much a single file changed, in changed lines. */
export const estimateComplexity = (
  diff: string,
): "low" | "medium" | "high" => {
  const lines = diff.split("\n");
  const addedLines = lines.filter(
    (l) => l.startsWith("+") && !l.startsWith("+++"),
  ).length;
  const deletedLines = lines.filter(
    (l) => l.startsWith("-") && !l.startsWith("---"),
  ).length;
  const total = addedLines + deletedLines;

  if (total > 100) return "high";
  if (total > 30) return "medium";
  return "low";
};

/** Patterns worth a reviewer's attention in an added line, deduplicated. */
export const generateSuggestions = (
  diff: string,
  language: string,
): string[] => {
  const suggestions: string[] = [];
  const lines = diff.split("\n");

  for (const line of lines) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    // Check for console.log/print
    if (/console\.(log|debug|info)/.test(line)) {
      suggestions.push("Found console.log - consider removing before merge");
    }
    if (/fmt\.Println|println!/.test(line)) {
      suggestions.push("Found print statement - consider using proper logging");
    }

    // Check for TODO/FIXME
    if (/TODO|FIXME|HACK|XXX/.test(line)) {
      suggestions.push("Contains TODO/FIXME comment");
    }

    // Check for hardcoded secrets patterns
    if (
      /(password|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']+["']/i.test(line)
    ) {
      suggestions.push("⚠️ Potential hardcoded secret detected");
    }

    // Check for any type in TS
    if (language.includes("TypeScript") && /:\s*any\b/.test(line)) {
      suggestions.push("Use of 'any' type - consider using a specific type");
    }
  }

  return [...new Set(suggestions)];
};
