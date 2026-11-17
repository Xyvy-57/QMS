/* =====================================================================
 * 设置与对接：允许内嵌本软件的 QMS 地址（消息白名单）、识别默认值、连接状态与消息记录、数据导出
 * ===================================================================== */
COMPONENTS['page-settings'] = {
  setup() {
    const f = reactive({ qmsOrigins: '', defaultGeneralTol: 'm', ocrLangs: 'eng+chi_sim', ocrMode: 'auto', renderWidth: 2200, localUser: '' });
    const fill = () => Object.assign(f, { qmsOrigins: (S.settings.qmsOrigins || []).join('\n'), defaultGeneralTol: S.settings.defaultGeneralTol || 'm', ocrLangs: S.settings.ocrLangs || 'eng+chi_sim', ocrMode: S.settings.ocrMode || 'auto', renderWidth: S.settings.renderWidth || 2200, localUser: S.settings.localUser || '' });
    onMounted(fill);
    const save = async () => {
      const list = f.qmsOrigins.split(/[\s,;]+/).map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
      const bad = list.filter((o) => !/^https?:\/\/[^/\s]+$/.test(o));
      if (bad.length) { toast('来源地址只写协议、主机和端口，例如 http://localhost:5180（不合格：' + bad.join('、') + '）', 'error'); return; }
      try {
        const r = await api('PUT', '/settings', { qmsOrigins: list, defaultGeneralTol: f.defaultGeneralTol, ocrLangs: f.ocrLangs, ocrMode: f.ocrMode, renderWidth: Math.max(1200, Math.min(4000, parseInt(f.renderWidth, 10) || 2200)), localUser: f.localUser.trim() });
        Object.assign(S.settings, r); fill(); toast('设置已保存', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    const exportAll = () => { window.open(API_BASE + '/export', '_blank', 'noopener'); };
    const reset = async () => {
      if (!(await confirmBox({ title: '清空全部数据？', message: '会删除服务端 data 目录里的全部图纸、识别结果和同步批次，不能恢复。QMS 里已经生成的标准不受影响。', ok: '清空', danger: true }))) return;
      try { await api('POST', '/reset', { confirm: 'RESET' }); await refreshDrawings(); toast('已清空', 'success'); } catch (e) { toast(e.message, 'error'); }
    };
    const sendReady = () => { if (!postToQms('worlder.ready', { version: APP_VERSION, app: 'worlder-bubble', user: meName() })) toast('本页面没有嵌在 QMS 里，或白名单为空', 'warn'); };
    return { f, save, exportAll, reset, sendReady, GBT1804_CLASSES };
  },
  template: `
<div class="space-y-5 max-w-5xl">
  <div><h1 class="page-title">设置与对接</h1><p class="text-xs text-ink-3 mt-1">本软件与 QMS 之间只通过浏览器消息通知和同步接口交换数据，双方都校验来源地址。</p></div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="card p-5 space-y-4">
      <h2 class="section-title">QMS 对接</h2>
      <div><label class="label">允许内嵌本软件、拉取同步结果的 QMS 地址（每行一个）</label><textarea v-model="f.qmsOrigins" rows="3" class="textarea font-mono !text-[12px]" placeholder="http://localhost:5180"></textarea>
        <p class="text-[11px] text-ink-4 mt-1.5 leading-relaxed">同时用于三处：响应头 frame-ancestors（允许被内嵌）、postMessage 来源校验、同步接口的跨域许可。</p></div>
      <div class="rounded-2xl bg-[#f7f7f9] p-3.5 text-[12.5px] space-y-1.5">
        <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" :class="UI.embedded ? 'bg-emerald-500' : 'bg-ink-5'"></span>{{ UI.embedded ? '本页面嵌在其它页面里' : '本页面是单独打开的' }}</div>
        <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" :class="UI.qms.handshake ? 'bg-emerald-500' : 'bg-ink-5'"></span>{{ UI.qms.handshake ? '已收到 QMS 消息（' + UI.qms.origin + '）' : '还没有收到 QMS 的消息' }}</div>
        <div v-if="UI.qms.user" class="flex items-center gap-2"><ic name="user" :size="13"/>QMS 当前用户：{{ UI.qms.user }}{{ UI.qms.role ? '（' + UI.qms.role + '）' : '' }}</div>
        <button v-if="UI.embedded" class="link text-xs" @click="sendReady">重新发送就绪消息</button>
      </div>
      <div><div class="label">最近的消息</div>
        <div class="max-h-48 overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
          <div v-for="(m,i) in UI.qms.log" :key="i" class="px-3 py-1.5 border-b border-black/[0.04] text-[11.5px] font-mono"><span :class="m.dir === 'in' ? 'text-emerald-700' : 'text-brand-700'">{{ m.dir === 'in' ? '收到' : '发出' }}</span> {{ m.type }} <span class="text-ink-4">{{ fmtTime(m.at).slice(11) }}</span><div class="text-ink-4 truncate">{{ m.text }}</div></div>
          <div v-if="!UI.qms.log.length" class="px-3 py-4 text-center text-[11.5px] text-ink-4">暂无</div>
        </div>
      </div>
    </div>

    <div class="card p-5 space-y-4">
      <h2 class="section-title">识别</h2>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">默认未注公差等级</label><select v-model="f.defaultGeneralTol" class="input"><option value="">不默认（图纸没写就不补公差）</option><option v-for="(l,k) in GBT1804_CLASSES" :key="k" :value="k">{{ l }}</option></select></div>
        <div><label class="label">OCR 语言</label><select v-model="f.ocrLangs" class="input"><option value="eng+chi_sim">英文 + 简体中文</option><option value="eng">只用英文（更快）</option></select></div>
        <div><label class="label">什么时候用 OCR</label><select v-model="f.ocrMode" class="input"><option value="auto">自动：文件里读不到文字时</option><option value="always">总是用 OCR</option><option value="never">从不用（只读矢量文字）</option></select></div>
        <div><label class="label">页面渲染宽度（像素）</label><input v-model.number="f.renderWidth" class="input" inputmode="numeric"></div>
        <div class="col-span-2"><label class="label">单独使用时的操作人姓名</label><input v-model="f.localUser" class="input" placeholder="本机用户"><p class="text-[11px] text-ink-4 mt-1">从 QMS 打开时以 QMS 传来的用户为准。</p></div>
      </div>
      <div class="flex justify-end"><button class="btn-primary" @click="save"><ic name="check" :size="15"/>保存设置</button></div>
      <div class="pt-4 border-t border-black/[0.06]">
        <h3 class="text-[13px] font-semibold">数据</h3>
        <p class="text-[11.5px] text-ink-3 mt-1">服务端数据目录：<span class="font-mono">{{ S.server.dataDir || '—' }}</span></p>
        <div class="flex gap-2 mt-3"><button class="btn-secondary btn-sm" @click="exportAll"><ic name="download" :size="14"/>导出全部数据（JSON）</button><button class="btn-ghost btn-sm !text-rose-600" @click="reset"><ic name="trash" :size="14"/>清空数据</button></div>
      </div>
    </div>
  </div>

  <div class="card p-5 text-[12px] text-ink-3 leading-relaxed">
    <h2 class="section-title !text-[14px] mb-2">关于</h2>
    自研气泡识别软件 {{ APP_VERSION }} · 服务端 {{ S.server.name }} {{ S.server.version }}。识别在浏览器本地完成：pdf.js（Apache-2.0）读取 PDF，tesseract.js（Apache-2.0）本地 OCR；界面 Vue 3（MIT）、Tailwind CSS（MIT）。
  </div>
</div>`,
};
