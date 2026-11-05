#!/usr/bin/env python3
"""立山BC GPSログ統合ツール

gpx_input/ に置いた「実測」GPXを解析し、以下を出力する。
  output/tachiyama_BC_2020_2025.gpx   統合GPX（記録ごとに1 trk）
  output/by_year/tachiyama_BC_<年度>.gpx 年度別GPX
  output/single/<record_id>.gpx        記録ごとの単一トラックGPX（YAMAP取り込み向け）
  output/tachiyama_BC_map.html         統合地図（Leaflet＋地理院タイル）
  output/tachiyama_BC_log_list.xlsx    記録一覧・取得不能一覧・区間解析

原則:
  * 出力するのはGPXファイルに含まれていた実測点のみ。補間・推定座標は一切作らない。
  * 登り/滑走の区分は実測点の時刻と標高から自動判定した「属性」であり、座標は変更しない。

GPXファイル名の先頭を records.csv の record_id にすると記録と紐付く
（例: gpx_input/Y2025-1124-karimero.gpx, Y2025-1124-karimero_day2.gpx）。
紐付かないGPXは「未登録記録」として扱い、GPX内のメタデータから情報を補う。

使い方:
  python3 build.py                # 対象期間外の点を除外（既定）
  python3 build.py --no-clip      # 期間外の点も残す
"""
import argparse
import csv
import datetime as dt
import hashlib
import html
import json
import math
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
JST = dt.timezone(dt.timedelta(hours=9))

# 立山・室堂周辺の範囲（緯度経度の外接矩形）。範囲外の点を含むGPXは警告する。
BBOX = (36.50, 137.52, 36.66, 137.70)  # south, west, north, east
YEARS = range(2020, 2026)

# 区分判定のしきい値
WINDOW_S = 60            # 鉛直速度を評価する時間窓（秒）
DESCENT_VZ = -0.25       # m/s 以下の下降を滑走候補とする
DESCENT_HSPEED = 1.0     # m/s 以上の水平速度で滑走とする（歩き下りと区別）
ASCENT_VZ = 0.03         # m/s 以上の上昇を登りとする
MIN_RUN_S = 45           # これより短い区間は前後に吸収する

# 重複判定
NEAR_DUP_DIST_M = 40     # 点がこの距離以内なら「重なる」
NEAR_DUP_RATIO = 0.9     # 重なる点の割合がこれ以上で近似重複
NEAR_DUP_START_S = 1800  # 開始時刻の差がこの秒数以内

YEAR_COLORS = {
    2020: "#1f77b4", 2021: "#ff7f0e", 2022: "#2ca02c",
    2023: "#d62728", 2024: "#9467bd", 2025: "#8c564b",
}
UNKNOWN_COLOR = "#555555"
SEG_LABEL = {"descent": "滑走", "ascent": "登り", "other": "平坦・休憩・歩き下り", "unknown": "区別不可（時刻なし）"}


# ---------------------------------------------------------------- GPX 読み込み
def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _children(el, name):
    return [c for c in el if _local(c.tag) == name]


def parse_time(s):
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    try:
        t = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t


def read_gpx(path):
    """GPXを読み、(meta, segments) を返す。segments は点リストのリスト。"""
    root = ET.parse(path).getroot()
    meta = {"name": None, "author": None, "time": None}
    md = _child(root, "metadata")
    if md is not None:
        n = _child(md, "name")
        meta["name"] = n.text.strip() if n is not None and n.text else None
        a = _child(md, "author")
        if a is not None:
            an = _child(a, "name")
            meta["author"] = an.text.strip() if an is not None and an.text else None
        t = _child(md, "time")
        meta["time"] = parse_time(t.text) if t is not None else None

    def pt(el):
        e = _child(el, "ele")
        t = _child(el, "time")
        return {
            "lat": float(el.get("lat")),
            "lon": float(el.get("lon")),
            "ele": float(e.text) if e is not None and e.text else None,
            "time": parse_time(t.text) if t is not None else None,
        }

    segments = []
    for trk in _children(root, "trk"):
        if meta["name"] is None:
            n = _child(trk, "name")
            meta["name"] = n.text.strip() if n is not None and n.text else None
        for seg in _children(trk, "trkseg"):
            pts = [pt(p) for p in _children(seg, "trkpt")]
            if pts:
                segments.append(pts)
    # rte（ルート）は計画線である可能性が高いため実測として扱わない
    has_route = bool(_children(root, "rte"))
    has_wpt = bool(_children(root, "wpt"))
    return meta, segments, has_route, has_wpt


