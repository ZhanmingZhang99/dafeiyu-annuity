/*
 * 放映机：把 /api/* 的请求拦下来，改成从磁带（tape.json）里取一条响应还回去。
 *
 * 目的：让这一套页面在完全没有后端、没有数据库的地方照样点得动——
 * 扔到任何静态托管上就是一个能看的影印本。
 *
 * 三条原则，写死在代码里：
 *   1. 只读。写操作（POST/PUT/DELETE 里带 body 的）一律拒绝，并明确说「演示站只读」，
 *      绝不假装成功——假装成功会让人以为数据真改了。
 *   2. 没录到的接口如实报错（30002），并在控制台留一条，方便回头补录。
 *   3. 不改业务代码。这个文件只在演示构建里被塞进 index.html，正经构建里没有它。
 */
(function () {
  'use strict'

  // 演示站不设门槛：在应用启动之前，把会话直接写进 localStorage。
  // 键名与 trust-lite/web/src/stores/user.js 保持一致（trust-lite.token / trust-lite.user）。
  // 这一步必须在业务代码之前跑——本文件注入在 <head>，业务 bundle 是 module，天然排在后面。
  try {
    if (!localStorage.getItem('trust-lite.token')) {
      localStorage.setItem('trust-lite.token', 'demo-token-readonly')
      localStorage.setItem('trust-lite.user', JSON.stringify({
        userId: 1,
        username: 'admin',
        displayName: '系统管理员',
        roles: ['ADMIN']
      }))
    }
  } catch (e) {
    // 隐私模式下 localStorage 可能不可写，那就让它走登录页，不因此报错
  }

  var TAPE_URL = './tape/tape.json'
  var tape = { entries: [], routes: [] }
  var ready = null
  var misses = []
  var hits = 0

  // 手机上的排版补丁：桌面布局在 390 宽下侧栏会吃掉半个屏。
  // 样式全部包在 max-width:899px 里，宽屏不受影响；正经构建里没有这段。
  function installPhoneLayout() {
    if (document.getElementById('__menu_btn')) return
    var st = document.createElement('style')
    var phoneCssLines = [
      '@media (max-width:899px){',
      '  .aside{position:fixed!important;left:0;top:0;bottom:0;z-index:60;transform:translateX(-100%);transition:transform .18s ease;box-shadow:2px 0 12px rgba(0,0,0,.35)}',
      '  body.__menu-open .aside{transform:none}',
      '  .el-main{padding:10px!important;overflow-x:auto}',
      '  .header .el-breadcrumb{display:none!important}',
      '  .header .header-right .el-tag{display:none!important}',
      '  .el-table{font-size:12px}',
      '  .cardmode .el-table{display:block;background:transparent;font-size:13px}',
      '  .cardmode .el-table__header-wrapper{display:none}',
      '  .cardmode .el-table__body-wrapper,.cardmode .el-table__body,.cardmode .el-table__body tbody{display:block;width:100%!important;overflow:visible!important}',
      '  .cardmode .el-table,.cardmode .el-table__inner-wrapper{width:100%!important;display:block}',
      '  .cardmode .el-scrollbar__wrap{overflow-x:hidden!important}',
      '  .cardmode .el-scrollbar__view{display:block!important;width:100%!important}',
      '  .cardmode .el-card__body{padding:10px!important}',
      '  .cardmode .el-table__body tbody tr{display:block;width:100%!important;box-sizing:border-box;background:#fff;border:1px solid #e6ebf2;border-radius:12px;margin:0 0 10px;padding:10px 12px}',
      '  .cardmode .el-table__body tbody tr:hover>td{background:transparent}',
      '  .cardmode .el-table__body tbody td{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border:0!important;padding:3px 0;line-height:1.55;width:auto!important;background:transparent!important}',
      '  .cardmode .el-table__body tbody td::before{content:attr(data-label);color:#8a94a6;font-size:12px;flex:0 0 76px;text-align:left}',
      '  .cardmode .el-table__body tbody td .cell{padding:0;flex:1 1 auto;min-width:0;word-break:break-word;text-align:right}',
      '  .cardmode .el-table__body tbody td.is-first{display:block;padding:0 0 6px;border-bottom:1px dashed #eef1f6!important;margin-bottom:6px}',
      '  .cardmode .el-table__body tbody td.is-first::before{display:none}',
      '  .cardmode .el-table__body tbody td.is-first .cell{text-align:left;font-weight:600;font-size:14px}',
      '  .cardmode .el-table__body tbody td.is-op{justify-content:flex-end;gap:16px;padding-top:8px;margin-top:6px;border-top:1px dashed #eef1f6!important}',
      '  .cardmode .el-table__body tbody td.is-op::before{display:none}',
      '  .cardmode .el-table__body tbody td.is-op .cell{text-align:right}',
      '  .cardmode .el-table colgroup{display:none}',
      '  .cardmode .el-table__body tbody td{min-width:0;overflow:visible}',
      '  .cardmode .el-table__body tbody td .cell{width:auto!important;min-width:0;white-space:normal!important;overflow:visible!important;text-overflow:clip;text-align:right}',
      '  .cardmode .el-pagination{padding:4px 0 0}',
      '  #__menu_btn{display:block}',
      '}',
      '#__menu_btn{display:none;position:fixed;right:12px;bottom:calc(44px + env(safe-area-inset-bottom));z-index:80;border:0;border-radius:22px;padding:9px 16px;font-size:13px;background:#4fb0ff;color:#08243b;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.35)}'
    ]
    st.textContent = phoneCssLines.join('\n')
    document.head.appendChild(st)
    // 桌面想预览手机版：地址后面加 ?card=1（或 #card=1）
    var forceCard = /(?:[?&#])card=1/.test(location.search + location.hash)
    if (forceCard) {
      var inner = phoneCssLines.slice(1).filter(function (l) { return l.trim() !== '}' })
      var st2 = document.createElement('style')
      inner.push('body[data-card-forced] .el-main{max-width:520px;margin:0 auto}', + 'body[data-card-forced] .el-table,' + 'body[data-card-forced] .el-table__inner-wrapper,' + 'body[data-card-forced] .el-table__body-wrapper{display:block;width:100%!important}')
      st2.textContent = inner.join('\n')
      document.head.appendChild(st2)
      document.body.setAttribute('data-card-forced', '1')
    }
    var b = document.createElement('button')
    b.id = '__menu_btn'
    b.textContent = '菜单'
    b.onclick = function () { document.body.classList.toggle('__menu-open') }
    // 应用自带的左上角折叠按钮在窄屏只会把侧栏收成 64px，看着像失灵；窄屏下让它开抽屉
    document.addEventListener('click', function (e) {
      if (window.innerWidth > 899) return
      var t = e.target
      if (t && t.closest && t.closest('.collapse-btn')) {
        e.preventDefault()
        e.stopPropagation()
        document.body.classList.toggle('__menu-open')
      }
    }, true)
    document.body.appendChild(b)
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('__menu-open')) return
      var a = e.target && e.target.closest ? e.target.closest('.el-menu-item, .el-sub-menu__title, .aside a') : null
      if (a) document.body.classList.remove('__menu-open')
    }, true)
  }


  // 手机上的表格改卡片：表头文字搬到每一格前面当标签，一行一张卡。
  // 不做逐页改造，靠 el-table 的统一结构在所有列表页生效。
  function labelTables() {
    if (!document.body || !document.body.classList.contains('cardmode')) return
    var tables = document.querySelectorAll('.el-table')
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i]
      var ths = t.querySelectorAll('.el-table__header thead th')
      if (!ths.length) continue
      var labels = []
      for (var k = 0; k < ths.length; k++) labels.push((ths[k].innerText || '').trim())
      var rows = t.querySelectorAll('.el-table__body tbody tr')
      for (var r = 0; r < rows.length; r++) {
        var tds = rows[r].children
        for (var c = 0; c < tds.length; c++) {
          var td = tds[c]
          var label = labels[c] || ''
          if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label)
          if (c === 0) td.classList.add('is-first')
          if (label === '操作' || label === '操作列') td.classList.add('is-op')
        }
      }
    }
  }

  var labelTimer = null
  function scheduleLabel() {
    if (labelTimer) return
    labelTimer = setTimeout(function () { labelTimer = null; labelTables() }, 120)
  }

  function startCardMode() {
    document.body.classList.add('cardmode')
    labelTables()
    window.__cardDebug = labelTables
    var mo = new MutationObserver(scheduleLabel)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleLabel)
    window.addEventListener('hashchange', function () { setTimeout(labelTables, 400) })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPhoneLayout)
  } else {
    installPhoneLayout()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCardMode)
  } else {
    startCardMode()
  }

  // 只读判定：这些动作即便磁带里有记录也不回放，直接拒绝
  var WRITE_METHODS = { POST_WRITE: 1 }

  function normalizePath(p) {
    var q = p.indexOf('?')
    if (q >= 0) p = p.slice(0, q)
    return p.replace(/\/+$/, '') || '/'
  }

  // 把路径里的数字段换成 {id}，用来做「同一类接口」的兜底匹配
  function pathShape(p) {
    return normalizePath(p).replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/[A-Z]\d{6,}(?=\/|$)/g, '/{id}')
  }

  function loadTape() {
    if (ready) return ready
    ready = fetch(TAPE_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('磁带读不到：' + r.status)
        return r.json()
      })
      .then(function (j) {
        tape = j || tape
        tape.entries = tape.entries || []
        window.__demoTape = { entries: tape.entries.length, routes: (tape.routes || []).length }
        return tape
      })
      .catch(function (e) {
        console.error('[放映机]', e.message)
        window.__demoTape = { entries: 0, routes: 0, error: e.message }
        return tape
      })
    return ready
  }

  // 这些 POST 只是「查」，不是「改」：登录、以及各种 page / preview / overview 之类
  var READONLY_POST = /^\/api\/auth\/(login|logout)$|\/(page|query|preview|overview|tree|timeline|detail|list|search|check|calc|estimate|trial)$/

  function isWrite(method, body, path) {
    if (READONLY_POST.test(normalizePath(path || ''))) return false

    if (method === 'GET') return false
    // 分页/查询类也是 POST，但它们带的是 condition，不改数据
    if (!body) return false
    if (typeof body === 'string') {
      if (/"condition"\s*:/.test(body) && !/"(planName|partyName|entPlanName|amount)"/.test(body)) return false
      if (/^(标记|确认|提交|保存|删除)/.test(body.trim())) return true
      return true
    }
    return true
  }

  function pick(method, path) {
    var p = normalizePath(path)
    var same = tape.entries.filter(function (e) {
      return normalizePath(e.path) === p && (!method || e.method === method)
    })
    if (same.length) return same[same.length - 1]

    var shape = pathShape(p)
    var loose = tape.entries.filter(function (e) {
      return pathShape(e.path) === shape && (!method || e.method === method)
    })
    if (loose.length) return loose[loose.length - 1]

    // 最后一级兜底：同前缀的任意一条（比如详情页换了 id）
    var pref = tape.entries.filter(function (e) {
      return normalizePath(e.path).indexOf(p) === 0 && (!method || e.method === method)
    })
    if (pref.length) return pref[0]
    return null
  }

  function jsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Demo': 'tape' }
    })
  }

  var realFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    var body = init && init.body

    // 磁带本身、静态资源都走真 fetch
    if (url.indexOf('/api/') < 0) return realFetch(input, init)

    return loadTape().then(function () {
      var path = url
      try { path = new URL(url, location.href).pathname } catch (e) {}

      if (method !== 'GET' && isWrite(method, body, path)) {
        misses.push({ method: method, path: path, reason: 'read-only' })
        window.__demoMiss = misses
        return jsonResponse({
          code: '30001',
          message: '这是只读影印本，演示站不保存任何改动；想自己动手请在本机跑真系统。',
          data: null,
          traceId: 'demo-readonly',
          errors: null
        })
      }

      // 登录接口不依赖磁带：演示站固定认这一组账号（页面上写的就是 admin / admin123）。
      // 留这条是因为有人可能从别处点进登录页，给他一个确定结果，别撞 30002。
      if (normalizePath(path) === '/api/auth/login') {
        hits++
        window.__demoHits = hits
        return jsonResponse({
          code: '0',
          message: 'ok',
          data: {
            token: 'demo-token-readonly',
            user: { userId: 1, username: 'admin', displayName: '系统管理员', roles: ['ADMIN'] }
          },
          traceId: 'demo-login',
          errors: null
        })
      }

      var hit = pick(method, path)
      if (hit) {
        hits++
        window.__demoHits = hits
        return jsonResponse(hit.json)
      }

      misses.push({ method: method, path: path, reason: 'not-recorded' })
      window.__demoMiss = misses
      console.warn('[放映机] 这段没录到：' + method + ' ' + path)
      return jsonResponse({
        code: '30002',
        message: '演示站没录到这一段：' + path,
        data: null,
        traceId: 'demo-miss',
        errors: null
      })
    })
  }

  // 页面右上角挂一条小标签，让人一眼知道这是影印本
  function badge() {
    var d = document.createElement('div')
    d.id = 'demo-badge'
    d.textContent = '只读影印本'
    d.style.cssText = [
      'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2147483647',
      'padding:4px 10px', 'border-radius:12px', 'font-size:12px', 'line-height:18px',
      'background:rgba(24,44,66,.82)', 'color:#cfe6ff', 'pointer-events:none',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif'
    ].join(';')
    if (window.innerWidth <= 899) {
      d.style.fontSize = '11px'
      d.style.padding = '3px 8px'
      d.style.opacity = '0.72'
      d.style.bottom = 'calc(8px + env(safe-area-inset-bottom))'
    }
    document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(d)
    })
  }

  loadTape()
  badge()
})()
