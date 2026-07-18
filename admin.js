// admin.js
// PC管理画面(admin.html)。認証はスマホ側(app.js)と同じLIFF+LINEログインを使い、
// サーバー側(getAdminDashboard等)で管理者フラグ(社員マスタD列)を必ずチェックする
// (画面側の管理者判定はUI出し分けのためだけで、権限の最終判断はGAS側で行う)。

// ↓この2つはweb/app.jsの値と必ず一致させること(LIFFの再作成・GASの再デプロイをしたら両方書き換える)
var LIFF_ID = '2010686947-KFPaPxQD';
var API_BASE_URL = 'https://script.google.com/macros/s/AKfycby9CioempNx2RqXbGdD_waPGE5au4YtvXReLqbY31F6vQ2TbFjrcr-0oUYiRkZPaMd1lw/exec';
var API_GET_LENGTH_LIMIT = 6000;

var idToken = null;
var staffListCache_ = [];
var currentTab_ = 'tab-dashboard';

function runServer_(action) {
  var args = Array.prototype.slice.call(arguments, 1);
  var argsJson = JSON.stringify(args);
  var request;
  if (argsJson.length < API_GET_LENGTH_LIMIT) {
    var url = API_BASE_URL + '?action=' + encodeURIComponent(action) + '&args=' + encodeURIComponent(argsJson);
    request = fetch(url);
  } else {
    request = fetch(API_BASE_URL, { method: 'POST', body: JSON.stringify({ action: action, args: args }) });
  }
  return request.then(function (res) {
    if (!res.ok) throw new Error('サーバーエラー: HTTP ' + res.status);
    return res.json();
  }).then(function (json) {
    if (!json.ok) throw new Error(json.error || 'サーバーでエラーが発生しました。');
    return json.data;
  });
}

function escapeHtml_(text) {
  var div = document.createElement('div');
  div.textContent = String(text === undefined || text === null ? '' : text);
  return div.innerHTML;
}

function showError_(err) {
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('error-message').textContent = (err && err.message) ? err.message : String(err);
  document.getElementById('screen-error').classList.remove('hidden');
}

function todayYearMonth_() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function minutesToHm_(minutes) {
  var m = Math.max(0, Math.round(Number(minutes) || 0));
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}

// ===== 起動 =====
function initApp_() {
  if (typeof liff === 'undefined') { showError_({ message: 'LIFF SDKの読み込みに失敗しました。' }); return; }
  liff.init({ liffId: LIFF_ID }).then(function () {
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    idToken = liff.getIDToken();
    return runServer_('getMyProfileAndMasters', idToken).then(function (result) {
      if (!result.profile.registered) {
        showError_({ message: '社員登録が完了していません。先にスマホのLINEアプリで社員登録してください。' });
        return;
      }
      if (!result.profile.isAdmin) {
        document.getElementById('screen-loading').classList.add('hidden');
        document.getElementById('screen-denied').classList.remove('hidden');
        return;
      }
      document.getElementById('sidebar-user').textContent = result.profile.staffName;
      document.getElementById('topbar-user').textContent = result.profile.staffName + '(管理者)';
      document.getElementById('screen-loading').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('att-month').value = todayYearMonth_();
      loadDashboardTab_();
    }).catch(function (err) {
      // ブラウザに残っていた古いLIFFセッションのidTokenが期限切れの場合、エラー画面を出す前に
      // ログアウト→再ログインさせて自動的に復旧させる(毎回ユーザーに手動再読み込みさせないため)。
      if (err && err.message && err.message.indexOf('expired') !== -1) {
        liff.logout();
        liff.login({ redirectUri: location.href });
        return;
      }
      throw err;
    });
  }).catch(showError_);
}

