export const companyUiFixture=`(function(require){var j=require("ABep"),r=require("zd8w");
function sidebar(items,navigate,current){items.push({id:'plugins',animatedIcon:"sidebar-plugins",label:'Plugins',onSelect:e=>select(null,navigate,e),isCurrentDestination:current.startsWith('/skills')||current.startsWith('/plugins')});}
const routes=()=>[j.jsx(R.Route,{path:"/skills",children:[]})];
globalThis.companyUiFixture={sidebar,routes};})(globalThis.companyFixtureRequire);`;
