// attendance.js
// ホーム画面の出勤/退勤/休憩ボタンの打刻処理。GPS取得(ON/OFF)を踏まえて座標を渡す。

/** GPSがONの場合のみ現在地を取得してcallbackに渡す。OFF/取得失敗時はnull,nullを渡す(打刻自体は続行)。 */
function getPunchLocation_(callback) {
  var useGps = document.getElementById('gps-toggle').checked;
  if (!useGps || !navigator.geolocation) {
    callback(null, null);
    return;
  }
  navigator.geolocation.getCurrentPosition(function (pos) {
    callback(pos.coords.latitude, pos.coords.longitude);
  }, function () {
    // 取得失敗時は位置情報なしで打刻を続行する(現場で電波が悪いことがあるため、打刻自体を止めない)
    callback(null, null);
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function runPunch_(action, needsLocation) {
  showOverlay_('打刻中...');
  var finish = function (lat, lng) {
    var args = needsLocation ? [idToken, lat, lng] : [idToken];
    runServer_.apply(null, [action].concat(args)).then(function (status) {
      hideOverlay_();
      renderAttendanceStatus_(status);
    }).catch(showError_);
  };
  if (needsLocation) {
    getPunchLocation_(finish);
  } else {
    finish(null, null);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('btn-clock-in').addEventListener('click', function () { runPunch_('clockIn', true); });
  document.getElementById('btn-clock-out').addEventListener('click', function () { runPunch_('clockOut', true); });
  document.getElementById('btn-break-toggle').addEventListener('click', function () {
    var isOnBreak = document.getElementById('attendance-status-badge').textContent === '休憩中';
    runPunch_(isOnBreak ? 'breakEnd' : 'breakStart', false);
  });
});