# ---------------------------------------------------------------- 幾何
def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = p2 - p1
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def track_stats(pts):
    dist = up = down = 0.0
    for a, b in zip(pts, pts[1:]):
        dist += haversine(a, b)
        if a["ele"] is not None and b["ele"] is not None:
            d = b["ele"] - a["ele"]
            if d > 0:
                up += d
            else:
                down -= d
    eles = [p["ele"] for p in pts if p["ele"] is not None]
    times = [p["time"] for p in pts if p["time"]]
    return {
        "distance_km": round(dist / 1000, 2),
        "ascent_m": round(up),
        "descent_m": round(down),
        "ele_min": round(min(eles)) if eles else None,
        "ele_max": round(max(eles)) if eles else None,
        "start": min(times) if times else None,
        "end": max(times) if times else None,
    }


# ---------------------------------------------------------------- 期間判定
def in_period(t):
    """2020〜2025年の各年 11/25〜12/31（JST）に入るか。"""
    j = t.astimezone(JST)
    return j.year in YEARS and (j.month == 12 or (j.month == 11 and j.day >= 25))


def season_of(t):
    return t.astimezone(JST).year if t else None


# ---------------------------------------------------------------- 登り/滑走区分
def classify(pts):
    """各点に区分ラベルを付けて返す（座標は変更しない）。"""
    n = len(pts)
    if n < 2 or any(p["time"] is None for p in pts) or any(p["ele"] is None for p in pts):
        return ["unknown"] * n
    ts = [p["time"].timestamp() for p in pts]
    # 標高を軽く平滑化（GPS標高のノイズ対策、前後2点の移動平均）
    eles = []
    for i in range(n):
        w = [pts[j]["ele"] for j in range(max(0, i - 2), min(n, i + 3))]
        eles.append(sum(w) / len(w))
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine(a, b))

    labels = []
    j0 = 0
    j1 = 0
    for i in range(n):
        while ts[i] - ts[j0] > WINDOW_S / 2:
            j0 += 1
        while j1 + 1 < n and ts[j1 + 1] - ts[i] <= WINDOW_S / 2:
            j1 += 1
        a, b = j0, j1
        if b == a:
            a, b = max(0, i - 1), min(n - 1, i + 1)
        span = ts[b] - ts[a]
        if span <= 0:
            labels.append("other")
            continue
        vz = (eles[b] - eles[a]) / span
        hs = (cum[b] - cum[a]) / span
        if vz <= DESCENT_VZ and hs >= DESCENT_HSPEED:
            labels.append("descent")
        elif vz >= ASCENT_VZ:
            labels.append("ascent")
        else:
            labels.append("other")

    # 短い区間を吸収
    for _ in range(20):
        runs = to_runs(labels)
        if len(runs) <= 1:
            break
        changed = False
        for k, (lab, s, e) in enumerate(runs):
            if ts[e] - ts[s] >= MIN_RUN_S:
                continue
            nb = runs[k - 1][0] if k > 0 else runs[k + 1][0]
            if nb != lab:
                labels[s:e + 1] = [nb] * (e - s + 1)
                changed = True
        if not changed:
            break
    return labels


def to_runs(labels):
    runs = []
    s = 0
    for i in range(1, len(labels) + 1):
        if i == len(labels) or labels[i] != labels[s]:
            runs.append((labels[s], s, i - 1))
            s = i
    return runs


# ---------------------------------------------------------------- 重複
def point_hash(pts):
    h = hashlib.sha1()
    for p in pts:
        h.update(f"{p['lat']:.6f},{p['lon']:.6f},{p['time']}".encode())
    return h.hexdigest()


