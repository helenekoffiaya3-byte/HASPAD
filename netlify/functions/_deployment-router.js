export const RUNTIME_TARGETS=Object.freeze({STATIC:"netlify-static",SERVERLESS:"netlify-serverless",CONTAINER:"container"});
const CONTAINER_RUNTIMES=new Set(["docker","docker-compose","python","go","php"]);
const SERVERLESS_HINTS=new Set(["netlify.toml","netlify/functions","serverless.yml","serverless.yaml"]);
const FRAMEWORKS=new Set(["next","vite","angular","vue","react","express","fastify","nestjs"]);

export function deploymentTarget({runtime="unknown",framework=null,detectedFiles=[],publishDirectory=null}={}){
  const files=new Set((detectedFiles||[]).map(x=>String(x).replace(/^\.\//,"")));
  if(runtime==="static")return {target:RUNTIME_TARGETS.STATIC,provider:"netlify",reason:"static-project"};
  if(CONTAINER_RUNTIMES.has(runtime)||files.has("Dockerfile")||files.has("docker-compose.yml")||files.has("docker-compose.yaml"))
    return {target:RUNTIME_TARGETS.CONTAINER,provider:"container",reason:"full-runtime-required"};
  if([...SERVERLESS_HINTS].some(x=>files.has(x))||files.has("netlify/functions"))
    return {target:RUNTIME_TARGETS.SERVERLESS,provider:"netlify",reason:"serverless-configuration-detected"};
  if(runtime==="node"&&FRAMEWORKS.has(framework)&&framework!=="express"&&framework!=="fastify"&&framework!=="nestjs")
    return {target:RUNTIME_TARGETS.STATIC,provider:"netlify",reason:"frontend-framework"};
  if(runtime==="node")return {target:RUNTIME_TARGETS.CONTAINER,provider:"container",reason:"node-runtime"};
  if(publishDirectory)return {target:RUNTIME_TARGETS.STATIC,provider:"netlify",reason:"publish-directory"};
  return {target:RUNTIME_TARGETS.CONTAINER,provider:"container",reason:"unknown-runtime"};
}
