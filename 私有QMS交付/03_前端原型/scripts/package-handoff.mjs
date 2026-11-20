/** 在前端构建后生成可单独分发的实操版和讲解卡。接收方只需浏览器。 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read=path=>readFileSync(join(root,path),'utf8');
function section(file, start, end) {
  const source=read('src/'+file+'.js');
  const left=start ? source.indexOf(start) : 0;
  const right=end ? source.indexOf(end,left+1) : source.length;
  if(left<0 || right<left) throw new Error('交付组件边界已改变：'+file+' '+start+' / '+end);
  return source.slice(left,right);
}
const code=[
  // 常规集成配置迁移位于核心状态与 UI 之间。离线交付入口无需载入接口迁移。
  section('10_core',null,'/* 升级旧的演示数据'),section('10_core','if (!S.dwgImages',null),
  read('src/15_actions.js'), section('20_ui',null,'/** 带原因说明的按钮'),
  section('20_ui',"COMPONENTS['signature-pad']",'/** 图片压缩'),section('20_ui','function demoPhoto()',"COMPONENTS['photo-strip']"),
  read('src/46_production.js'),section('47_mainline',null,"COMPONENTS['order-receipt']"),
  section('48_guide','function nextOf(','/* 工单列表：'), section('50_ncr',null,'/* ---------------- 登记不合格'),
  section('85_prod_demo',null,'// 一进入就能试分批交检'),read('src/87_handoff.js'),read('src/88_handoff_ui.js'),
  `const app=createApp(COMPONENTS['handoff-workshop']);app.component('ic',COMPONENTS.ic);app.component('signature-pad',COMPONENTS['signature-pad']);app.mount('#app');`
].join('\n;\n');
const base=read('qms_pro_qms.html').match(/<style>([\s\S]*?)<\/style>/)?.[1];
if(!base) throw new Error('请先运行 node build.mjs');
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="qms-handoff" content="1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; base-uri 'none'; form-action 'none'"><link rel="icon" href="data:,"><title>Worlder QMS · 工单实操</title><style>${base}\n${read('styles/handoff.css')}\nbody{margin:0;background:#e7ede8}canvas{touch-action:none}</style></head><body><div id="app"></div><noscript>请在启用 JavaScript 的浏览器中打开此文件。</noscript><script>/* ${read('vendor/vue.LICENSE').replace(/\*\//g,'* /')} */\n${escapeScript(read('vendor/vue.global.prod.js'))}</script><script>(function(){'use strict';\n${escapeScript(code)}\n})();</script></body></html>`;
const dest=join(root,'demo','交付版');mkdirSync(dest,{recursive:true});
writeFileSync(join(dest,'开始演示.html'),html);
copyFileSync(join(root,'delivery','演示讲解卡.html'),join(dest,'演示讲解卡.html'));
// 写入 UTF-8 文件名，只打包清单中的两个文件。原子替换避免提供半写入的压缩包。
const pack=`from pathlib import Path\nfrom zipfile import ZipFile, ZIP_DEFLATED\nimport os,sys,tempfile\nroot=Path(sys.argv[1]); target=root.parent/'Worlder-QMS-工单实操演示.zip'\nwith tempfile.NamedTemporaryFile(dir=root.parent,delete=False) as temp: path=Path(temp.name)\ntry:\n with ZipFile(path,'w',ZIP_DEFLATED) as z:\n  for name in ['开始演示.html','演示讲解卡.html']: z.write(root/name,name)\n with ZipFile(path) as z: assert z.testzip() is None\n os.replace(path,target)\nfinally:\n path.unlink(missing_ok=True)\nprint(target)`;
execFileSync('python3',['-c',pack,dest],{stdio:'inherit'});