def overlap_ratio(a, b, sample=200):
    if not a or not b:
        return 0.0
    step = max(1, len(a) // sample)
    sa = a[::step]
    stepb = max(1, len(b) // 2000)
    sb = b[::stepb]
    hit = 0
    for p in sa:
        if any(haversine(p, q) <= NEAR_DUP_DIST_M for q in sb):
            hit += 1
    return hit / len(sa)


# ---------------------------------------------------------------- 入出力
def load_records(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def match_record(fname, records):
    base = os.path.splitext(os.path.basename(fname))[0]
    best = None
    for r in records:
        rid = r["record_id"]
        if base == rid or base.startswith(rid + "_") or base.startswith(rid + "-"):
            if best is None or len(rid) > len(best["record_id"]):
                best = r
    return best


def gpx_doc(tracks, name, desc):
    """tracks: [{'name','desc','segments':[[pts]],'type'}]"""
    ns = "http://www.topografix.com/GPX/1/1"
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<gpx version="1.1" creator="tateyama_bc/build.py" xmlns="{ns}" '
           'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
           "  <metadata>",
           f"    <name>{html.escape(name)}</name>",
           f"    <desc>{html.escape(desc)}</desc>",
           f"    <time>{dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}</time>",
           "  </metadata>"]
    for t in tracks:
        out.append("  <trk>")
        out.append(f"    <name>{html.escape(t['name'])}</name>")
        if t.get("desc"):
            out.append(f"    <desc>{html.escape(t['desc'])}</desc>")
        if t.get("type"):
            out.append(f"    <type>{html.escape(t['type'])}</type>")
        for seg in t["segments"]:
            out.append("    <trkseg>")
            for p in seg:
                s = f'      <trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}">'
                if p["ele"] is not None:
                    s += f"<ele>{p['ele']:.1f}</ele>"
                if p["time"] is not None:
                    s += f"<time>{p['time'].astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}</time>"
                s += "</trkpt>"
                out.append(s)
            out.append("    </trkseg>")
        out.append("  </trk>")
    out.append("</gpx>")
    return "\n".join(out) + "\n"


def fmt_t(t):
    return t.astimezone(JST).strftime("%Y-%m-%d %H:%M") if t else ""


# ---------------------------------------------------------------- メイン
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=os.path.join(HERE, "gpx_input"))
    ap.add_argument("--records", default=os.path.join(HERE, "records.csv"))
    ap.add_argument("--output", default=os.path.join(HERE, "output"))
    ap.add_argument("--no-clip", action="store_true", help="対象期間外の点も残す")
    args = ap.parse_args()

    records = load_records(args.records)
    rec_by_id = {r["record_id"]: r for r in records}
    os.makedirs(args.output, exist_ok=True)

    files = sorted(f for f in os.listdir(args.input) if f.lower().endswith(".gpx")) if os.path.isdir(args.input) else []
    tracks = []      # 解析済みトラック
    issues = []      # 取り込み時の問題
    seen_hash = {}

    for fname in files:
        path = os.path.join(args.input, fname)
        try:
            meta, segs, has_rte, has_wpt = read_gpx(path)
        except ET.ParseError as e:
            issues.append((fname, f"GPXとして読めない: {e}"))
            continue
        if not segs:
            msg = "trk（実測トラック）が無い"
            if has_rte:
                msg += "。rte（計画ルート）のみのため実測として取り込まない"
            issues.append((fname, msg))
            continue
        rec = match_record(fname, records)
        if rec is None:
            rid = "UNREG-" + os.path.splitext(fname)[0]
            rec = {"record_id": rid, "source": "未登録", "url": "", "author": meta["author"] or "",
                   "title": meta["name"] or fname, "areas": "", "activity": "", "period_status": "",
                   "gps_status": "", "gps_reason": "", "notes": "records.csv未登録"}
            records.append(rec)
            rec_by_id[rid] = rec

        all_pts = [p for s in segs for p in s]
        if all(p["time"] is None for p in all_pts):
            issues.append((fname, "時刻情報が無い。登り/滑走の区別と期間判定ができない"))
        outside = sum(1 for p in all_pts if not (BBOX[0] <= p["lat"] <= BBOX[2] and BBOX[1] <= p["lon"] <= BBOX[3]))
        if outside:
            issues.append((fname, f"立山周辺の範囲外の点が {outside} 点ある（アクセス区間の可能性）"))

        kept_segs = []
        clipped = 0
        for s in segs:
            if args.no_clip:
                cur = [s]
            else:
                cur, buf = [], []
                for p in s:
                    if p["time"] is None or in_period(p["time"]):
                        buf.append(p)
                    else:
                        clipped += 1
                        if buf:
                            cur.append(buf)
                            buf = []
                if buf:
                    cur.append(buf)
            kept_segs.extend(c for c in cur if len(c) >= 2)
        if clipped:
            issues.append((fname, f"対象期間外（11/25より前など）の {clipped} 点を除外"))
        if not kept_segs:
            issues.append((fname, "対象期間内の点が無いため統合対象外"))
            continue

        h = point_hash([p for s in kept_segs for p in s])
        if h in seen_hash:
            issues.append((fname, f"{seen_hash[h]} と完全に同一の軌跡のため除外"))
            continue
        seen_hash[h] = fname

        pts_flat = [p for s in kept_segs for p in s]
        st = track_stats(pts_flat)
        # 区間解析（セグメントごと）
        runs_info = []
        labeled_segs = []
        for s in kept_segs:
            labs = classify(s)
            labeled_segs.append((s, labs))
            for lab, a, b in to_runs(labs):
                sub = s[a:b + 1]
                if len(sub) < 2:
                    continue
                ss = track_stats(sub)
                runs_info.append({"type": lab, "start": ss["start"], "end": ss["end"],
                                  "distance_km": ss["distance_km"], "ele_from": sub[0]["ele"],
                                  "ele_to": sub[-1]["ele"], "ascent_m": ss["ascent_m"], "descent_m": ss["descent_m"]})
        season = season_of(st["start"]) or (int(rec["date_start"][:4]) if rec.get("date_start") else None)
        tracks.append({"file": fname, "rec": rec, "segments": kept_segs, "labeled": labeled_segs,
                       "stats": st, "runs": runs_info, "season": season, "dup_of": None})

    # 近似重複（同行者の同一ツアーなど）。削除はせず、統合GPXでは代表のみ残す。
    for i, a in enumerate(tracks):
        for b in tracks[:i]:
            if b["dup_of"] or not a["stats"]["start"] or not b["stats"]["start"]:
                continue
            if abs((a["stats"]["start"] - b["stats"]["start"]).total_seconds()) > NEAR_DUP_START_S:
                continue
            pa = [p for s in a["segments"] for p in s]
            pb = [p for s in b["segments"] for p in s]
            if overlap_ratio(pa, pb) >= NEAR_DUP_RATIO and overlap_ratio(pb, pa) >= NEAR_DUP_RATIO:
                a["dup_of"] = b["file"]
                issues.append((a["file"], f"{b['file']} とほぼ同一の軌跡（同行者記録の可能性）。統合GPXでは代表のみ採用"))
                break

    # ---------------- GPX出力
    def trk_entry(t, segs=None):
        r = t["rec"]
        nm = f"{t['season'] or ''} {r.get('title') or t['file']}".strip()
        desc = " / ".join(x for x in [r.get("source", ""), r.get("author", ""), r.get("url", ""),
                                       "実測GPS軌跡（推定座標なし）"] if x)
        return {"name": nm, "desc": desc, "type": "backcountry_ski", "segments": segs or t["segments"]}

    primary = [t for t in tracks if not t["dup_of"]]
    outputs = []
    if primary:
        p = os.path.join(args.output, "tachiyama_BC_2020_2025.gpx")
        with open(p, "w", encoding="utf-8") as f:
            f.write(gpx_doc([trk_entry(t) for t in primary], "立山BC 2020-2025 統合（実測）",
                            "2020-2025年 11/25以降の立山BC実測GPS軌跡。記録ごとに1トラック。"))
        outputs.append(p)
        ydir = os.path.join(args.output, "by_year")
        os.makedirs(ydir, exist_ok=True)
        for y in sorted({t["season"] for t in primary if t["season"]}):
            p = os.path.join(ydir, f"tachiyama_BC_{y}.gpx")
            with open(p, "w", encoding="utf-8") as f:
                f.write(gpx_doc([trk_entry(t) for t in primary if t["season"] == y], f"立山BC {y}（実測）", ""))
            outputs.append(p)
        sdir = os.path.join(args.output, "single")
        os.makedirs(sdir, exist_ok=True)
        for t in tracks:
            base = os.path.splitext(t["file"])[0]
            # YAMAP取り込みを想定し、1ファイル1トラック・1セグメント（時系列順に連結）
            pts = sorted([p for s in t["segments"] for p in s],
                         key=lambda p: p["time"].timestamp() if p["time"] else 0) \
                if all(p["time"] for s in t["segments"] for p in s) else [p for s in t["segments"] for p in s]
            p = os.path.join(sdir, f"{base}.gpx")
            with open(p, "w", encoding="utf-8") as f:
                f.write(gpx_doc([trk_entry(t, [pts])], t["rec"].get("title") or base, "実測GPS軌跡"))
            outputs.append(p)
    else:
        print("実測GPXが0件のため、統合GPXは出力しません（推定座標で代用しない方針）。")

    write_html(os.path.join(args.output, "tachiyama_BC_map.html"), records, tracks, issues)
    write_xlsx(os.path.join(args.output, "tachiyama_BC_log_list.xlsx"), records, tracks, issues)
    outputs += [os.path.join(args.output, "tachiyama_BC_map.html"),
                os.path.join(args.output, "tachiyama_BC_log_list.xlsx")]
    print(f"GPX入力 {len(files)} 件 / 取り込み {len(tracks)} 件（代表 {len(primary)} 件）")
    for fname, msg in issues:
        print(f"  [注意] {fname}: {msg}")
    for p in outputs:
        print("  出力:", os.path.relpath(p, HERE))


# ---------------------------------------------------------------- HTML
def write_html(path, records, tracks, issues):
    feats = []
    for t in tracks:
        r = t["rec"]
        color = YEAR_COLORS.get(t["season"], UNKNOWN_COLOR)
        for s, labs in t["labeled"]:
            for lab, a, b in to_runs(labs):
                sub = s[max(0, a - 1 if a > 0 else 0):b + 1]  # 区間の継ぎ目を切らないよう前の1点を含める
                if len(sub) < 2:
                    continue
                feats.append({
                    "rid": r["record_id"], "file": t["file"], "season": t["season"], "color": color,
                    "seg": lab, "dup": bool(t["dup_of"]),
                    "coords": [[round(p["lat"], 6), round(p["lon"], 6)] for p in sub],
                })
    rec_rows = []
    track_by_rid = {}
    for t in tracks:
        track_by_rid.setdefault(t["rec"]["record_id"], []).append(t)
    for r in records:
        ts = track_by_rid.get(r["record_id"], [])
        rec_rows.append({
            "rid": r["record_id"], "source": r.get("source", ""), "url": r.get("url", ""),
            "date": f"{r.get('date_start', '')}〜{r.get('date_end', '')}" if r.get("date_start") else "",
            "author": r.get("author", ""), "title": r.get("title", ""), "areas": r.get("areas", ""),
            "period": r.get("period_status", ""),
            "gps": "取得済（%d件）" % len(ts) if ts else (r.get("gps_status") or "未取得"),
            "reason": "" if ts else r.get("gps_reason", ""),
            "season": ts[0]["season"] if ts else None,
            "color": YEAR_COLORS.get(ts[0]["season"], UNKNOWN_COLOR) if ts else None,
        })
    data = {"features": feats, "records": rec_rows, "years": YEAR_COLORS,
            "segLabel": SEG_LABEL, "issues": [{"file": f, "msg": m} for f, m in issues],
            "generated": dt.datetime.now(JST).strftime("%Y-%m-%d %H:%M")}
    with open(path, "w", encoding="utf-8") as f:
        f.write(HTML_TEMPLATE.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False)))


