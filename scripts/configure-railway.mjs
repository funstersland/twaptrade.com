import {execFileSync} from "node:child_process";

// Runtime configuration is explicit per service. Both services build the same
// GitHub commit, but the trading engine must never use the web start command.
const environment = "0b10e8b2-2c02-424e-bb77-34caacf859fd";
const services = [
  {id:"e7f62ce3-27fc-4d6c-bf8c-4ac06809eed3",name:"twaptrade.com",startCommand:"node server.js",healthcheckPath:"/api/health",healthcheckTimeout:120,preDeployCommand:["node scripts/migrate-postgres.mjs"]},
  {id:"5b2e015c-42f1-4808-a854-6d20f9377c3b",name:"continuation-engine",startCommand:"node scripts/bots/continuation-runner.mjs",healthcheckPath:null,preDeployCommand:[]},
];
for(const {id,name,...input} of services) {
  const query = "mutation Configure($service:String!,$environment:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$service,environmentId:$environment,input:$input)}";
  execFileSync("npx",["--yes","@railway/cli","api",query,"--variables",JSON.stringify({service:id,environment,
    input:{...input,railwayConfigFile:null,builder:"RAILPACK",dockerfilePath:"Dockerfile",sleepApplication:false,numReplicas:1,restartPolicyType:"ON_FAILURE",restartPolicyMaxRetries:100}})],{stdio:"pipe"});
  console.log(`${name}: Docker build, dedicated start command, one persistent replica configured.`);
}
