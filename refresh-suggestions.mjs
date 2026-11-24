const origin="http://127.0.0.1:47381";
const r=await fetch(origin+"/suggestions/refresh",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json","X-Tab-Bridge":"1"},body:"{}",signal:AbortSignal.timeout(10000)});
const result=await r.json();
if(!r.ok)throw Error(result.error || "Refresh failed");
console.log(JSON.stringify(result));
