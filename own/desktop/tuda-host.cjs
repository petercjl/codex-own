'use strict';
// Independent Tuda owns its lifetime. Retain the entry for old callers without
// issuing quit requests, reading local bearer credentials or claiming ownership.
async function stop(){return {running:'independent',closed:false,reason:'TUDA_INDEPENDENT_LIFECYCLE'};}
function install(){}
module.exports={stop,install};
