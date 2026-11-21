'use strict';

/*
 * 备考助手 · Beikao Helper
 * 把 Obsidian 笔记变成题库：刷题、背诵、错题本、资料检索、AI 讲解/出题。
 * 全部本地运行；AI 可选，用户自带 API Key。
 */

const {
  Plugin, ItemView, Notice, Modal, PluginSettingTab, Setting, requestUrl, TFile,
} = require('obsidian');

const VIEW_TYPE = 'beikao-helper-view';

const DEFAULT_SETTINGS = {
  folder: '备考资料',
  dailyGoal: 20,
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiKey: '',
  aiModel: 'gpt-4o-mini',
};

const SRS_DAYS = [1, 3, 7, 15, 30];

/* ---------------- 小工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysFromNow(n) {
  return Date.now() + n * 86400000;
}

/* ---------------- 解析笔记 ---------------- */

/**
 * 支持的写法（一行一条，空行结束一道题）：
 *   Q: 社区教育最本质的特征不包括？
 *   A. 全员性
 *   B. 服务性
 *   答案: B
 *   解析: 服务性不属于最本质特征。
 *
 * 没有选项行的，自动当成背诵卡（问答对）。
 */
function parseContent(content, file) {
  const items = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.question) items.push(cur);
    cur = null;
  };

  content.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    let m;
    if ((m = line.match(/^(?:Q|问)\s*[:：]\s*(.+)$/i))) {
      flush();
      cur = { question: m[1].trim(), options: {}, answer: '', explanation: '', file, line: idx + 1 };
      return;
    }
    if (!cur) return;
    if ((m = line.match(/^([A-E])\s*[.．、):：]\s*(.+)$/))) {
      cur.options[m[1].toUpperCase()] = m[2].trim();
      return;
    }
    if ((m = line.match(/^(?:答案|正确答案|答)\s*[:：]\s*(.+)$/))) {
      cur.answer = m[1].trim();
      return;
    }
    if ((m = line.match(/^(?:解析|说明|考点)\s*[:：]\s*(.+)$/))) {
      cur.explanation = m[1].trim();
    }
  });
  flush();
  return items.map(normalizeItem).filter(Boolean);
}

function normalizeItem(it) {
  const letters = Object.keys(it.options);
  let answerLetters = [];
  let answerText = it.answer;
  if (letters.length) {
    const ans = (it.answer || '').trim();
    if (!ans) return null;
    const m = ans.match(/^[A-E]+$/i);
    if (m) {
      answerLetters = m[0].toUpperCase().split('');
    } else if (ans.length >= 2) {
      const hit = letters.find((k) => it.options[k] === ans
        || it.options[k].includes(ans)
        || ans.includes(it.options[k]));
      if (hit) answerLetters = [hit];
    }
    if (!answerLetters.length) return null;
  }
  if (!answerLetters.length && !answerText) return null;
  return {
    id: hash(it.file + '|' + it.question),
    question: it.question,
    options: it.options,
    answerLetters,
    answerText,
    explanation: it.explanation,
    file: it.file,
    line: it.line,
    type: answerLetters.length ? 'choice' : 'card',
  };
}

/* ---------------- 主插件 ---------------- */

class BeikaoPlugin extends Plugin {
  async onload() {
    await this.loadAll();

    this.registerView(VIEW_TYPE, (leaf) => new StudyView(leaf, this));

    this.addRibbonIcon('graduation-cap', '打开备考助手', () => this.activateView());

    this.addCommand({ id: 'open', name: '打开备考助手', callback: () => this.activateView() });
    this.addCommand({ id: 'rebuild', name: '重新导入题库', callback: () => this.rebuild(true) });
    this.addCommand({ id: 'ai-explain', name: '用 AI 讲解当前这道题', callback: () => this.aiExplainCurrent() });
    this.addCommand({ id: 'ai-generate', name: '用 AI 从当前笔记生成题目', callback: () => this.aiGenerateFromNote() });

    this.addSettingTab(new BeikaoSettings(this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadAll() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    this.progress = Object.assign(
      { wrong: {}, srs: {}, stats: { answered: 0, correct: 0, byDay: {}, streak: 0, lastDay: '' } },
      data.progress || {},
    );
    this.items = [];
    this.files = 0;
    await this.rebuild(false);
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, progress: this.progress });
  }

