#!/usr/bin/env python3
"""
スタート展示・オッズの最終確認ジョブ。

- 進入変更 / 異常 / 締切済み → スキップ
- 展示厳格: 進入・ST・周回必須、1号ST悪化・展示順位悪化でスキップ
- オッズ: 買われすぎ・資金集中・帯外でスキップ（締切間近の欠測もスキップ）
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SRC_DATA = ROOT / "src" / "data"
JST = timezone(timedelta(hours=9))


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoConfirm/5.0"})
    with urllib.request.urlopen(req, timeout=45) as res:
        return json.loads(res.read())


def load_programs(date_key: str) -> dict | None:
    for path in [ROOT / "data" / "api" / f"{date_key}.json", ROOT / "data" / "programs" / f"{date_key}.json"]:
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
    return None


def parse_closed_at(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt


def is_race_closed(race_doc: dict, now: datetime | None = None) -> bool:
    now = now or datetime.now(JST)
    closed = parse_closed_at(race_doc.get("closed_at"))
    if closed is not None and now >= closed:
        return True
    result = race_doc.get("result")
    if isinstance(result, dict):
        racers = result.get("racers") or {}
        if any((r or {}).get("place_number") not in (None, "", 0) for r in racers.values()):
            return True
        payouts = result.get("payouts") or {}
        if any(payouts.get(k) for k in ("trifecta", "exacta", "win")):
            return True
    return False


def flatten_trifecta_tree(tree) -> dict[str, float]:
    out: dict[str, float] = {}
    if not isinstance(tree, dict):
        return out
    for a, m2 in tree.items():
        if not isinstance(m2, dict):
            continue
        for b, m3 in m2.items():
            if not isinstance(m3, dict):
                continue
            for c, odds in m3.items():
                if odds is None:
                    continue
                try:
                    v = float(odds)
                except (TypeError, ValueError):
                    continue
                if v > 0:
                    out[f"{a}-{b}-{c}"] = v
    return out


def race_odds(programs: dict, stadium: int, race: int, date_key: str) -> tuple[dict[str, float], str]:
    stadiums = (programs.get("programs") or programs).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    odds = flatten_trifecta_tree(((race_doc.get("odds") or {}).get("trifecta")))
    if odds:
        return odds, "programs"
    iso = f"{date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}"
    local = ROOT / "data" / "chronology" / f"{date_key}.json"
    data = None
    if local.exists():
        data = json.loads(local.read_text(encoding="utf-8"))
    else:
        for url in [
            f"https://boatraceopenapi.github.io/chronology/v2/{iso}.json",
            f"https://boatraceopenapi.github.io/api/v2/{iso}.json",
        ]:
            try:
                data = fetch_json(url)
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                break
            except Exception:
                continue
    if not data:
        return {}, "missing"
    stadiums = (data.get("programs") or {}).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    odds = flatten_trifecta_tree(((race_doc.get("odds") or {}).get("trifecta")))
    return (odds, "chronology") if odds else ({}, "missing")


def evaluate_odds(odds: dict[str, float], cfg: dict, tickets: list[str]) -> dict:
    if not odds:
        return {"ok": None, "missing": True, "reason": "オッズ未取得", "tickets": tickets}
    ranked = sorted(((k, v) for k, v in odds.items() if v > 0), key=lambda x: x[1])
    favorite, fav = ranked[0]
    inv = [(k, 1.0 / v) for k, v in ranked[:30]]
    s = sum(v for _, v in inv) or 1.0
    top3 = sum(v for _, v in inv[:3]) / s
    overbet = fav < float(cfg.get("min_favorite_odds") or 6)
    concentrate = top3 > float(cfg.get("max_top3_share") or 0.55)
    lo = float(cfg.get("ticket_odds_lo") or 6)
    hi = float(cfg.get("ticket_odds_hi") or 120)
    filtered = [t for t in tickets if lo <= float(odds.get(t) or 0) <= hi]
    reasons = []
    blocked = False
    if cfg.get("block_overbet", True) and overbet:
        blocked = True
        reasons.append(f"買われすぎ {favorite} {fav:.1f}倍")
    if cfg.get("block_money_concentrate", True) and concentrate:
        blocked = True
        reasons.append(f"資金集中 top3={top3:.1%}")
    if not filtered:
        blocked = True
        reasons.append("買い目がオッズ帯外")
    return {
        "ok": not blocked,
        "missing": False,
        "favorite": favorite,
        "fav_odds": fav,
        "top3_share": round(top3, 3),
        "tickets": filtered if filtered else tickets,
        "reason": " / ".join(reasons) if reasons else "オッズ妥当",
    }


def exhibition_for_race(programs: dict, stadium: int, race: int, pick: dict, rules: dict) -> dict:
    ex_cfg = rules.get("exhibition") or {}
    odds_cfg = rules.get("odds") or {}
    stadiums = (programs.get("programs") or programs).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    preview = race_doc.get("preview") or {}
    racers = preview.get("racers") or {}
    program_racers = race_doc.get("racers") or {}
    boats = []
    entry_changed = False
    missing = False
    for _, r in racers.items():
        entry = int(r.get("entry_number") or 0)
        course = r.get("course_number")
        course_i = int(course) if course not in (None, "") else None
        st = r.get("start_timing")
        exhibit = r.get("exhibition_time")
        changed = course_i is not None and entry and course_i != entry
        if changed:
            entry_changed = True
        if course_i is None or st is None or exhibit is None:
            missing = True
        boats.append(
            {
                "entry": entry,
                "course": course_i,
                "slit": float(st) if st is not None else None,
                "lapTime": float(exhibit) if exhibit is not None else None,
                "entryChanged": changed,
            }
        )
    remarks = ((race_doc.get("result") or {}).get("remarks") or "") if isinstance(race_doc.get("result"), dict) else ""
    unexpected = bool(remarks) and any(
        k in str(remarks) for k in ("中止", "欠場", "不成立", "レース取り消し", "進入違反")
    )
    closed = is_race_closed(race_doc)

    # strict 1号 gate
    c1_fail = False
    c1_reason = ""
    if ex_cfg.get("strict", True) and boats and not missing:
        b1 = next((b for b in boats if b["entry"] == 1), None)
        prog1 = None
        for _, rr in program_racers.items():
            if int(rr.get("entry_number") or 0) == 1:
                prog1 = rr
                break
        if b1 and b1.get("slit") is not None and prog1 is not None:
            prog_st = float(prog1.get("average_start_timing") or prog1.get("start_timing") or 0.2)
            delta = float(b1["slit"]) - prog_st
            if delta > float(ex_cfg.get("max_c1_slit_delta") or 0.05):
                c1_fail = True
                c1_reason = f"1号展示ST悪化 (+{delta:.2f})"
        if b1 and b1.get("lapTime") is not None:
            laps = [b["lapTime"] for b in boats if b.get("lapTime") is not None]
            # smaller exhibition time is better
            rank = 1 + sum(1 for x in laps if x < b1["lapTime"] - 1e-9)
            if rank > int(ex_cfg.get("max_c1_exhibit_rank") or 4):
                c1_fail = True
                c1_reason = (c1_reason + " / " if c1_reason else "") + f"1号展示タイム順位 {rank}位"

    date_key = str(pick.get("date") or race_doc.get("date") or "")
    if len(date_key) == 10 and "-" in date_key:
        date_key = date_key.replace("-", "")
    odds_map, odds_source = race_odds(programs, stadium, race, date_key or datetime.now(JST).strftime("%Y%m%d"))
    tickets = list(pick.get("tickets") or [])
    odds_eval = evaluate_odds(odds_map, odds_cfg, tickets) if odds_cfg.get("enabled", True) else {
        "ok": True, "missing": False, "reason": "odds off", "tickets": tickets
    }

    near_close = False
    closed_at = parse_closed_at(race_doc.get("closed_at") or pick.get("closed_at"))
    mins = float(odds_cfg.get("skip_if_missing_near_close_minutes") or 20)
    if closed_at is not None:
        remain = (closed_at - datetime.now(JST)).total_seconds() / 60.0
        near_close = 0 < remain <= mins

    ready = (
        bool(boats)
        and not missing
        and not entry_changed
        and not unexpected
        and not closed
        and not c1_fail
        and odds_eval.get("ok") is not False
        and not (odds_eval.get("missing") and near_close and odds_cfg.get("require_odds_to_confirm", True))
    )

    reason = "スタート展示・オッズ確認済み"
    status = "confirmed"
    skip_reason = None
    if closed:
        reason = f"締切済みのためスキップ ({race_doc.get('closed_at')})"
        status = "skipped"
        skip_reason = "race_closed"
    elif unexpected:
        reason = f"予期しない事態のためスキップ ({remarks})"
        status = "skipped"
        skip_reason = "unexpected"
    elif entry_changed:
        reason = "進入変更のためスキップ"
        status = "skipped"
        skip_reason = "entry_change"
    elif not boats or missing:
        reason = "進入・スリット・周回タイム未完了"
        status = "provisional"
        skip_reason = "exhibition_pending"
    elif c1_fail:
        reason = f"展示ゲート不合格 ({c1_reason})"
        status = "skipped"
        skip_reason = "exhibition_fail"
    elif odds_eval.get("ok") is False:
        reason = f"オッズ回避 ({odds_eval.get('reason')})"
        status = "skipped"
        skip_reason = "odds_overbet"
    elif odds_eval.get("missing") and near_close and odds_cfg.get("require_odds_to_confirm", True):
        reason = "締切間近でオッズ未取得のためスキップ"
        status = "skipped"
        skip_reason = "odds_missing_near_close"
    elif odds_eval.get("missing"):
        reason = "展示待ち/オッズ待ち"
        status = "provisional"
        skip_reason = "odds_pending"
    elif not ready:
        reason = "確認未完了"
        status = "provisional"
        skip_reason = "exhibition_pending"

    final_tickets = odds_eval.get("tickets") or tickets
    return {
        "ready": ready,
        "status": status,
        "reason": reason,
        "skip_reason": skip_reason,
        "entryChanged": entry_changed,
        "unexpected": unexpected,
        "raceClosed": closed,
        "exhibitionFail": c1_fail,
        "boats": boats,
        "wind_speed": preview.get("wind_speed"),
        "closed_at": race_doc.get("closed_at"),
        "odds": {
            "source": odds_source,
            "missing": odds_eval.get("missing"),
            "ok": odds_eval.get("ok"),
            "favorite": odds_eval.get("favorite"),
            "fav_odds": odds_eval.get("fav_odds"),
            "top3_share": odds_eval.get("top3_share"),
            "reason": odds_eval.get("reason"),
        },
        "tickets": final_tickets,
    }


def confirm_date(date_key: str) -> dict:
    picks_path = REPORTS / f"picks_{date_key}.json"
    if not picks_path.exists():
        return {"date": date_key, "status": "no_picks"}
    doc = json.loads(picks_path.read_text(encoding="utf-8"))
    rules = load_json(REPORTS / "honmei_rules.json", {}) or {}
    programs = load_programs(date_key)
    if not programs:
        return {"date": date_key, "status": "programs_unavailable", "picks": doc.get("picks") or []}

    confirmed = skipped = provisional = 0
    out_picks = []
    for p in doc.get("picks") or []:
        # already closed picks should not stay active
        ex = exhibition_for_race(programs, int(p["stadium"]), int(p["race"]), p, rules)
        status = ex["status"]
        tickets = ex.get("tickets") or p.get("tickets") or []
        stake = int(p.get("stake_per_ticket") or 100)
        row = {
            **p,
            "status": status,
            "tickets": tickets,
            "points": len(tickets),
            "stake_total": stake * len(tickets),
            "exhibition": {
                "ready": ex["ready"],
                "reason": ex["reason"],
                "entryChanged": ex["entryChanged"],
                "unexpected": ex["unexpected"],
                "exhibitionFail": ex.get("exhibitionFail"),
                "boats": ex["boats"],
                "wind_speed": ex["wind_speed"],
            },
            "odds": ex.get("odds") or p.get("odds"),
            "closed_at": ex.get("closed_at") or p.get("closed_at"),
            "skip_reason": ex.get("skip_reason"),
        }
        if status == "confirmed":
            confirmed += 1
        elif status == "skipped":
            skipped += 1
        else:
            provisional += 1
        out_picks.append(row)

    # active board: drop skipped closed races from count emphasis but keep for audit
    active_picks = [p for p in out_picks if p.get("status") != "skipped"]
    out = {
        **doc,
        "picks": out_picks,
        "active_picks": active_picks,
        "count": len(active_picks),
        "confirmed": confirmed,
        "skipped": skipped,
        "provisional": provisional,
        "confirmed_at": datetime.now(JST).isoformat(),
        "mode": rules.get("mode") or "honmei_strict2",
        "disabled_systems": rules.get("disabled_systems") or ["oshi", "ana"],
        "stadium_blacklist": rules.get("stadium_blacklist") or [21],
        "note": "超厳選2点。展示厳格＋オッズ回避後に確定。進入変更・異常・締切済み・買われすぎはスキップ。押し目穴無効。",
        "status": "ok",
    }
    picks_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def refresh_board(today_doc: dict | None, tomorrow_doc: dict | None) -> None:
    def usable(doc: dict | None) -> bool:
        if not doc:
            return False
        if doc.get("status") == "programs_unavailable":
            return False
        return True

    # prefer today for live ops
    active = today_doc if usable(today_doc) else tomorrow_doc if usable(tomorrow_doc) else today_doc or tomorrow_doc or {}
    picks = active.get("active_picks") or [p for p in (active.get("picks") or []) if p.get("status") != "skipped"]
    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at") or active.get("confirmed_at"),
        "picks": picks,
        "all_picks": active.get("picks") or [],
        "count": len(picks),
        "status": active.get("status"),
        "note": active.get("note"),
        "mode": active.get("mode") or "honmei_strict2",
        "disabled_systems": active.get("disabled_systems") or ["oshi", "ana"],
        "stadium_blacklist": active.get("stadium_blacklist") or [21],
        "selection": active.get("selection"),
        "points_per_race": active.get("points_per_race") or 2,
        "confirmed": active.get("confirmed"),
        "skipped": active.get("skipped"),
        "provisional": active.get("provisional"),
        "today": today_doc,
        "tomorrow": tomorrow_doc,
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    SRC_DATA.mkdir(parents=True, exist_ok=True)
    (REPORTS / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    (SRC_DATA / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    for name in ("honmei_rules.json", "locked_triple_rules.json", "locked_honmei_rule.json"):
        src = REPORTS / name
        if src.exists():
            (SRC_DATA / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD")
    args = ap.parse_args()
    now = datetime.now(JST)
    today = now.strftime("%Y%m%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y%m%d")
    dates = [args.date] if args.date else [today, tomorrow]

    docs = {}
    for d in dates:
        print("confirm", d)
        out = confirm_date(d)
        docs[d] = out if out.get("picks") is not None else load_json(REPORTS / f"picks_{d}.json")
        print(
            " ",
            out.get("status"),
            "confirmed",
            out.get("confirmed"),
            "skipped",
            out.get("skipped"),
            "provisional",
            out.get("provisional"),
            "active",
            out.get("count"),
        )

    today_doc = docs.get(today) or load_json(REPORTS / f"picks_{today}.json")
    tomorrow_doc = docs.get(tomorrow) or load_json(REPORTS / f"picks_{tomorrow}.json")
    refresh_board(today_doc, tomorrow_doc)
    print("board refreshed")


if __name__ == "__main__":
    main()
