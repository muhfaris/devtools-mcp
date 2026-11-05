import { ToolRegistry } from "../core/registry.js";
import { Config } from "../core/types.js";
import { generateUlidTool } from "./id-generators/ulid.js";
import { generateUuidTool } from "./id-generators/uuid.js";
import { generateIdTool } from "./id-generators/id.js";
import { base64EncodeTool, base64DecodeTool } from "./encoding/base64.js";
import { jwtDecodeTool } from "./encoding/jwt.js";
import { hashGenerateTool } from "./encoding/hash.js";
import { secretGenerateTool } from "./encoding/secret.js";
import { regexTestTool } from "./encoding/regex.js";
import { cronParseTool } from "./misc/cron.js";
import { timezoneConvertTool } from "./misc/timezone.js";
import { semverBumpTool } from "./misc/semver.js";
import { slugifyTool } from "./misc/slugify.js";
import { diffTool } from "./misc/diff.js";
import { envDiffTool } from "./misc/env-diff.js";
import { portCheckTool } from "./misc/port-check.js";
import { getDbSchemaTool } from "./database/schema.js";
import { executeQueryTool } from "./database/query.js";
import { explainQueryTool } from "./database/explain.js";
import { gitlabListMrsTool } from "./gitlab/list-mrs.js";
import { gitlabGetMrTool } from "./gitlab/get-mr.js";
import { gitlabCreateMrTool } from "./gitlab/create-mr.js";
import { gitlabUpdateMrTool } from "./gitlab/update-mr.js";
import { gitlabCreateNoteTool } from "./gitlab/create-note.js";
import { gitlabUpdateNoteTool } from "./gitlab/update-note.js";
import { gitlabDeleteNoteTool } from "./gitlab/delete-note.js";
import { gitlabReviewMrTool } from "./gitlab/review-mr.js";
import { gitlabGetDiscussionsTool } from "./gitlab/discussions.js";
import { gitlabGetFileTool } from "./gitlab/get-file.js";
import { gitlabGetCommitsTool } from "./gitlab/get-commits.js";
import { gitlabCompareBranchesTool } from "./gitlab/compare-branches.js";
import { gitlabSearchCodeTool } from "./gitlab/search-code.js";
import { gitlabSetConfigTool } from "./gitlab/set-config.js";
import { githubListPrsTool } from "./github/list-prs.js";
import { githubGetPrTool } from "./github/get-pr.js";
import { githubCreatePrTool } from "./github/create-pr.js";
import { githubUpdatePrTool } from "./github/update-pr.js";
import { githubCreateCommentTool } from "./github/create-comment.js";
import { githubUpdateCommentTool } from "./github/update-comment.js";
import { githubDeleteCommentTool } from "./github/delete-comment.js";
import { githubReviewPrTool } from "./github/review-pr.js";
import { githubGetPrDiscussionsTool } from "./github/discussions.js";
import { githubGetFileTool } from "./github/get-file.js";
import { githubGetCommitsTool } from "./github/get-commits.js";
import { githubCompareBranchesTool } from "./github/compare-branches.js";
import { githubSearchCodeTool } from "./github/search-code.js";
import { githubSetConfigTool } from "./github/set-config.js";
import { databaseSetConnectionTool } from "./database/set-connection.js";
import { showConfigTool } from "./config/show.js";
import { reloadConfigTool } from "./config/reload.js";
import { configInitTool } from "./misc/config-init.js";
import { providersInfoTool } from "./providers/info.js";
import {
  jsonMinifyTool,
  jsonFormatTool,
  jsonValidateTool,
  jsonToTypesTool,
} from "./json/index.js";
import { redisInfoTool } from "./redis/info.js";
import { redisListKeysTool } from "./redis/list-keys.js";
import { redisGetKeyTool } from "./redis/get-key.js";
import { redisKeyInfoTool } from "./redis/key-info.js";
import { redisSlowlogTool } from "./redis/slowlog.js";
import { redisSetKeyTool } from "./redis/set-key.js";
import { redisDeleteKeyTool } from "./redis/delete-key.js";
import { redisExpireKeyTool } from "./redis/expire-key.js";
import {
  fakePersonTool,
  fakeCompanyTool,
  publicHolidaysTool,
} from "./dummy-data/index.js";

// In registerAllTools:
export { createRegistry } from "../core/registry.js";

export const registerAllTools = async (
  registry: ToolRegistry,
  config: Config,
) => {
  registry.register(generateUlidTool);
  registry.register(generateUuidTool);
  registry.register(generateIdTool);
  registry.register(base64EncodeTool);
  registry.register(base64DecodeTool);
  registry.register(jwtDecodeTool);
  registry.register(hashGenerateTool);
  registry.register(secretGenerateTool);
  registry.register(regexTestTool);
  registry.register(cronParseTool);
  registry.register(timezoneConvertTool);
  registry.register(semverBumpTool);
  registry.register(slugifyTool);
  registry.register(diffTool);
  registry.register(envDiffTool);
  registry.register(portCheckTool);
  registry.register(gitlabListMrsTool);
  registry.register(gitlabGetMrTool);
  registry.register(gitlabCreateMrTool);
  registry.register(gitlabUpdateMrTool);
  registry.register(gitlabCreateNoteTool);
  registry.register(gitlabUpdateNoteTool);
  registry.register(gitlabDeleteNoteTool);
  registry.register(gitlabReviewMrTool);
  registry.register(gitlabGetDiscussionsTool);
  registry.register(gitlabGetFileTool);
  registry.register(gitlabGetCommitsTool);
  registry.register(gitlabCompareBranchesTool);
  registry.register(gitlabSearchCodeTool);
  registry.register(getDbSchemaTool);
  registry.register(executeQueryTool);
  registry.register(explainQueryTool);
  registry.register(gitlabSetConfigTool);
  registry.register(githubListPrsTool);
  registry.register(githubGetPrTool);
  registry.register(githubCreatePrTool);
  registry.register(githubUpdatePrTool);
  registry.register(githubCreateCommentTool);
  registry.register(githubUpdateCommentTool);
  registry.register(githubDeleteCommentTool);
  registry.register(githubReviewPrTool);
  registry.register(githubGetPrDiscussionsTool);
  registry.register(githubGetFileTool);
  registry.register(githubGetCommitsTool);
  registry.register(githubCompareBranchesTool);
  registry.register(githubSearchCodeTool);
  registry.register(githubSetConfigTool);
  registry.register(databaseSetConnectionTool);
  registry.register(showConfigTool);
  registry.register(reloadConfigTool);
  registry.register(configInitTool);
  registry.register(providersInfoTool);
  registry.register(jsonMinifyTool);
  registry.register(jsonFormatTool);
  registry.register(jsonValidateTool);
  registry.register(jsonToTypesTool);
  registry.register(redisInfoTool);
  registry.register(redisListKeysTool);
  registry.register(redisGetKeyTool);
  registry.register(redisKeyInfoTool);
  registry.register(redisSlowlogTool);
  registry.register(redisSetKeyTool);
  registry.register(redisDeleteKeyTool);
  registry.register(redisExpireKeyTool);
  registry.register(fakePersonTool);
  registry.register(fakeCompanyTool);
  registry.register(publicHolidaysTool);
};
