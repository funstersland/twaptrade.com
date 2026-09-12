import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

// Provision only Forecast. Preserve existing service variables and web release steps.
const projectId = "df06f210-d44f-4fe0-8366-93ba9dcd1fff";
const environmentId = "0b10e8b2-2c02-424e-bb77-34caacf859fd";
const web = "e7f62ce3-27fc-4d6c-bf8c-4ac06809eed3";
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
const instance = state.environments.edges
  .find((e) => e.node.id === environmentId)
  ?.node.serviceInstances.edges.find((e) => e.node.serviceId === web)?.node;
const domain = instance?.domains.serviceDomains.find(
  (d) => d.domain === "twaptradecom-production.up.railway.app",
)?.domain;
if (!domain) throw Error("Expected production web origin missing");
const old = cli(["variable", "list", "--service", web, "--json"]);
if (!old.TWAP_BOT_ENCRYPTION_KEY)
  throw Error("Existing wallet encryption key missing");
const token =
  old.TWAP_FORECAST_RUNNER_TOKEN || randomBytes(32).toString("base64url");
const current = api(
  "query($service:String!,$environment:String!){serviceInstance(serviceId:$service,environmentId:$environment){preDeployCommand}}",
  { service: web, environment: environmentId },
).serviceInstance;
const currentCommand = (current.preDeployCommand || []).join(" && ");
const supportedCommands = new Set([
  "node scripts/prepare-cheapshare-database.mjs",
  "node scripts/prepare-cheapshare-database.mjs && node scripts/register-forecast.mjs",
  "node scripts/prepare-production-database.mjs",
]);
if (!supportedCommands.has(currentCommand))
  throw Error(
    "Existing release steps changed; preserve them before configuring Forecast",
  );
const commands = ["node scripts/prepare-production-database.mjs"];
const matches = state.services.edges.filter(
  (e) => e.node.name === "forecast-engine",
);
if (matches.length > 1) throw Error("Forecast worker identity conflict");
let worker = matches[0]?.node.id;
if (!worker)
  worker = api(
    "mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id}}",
    { input: { projectId, environmentId, name: "forecast-engine" } },
  ).serviceCreate.id;
for (const [serviceId, variables] of [
  [web, { TWAP_FORECAST_RUNNER_TOKEN: token }],
  [
    worker,
    {
      TWAP_FORECAST_RUNNER_TOKEN: token,
      TWAP_FORECAST_APP_ORIGIN: `https://${domain}`,
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
const configure =
  "mutation($service:String!,$environment:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$service,environmentId:$environment,input:$input)}";
api(configure, {
  service: web,
  environment: environmentId,
  input: { preDeployCommand: commands },
});
api(configure, {
  service: worker,
  environment: environmentId,
  input: {
    railwayConfigFile: null,
    builder: "RAILPACK",
    dockerfilePath: "Dockerfile",
    startCommand: "node scripts/bots/forecast-runner.mjs",
    healthcheckPath: null,
    preDeployCommand: [],
    sleepApplication: false,
    numReplicas: 1,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 100,
    multiRegionConfig: { ams: { numReplicas: 1 } },
  },
});
fs.mkdirSync(".sites-runtime", { recursive: true });
fs.writeFileSync(
  ".sites-runtime/forecast-deployment.json",
  JSON.stringify({
    projectId,
    environmentId,
    web,
    worker,
    origin: `https://${domain}`,
  }),
  { mode: 0o600 },
);
console.log(
  "Forecast worker configured; existing web release steps preserved. No bots armed.",
);
if (process.argv.includes("--connect")) {
  api(
    "mutation($id:String!,$input:ServiceConnectInput!){serviceConnect(id:$id,input:$input){id}}",
    {
      id: worker,
      input: { repo: "funstersland/twaptrade.com", branch: "main" },
    },
  );
  console.log("Forecast worker connected to the published main branch.");
}