  /* ---- 题库 ---- */
  async rebuild(notify) {
    const folder = (this.settings.folder || '').replace(/^\/+|\/+$/g, '');
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      if (!folder) return true;
      return f.path === folder || f.path.startsWith(folder + '/');
    });
    const items = [];
    for (const f of files) {
      let content = '';
      try {
        content = await this.app.vault.cachedRead(f);
      } catch (e) {
        continue;
      }
      items.push(...parseContent(content, f.path));
    }
    this.items = items;
    this.files = files.length;
    if (notify) {
      new Notice(`已导入 ${items.length} 道题，来自 ${files.length} 篇笔记`);
      this.refreshViews();
    }
    return items;
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view && leaf.view.render) leaf.view.render();
    });
  }

  async activateView() {
    let leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /* ---- 进度 ---- */
  pick(onlyChoice) {
    const pool = onlyChoice ? this.items.filter((i) => i.type === 'choice') : this.items;
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  pickDue() {
    const cards = this.items.filter((i) => i.type === 'card');
    if (!cards.length) return null;
    cards.sort((a, b) => {
      const da = this.progress.srs[a.id] ? this.progress.srs[a.id].due : 0;
      const db = this.progress.srs[b.id] ? this.progress.srs[b.id].due : 0;
      return da - db;
    });
    return cards[0];
  }

  recordAnswer(item, correct) {
    const s = this.progress.stats;
    s.answered += 1;
    if (correct) s.correct += 1;
    const d = today();
    s.byDay[d] = s.byDay[d] || { answered: 0, correct: 0 };
    s.byDay[d].answered += 1;
    if (correct) s.byDay[d].correct += 1;
    if (s.lastDay !== d) {
      const y = new Date(Date.now() - 86400000);
      const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      s.streak = s.lastDay === yd ? (s.streak || 0) + 1 : 1;
      s.lastDay = d;
    }
    if (correct) {
      delete this.progress.wrong[item.id];
    } else {
      const w = this.progress.wrong[item.id] || { count: 0 };
      w.count += 1;
      w.ts = Date.now();
      this.progress.wrong[item.id] = w;
    }
    this.saveAll();
  }

  recordRecite(item, known) {
    const prev = this.progress.srs[item.id] || { ease: 0, due: 0, seen: 0 };
    const ease = known ? Math.min(prev.ease + 1, SRS_DAYS.length - 1) : 0;
    this.progress.srs[item.id] = {
      ease,
      due: daysFromNow(SRS_DAYS[ease]),
      seen: prev.seen + 1,
    };
    this.recordAnswer(item, known);
  }

  todayCount() {
    const d = this.progress.stats.byDay[today()];
    return d ? d.answered : 0;
  }

  /* ---- 出处跳转 ---- */
  async openSource(item) {
    const file = this.app.vault.getAbstractFileByPath(item.file);
    if (!(file instanceof TFile)) {
      new Notice('找不到原文件：' + item.file);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view && view.editor) {
      const line = Math.max(0, (item.line || 1) - 1);
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }

  /* ---- AI ---- */
  aiReady() {
    const s = this.settings;
    return Boolean(s.aiEnabled && s.aiKey && s.aiBaseUrl && s.aiModel);
  }

  async aiChat(messages) {
    const s = this.settings;
    if (!this.aiReady()) throw new Error('先在设置里打开 AI 并填好 Key');
    const url = s.aiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
    const res = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.aiKey,
      },
      body: JSON.stringify({ model: s.aiModel, messages, temperature: 0.4 }),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`AI 接口返回 ${res.status}：${(res.text || '').slice(0, 200)}`);
    }
    const data = res.json || {};
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    if (!content) throw new Error('AI 没有返回内容');
    return content;
  }

  aiExplainCurrent() {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const item = view && view.view ? view.view.cur : null;
    if (!item) {
      new Notice('先在备考助手里出一道题');
      return;
    }
    const prompt = [
      '你是在带教考生的老师。下面这道题，请用考生能懂的话讲三件事：',
      '1) 正确答案为什么对；2) 其它选项错在哪；3) 最容易混的那个概念怎么区分。',
      '不要复述题干，直接讲。',
      '',
      `题目：${item.question}`,
      Object.keys(item.options).length
        ? '选项：' + Object.keys(item.options).map((k) => `${k}. ${item.options[k]}`).join('  ')
        : '',
      `标准答案：${item.answerLetters.join('') || item.answerText}`,
      item.explanation ? `已有解析：${item.explanation}` : '',
    ].filter(Boolean).join('\n');

    new Notice('正在让 AI 讲解…');
    this.aiChat([{ role: 'user', content: prompt }])
      .then((text) => new AiModal(this.app, 'AI 讲解', text).open())
      .catch((e) => new Notice(String(e.message || e)));
  }

  async aiGenerateFromNote() {
    if (!this.aiReady()) {
      new Notice('先在设置里打开 AI 并填好 Key');
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
    if (!view) {
      new Notice('先打开一篇笔记');
      return;
    }
    const text = view.editor.getValue().slice(0, 6000);
    if (text.trim().length < 50) {
      new Notice('这篇笔记太短，先写点内容');
      return;
    }
    const prompt = [
      '把下面的学习笔记变成 5 道单选题，只输出 JSON 数组，不要解释。',
      '每个元素的格式：{"question":"题干","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"B","explanation":"一句话解析"}',
      '要求：答案必须能从笔记里找到依据；题干不要出现"根据笔记"这类说法；中文。',
      '',
      '笔记：',
      text,
    ].join('\n');

    new Notice('正在生成题目…');
    try {
      const out = await this.aiChat([{ role: 'user', content: prompt }]);
      const start = out.indexOf('[');
      const end = out.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error('AI 没按 JSON 返回');
      const arr = JSON.parse(out.slice(start, end + 1));
      new AiModal(this.app, `AI 生成 ${arr.length} 道题（可插入当前笔记）`,
        arr.map((q) => `Q: ${q.question}\nA. ${q.options.A}\nB. ${q.options.B}\nC. ${q.options.C}\nD. ${q.options.D}\n答案: ${q.answer}\n解析: ${q.explanation || ''}`).join('\n\n'),
        view).open();
    } catch (e) {
      new Notice('生成失败：' + String(e.message || e));
    }
  }
};

