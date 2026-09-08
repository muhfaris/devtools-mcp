import { Tool } from "../../core/types.js";

export const semverBumpTool: Tool = {
  name: "semver_bump",
  description: "Bump semantic version (patch, minor, major)",
  params: {
    version: { type: "string", description: 'Current version (e.g., "1.2.3")' },
    bump: {
      type: "string",
      description:
        'Bump type: patch, minor, major, or prerelease (e.g., "alpha.1")',
    },
    prerelease: {
      type: "string",
      optional: true,
      description: 'Prerelease identifier (e.g., "alpha", "beta")',
    },
  },
  execute: async (params) => {
    const version = params.version || "0.0.0";
    const bump = params.bump || "patch";
    const prerelease = params.prerelease;

    // Parse version
    const parts = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!parts) {
      throw new Error(
        `Invalid version format: ${version}. Expected semver (e.g., 1.2.3)`,
      );
    }

    let [_, majorStr, minorStr, patchStr, preStr] = parts;
    let major = parseInt(majorStr);
    let minor = parseInt(minorStr);
    let patch = parseInt(patchStr);

    let newPre = "";
    let newVersion = "";

    switch (bump) {
      case "major":
        major++;
        minor = 0;
        patch = 0;
        newPre = "";
        break;
      case "minor":
        minor++;
        patch = 0;
        newPre = "";
        break;
      case "patch":
        patch++;
        newPre = "";
        break;
      default:
        // Prerelease bump
        if (bump.startsWith("pre")) {
          const type = bump.replace("pre", "") || "alpha";
          if (!preStr) {
            newPre = `${type}.0`;
          } else {
            const preParts = preStr.split(".");
            if (preParts[0] === type) {
              const num = parseInt(preParts[1] || "0") + 1;
              newPre = `${type}.${num}`;
            } else {
              newPre = `${type}.0`;
            }
          }
          newVersion = `${major}.${minor}.${patch}-${newPre}`;
          return { content: [{ type: "text", text: newVersion }] };
        } else {
          throw new Error(
            `Invalid bump type: ${bump}. Use: patch, minor, major, pre, prealpha, prebeta, prerelease`,
          );
        }
    }

    newVersion = `${major}.${minor}.${patch}`;
    if (newPre) newVersion += `-${newPre}`;
    if (prerelease && !newPre) {
      newVersion += `-${prerelease}.0`;
    }

    return { content: [{ type: "text", text: newVersion }] };
  },
};