// ===== ダッシュボードタブ =====
function renderDonut_(workingCount, doneCount, absentCount, total) {
  var pct = total > 0 ? Math.round((workingCount + doneCount) / total * 100) : 0;
  var workingDeg = total > 0 ? (workingCount / total * 360) : 0;
  var doneDeg = total > 0 ? (doneCount / total * 360) : 0;
  var donut = document.getElementById('today-donut');
  donut.setAttribute('data-pct', pct + '%');
  donut.style.background = 'conic-gradient(var(--success) 0deg ' + workingDeg + 'deg, ' +
    'var(--text-sub) ' + workingDeg + 'deg ' + (workingDeg + doneDeg) + 'deg, ' +
    'var(--border) ' + (workingDeg + doneDeg) + 'deg 360deg)';
  document.getElementById('legend-working').textContent = workingCount;
  document.getElementById('legend-done').textContent = doneCount;
  document.getElementById('legend-absent').textContent = absentCount;
}

function loadDashboardTab_() {
  runServer_('getAdminDashboard', idToken, todayYearMonth_()).then(function (data) {
    staffListCache_ = data.staffList;
    populateStaffSelect_();

    renderDonut_(data.today.workingCount, data.today.doneCount, data.today.absentCount, data.today.totalStaff);
    document.getElementById('stat-pending').textContent = data.pendingRequests.length;
    document.getElementById('stat-month-work').textContent = minutesToHm_(data.month.workMinutes);
    document.getElementById('stat-month-overtime').textContent = minutesToHm_(data.month.overtimeMinutes);
    document.getElementById('stat-month-reports').textContent = data.month.reportCount;

    document.getElementById('today-table-body').innerHTML = data.today.list.map(function (r) {
      return '<tr><td>' + escapeHtml_(r.staffId) + '</td><td>' + escapeHtml_(r.staffName) + '</td>' +
        '<td><span class="badge st-' + r.status + '">' + r.status + '</span></td>' +
        '<td>' + escapeHtml_(r.clockIn ? r.clockIn.split(' ')[1] : '-') + '</td>' +
        '<td>' + escapeHtml_(r.clockOut ? r.clockOut.split(' ')[1] : '-') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty-note">データがありません</td></tr>';

    renderPendingReqTable_(data.pendingRequests);
  }).catch(showError_);
}

function renderPendingReqTable_(list) {
  var body = document.getElementById('pending-req-table-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-note">承認待ちの申請はありません</td></tr>';
    return;
  }
  body.innerHTML = list.map(function (r) {
    return '<tr><td>' + escapeHtml_(r.staffName) + '</td><td>' + escapeHtml_(r.type) + '</td>' +
      '<td>' + escapeHtml_(r.targetDate || '-') + '</td><td>' + escapeHtml_(r.content || '') + '</td>' +
      '<td class="req-actions"><button class="btn-small btn-approve" data-id="' + r.id + '">承認</button>' +
      '<button class="btn-small btn-reject" data-id="' + r.id + '">却下</button></td></tr>';
  }).join('');
  body.querySelectorAll('.btn-approve').forEach(function (btn) {
    btn.addEventListener('click', function () { decide_(btn.getAttribute('data-id'), '承認'); });
  });
  body.querySelectorAll('.btn-reject').forEach(function (btn) {
    btn.addEventListener('click', function () { decide_(btn.getAttribute('data-id'), '却下'); });
  });
}

function decide_(id, decision) {
  runServer_('decideRequest', idToken, id, decision).then(function () {
    loadDashboardTab_();
    if (currentTab_ === 'tab-requests') loadRequestsTab_();
  }).catch(showError_);
}

// ===== 勤怠一覧タブ =====
function populateStaffSelect_() {
  var select = document.getElementById('att-staff');
  var current = select.value;
  select.innerHTML = '<option value="ALL">全社員</option>' + staffListCache_.map(function (s) {
    return '<option value="' + escapeHtml_(s.staffId) + '">' + escapeHtml_(s.staffName) + '</option>';
  }).join('');
  if (current) select.value = current;
}

function loadAttendanceTab_() {
  var yearMonth = document.getElementById('att-month').value || todayYearMonth_();
  var targetStaffId = document.getElementById('att-staff').value;
  runServer_('listAttendanceRows', idToken, yearMonth, targetStaffId).then(function (rows) {
    document.getElementById('att-table-body').innerHTML = rows.map(function (r) {
      return '<tr><td>' + escapeHtml_(r.date) + '</td><td>' + escapeHtml_(r.staffId) + '</td><td>' + escapeHtml_(r.staffName) + '</td>' +
        '<td>' + escapeHtml_(r.clockIn ? r.clockIn.split(' ')[1] : '-') + '</td>' +
        '<td>' + escapeHtml_(r.clockOut ? r.clockOut.split(' ')[1] : '-') + '</td>' +
        '<td>' + r.breakMinutes + '</td><td>' + r.workMinutes + '</td><td>' + r.overtimeMinutes + '</td>' +
        '<td>' + escapeHtml_(r.dayType) + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="empty-note">データがありません</td></tr>';
  }).catch(showError_);
}

function downloadTextFile_(filename, text, mime) {
  var blob = new Blob([text], { type: mime || 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}

// ===== 申請承認タブ =====
function loadRequestsTab_() {
  var statusFilter = document.getElementById('req-status-filter').value;
  runServer_('listRequests', idToken, statusFilter).then(function (list) {
    document.getElementById('req-table-body').innerHTML = list.map(function (r) {
      var actions = r.status === '申請中'
        ? '<button class="btn-small btn-approve" data-id="' + r.id + '">承認</button> ' +
          '<button class="btn-small btn-reject" data-id="' + r.id + '">却下</button>'
        : escapeHtml_(r.decidedBy || '-');
      return '<tr><td>' + escapeHtml_(r.staffName) + '</td><td>' + escapeHtml_(r.type) + '</td>' +
        '<td>' + escapeHtml_(r.targetDate || '-') + '</td><td>' + escapeHtml_(r.content || '') + '</td>' +
        '<td><span class="badge st-' + r.status + '">' + r.status + '</span></td>' +
        '<td>' + escapeHtml_(r.createdAt) + '</td><td class="req-actions">' + actions + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-note">申請はありません</td></tr>';

    document.querySelectorAll('#req-table-body .btn-approve').forEach(function (btn) {
      btn.addEventListener('click', function () { decideAndReload_(btn.getAttribute('data-id'), '承認'); });
    });
    document.querySelectorAll('#req-table-body .btn-reject').forEach(function (btn) {
      btn.addEventListener('click', function () { decideAndReload_(btn.getAttribute('data-id'), '却下'); });
    });
  }).catch(showError_);
  loadLeaveReviewPanel_();
}

function decideAndReload_(id, decision) {
  runServer_('decideRequest', idToken, id, decision).then(function () {
    loadRequestsTab_();
  }).catch(showError_);
}

// ===== 有給付与「要確認」一覧 =====
function loadLeaveReviewPanel_() {
  runServer_('listLeaveGrantsNeedingReview', idToken).then(function (data) {
    var body = document.getElementById('leave-review-table-body');
    body.innerHTML = data.needsReview.length ? data.needsReview.map(function (r) {
      return '<tr><td>' + escapeHtml_(r.staffName) + '</td><td>' + escapeHtml_(r.basisDate) + '</td>' +
        '<td>' + escapeHtml_(r.tenureLabel) + '</td><td>' + r.scheduledDays + '日</td>' +
        '<td class="req-actions"><button class="btn-small btn-leave-grant" data-id="' + r.id + '" data-days="' + r.scheduledDays + '">付与する</button>' +
        '<button class="btn-small btn-leave-skip" data-id="' + r.id + '">見送る</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty-note">要確認の付与はありません</td></tr>';

    body.querySelectorAll('.btn-leave-grant').forEach(function (btn) {
      btn.addEventListener('click', function () { decideLeave_(btn.getAttribute('data-id'), '付与済', Number(btn.getAttribute('data-days'))); });
    });
    body.querySelectorAll('.btn-leave-skip').forEach(function (btn) {
      btn.addEventListener('click', function () { decideLeave_(btn.getAttribute('data-id'), '見送り', 0); });
    });

    var missingEl = document.getElementById('leave-missing-hire-date');
    missingEl.textContent = data.missingHireDate.length
      ? '入社日が未設定のため有給計算ができない社員: ' + data.missingHireDate.map(function (s) { return s.staffName; }).join('、')
      : '';
  }).catch(showError_);
}

function decideLeave_(grantId, decision, days) {
  runServer_('decideLeaveGrant', idToken, grantId, decision, days).then(function () {
    loadLeaveReviewPanel_();
  }).catch(showError_);
}

// ===== お知らせ管理タブ =====
function loadAnnounceTab_() {
  runServer_('getHomeDashboard', idToken).then(function (data) {
    var list = data.announcements;
    document.getElementById('ann-active-list').innerHTML = list.length
      ? list.map(function (a) {
          return '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
            '<b>' + escapeHtml_(a.title) + '</b><div style="font-size:12px;color:var(--text-sub);">' +
            escapeHtml_(a.startDate) + ' 〜 ' + escapeHtml_(a.endDate || '無期限') + '</div>' +
            '<div style="font-size:13px;margin-top:4px;white-space:pre-wrap;">' + escapeHtml_(a.body) + '</div></div>';
        }).join('')
      : '<p class="empty-note">現在掲載中のお知らせはありません</p>';
  }).catch(showError_);
}

// ===== タブ切り替え =====
function switchTab_(tabId) {
  currentTab_ = tabId;
  document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-tab') === tabId); });
  ['tab-dashboard', 'tab-attendance', 'tab-requests', 'tab-announce'].forEach(function (id) {
    document.getElementById(id).classList.toggle('hidden', id !== tabId);
  });
  var titles = { 'tab-dashboard': 'ダッシュボード', 'tab-attendance': '勤怠一覧', 'tab-requests': '申請承認', 'tab-announce': 'お知らせ管理' };
  document.getElementById('topbar-title').textContent = titles[tabId];
  if (tabId === 'tab-dashboard') loadDashboardTab_();
  else if (tabId === 'tab-attendance') loadAttendanceTab_();
  else if (tabId === 'tab-requests') loadRequestsTab_();
  else if (tabId === 'tab-announce') loadAnnounceTab_();
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () { switchTab_(item.getAttribute('data-tab')); });
  });
  document.getElementById('btn-refresh').addEventListener('click', function () { switchTab_(currentTab_); });
  document.getElementById('btn-att-search').addEventListener('click', loadAttendanceTab_);
  document.getElementById('req-status-filter').addEventListener('change', loadRequestsTab_);

  document.getElementById('btn-att-csv').addEventListener('click', function () {
    var yearMonth = document.getElementById('att-month').value || todayYearMonth_();
    var targetStaffId = document.getElementById('att-staff').value;
    runServer_('exportAttendanceCsv', idToken, yearMonth, targetStaffId).then(function (result) {
      downloadTextFile_(result.filename, result.csvText, 'text/csv;charset=utf-8');
    }).catch(showError_);
  });
  document.getElementById('btn-att-pdf').addEventListener('click', function () {
    var yearMonth = document.getElementById('att-month').value || todayYearMonth_();
    var targetStaffId = document.getElementById('att-staff').value;
    runServer_('exportAttendancePdf', idToken, yearMonth, targetStaffId).then(function (result) {
      window.open(result.pdfUrl, '_blank');
    }).catch(showError_);
  });

  document.getElementById('btn-ann-submit').addEventListener('click', function () {
    var title = document.getElementById('ann-title').value.trim();
    var body = document.getElementById('ann-body').value.trim();
    var start = document.getElementById('ann-start').value;
    var end = document.getElementById('ann-end').value;
    if (!title) { alert('タイトルを入力してください。'); return; }
    runServer_('addAnnouncement', idToken, title, body, start, end).then(function () {
      document.getElementById('ann-title').value = '';
      document.getElementById('ann-body').value = '';
      document.getElementById('ann-start').value = '';
      document.getElementById('ann-end').value = '';
      loadAnnounceTab_();
    }).catch(showError_);
  });

  document.getElementById('btn-sync-holidays').addEventListener('click', function () {
    var resultEl = document.getElementById('holiday-sync-result');
    resultEl.textContent = '取得中...';
    runServer_('syncHolidays', idToken).then(function (result) {
      resultEl.textContent = '祝日データを更新しました(' + result.count + '件)。';
    }).catch(function (err) {
      resultEl.textContent = '取得に失敗しました: ' + ((err && err.message) || err);
    });
  });
});

window.addEventListener('load', initApp_);
