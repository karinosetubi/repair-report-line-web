// home.js
// ホーム画面(ダッシュボード)・申請一覧・お知らせ管理の描画とイベント処理。
// 勤怠の打刻自体(出勤/退勤/休憩)は attendance.js が担当し、このファイルからはその関数を呼び出す。

var dashboardData_ = null;
var clockTickTimer_ = null;

function minutesToHm_(minutes) {
  var m = Math.max(0, Math.round(Number(minutes) || 0));
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}

function startClockTick_() {
  if (clockTickTimer_) clearInterval(clockTickTimer_);
  var update = function () {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    document.getElementById('clock-now').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  };
  update();
  clockTickTimer_ = setInterval(update, 1000 * 15);
}

/** ダッシュボード画面を表示し、最新データを読み込む */
function showDashboard_() {
  showScreen_('screen-dashboard');
  startClockTick_();
  loadDashboard_();
}

function loadDashboard_() {
  var now = new Date();
  document.getElementById('dash-date').textContent = Utilities_formatJaDate_(now);
  document.getElementById('clock-today').textContent = Utilities_formatJaDate_(now);
  runServer_('getHomeDashboard', idToken).then(function (data) {
    dashboardData_ = data;
    renderDashboard_(data);
  }).catch(function (err) {
    document.getElementById('tile-weather-desc').textContent = '取得に失敗しました';
    console.error(err);
  });
}

function Utilities_formatJaDate_(d) {
  var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + w + ')';
}

function renderDashboard_(data) {
  document.getElementById('dash-name').textContent = data.profile.staffName + 'さん、おつかれさまです';
  document.getElementById('quick-announce-admin').classList.toggle('hidden', !data.profile.isAdmin);

  renderAttendanceStatus_(data.attendance);

  // 天気
  var w = data.weather;
  if (w && w.ok) {
    document.getElementById('tile-weather-temp').textContent = w.temperature + '℃ / 湿度' + w.humidity + '%';
    document.getElementById('tile-weather-desc').textContent = w.description;
    document.getElementById('tile-weather-wbgt').textContent = '暑さ指数(簡易推定): ' + w.wbgt + '℃ ※実測値ではありません';
  } else {
    document.getElementById('tile-weather-desc').textContent = (w && w.error) || '天気情報を取得できませんでした';
  }

  // 本日の現場
  document.getElementById('tile-sites-count').textContent = data.todaySites.length + '件';
  var sitesList = document.getElementById('tile-sites-list');
  sitesList.innerHTML = data.todaySites.length
    ? data.todaySites.map(function (s) {
        return '<div class="site-row"><div class="name">' + escapeHtml_(s.customerName) + '様</div>' +
          '<div class="sub">' + escapeHtml_(s.address || '') + ' / 担当: ' + escapeHtml_(s.staffName || '') + '</div></div>';
      }).join('')
    : '<div class="empty-note">本日の工事日報登録はまだありません</div>';

  // 本日の予定
  document.getElementById('tile-schedules-count').textContent = data.todaySchedules.length + '件';
  var schedList = document.getElementById('tile-schedules-list');
  schedList.innerHTML = data.todaySchedules.length
    ? data.todaySchedules.map(function (s) {
        return '<div class="schedule-row"><div class="name">' + escapeHtml_(s.siteName) + '(' + escapeHtml_(s.staffName) + ')</div>' +
          '<div class="sub">' + escapeHtml_(s.startTime || '') + '〜' + escapeHtml_(s.endTime || '') + ' ' + escapeHtml_(s.content || '') + '</div></div>';
      }).join('')
    : '<div class="empty-note">本日の予定登録はまだありません</div>';

  // 今日の工事件数
  document.getElementById('tile-reports-count').textContent = data.todayReportCount + '件';

  // 未承認申請
  document.getElementById('tile-requests-count').textContent = data.pendingRequestsCount + '件';

  // 車両・工具
  document.getElementById('tile-vehicle-count').textContent = data.vehicle.todayReservations.length + '/' + data.vehicle.total + '台(本日予約)';
  document.getElementById('tile-tool-count').textContent = data.tool.onLoan.length + '/' + data.tool.total + '点(貸出中)';

  // お知らせ
  var annList = document.getElementById('tile-announce-list');
  annList.innerHTML = data.announcements.length
    ? data.announcements.map(function (a) {
        return '<div class="announce-row"><div class="title">' + escapeHtml_(a.title) + '</div>' +
          '<div class="body">' + escapeHtml_(a.body) + '</div></div>';
      }).join('')
    : '<div class="empty-note">お知らせはありません</div>';
}