/** 供测试与贡献者使用：解析函数单独导出 */
module.exports = BeikaoPlugin;
module.exports.parseContent = parseContent;
module.exports.normalizeItem = normalizeItem;

/* ---------------- 侧栏视图 ---------------- */

class StudyView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tab = 'practice';
    this.cur = null;
    this.picked = [];
    this.graded = false;
    this.revealed = false;
    this.search = '';
    this.reciteItem = null;
    this.aiText = '';
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '备考助手'; }
  getIcon() { return 'graduation-cap'; }

  async onOpen() { this.render(); }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('bk-root');

    const head = root.createDiv({ cls: 'bk-head' });
    head.createEl('div', { cls: 'bk-title', text: '备考助手' });
    const st = this.plugin.progress.stats;
    const rate = st.answered ? Math.round((st.correct / st.answered) * 100) : 0;
    head.createEl('div', {
      cls: 'bk-sub',
      text: `今日 ${this.plugin.todayCount()}/${this.plugin.settings.dailyGoal} · 正确率 ${rate}% · 题库 ${this.plugin.items.length}`,
    });

    const tabs = root.createDiv({ cls: 'bk-tabs' });
    [['practice', '刷题'], ['recite', '背诵'], ['wrong', '错题'], ['search', '检索'], ['stats', '统计']]
      .forEach(([key, label]) => {
        const b = tabs.createEl('button', { cls: 'bk-tab' + (this.tab === key ? ' on' : ''), text: label });
        b.onclick = () => { this.tab = key; this.render(); };
      });

    const body = root.createDiv({ cls: 'bk-body' });
    if (this.tab === 'practice') this.renderPractice(body);
    else if (this.tab === 'recite') this.renderRecite(body);
    else if (this.tab === 'wrong') this.renderWrong(body);
    else if (this.tab === 'search') this.renderSearch(body);
    else this.renderStats(body);

    const foot = root.createDiv({ cls: 'bk-foot' });
    foot.createEl('button', { cls: 'bk-link', text: '重新导入题库' }).onclick = () => this.plugin.rebuild(true);
    foot.createEl('button', { cls: 'bk-link', text: '导入说明' }).onclick = () => new Notice(
      '在笔记里写：Q: 题干 / A. 选项 / 答案: B / 解析: 一句话。没有选项就是背诵卡。',
    );
  }

  /* ---- 刷题 ---- */
  renderPractice(box) {
    const p = this.plugin;
    if (!this.cur) {
      box.createEl('div', { cls: 'bk-empty', text: p.items.length
        ? '点下面开始。做错的题会自动进错题本。'
        : '还没有题目。把笔记放进「' + p.settings.folder + '」文件夹，格式：Q: 题干 / A. 选项 / 答案: B。' });
      const b = box.createEl('button', { cls: 'bk-btn bk-primary', text: '出一题' });
      b.onclick = () => { this.cur = p.pick(true); this.picked = []; this.graded = false; this.render(); };
      return;
    }

    const it = this.cur;
    box.createEl('div', { cls: 'bk-q', text: it.question });
    const opts = box.createDiv({ cls: 'bk-opts' });
    Object.keys(it.options).forEach((k) => {
      const btn = opts.createEl('button', { cls: 'bk-opt', text: `${k}. ${it.options[k]}` });
      if (this.graded) {
        if (it.answerLetters.includes(k)) btn.addClass('right');
        else if (this.picked.includes(k)) btn.addClass('wrong');
      } else if (this.picked.includes(k)) {
        btn.addClass('sel');
      }
      btn.onclick = () => {
        if (this.graded) return;
        this.picked = [k];
        this.graded = true;
        p.recordAnswer(it, it.answerLetters.includes(k));
        this.render();
      };
    });

    if (this.graded) {
      const ok = it.answerLetters.every((k) => this.picked.includes(k)) && this.picked.length === it.answerLetters.length;
      const res = box.createDiv({ cls: 'bk-result ' + (ok ? 'ok' : 'no') });
      res.createEl('div', { cls: 'bk-verdict', text: ok ? '答对了' : `答错了，正确答案 ${it.answerLetters.join('')}` });
      if (it.explanation) res.createEl('div', { cls: 'bk-exp', text: '解析：' + it.explanation });
      const src = res.createEl('button', { cls: 'bk-link', text: '看原文 ›' });
      src.onclick = () => p.openSource(it);

      const ab = box.createEl('button', { cls: 'bk-btn bk-primary', text: '下一题' });
      ab.onclick = () => { this.cur = p.pick(true); this.picked = []; this.graded = false; this.render(); };
      if (p.settings.aiEnabled) {
        const ai = box.createEl('button', { cls: 'bk-btn', text: 'AI 讲解' });
        ai.onclick = () => p.aiExplainCurrent();
      }
    }
  }

  /* ---- 背诵 ---- */
  renderRecite(box) {
    const p = this.plugin;
    if (!this.reciteItem) this.reciteItem = p.pickDue();
    if (!this.reciteItem) {
      box.createEl('div', { cls: 'bk-empty', text: '还没有背诵卡。没有选项的 Q/A 会自动变成卡。' });
      return;
    }
    const it = this.reciteItem;
    box.createEl('div', { cls: 'bk-q', text: it.question });
    if (!this.revealed) {
      box.createEl('button', { cls: 'bk-btn bk-primary', text: '显示答案' })
        .onclick = () => { this.revealed = true; this.render(); };
      return;
    }
    box.createEl('div', { cls: 'bk-answer', text: it.answerText || it.options[it.answerLetters[0]] });
    const row = box.createDiv({ cls: 'bk-row' });
    row.createEl('button', { cls: 'bk-btn bk-good', text: '记住了' }).onclick = () => {
      p.recordRecite(it, true);
      this.reciteItem = null; this.revealed = false; this.render();
    };
    row.createEl('button', { cls: 'bk-btn bk-bad', text: '没记住' }).onclick = () => {
      p.recordRecite(it, false);
      this.reciteItem = null; this.revealed = false; this.render();
    };
    const src = box.createEl('button', { cls: 'bk-link', text: '看原文 ›' });
    src.onclick = () => p.openSource(it);
  }

  /* ---- 错题 ---- */
  renderWrong(box) {
    const p = this.plugin;
    const ids = Object.keys(p.progress.wrong);
    if (!ids.length) {
      box.createEl('div', { cls: 'bk-empty', text: '错题本是空的。做错一道就会进来。' });
      return;
    }
    const list = p.items.filter((i) => p.progress.wrong[i.id]);
    list.forEach((it) => {
      const row = box.createDiv({ cls: 'bk-wrong' });
      row.createEl('div', { cls: 'bk-wq', text: it.question });
      row.createEl('div', {
        cls: 'bk-wmeta',
        text: `${it.file.split('/').pop()} · 错了 ${p.progress.wrong[it.id].count} 次 · 答案 ${it.answerLetters.join('') || it.answerText}`,
      });
      row.onclick = () => {
        this.tab = 'practice';
        this.cur = it;
        this.picked = [];
        this.graded = false;
        this.render();
      };
    });
  }

  /* ---- 检索 ---- */
  renderSearch(box) {
    const p = this.plugin;
    const input = box.createEl('input', { cls: 'bk-input', type: 'text', placeholder: '搜题干 / 答案 / 解析…' });
    input.value = this.search;
    input.oninput = () => { this.search = input.value; this.render(); setTimeout(() => {
      const el = this.contentEl.querySelector('.bk-input');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 0); };

    const q = this.search.trim().toLowerCase();
    if (!q) return;
    const hits = p.items.filter((it) =>
      it.question.toLowerCase().includes(q)
      || (it.explanation || '').toLowerCase().includes(q)
      || (it.answerText || '').toLowerCase().includes(q)
      || Object.values(it.options).some((v) => v.toLowerCase().includes(q)));
    box.createEl('div', { cls: 'bk-sub', text: `找到 ${hits.length} 条` });
    hits.slice(0, 50).forEach((it) => {
      const row = box.createDiv({ cls: 'bk-hit' });
      row.createEl('div', { cls: 'bk-wq', text: it.question });
      const meta = row.createEl('div', { cls: 'bk-wmeta' });
      meta.setText(`${it.file.split('/').pop()} · 第 ${it.line} 行`);
      row.onclick = () => p.openSource(it);
    });
  }

  /* ---- 统计 ---- */
  renderStats(box) {
    const p = this.plugin;
    const s = p.progress.stats;
    const grid = box.createDiv({ cls: 'bk-grid' });
    [
      ['已做题数', s.answered],
      ['正确率', (s.answered ? Math.round((s.correct / s.answered) * 100) : 0) + '%'],
      ['连续天数', s.streak || 0],
      ['错题数', Object.keys(p.progress.wrong).length],
      ['题库', p.items.length],
      ['笔记数', p.files],
    ].forEach(([k, v]) => {
      const c = grid.createDiv({ cls: 'bk-cell' });
      c.createEl('div', { cls: 'bk-cell-v', text: String(v) });
      c.createEl('div', { cls: 'bk-cell-k', text: k });
    });

    box.createEl('div', { cls: 'bk-sub', text: '最近 7 天' });
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push([key.slice(5), s.byDay[key] || { answered: 0 }]);
    }
    const max = Math.max(1, ...days.map((d) => d[1].answered));
    const chart = box.createDiv({ cls: 'bk-chart' });
    days.forEach(([label, v]) => {
      const col = chart.createDiv({ cls: 'bk-bar-col' });
      const bar = col.createDiv({ cls: 'bk-bar' });
      bar.style.height = Math.round((v.answered / max) * 60) + 'px';
      col.createEl('div', { cls: 'bk-bar-label', text: label });
    });
  }
}