HTML_TEMPLATE = r"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>立山BC軌跡マップ</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e2dc;--warn:#9a5b00;--warnbg:#fff4e0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--panel:#20201e;--fg:#ececea;--muted:#a3a39d;--line:#34342f;--warn:#ffc46b;--warnbg:#3a2c12}}
:root[data-theme="dark"]{--bg:#161615;--panel:#20201e;--fg:#ececea;--muted:#a3a39d;--line:#34342f;--warn:#ffc46b;--warnbg:#3a2c12}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
header{padding:16px}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px}
.wrap{display:grid;grid-template-columns:1fr 320px;gap:12px;padding:0 16px 16px}
@media (max-width:860px){.wrap{grid-template-columns:1fr}}
#map{height:70vh;min-height:420px;border:1px solid var(--line);border-radius:8px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:70vh}
.panel h2{font-size:14px;margin:8px 0}
label{display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer}
.sw{display:inline-block;width:22px;height:4px;border-radius:2px}
.notice{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:10px 12px;margin:0 16px 12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600}
.tablewrap{margin:0 16px 24px;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow-x:auto}
a{color:inherit}
.muted{color:var(--muted)}
</style>
</head>
<body>
<header>
  <h1>立山BC 実測GPS軌跡マップ（2020〜2025年 11/25以降）</h1>
  <div class="sub">表示しているのはGPXに含まれる実測点だけです。推定した滑走ラインは描いていません。<br>
  線の色＝年度、実線＝滑走、破線＝登り、点線＝その他。登りと滑走は時刻と標高から自動判定しています。<span id="gen"></span></div>
