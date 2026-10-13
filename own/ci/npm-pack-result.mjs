export function packResult(raw, name) {
  const result=JSON.parse(raw);
  const item=Array.isArray(result)?result.find(p=>p.name===name):result[name];
  if(!item||item.name!==name||!item.filename||!item.integrity||!Number.isSafeInteger(item.size))
    throw Error('Unexpected npm pack JSON result');
  return item;
}
