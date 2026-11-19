/* 手机壳：只读影印本的入口页。
 * 数据全部来自 demo-dist/app/tape/tape.json（放映机录下来的接口响应），
 * 壳自己不发明任何数字；取不到就显示「—」，不假装。 */
(function () {
  'use strict';

  var TAPE = './app/tape/tape.json';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function fmtMoney(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(String(v).replace(/,/g, ''));
    if (isNaN(n)) return String(v);
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtCount(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    return isNaN(n) ? String(v) : n.toLocaleString('zh-CN');
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 磁带里一条记录长这样：{method, path, query, body, route, status, json}
   * 同一个接口可能录了多次（不同页面），取「参数最全/最后一条」按需挑。 */
  function findEntries(tape, pathPrefix) {
    return (tape.entries || []).filter(function (e) {
      return e.path === pathPrefix && e.method === 'POST';
    });
  }

  function pickRichest(entries) {
    // 条目多时优先取返回行数最多的那条（通常是首页或全量查询）
    var best = null, bestN = -1;
    entries.forEach(function (e) {
      var rows = (e.json && e.json.data && (e.json.data.rows || e.json.data)) || [];
      var n = Array.isArray(rows) ? rows.length : 0;
      if (n > bestN) { bestN = n; best = e; }
    });
    return best;
  }

  function statusTag(s) {
    // 业务状态：1 草稿 / 2 审批中 / 3 已生效 / 4 已否决 / 5 已作废
    var map = { 1: ['草稿', ''], 2: ['审批中', 'wait'], 3: ['已生效', 'on'], 4: ['已否决', ''], 5: ['已作废', ''] };
    var it = map[s] || [String(s || '—'), ''];
    return '<span class="tag ' + it[1] + '">' + esc(it[0]) + '</span>';
  }

  function renderHome(tape) {
    var ov = null, recon = null;
    (tape.entries || []).forEach(function (e) {
      if (e.path === '/api/dashboard/overview' && e.json && e.json.data) ov = e.json.data;
      if (e.path === '/api/recon/summary' && e.json && e.json.data) recon = e.json.data;
    });
    if (!ov) return;

    var vals = {
      plans: fmtCount(ov.plans && ov.plans.live),
      entPlans: fmtCount(ov.entPlans && ov.entPlans.live),
      persons: fmtCount(ov.people && ov.people.active),
      balance: fmtMoney(ov.money && ov.money.accountBalance),
      unpaid: fmtMoney(ov.money && ov.money.unpaidDue),
      recon: recon ? (recon.result === 'PASS' ? 'PASS' : '有差异') : '—'
    };

    var foot = {
      plans: ov.plans ? ('草稿 ' + ov.plans.draft + ' · 审批中 ' + ov.plans.inApproval) : '',
      entPlans: ov.entPlans ? ('待复核 ' + ov.entPlans.pendingReview + ' · 终止 ' + ov.entPlans.terminated) : '',
      persons: ov.people ? ('保留 ' + ov.people.retained + ' · 终止 ' + ov.people.terminated) : '',
      unpaid: '口径：未过账单据',
      recon: recon ? (recon.checkedAccounts + ' 账户 · ' + recon.checkedTxns + ' 流水') : '点进系统看'
    };

    Array.prototype.forEach.call(document.querySelectorAll('#stat-grid .stat'), function (el) {
      var k = el.getAttribute('data-k');
      var v = el.querySelector('.v');
      if (v) v.textContent = vals[k] !== undefined && vals[k] !== null ? vals[k] : '—';
      if (k === 'recon') {
        el.classList.toggle('ok', vals.recon === 'PASS');
        el.classList.toggle('warn', vals.recon !== 'PASS' && vals.recon !== '—');
      }
      var f = el.querySelector('.f');
      if (f && foot[k]) f.textContent = foot[k];
    });
  }

  function renderPlans(tape) {
    var e = pickRichest(findEntries(tape, '/api/plans/page'));
    var box = $('#plan-list');
    if (!e || !e.json || !e.json.data || !Array.isArray(e.json.data.rows)) {
      box.innerHTML = '<p class="empty">磁带里没录到产品列表。</p>';
      return;
    }
    var rows = e.json.data.rows;
    if (!rows.length) { box.innerHTML = '<p class="empty">这个库里还没有产品。</p>'; return; }
    box.innerHTML = rows.map(function (r) {
      var amt = fmtMoney(r.totalAmt);
      return '<a class="row" href="./app/#/plans/' + esc(r.planId) + '">' +
        '<div class="n"><span class="no">' + esc(r.planNo) + '</span>' + statusTag(r.bizStatus) + '</div>' +
        '<div class="name">' + esc(r.planName) + '</div>' +
        '<div class="meta"><span>金额 ' + amt + ' 元</span>' +
        (r.startDate ? '<span>成立 ' + esc(r.startDate) + '</span>' : '<span>未成立</span>') +
        '</div></a>';
    }).join('');
  }

  function renderEnts(tape) {
    var e = pickRichest(findEntries(tape, '/api/ent-plans/page'));
    var box = $('#ent-list');
    if (!e || !e.json || !e.json.data || !Array.isArray(e.json.data.rows)) {
      box.innerHTML = '<p class="empty">磁带里没录到企业年金列表。</p>';
      return;
    }
    var rows = e.json.data.rows;
    if (!rows.length) { box.innerHTML = '<p class="empty">这个库里还没有企业计划。</p>'; return; }
    box.innerHTML = rows.map(function (r) {
      var st = { 1: ['未生效', ''], 2: ['生效', 'on'], 3: ['停用', ''] }[r.status] || [String(r.status || '—'), ''];
      return '<a class="row" href="./app/#/ent-plans/' + esc(r.entPlanId) + '">' +
        '<div class="n"><span class="no">' + esc(r.entPlanNo) + '</span>' +
        '<span class="tag ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
        '<div class="name">' + esc(r.entPlanName) + '</div>' +
        '<div class="meta"><span>所属计划 ' + esc(r.planNo || '—') + '</span>' +
        '<span>归属方式 ' + (r.vestMode === 2 ? '按全额' : '按余额') + '</span></div></a>';
    }).join('');
  }

  function switchTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    $$('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }

  function boot() {
    $$('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    var want = (location.hash || '').replace('#', '');
    if (['home', 'plans', 'annuity', 'me'].indexOf(want) >= 0) switchTab(want);

    fetch(TAPE, { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (tape) {
        renderHome(tape);
        renderPlans(tape);
        renderEnts(tape);
        var when = tape.recordedAt ? String(tape.recordedAt).slice(0, 10) : '—';
        $('#tape-date').textContent = when;
        $('#tape-pages').textContent = (tape.routes || []).length || '—';
      })
      .catch(function () {
        $('#plan-list').innerHTML = '<p class="empty">读不到磁带（是不是还没构建？先跑 demo/build-demo.ps1）。</p>';
        $('#ent-list').innerHTML = '<p class="empty">读不到磁带。</p>';
      });
  }

  document.addEventListener('DOMContentLoaded', boot);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 本地 file:// 打开时注册会失败，忽略 */ });
    });
  }
})();