</header>
<div id="notice"></div>
<div class="wrap">
  <div id="map"></div>
  <div class="panel">
    <h2>色分け</h2>
    <label><input type="radio" name="mode" value="year" checked> 年度別</label>
    <label><input type="radio" name="mode" value="record"> 記録別</label>
    <h2>区間</h2>
    <div id="segs"></div>
    <h2>年度</h2>
    <div id="years"></div>
    <h2>記録</h2>
    <div id="recs"></div>
    <label><input type="checkbox" id="showdup"> 近似重複の記録も表示</label>
  </div>
</div>
<div class="tablewrap">
<table>
<thead><tr><th>記録ID</th><th>日付</th><th>情報源</th><th>記録者</th><th>活動名</th><th>滑走エリア</th><th>期間判定</th><th>GPS</th><th>取得不能の理由</th></tr></thead>
<tbody id="tbody"></tbody>
</table>
</div>
<script>
const D=/*__DATA__*/null;
document.getElementById('gen').textContent=' 生成: '+D.generated;
const map=L.map('map').setView([36.585,137.605],13);
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{maxZoom:18,attribution:'<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>'}).addTo(map);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nTracks=new Set(D.features.map(f=>f.file)).size;
const nb=document.getElementById('notice');
if(nTracks===0){nb.innerHTML='<div class="notice">実測GPXはまだ0件です。GPXを <code>tateyama_bc/gpx_input/</code> に置いて <code>python3 build.py</code> を実行すると、ここに軌跡が表示されます。下の表は候補記録と、GPSが取得できない理由の一覧です。</div>';}
else if(D.issues.length){nb.innerHTML='<div class="notice">取り込み時の注意: '+D.issues.map(i=>esc(i.file)+' — '+esc(i.msg)).join('<br>')+'</div>';}
const palette=['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#17becf','#bcbd22','#7f7f7f'];
const rids=[...new Set(D.features.map(f=>f.rid))];
const recColor=Object.fromEntries(rids.map((r,i)=>[r,palette[i%palette.length]]));
const dash={descent:null,ascent:'8 6',other:'2 5',unknown:null};
const state={mode:'year',segs:new Set(Object.keys(D.segLabel)),years:new Set(Object.keys(D.years).map(Number).concat([null])),recs:new Set(rids),dup:false};
const layer=L.layerGroup().addTo(map);
function draw(){
  layer.clearLayers();const b=[];
  D.features.forEach(f=>{
    if(!state.segs.has(f.seg)||!state.years.has(f.season)||!state.recs.has(f.rid))return;
    if(f.dup&&!state.dup)return;
    const c=state.mode==='year'?f.color:recColor[f.rid];
    const pl=L.polyline(f.coords,{color:c,weight:f.seg==='descent'?4:3,opacity:f.seg==='other'?0.6:0.9,dashArray:dash[f.seg]});
    const r=D.records.find(x=>x.rid===f.rid)||{};
    pl.bindPopup('<b>'+esc(r.title||f.file)+'</b><br>'+esc(r.date)+'<br>'+esc(r.author)+'<br>区間: '+esc(D.segLabel[f.seg])+'<br>ファイル: '+esc(f.file)+(r.url?'<br><a href="'+esc(r.url)+'" target="_blank" rel="noopener">元の記録</a>':''));
    pl.addTo(layer);b.push(...f.coords);
  });
  if(b.length)map.fitBounds(b,{padding:[20,20]});
}
function chk(container,items,set,labelFn,colorFn){
  const el=document.getElementById(container);
  el.innerHTML=items.map((v,i)=>'<label><input type="checkbox" data-i="'+i+'" checked> '+(colorFn?'<span class="sw" style="background:'+colorFn(v)+'"></span>':'')+esc(labelFn(v))+'</label>').join('')||'<span class="muted">なし</span>';
  el.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',()=>{const v=items[+inp.dataset.i];inp.checked?set.add(v):set.delete(v);draw();}));
}
chk('segs',Object.keys(D.segLabel),state.segs,k=>D.segLabel[k]);
const yrs=[...new Set(D.features.map(f=>f.season))].sort();
chk('years',yrs,state.years,y=>y?y+'年度':'年度不明',y=>D.years[y]||'#555');
chk('recs',rids,state.recs,r=>(D.records.find(x=>x.rid===r)||{}).title||r,r=>recColor[r]);
document.querySelectorAll('input[name=mode]').forEach(i=>i.addEventListener('change',e=>{state.mode=e.target.value;draw();}));
document.getElementById('showdup').addEventListener('change',e=>{state.dup=e.target.checked;draw();});
document.getElementById('tbody').innerHTML=D.records.map(r=>'<tr><td>'+esc(r.rid)+'</td><td>'+esc(r.date)+'</td><td>'+esc(r.source)+'</td><td>'+esc(r.author)+'</td><td>'+(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a>':esc(r.title))+'</td><td>'+esc(r.areas)+'</td><td>'+esc(r.period)+'</td><td>'+(r.color?'<span class="sw" style="background:'+r.color+'"></span> ':'')+esc(r.gps)+'</td><td>'+esc(r.reason)+'</td></tr>').join('');
draw();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- XLSX
def write_xlsx(path, records, tracks, issues):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="3B4A5A")

    def sheet(ws, headers, rows, widths):
        ws.append(headers)
        for c in ws[1]:
            c.font = hdr_font
            c.fill = hdr_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for r in rows:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
        ws.freeze_panes = "A2"
        if rows:
            ws.auto_filter.ref = ws.dimensions

    by_rid = {}
    for t in tracks:
        by_rid.setdefault(t["rec"]["record_id"], []).append(t)

    ws = wb.active
    ws.title = "記録一覧"
    rows = []
    for r in records:
        ts = by_rid.get(r["record_id"], [])
        if ts:
            st = ts[0]["stats"]
            dist = sum(t["stats"]["distance_km"] for t in ts)
            up = sum(t["stats"]["ascent_m"] for t in ts)
            down = sum(t["stats"]["descent_m"] for t in ts)
            emin = min((t["stats"]["ele_min"] for t in ts if t["stats"]["ele_min"] is not None), default=None)
            emax = max((t["stats"]["ele_max"] for t in ts if t["stats"]["ele_max"] is not None), default=None)
            gps = f"取得済（{len(ts)}ファイル）"
            reason = ""
        else:
            dist = up = down = emin = emax = None
            gps = r.get("gps_status") or "未取得"
            reason = r.get("gps_reason", "")
        rows.append([r["record_id"], r.get("date_start", ""), r.get("date_end", ""), r.get("source", ""),
                     r.get("author", ""), r.get("title", ""), r.get("url", ""),
                     _num(r.get("distance_km")), _num(r.get("ascent_m")), _num(r.get("descent_m")),
                     r.get("moving_time", ""), dist, up, down, emin, emax,
                     r.get("areas", ""), r.get("activity", ""), r.get("period_status", ""), gps, reason,
                     r.get("info_basis", ""), r.get("notes", "")])
    sheet(ws, ["記録ID", "開始日", "終了日", "情報源", "記録者", "活動名", "URL",
               "距離km（記録表示値）", "登りm（記録表示値）", "下りm（記録表示値）", "時間（記録表示値）",
               "距離km（GPX実測）", "累積登りm（GPX実測）", "累積下りm（GPX実測）", "最低標高m", "最高標高m",
               "滑走エリア", "種別", "期間判定", "GPS取得状況", "取得不能の理由", "情報の根拠", "備考"],
          rows, [22, 11, 11, 14, 14, 30, 40, 10, 10, 10, 10, 10, 10, 10, 9, 9, 30, 16, 20, 14, 40, 22, 30])
    for row in ws.iter_rows(min_row=2, min_col=7, max_col=7):
        for c in row:
            if c.value:
                c.hyperlink = c.value
                c.font = Font(color="1155CC", underline="single")

    ws2 = wb.create_sheet("GPS取得不能")
    rows2 = [[r["record_id"], r.get("date_start", ""), r.get("title", ""), r.get("url", ""),
              r.get("period_status", ""), r.get("gps_reason", "")]
             for r in records if r["record_id"] not in by_rid and (r.get("gps_status") or "未取得") == "未取得"]
    sheet(ws2, ["記録ID", "開始日", "活動名", "URL", "期間判定", "取得不能の理由"], rows2, [22, 11, 30, 45, 20, 60])

    ws3 = wb.create_sheet("区間解析")
    rows3 = []
    for t in tracks:
        for k, ru in enumerate(t["runs"], 1):
            rows3.append([t["rec"]["record_id"], t["file"], k, SEG_LABEL[ru["type"]], fmt_t(ru["start"]),
                          fmt_t(ru["end"]), ru["distance_km"],
                          round(ru["ele_from"]) if ru["ele_from"] is not None else None,
                          round(ru["ele_to"]) if ru["ele_to"] is not None else None,
                          ru["ascent_m"], ru["descent_m"], "重複（代表外）" if t["dup_of"] else ""])
    sheet(ws3, ["記録ID", "ファイル", "区間No", "区分（自動判定）", "開始(JST)", "終了(JST)", "距離km",
                "開始標高m", "終了標高m", "累積登りm", "累積下りm", "重複"], rows3,
          [22, 28, 7, 18, 16, 16, 8, 9, 9, 9, 9, 12])

    ws4 = wb.create_sheet("取り込み注意")
    sheet(ws4, ["ファイル", "内容"], [list(i) for i in issues], [32, 80])

    ws5 = wb.create_sheet("調査メモ")
    notes = [
        ["対象期間", "2020-11-25〜2025-12-31（各年 11/25〜12/31）。立山黒部アルペンルートは例年11/30で冬期閉鎖のため、実質は各年 11/25〜11/30。"],
        ["区分判定", f"{WINDOW_S}秒窓の鉛直速度が{DESCENT_VZ}m/s以下かつ水平速度{DESCENT_HSPEED}m/s以上で滑走、+{ASCENT_VZ}m/s以上で登り、それ以外はその他。{MIN_RUN_S}秒未満の区間は前後に吸収。時刻のないGPXは区別不可。"],
        ["重複整理", f"点列が完全に一致するものは除外。開始時刻の差が{NEAR_DUP_START_S // 60}分以内で、互いに{int(NEAR_DUP_RATIO * 100)}%以上の点が{NEAR_DUP_DIST_M}m以内にあるものは近似重複とし、統合GPXでは代表のみ採用。"],
        ["座標の扱い", "出力するのはGPXファイルの実測点のみ。補間・推定座標は作らない。rte（計画ルート）は実測ではないため取り込まない。"],
        ["JUNRINA", "Web検索では、JUNRINA（junrina mountain service）は越後湯沢を拠点とするガイド。立山でのツアー記録は検索で確認できなかった。公式サイト・SNSは今回の環境から閲覧できず、未確認。"],
    ]
    sheet(ws5, ["項目", "内容"], notes, [14, 110])
    wb.save(path)


def _num(v):
    if v in (None, ""):
        return None
    try:
        return float(v) if "." in str(v) else int(v)
    except ValueError:
        return v


if __name__ == "__main__":
    sys.exit(main())
