#!/usr/bin/env python3
"""
スタート展示の確認ジョブ。

前日 provisional の買い目を、当日の preview（進入・ST・展示タイム）で
confirm / skip する。進入変更や予期しない欠測はスキップ。
"""

from __future__ import annotations

import json
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


def load_programs(date_key: str) -> dict | None:
    for path in [ROOT / "data" / "api" / f"{date_key}.json", ROOT / "data" / "programs" / f"{date_key}.json"]:
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
    return None


def exhibition_for_race(programs: dict, stadium: int, race: int) -> dict:
    stadiums = (programs.get("programs") or programs).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    preview = race_doc.get("preview") or {}
    racers = preview.get("racers") or {}
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
    ready = bool(boats) and not missing and not entry_changed and not unexpected
    reason = "スタート展示確認済み"
    status = "confirmed"
    if not boats:
        reason = "スタート展示未取得"
        status = "provisional"
    elif unexpected:
        reason = f"予期しない事態のためスキップ ({remarks})"
        status = "skipped"
    elif entry_changed:
        reason = "進入変更のためスキップ"
        status = "skipped"
    elif missing:
        reason = "進入・スリット・周回タイム未完了"
        status = "provisional"
    return {
        "ready": ready,
        "status": status,
        "reason": reason,
        "entryChanged": entry_changed,
        "unexpected": unexpected,
        "boats": boats,
        "wind_speed": preview.get("wind_speed"),
    }


def confirm_date(date_key: str) -> dict:
    picks_path = REPORTS / f"picks_{date_key}.json"
    if not picks_path.exists():
        return {"date": date_key, "status": "no_picks"}
    doc = json.loads(picks_path.read_text(encoding="utf-8"))
    programs = load_programs(date_key)
    if not programs:
        return {"date": date_key, "status": "programs_unavailable", "picks": doc.get("picks") or []}

    confirmed = skipped = provisional = 0
    out_picks = []
    for p in doc.get("picks") or []:
        ex = exhibition_for_race(programs, int(p["stadium"]), int(p["race"]))
        status = ex["status"]
        row = {
            **p,
            "status": status,
            "exhibition": {
                "ready": ex["ready"],
                "reason": ex["reason"],
                "entryChanged": ex["entryChanged"],
                "unexpected": ex["unexpected"],
                "boats": ex["boats"],
                "wind_speed": ex["wind_speed"],
            },
            "skip_reason": None
            if status == "confirmed"
            else ("entry_change" if ex["entryChanged"] else "unexpected" if ex["unexpected"] else "exhibition_pending"),
        }
        if status == "confirmed":
            confirmed += 1
        elif status == "skipped":
            skipped += 1
        else:
            provisional += 1
        out_picks.append(row)

    out = {
        **doc,
        "picks": out_picks,
        "count": len(out_picks),
        "confirmed": confirmed,
        "skipped": skipped,
        "provisional": provisional,
        "confirmed_at": datetime.now(JST).isoformat(),
        "note": "スタート展示確認後に確定。進入変更・予期しない事態はスキップ。",
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

    active = tomorrow_doc if usable(tomorrow_doc) else today_doc if usable(today_doc) else tomorrow_doc or today_doc or {}
    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at") or active.get("confirmed_at"),
        "picks": active.get("picks") or [],
        "count": active.get("count") or 0,
        "status": active.get("status"),
        "note": active.get("note"),
        "mode": active.get("mode") or "honmei",
        "daily_target": active.get("daily_target"),
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
        )

    today_doc = docs.get(today) or load_json(REPORTS / f"picks_{today}.json")
    tomorrow_doc = docs.get(tomorrow) or load_json(REPORTS / f"picks_{tomorrow}.json")
    if args.date and args.date not in (today, tomorrow):
        # 単独日付の確認時はボードを当日/翌日優先のまま維持
        pass
    refresh_board(today_doc, tomorrow_doc)
    print("board refreshed")


if __name__ == "__main__":
    main()
