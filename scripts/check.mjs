import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const roots=["netlify/functions","scripts"];
const files=[];
function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    if(item.isDirectory()) walk(file);
    else if(/\.m?js$/.test(item.name)) files.push(file);
  }
}
for(const root of roots) walk(root);
for(const file of files){
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["--check",file]);
    let error="";
    child.stderr.on("data",data=>error+=data);
    child.on("close",code=>code===0?resolve():reject(new Error(error)));
  });
}
console.log("Checked "+files.length+" JavaScript files.");