function renderAttendanceStatus_(a) {
  var badge = document.getElementById('attendance-status-badge');
  badge.textContent = a.status;
  badge.className = 'status-badge status-' + a.status;
  document.getElementById('clock-in-time').textContent = a.clockIn ? a.clockIn.split(' ')[1] : '--:--';
  document.getElementById('clock-out-time').textContent = a.clockOut ? a.clockOut.split(' ')[1] : '--:--';
  document.getElementById('break-minutes-value').textContent = (a.breakMinutes || 0) + '分';

  var btnIn = document.getElementById('btn-clock-in');
  var btnOut = document.getElementById('btn-clock-out');
  var btnBreak = document.getElementById('btn-break-toggle');

  btnIn.disabled = a.status !== '未出勤';
  btnOut.disabled = !(a.status === '出勤中');
  btnBreak.disabled = a.status === '未出勤' || a.status === '退勤済';
  btnBreak.textContent = a.status === '休憩中' ? '▶ 休憩終了' : '☕ 休憩開始';
}

// ===== 申請・承認 =====
function loadRequests_() {
  runServer_('listRequests', idToken, '').then(function (list) {
    renderRequestList_(list);
  }).catch(showError_);
}

function renderRequestList_(list) {
  var container = document.getElementById('req-list');
  if (!list.length) {
    container.innerHTML = '<p class="empty-note">申請はまだありません</p>';
    return;
  }
  var isAdmin = dashboardData_ && dashboardData_.profile.isAdmin;
  container.innerHTML = list.map(function (r) {
    var actions = (isAdmin && r.status === '申請中')
      ? '<div class="req-actions">' +
        '<button class="btn-small btn-approve" data-id="' + r.id + '" type="button">承認</button>' +
        '<button class="btn-small btn-reject" data-id="' + r.id + '" type="button">却下</button></div>'
      : '';
    return '<div class="req-card">' +
      '<div class="top"><b>' + escapeHtml_(r.staffName) + ' / ' + escapeHtml_(r.type) + '</b>' +
      '<span class="req-status st-' + r.status + '">' + r.status + '</span></div>' +
      '<div class="tile-sub">対象日: ' + escapeHtml_(r.targetDate || '-') + ' / 申請日時: ' + escapeHtml_(r.createdAt) + '</div>' +
      '<div class="tile-sub">' + escapeHtml_(r.content || '') + '</div>' + actions + '</div>';
  }).join('');

  container.querySelectorAll('.btn-approve').forEach(function (btn) {
    btn.addEventListener('click', function () { decideRequestClick_(btn.getAttribute('data-id'), '承認'); });
  });
  container.querySelectorAll('.btn-reject').forEach(function (btn) {
    btn.addEventListener('click', function () { decideRequestClick_(btn.getAttribute('data-id'), '却下'); });
  });
}

function decideRequestClick_(id, decision) {
  showOverlay_('更新中...');
  runServer_('decideRequest', idToken, id, decision).then(function () {
    hideOverlay_();
    loadRequests_();
  }).catch(showError_);
}

