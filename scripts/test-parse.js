#!/usr/bin/env node
'use strict';

/*
 * 解析器测试：不依赖 Obsidian，直接跑 node scripts/test-parse.js
 * 用假的 obsidian 模块顶替运行时，验证 Q/A 解析与答案规范化。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const stub = {
  Plugin: class { addRibbonIcon() {} addCommand() {} registerView() {} addSettingTab() {} async loadData() { return {}; } async saveData() {} },
  ItemView: class { constructor(leaf) { this.leaf = leaf; } },
  Notice: class { constructor() {} },
  Modal: class { constructor() {} open() {} },
  PluginSettingTab: class { constructor() {} },
  Setting: class {
    setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; }
  },
  requestUrl: async () => ({ status: 200, json: {} }),
  TFile: class {},
  MarkdownView: class {},
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'obsidian') return stub;
  return origLoad.apply(this, arguments);
};

const { parseContent } = require(path.join(__dirname, '..', 'main.js'));

let pass = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error('       ' + e.message);
    process.exitCode = 1;
  }
}

console.log('解析器测试');

check('选项 + 字母答案', () => {
  const items = parseContent('Q: 1+1=?\nA. 1\nB. 2\n答案: B\n解析: 算术', 't.md');
  assert.strictEqual(items.length, 1);
  const it = items[0];
  assert.deepStrictEqual(it.answerLetters, ['B']);
  assert.strictEqual(it.type, 'choice');
  assert.strictEqual(it.explanation, '算术');
  assert.strictEqual(it.line, 1);
});

check('答案是选项原文时反查字母', () => {
  const items = parseContent('Q: 首都是?\nA. 上海\nB. 北京\n答案: 北京', 't.md');
  assert.deepStrictEqual(items[0].answerLetters, ['B']);
});

check('无选项自动成为背诵卡', () => {
  const items = parseContent('Q: 三大属性?\n答案: 公益性、普惠性、便民性', 't.md');
  assert.strictEqual(items[0].type, 'card');
  assert.strictEqual(items[0].answerText, '公益性、普惠性、便民性');
});

check('没有答案的题被丢弃', () => {
  const items = parseContent('Q: 这道题没有答案\nA. 甲\nB. 乙', 't.md');
  assert.strictEqual(items.length, 0);
});

check('空行分题，多道题互不串', () => {
  const text = [
    'Q: 第一题', 'A. 甲', 'B. 乙', '答案: A', '',
    'Q: 第二题', 'A. 丙', 'B. 丁', '答案: B', '',
  ].join('\n');
  const items = parseContent(text, 't.md');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].question, '第一题');
  assert.deepStrictEqual(items[1].answerLetters, ['B']);
});

check('题干改一个字，id 会变（进度不串题）', () => {
  const a = parseContent('Q: 甲题\n答案: x', 't.md')[0];
  const b = parseContent('Q: 乙题\n答案: x', 't.md')[0];
  assert.notStrictEqual(a.id, b.id);
});

check('示例文件能被完整解析', () => {
  const files = ['社区教育示例.md', '家庭教育示例.md'];
  let total = 0;
  for (const f of files) {
    const p = path.join(__dirname, '..', 'examples', f);
    const items = parseContent(fs.readFileSync(p, 'utf8'), 'examples/' + f);
    assert.ok(items.length > 0, f + ' 没解析出题目');
    for (const it of items) {
      assert.ok(it.question.length > 3, f + ' 题干太短');
      if (it.type === 'choice') {
        assert.ok(it.answerLetters.length > 0, f + ' 有选择题没答案：' + it.question);
        for (const k of it.answerLetters) {
          assert.ok(it.options[k], f + ' 答案字母不在选项里：' + it.question);
        }
      }
    }
    total += items.length;
    console.log('       ' + f + ' → ' + items.length + ' 道题');
  }
  assert.ok(total >= 15, '示例题总量偏少：' + total);
});

console.log(process.exitCode ? '\n有失败用例，见上' : '\n全部通过（' + pass + ' 项）');