/* ---------------- AI 结果弹窗 ---------------- */

class AiModal extends Modal {
  constructor(app, title, text, editorView) {
    super(app);
    this.title = title;
    this.text = text;
    this.editorView = editorView || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    const pre = contentEl.createEl('pre', { cls: 'bk-modal-pre' });
    pre.setText(this.text);
    if (this.editorView) {
      contentEl.createEl('button', { cls: 'bk-btn bk-primary', text: '插入到当前笔记' }).onclick = () => {
        const ed = this.editorView.editor;
        ed.replaceSelection('\n' + this.text + '\n');
        new Notice('已插入');
        this.close();
      };
    }
    contentEl.createEl('button', { cls: 'bk-btn', text: '复制' }).onclick = async () => {
      await navigator.clipboard.writeText(this.text);
      new Notice('已复制');
    };
  }

  onClose() { this.contentEl.empty(); }
}

/* ---------------- 设置 ---------------- */

class BeikaoSettings extends PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('资料文件夹')
      .setDesc('这个文件夹下的 Markdown 笔记会被解析成题库，留空表示整个库')
      .addText((t) => t.setValue(this.plugin.settings.folder)
        .onChange(async (v) => { this.plugin.settings.folder = v; await this.plugin.saveAll(); }));

    new Setting(containerEl)
      .setName('每日目标题数')
      .addText((t) => t.setValue(String(this.plugin.settings.dailyGoal))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.dailyGoal = Number.isFinite(n) && n > 0 ? n : 20;
          await this.plugin.saveAll();
        }));

    containerEl.createEl('h4', { text: 'AI（可选，用你自己的 Key）' });

    new Setting(containerEl)
      .setName('启用 AI')
      .setDesc('用于讲解错题、从笔记生成题目。不启用也能刷题、背诵、检索。')
      .addToggle((t) => t.setValue(this.plugin.settings.aiEnabled)
        .onChange(async (v) => { this.plugin.settings.aiEnabled = v; await this.plugin.saveAll(); }));

    new Setting(containerEl)
      .setName('接口地址')
      .setDesc('OpenAI 兼容的 /v1 地址，例如 https://api.deepseek.com/v1')
      .addText((t) => t.setValue(this.plugin.settings.aiBaseUrl)
        .onChange(async (v) => { this.plugin.settings.aiBaseUrl = v.trim(); await this.plugin.saveAll(); }));

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('只保存在本机这个库的 data.json 里，不会上传')
      .addText((t) => {
        t.setValue(this.plugin.settings.aiKey);
        t.inputEl.type = 'password';
        t.onChange(async (v) => { this.plugin.settings.aiKey = v.trim(); await this.plugin.saveAll(); });
      });

    new Setting(containerEl)
      .setName('模型名')
      .setDesc('例如 gpt-4o-mini / deepseek-chat')
      .addText((t) => t.setValue(this.plugin.settings.aiModel)
        .onChange(async (v) => { this.plugin.settings.aiModel = v.trim(); await this.plugin.saveAll(); }));

    containerEl.createEl('p', {
      cls: 'bk-note',
      text: '题目格式：Q: 题干 → A. 选项 → 答案: B → 解析: 一句话。没有选项行的 Q/A 会自动成为背诵卡。',
    });
  }
}