// ===== 有給残日数 =====
function loadLeaveBalance_() {
  runServer_('getMyLeaveBalance', idToken).then(function (data) {
    if (!data.hasHireDate) {
      document.getElementById('leave-balance-value').textContent = '入社日未設定';
      document.getElementById('leave-balance-sub').textContent = '';
      document.getElementById('leave-balance-hire-date-note').textContent = '下の「入社日を設定・修正する」から入社日を登録してください。';
      return;
    }
    document.getElementById('leave-balance-value').textContent = data.remaining + '日';
    document.getElementById('leave-balance-sub').textContent =
      '付与合計 ' + data.totalGranted + '日 - 消化 ' + data.totalConsumed + '日(有効期限内の付与分のみで計算)';
    document.getElementById('leave-balance-hire-date-note').textContent = data.needsReviewCount > 0
      ? '※出勤率の判定に必要な勤怠データが不足している付与が' + data.needsReviewCount + '件あり、管理者の確認待ちです。'
      : '';
    document.getElementById('hire-date-input').value = data.hireDate ? data.hireDate.replace(/\//g, '-') : '';
  }).catch(function (err) {
    document.getElementById('leave-balance-value').textContent = '取得失敗';
    console.error(err);
  });
}

// ===== 勤怠履歴(月次) =====
var historyYearMonth_ = null;

function showAttendanceHistory_() {
  var now = new Date();
  historyYearMonth_ = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  showScreen_('screen-attendance-history');
  loadHistory_();
}

function shiftYearMonth_(ym, delta) {
  var parts = ym.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function loadHistory_() {
  document.getElementById('history-month-label').textContent = historyYearMonth_.replace('-', '年') + '月';
  showOverlay_('読み込み中...');
  runServer_('getMyAttendanceMonth', idToken, historyYearMonth_).then(function (report) {
    hideOverlay_();
    var rowsHtml = report.rows.map(function (r) {
      return '<div class="history-row">' +
        '<div>' + escapeHtml_(r.date.split('/').slice(1).join('/')) + '</div>' +
        '<div>' + escapeHtml_(r.clockIn ? r.clockIn.split(' ')[1] : '-') + '</div>' +
        '<div>' + escapeHtml_(r.clockOut ? r.clockOut.split(' ')[1] : '-') + '</div>' +
        '<div>' + minutesToHm_(r.overtimeMinutes) + '</div></div>';
    }).join('');
    document.getElementById('history-rows').innerHTML = rowsHtml || '<p class="empty-note">この月の勤怠記録はありません</p>';
    document.getElementById('history-total-work').textContent = minutesToHm_(report.totals.workMinutes);
    document.getElementById('history-total-overtime').textContent = minutesToHm_(report.totals.overtimeMinutes);
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

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('quick-new-report').addEventListener('click', function () { startNewReport_(); });
  document.getElementById('quick-search').addEventListener('click', function () {
    document.getElementById('search-keyword').value = '';
    document.getElementById('search-filter-equipment').value = '';
    document.getElementById('search-filter-maker').value = '';
    document.getElementById('search-result-list').innerHTML = '';
    showScreen_('screen-search');
  });
  document.getElementById('quick-attendance-history').addEventListener('click', showAttendanceHistory_);
  document.getElementById('quick-requests').addEventListener('click', function () {
    document.getElementById('req-target-date').value = todayDateString_();
    showScreen_('screen-requests');
    loadRequests_();
    loadLeaveBalance_();
  });
  document.getElementById('quick-announce-admin').addEventListener('click', function () {
    showScreen_('screen-announce-admin');
  });

  document.getElementById('req-type').addEventListener('change', function () {
    document.getElementById('req-hours-row').classList.toggle('hidden', this.value !== '時間休');
  });

  document.getElementById('btn-req-submit').addEventListener('click', function () {
    var type = document.getElementById('req-type').value;
    var targetDate = document.getElementById('req-target-date').value;
    var content = document.getElementById('req-content').value.trim();
    var hours = document.getElementById('req-hours').value;
    showOverlay_('送信中...');
    runServer_('submitRequest', idToken, type, content, targetDate, hours).then(function () {
      hideOverlay_();
      document.getElementById('req-content').value = '';
      document.getElementById('req-hours').value = '';
      loadRequests_();
      loadLeaveBalance_();
      loadDashboard_();
    }).catch(showError_);
  });

  document.getElementById('btn-hire-date-save').addEventListener('click', function () {
    var hireDate = document.getElementById('hire-date-input').value;
    if (!hireDate) { alert('入社日を選択してください。'); return; }
    showOverlay_('保存中...');
    runServer_('updateMyHireDate', idToken, hireDate).then(function () {
      hideOverlay_();
      loadLeaveBalance_();
    }).catch(showError_);
  });

  document.getElementById('btn-ann-submit').addEventListener('click', function () {
    var title = document.getElementById('ann-title').value.trim();
    var body = document.getElementById('ann-body').value.trim();
    var start = document.getElementById('ann-start').value;
    var end = document.getElementById('ann-end').value;
    if (!title) { alert('タイトルを入力してください。'); return; }
    showOverlay_('登録中...');
    runServer_('addAnnouncement', idToken, title, body, start, end).then(function () {
      hideOverlay_();
      document.getElementById('ann-title').value = '';
      document.getElementById('ann-body').value = '';
      document.getElementById('ann-start').value = '';
      document.getElementById('ann-end').value = '';
      alert('お知らせを登録しました。');
      loadDashboard_();
    }).catch(showError_);
  });

  document.getElementById('btn-history-prev').addEventListener('click', function () {
    historyYearMonth_ = shiftYearMonth_(historyYearMonth_, -1);
    loadHistory_();
  });
  document.getElementById('btn-history-next').addEventListener('click', function () {
    historyYearMonth_ = shiftYearMonth_(historyYearMonth_, 1);
    loadHistory_();
  });
  document.getElementById('btn-history-csv').addEventListener('click', function () {
    showOverlay_('CSVを作成中...');
    runServer_('exportAttendanceCsv', idToken, historyYearMonth_, '').then(function (result) {
      hideOverlay_();
      downloadTextFile_(result.filename, result.csvText, 'text/csv;charset=utf-8');
    }).catch(showError_);
  });
  document.getElementById('btn-history-pdf').addEventListener('click', function () {
    showOverlay_('PDFを作成中...(数秒かかります)');
    runServer_('exportAttendancePdf', idToken, historyYearMonth_, '').then(function (result) {
      hideOverlay_();
      window.open(result.pdfUrl, '_blank');
    }).catch(showError_);
  });
});

