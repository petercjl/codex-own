import test from 'node:test';import assert from 'node:assert/strict';
import {companyLimiter,companyRateLimits} from '../company.ts';
test('NAS has a finite independent service budget, independent of public IP and other organizations',()=>{
 let time=0;const limit=companyLimiter(()=>time);
 for(let i=0;i<companyRateLimits.publicPerMinute;i++)limit('public:ip',150,'test-public');
 assert.throws(()=>limit('public:ip',150,'test-public'),{code:'RATE_LIMIT',status:429});
 for(let i=0;i<companyRateLimits.nasIntrospectionPerMinute;i++)limit('nas:org:tuda-nas',6000,'test-nas');
 assert.throws(()=>limit('nas:org:tuda-nas',6000,'test-nas'),{code:'RATE_LIMIT',status:429});
 assert.doesNotThrow(()=>limit('nas:other-org:tuda-nas',6000,'test-nas'));
 time=60000;assert.doesNotThrow(()=>limit('nas:org:tuda-nas',6000,'test-nas'));assert.doesNotThrow(()=>limit('public:ip',150,'test-public'));
});
