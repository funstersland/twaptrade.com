import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
const projectId = "df06f210-d44f-4fe0-8366-93ba9dcd1fff",
  environmentId = "0b10e8b2-2c02-424e-bb77-34caacf859fd",
  web = "e7f62ce3-27fc-4d6c-bf8c-4ac06809eed3";
function cli(args) {
  try {
    return JSON.parse(
      execFileSync("npx", ["--yes", "@railway/cli", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    let message = "Railway request failed";
    try {
      message =
        JSON.parse(String(error.stdout))
          .errors?.map((e) => e.message)
          .join("; ") || message;
    } catch {}
    throw Error(message);
  }
}
function api(query, variables) {
  const r = cli(["api", query, "--variables", JSON.stringify(variables)]);
  if (r.errors) throw Error(r.errors.map((e) => e.message).join("; "));
  return r.data;
}
const state = cli(["status", "--json"]);
if (state.id !== projectId) throw Error("Wrong Railway project");
let worker = state.services.edges.find(
  (e) => e.node.name === "cheapshare-engine",
)?.node.id;
if (!worker) {
  worker = api(
    "mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id}}",
    { input: { projectId, environmentId, name: "cheapshare-engine" } },
  ).serviceCreate.id;
}
const old = cli(["variable", "list", "--service", web, "--json"]);
const token =
  old.TWAP_CHEAPSHARE_RUNNER_TOKEN || randomBytes(32).toString("base64url");
if (!old.TWAP_BOT_ENCRYPTION_KEY)
  throw Error("Existing encryption key missing");
for (const [serviceId, variables] of [
  [web, { TWAP_CHEAPSHARE_RUNNER_TOKEN: token }],
  [
    worker,
    {
      TWAP_CHEAPSHARE_RUNNER_TOKEN: token,
      TWAP_CHEAPSHARE_APP_ORIGIN:
        "https://twaptradecom-production.up.railway.app",
      TWAP_BOT_ENCRYPTION_KEY: old.TWAP_BOT_ENCRYPTION_KEY,
    },
  ],
])
  api(
    "mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}",
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables,
        replace: false,
        skipDeploys: true,
      },
    },
  );
api(
  "mutation($service:String!,$environment:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$service,environmentId:$environment,input:$input)}",
  {
    service: web,
    environment: environmentId,
    input: {
      preDeployCommand: ["node scripts/prepare-cheapshare-database.mjs"],
    },
  },
);
api(
  "mutation($service:String!,$environment:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$service,environmentId:$environment,input:$input)}",
  {
    service: worker,
    environment: environmentId,
    input: {
      railwayConfigFile: null,
      builder: "RAILPACK",
      dockerfilePath: "Dockerfile",
      startCommand: "node scripts/bots/cheapshare-runner.mjs",
      healthcheckPath: null,
      preDeployCommand: [],
      sleepApplication: false,
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 100,
      multiRegionConfig: { ams: { numReplicas: 1 } },
    },
  },
);
fs.mkdirSync(".sites-runtime", { recursive: true });
fs.writeFileSync(
  ".sites-runtime/cheapshare-deploy-secrets.json",
  JSON.stringify({ worker, token }),
  { mode: 0o600 },
);
console.log(
  `CheapShare worker ${worker} configured. Web migrations and catalog registration configured. Source connection is a separate step after the GitHub push.`,
);
if (process.argv.includes("--connect")) {
  api(
    "mutation($id:String!,$input:ServiceConnectInput!){serviceConnect(id:$id,input:$input){id}}",
    {
      id: worker,
      input: { repo: "funstersland/twaptrade.com", branch: "main" },
    },
  );
  console.log("CheapShare worker connected to GitHub main.");
}
