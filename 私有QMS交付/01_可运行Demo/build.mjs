import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
let html=readFileSync(join(root,'src/shell.html'),'utf8');
const files={'CSS':['styles.css','process.css','inspection.css'],'CORE':['core.js'],'PROCESS':['process.js'],'INSPECTION':['inspection.js'],'APP':['app.js']};
for(const [key,names] of Object.entries(files)){const text=names.map(n=>readFileSync(join(root,'src',n),'utf8')).join('\n');html=html.replace('/*__'+key+'__*/',()=>text);}
writeFileSync(join(root,'qms_pro_qms.html'),html);
console.log('Built qms_pro_qms.html: '+Buffer.byteLength(html)+' bytes.');
