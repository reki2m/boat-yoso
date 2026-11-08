#!/usr/bin/env python3
"""
前日〜当日の番組から、場×レースの買い目を生成する。
展示前は provisional。当日は展示確認後に confirm / skip する想定。
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

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖",
    7: "蒲郡", 8: "常滑", 9: "津", 10: "三国", 11: "びわこ", 12: "住之江",
    13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島", 18: "徳山",
    19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/2.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def skill_win(skills: dict, regno: int, course: int) -> float:
    rec = skills.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course)) or {}
    return float(c.get("win_rate") or 0)


def skill_top2(skills: dict, regno: int, course: int) -> float:
    rec = skills.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course)) or {}
    return float(c.get("top2_rate") or 0)


def innige_map(stadium_rates: dict) -> dict[int, float]:
    out = {}
    for _, v in stadium_rates.items():
        out[int(v["stadium"])] = float(v["rate"])
    return out


def tickets(kind: str) -> list[str]:
    m = {
        "trifecta_1_2_stream": ["1-2-3", "1-2-4", "1-2-5", "1-2-6"],
        "tri_oshi4": ["2-1-3", "2-1-4", "3-1-2", "3-1-4"],
        "tri_4_1_stream": ["4-1-2", "4-1-3", "4-1-5", "4-1-6"],
        "exa_21": ["2-1"],
        "exa_45": ["4-5"],
    }
    return m.get(kind, [])


CLASS_LABEL = {1: "A1", 2: "A2", 3: "B1", 4: "B2"}


def class_label(n: int) -> str:
    return CLASS_LABEL.get(int(n), f"級{n}")


def explain_honmei(place: int, stadium_name: str, e1: dict, e2: dict, inn: float, h: dict, ticket_list: list[str]) -> dict:
    reasons = [
        f"{stadium_name}はイン逃げ率 {(inn * 100):.1f}%（閾値 {(float(h.get('min_stadium_innige') or 0.6) * 100):.0f}%以上）",
        f"1号 {e1.get('name')} は{class_label(e1.get('class'))}・全国勝率 {float(e1.get('nat') or 0):.2f}・平均ST {float(e1.get('st') or 0):.2f}",
        f"モーター2連対 {float(e1.get('motor2') or 0):.1f}%、2号との勝率差 {float(e1.get('nat') or 0) - float(e2.get('nat') or 0):.2f}",
        f"買い目はイン戦の {', '.join(ticket_list)}（1-2軸の流れ）",
    ]
    why = (
        f"{stadium_name}はインが決まりやすい場。1号の{e1.get('name')}が"
        f"{class_label(e1.get('class'))}・勝率{float(e1.get('nat') or 0):.2f}・ST{float(e1.get('st') or 0):.2f}・"
        f"モーター{float(e1.get('motor2') or 0):.1f}%と本命条件を満たし、2号との勝率差も確保できるため"
        "「1-2流し」を採用。"
    )
    return {"why": why, "reasons": reasons}


def explain_oshi(place: int, stadium_name: str, e1: dict, e2: dict, skills: dict, inn: float, o: dict, ticket_list: list[str]) -> dict:
    c2s = skill_win(skills, int(e2.get("regno") or 0), 2)
    c2t2 = skill_top2(skills, int(e2.get("regno") or 0), 2)
    reasons = [
        f"1号勝率 {float(e1.get('nat') or 0):.2f} は押し目レンジ（{o.get('c1_nat_lo')}〜{o.get('c1_nat_hi')}）",
        f"2号 {e2.get('name')} の全国勝率 {float(e2.get('nat') or 0):.2f}、2コース勝率 {(c2s * 100):.1f}% / 2連対 {(c2t2 * 100):.1f}%",
        f"場のイン逃げ率 {(inn * 100):.1f}%（押し目下限 {(float(o.get('min_inn') or 0) * 100):.0f}%以上）",
        f"買い目は差し・まくり返し想定の {', '.join(ticket_list)}",
    ]
    why = (
        f"{stadium_name}で1号が強すぎず（勝率{float(e1.get('nat') or 0):.2f}）、"
        f"2号の{e2.get('name')}が2コース実績（勝率{(c2s * 100):.1f}%）と全国勝率{float(e2.get('nat') or 0):.2f}で反撃できる形。"
        f"イン一本に偏らず押し目の {', '.join(ticket_list)} を採用。"
    )
    return {"why": why, "reasons": reasons}


def explain_ana(place: int, stadium_name: str, e1: dict, ex: dict, axis: int, skills: dict, inn: float, a: dict, ticket_list: list[str]) -> dict:
    c1s = skill_win(skills, int(e1.get("regno") or 0), 1)
    axs = skill_win(skills, int(ex.get("regno") or 0), axis)
    reasons = [
        f"イン場が強くない（逃げ率 {(inn * 100):.1f}% ≤ {(float(a.get('max_inn') or 1) * 100):.0f}%）",
        f"1号 {e1.get('name')} は{class_label(e1.get('class'))}・勝率 {float(e1.get('nat') or 0):.2f}・ST {float(e1.get('st') or 0):.2f}・1コース勝率 {(c1s * 100):.1f}% と弱い",
        f"{axis}号 {ex.get('name')} は軸候補（全国勝率 {float(ex.get('nat') or 0):.2f}・{axis}コース勝率 {(axs * 100):.1f}%・モーター {float(ex.get('motor2') or 0):.1f}%）",
        f"買い目はアウト寄り {', '.join(ticket_list)}",
    ]
    why = (
        f"{stadium_name}はイン絶対場ではなく、1号の{e1.get('name')}が"
        f"勝率{float(e1.get('nat') or 0):.2f}/ST{float(e1.get('st') or 0):.2f}と穴向き。"
        f"{axis}号の{ex.get('name')}がコース実績と勝率で軸になれるため、"
        f"{', '.join(ticket_list)} を採用。"
    )
    if float(a.get("min_wind") or 0) > 0:
        reasons.append(f"風速 {a.get('min_wind')}m以上を当日確認（未達ならスキップ）")
        why += f" 当日風速{a.get('min_wind')}m未満なら見送り。"
    return {"why": why, "reasons": reasons}


def pick_band(place: int, entries: dict[int, dict], locked: dict, skills: dict, innige: dict[int, float]):
    e1, e2, e3, e4 = entries.get(1), entries.get(2), entries.get(3), entries.get(4)
    if not e1 or not e2:
        return None
    stadium_name = STADIUMS.get(place, f"場{place}")
    inn = innige.get(place, 0)

    # honmei
    h = locked.get("honmei") or {}
    if (
        place in (h.get("stadium_whitelist") or [])
        and int(e1.get("class") or 99) <= int(h.get("max_c1_class") or 1)
        and float(e1.get("nat") or 0) >= float(h.get("min_c1_nat") or 7)
        and float(e1.get("st") or 9) <= float(h.get("max_c1_st") or 0.14)
        and float(e1.get("motor2") or 0) >= float(h.get("min_motor2") or 35)
        and float(e1.get("nat") or 0) - float(e2.get("nat") or 0) >= float(h.get("min_gap_c2") or 1)
        and inn >= float(h.get("min_stadium_innige") or 0.6)
        and int(e1.get("grade") or 5) in (h.get("grades") or [4, 5])
    ):
        ticket_list = tickets(h.get("ticket") or "trifecta_1_2_stream")
        explanation = explain_honmei(place, stadium_name, e1, e2, inn, h, ticket_list)
        return {
            "band": "honmei",
            "label": "本命",
            "tickets": ticket_list,
            "ticket": h.get("ticket"),
            "validated_roi": h.get("validated_test_roi"),
            **explanation,
        }

    # oshi
    o = locked.get("oshi") or {}
    wl = o.get("stadium_whitelist")
    c2s = skill_win(skills, int(e2.get("regno") or 0), 2)
    if (
        (wl is None or place in wl)
        and float(o.get("min_inn") or 0) <= inn
        and float(o.get("c1_nat_lo") or 0) <= float(e1.get("nat") or 0) <= float(o.get("c1_nat_hi") or 99)
        and float(e2.get("nat") or 0) >= float(o.get("min_c2_nat") or 0)
        and c2s >= float(o.get("min_c2_skill") or 0)
        and skill_top2(skills, int(e2.get("regno") or 0), 2) >= float(o.get("min_c2_top2") or 0)
        and float(e1.get("st") or 9) <= float(o.get("max_c1_st") or 9)
        and (o.get("min_c2_motor") is None or float(e2.get("motor2") or 0) >= float(o["min_c2_motor"]))
        and int(e1.get("grade") or 5) in (o.get("grades") or [4, 5])
    ):
        ticket_list = tickets(o.get("ticket") or "tri_oshi4")
        explanation = explain_oshi(place, stadium_name, e1, e2, skills, inn, o, ticket_list)
        return {
            "band": "oshi",
            "label": "押し目",
            "tickets": ticket_list,
            "ticket": o.get("ticket"),
            "validated_roi": o.get("validated_test_roi"),
            "validated_hit": o.get("validated_test_hit_rate"),
            **explanation,
        }

    # ana
    a = locked.get("ana") or {}
    axis = int(a.get("axis") or 4)
    ex = entries.get(axis)
    if not ex:
        return None
    wl = a.get("stadium_whitelist")
    if (
        (wl is None or place in wl)
        and innige.get(place, 1) <= float(a.get("max_inn") or 1)
        and float(e1.get("nat") or 0) <= float(a.get("max_c1_nat") or 99)
        and skill_win(skills, int(e1.get("regno") or 0), 1) <= float(a.get("max_c1_skill") or 1)
        and float(e1.get("st") or 0) >= float(a.get("min_c1_st") or 0)
        and skill_win(skills, int(ex.get("regno") or 0), axis) >= float(a.get("min_axis_skill") or 0)
        and float(ex.get("nat") or 0) >= float(a.get("min_axis_nat") or 0)
        and (not a.get("require_weak_c1_class") or int(e1.get("class") or 1) >= 2)
        and (a.get("min_axis_motor") is None or float(ex.get("motor2") or 0) >= float(a["min_axis_motor"]))
        and int(e1.get("grade") or 5) in (a.get("grades") or [4, 5])
        # wind unknown day-before → mark needs_wind_confirm
    ):
        ticket_list = tickets(a.get("ticket") or "tri_4_1_stream")
        explanation = explain_ana(place, stadium_name, e1, ex, axis, skills, innige.get(place, 0), a, ticket_list)
        return {
            "band": "ana",
            "label": "穴目",
            "tickets": ticket_list,
            "ticket": a.get("ticket"),
            "validated_roi": a.get("validated_test_roi"),
            "validated_hit": a.get("validated_test_hit_rate"),
            "needs_wind_confirm": float(a.get("min_wind") or 0) > 0,
            "min_wind": a.get("min_wind"),
            **explanation,
        }
    return None


def load_programs_for(date_key: str) -> dict | None:
    year = date_key[:4]
    local = ROOT / "data" / "api" / f"{date_key}.json"
    urls = [
        f"https://boatraceopenapi.github.io/api/v1/{year}/{date_key}.json",
        "https://boatraceopenapi.github.io/api/v1/today.json",
    ]
    if local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    for url in urls:
        try:
            data = fetch_json(url)
            # today.json may not match date_key
            if url.endswith("today.json"):
                # accept anyway if requested date is today
                today = datetime.now(JST).strftime("%Y%m%d")
                if date_key != today:
                    continue
            (ROOT / "data" / "api").mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except Exception as e:
            print("fetch fail", url, e)
    return None


def generate(date_key: str, phase: str) -> dict:
    locked = load_json(REPORTS / "locked_triple_rules.json", {})
    skills = load_json(REPORTS / "course_skills.json", {})
    stadium_rates = load_json(REPORTS / "stadium_innige_rates.json", {})
    innige = innige_map(stadium_rates)
    programs = load_programs_for(date_key)
    picks = []
    if not programs:
        return {
            "date": date_key,
            "phase": phase,
            "generated_at": datetime.now(JST).isoformat(),
            "picks": [],
            "status": "programs_unavailable",
            "note": "番組未公開。夜中再取得待ち。",
        }

    stadiums = (programs.get("programs") or {}).get("stadiums") or {}
    for sid, st in stadiums.items():
        place = int(sid)
        races = st.get("races") or {}
        for rid, race in races.items():
            race_no = int(rid)
            grade = int(race.get("grade_number") or 5)
            entries = {}
            for _, r in (race.get("racers") or {}).items():
                entry = int(r.get("entry_number") or 0)
                if not entry:
                    continue
                entries[entry] = {
                    "regno": int(r.get("number") or 0),
                    "name": r.get("name"),
                    "class": int(r.get("rank_number") or 4),
                    "nat": float(r.get("national_win_rate") or 0),
                    "st": float(r.get("average_start_timing") or 0.2),
                    "motor2": float(r.get("motor_top_2_percent") or 0),
                    "grade": grade,
                }
            if len(entries) < 6:
                continue
            for e in entries.values():
                e["grade"] = grade
            band = pick_band(place, entries, locked, skills, innige)
            if not band:
                continue
            picks.append(
                {
                    "date": date_key,
                    "stadium": place,
                    "stadium_name": STADIUMS.get(place, f"場{place}"),
                    "race": race_no,
                    "title": race.get("title") or "",
                    "grade": grade,
                    "status": "provisional",  # 展示確認前
                    "skip_on": ["entry_change", "exhibition_missing", "unexpected_event"],
                    "entries": {
                        str(k): {"name": v["name"], "regno": v["regno"], "nat": v["nat"], "st": v["st"]}
                        for k, v in entries.items()
                    },
                    **band,
                }
            )

    out = {
        "date": date_key,
        "phase": phase,
        "generated_at": datetime.now(JST).isoformat(),
        "picks": picks,
        "count": len(picks),
        "status": "ok",
        "note": "前日予想は provisional。当日はスタート展示確認後に確定し、進入変更・異常はスキップ。",
    }
    return out


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD target date")
    ap.add_argument("--phase", default="nightly", choices=["nightly", "morning", "manual"])
    args = ap.parse_args()

    now = datetime.now(JST)
    today = now.strftime("%Y%m%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y%m%d")
    targets = []
    if args.date:
        targets.append((args.date, args.phase))
    else:
        # 夜中: 当日確定用 + 翌日 provisional
        targets.append((today, "today"))
        targets.append((tomorrow, "tomorrow"))

    REPORTS.mkdir(parents=True, exist_ok=True)
    SRC_DATA.mkdir(parents=True, exist_ok=True)
    bundle = {"generated_at": now.isoformat(), "targets": {}}
    for date_key, phase in targets:
        print("generate", date_key, phase)
        out = generate(date_key, phase)
        bundle["targets"][date_key] = out
        path = REPORTS / f"picks_{date_key}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  picks", out.get("count"), out.get("status"))

    def usable(doc: dict | None) -> bool:
        if not doc:
            return False
        return doc.get("status") != "programs_unavailable"

    # active board: prefer tomorrow when programs exist, else today
    tomorrow_doc = bundle["targets"].get(tomorrow)
    today_doc = bundle["targets"].get(today)
    if args.date and args.date in bundle["targets"]:
        active = bundle["targets"][args.date]
    elif usable(tomorrow_doc):
        active = tomorrow_doc
    elif usable(today_doc):
        active = today_doc
    else:
        active = tomorrow_doc or today_doc or next(iter(bundle["targets"].values()), {})

    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at"),
        "picks": active.get("picks") or [],
        "count": active.get("count") or 0,
        "status": active.get("status"),
        "note": active.get("note"),
        "today": today_doc,
        "tomorrow": tomorrow_doc,
        "all": bundle,
    }
    (REPORTS / "picks_board.json").write_text(
        json.dumps(board, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (SRC_DATA / "picks_board.json").write_text(
        json.dumps({k: v for k, v in board.items() if k != "all"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("board", active.get("date"), active.get("count"), active.get("status"))


if __name__ == "__main__":
    main()
