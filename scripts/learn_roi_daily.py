#!/usr/bin/env python3
"""
回収率モニタ＋軽量自動学習。

- 直近 accuracy からローリングROIを計算
- エントリー特徴量で閾値候補を再フィルタし、回収が改善する設定だけ採用
- 悪化時は pause / review フラグのみ（無謀な緩和はしない）
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SRC_DATA = ROOT / "src" / "data"
JST = timezone(timedelta(hours=9))

LOCK_KEYS = (
    "min_c1_nat",
    "max_c1_st",
    "min_motor2",
    "min_gap_c2",
    "min_score_gap",
    "max_c1_class",
)


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_accuracy_days(limit: int = 45) -> list[dict]:
    files = sorted(REPORTS.glob("accuracy_20*.json"), reverse=True)[:limit]
    days = []
    for f in files:
        doc = load_json(f)
        if isinstance(doc, dict) and isinstance(doc.get("rows"), list):
            days.append(doc)
    if days:
        return days
    summary = load_json(REPORTS / "accuracy_summary.json") or load_json(SRC_DATA / "accuracy_summary.json") or {}
    return [d for d in (summary.get("days") or []) if isinstance(d, dict)]


def iter_selected_rows(days: list[dict]) -> list[dict]:
    rows = []
    for day in days:
        for row in day.get("rows") or []:
            if row.get("result") in {"skipped", "skipped_entry_change", "skipped_no_exhibition", "no_result"}:
                continue
            if row.get("status") == "skipped":
                continue
            if "hit" not in row and row.get("result") not in {"hit", "miss"}:
                continue
            entries = row.get("entries") or {}
            if not entries.get("1"):
                continue
            rows.append(row)
    return rows


def passes_lock(rule: dict, row: dict) -> bool:
    e1 = (row.get("entries") or {}).get("1") or {}
    e2 = (row.get("entries") or {}).get("2") or {}
    place = int(row.get("stadium") or 0)
    race_no = int(row.get("race") or 0)
    wl = rule.get("stadium_whitelist")
    if isinstance(wl, list) and wl and place not in {int(x) for x in wl}:
        return False
    rbl = rule.get("race_blacklist")
    if isinstance(rbl, list) and rbl and race_no in {int(x) for x in rbl}:
        return False
    score_gap = float(row.get("score_gap") or 0)
    if rule.get("require_leading_score", True) and score_gap < float(rule.get("min_score_gap") or 0):
        return False
    return (
        float(e1.get("nat") or 0) >= float(rule.get("min_c1_nat") or 5.8)
        and float(e1.get("st") or 9) <= float(rule.get("max_c1_st") or 0.18)
        and int(e1.get("class") or 99) <= int(rule.get("max_c1_class") or 2)
        and float(e1.get("motor2") or 0) >= float(rule.get("min_motor2") or 28)
        and float(e1.get("nat") or 0) - float(e2.get("nat") or 0) >= float(rule.get("min_gap_c2") or 0.8)
    )


def score_rows(rule: dict, rows: list[dict]) -> dict:
    bets = pay = hits = n = 0
    for row in rows:
        if not passes_lock(rule, row):
            continue
        n += 1
        stake = int(row.get("stake") or (100 * max(1, len(row.get("tickets") or ["1-2-3"]))))
        got = int(row.get("pay") or 0)
        hit = bool(row.get("hit") or row.get("result") == "hit")
        bets += stake
        pay += got
        hits += int(hit)
    return {
        "n": n,
        "hits": hits,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "hit_rate": (hits / n * 100) if n else 0.0,
        "roi": (pay / bets * 100) if bets else 0.0,
    }


def candidate_rules(base: dict) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = [("baseline", deepcopy(base))]
    tweaks = [
        ("tighter_st", {"max_c1_st": round(float(base.get("max_c1_st") or 0.14) - 0.01, 3)}),
        ("higher_nat", {"min_c1_nat": round(float(base.get("min_c1_nat") or 6.5) + 0.1, 2)}),
        ("higher_motor", {"min_motor2": float(base.get("min_motor2") or 32) + 2}),
        ("higher_gap", {"min_gap_c2": round(float(base.get("min_gap_c2") or 1.0) + 0.1, 2)}),
        ("higher_score_gap", {"min_score_gap": round(float(base.get("min_score_gap") or 1.5) + 0.2, 2)}),
        ("looser_st_small", {"max_c1_st": round(float(base.get("max_c1_st") or 0.14) + 0.01, 3)}),
        ("combo_tight", {
            "max_c1_st": round(float(base.get("max_c1_st") or 0.14) - 0.01, 3),
            "min_c1_nat": round(float(base.get("min_c1_nat") or 6.5) + 0.1, 2),
        }),
    ]
    for name, patch in tweaks:
        # 緩和候補は回収改善が明確なときだけ後段で採用
        cand = deepcopy(base)
        cand.update(patch)
        out.append((name, cand))
    return out


def apply_lock(lock: dict, chosen: dict, note: str) -> dict:
    next_lock = deepcopy(lock)
    for k in LOCK_KEYS:
        if k in chosen:
            next_lock[k] = chosen[k]
    next_lock["validated_note"] = note
    next_lock["learned_at"] = datetime.now(JST).isoformat()
    return next_lock


def sync_honmei_rules(lock: dict) -> None:
    for folder in (REPORTS, SRC_DATA):
        path = folder / "honmei_rules.json"
        rules = load_json(path, {}) or {}
        selection = rules.get("selection") or {}
        for k in LOCK_KEYS:
            if k in lock:
                selection[k] = lock[k]
        if "stadium_whitelist" in lock:
            selection["stadium_whitelist"] = lock["stadium_whitelist"]
        if "race_blacklist" in lock:
            selection["race_blacklist"] = lock["race_blacklist"]
        rules["selection"] = selection
        # standard も揃える（生成ロジック互換）
        standard = rules.get("standard") or {}
        for k in ("min_c1_nat", "max_c1_st", "min_motor2", "min_gap_c2", "min_score_gap", "max_c1_class"):
            if k in lock:
                standard[k] = lock[k]
        rules["standard"] = standard
        rules["learned_at"] = datetime.now(JST).isoformat()
        save_json(path, rules)


def update_ops(ops: dict, rolling_roi: float | None, applied: bool, status: str) -> dict:
    next_ops = deepcopy(ops) if ops else {}
    mon = next_ops.get("monitoring") or {}
    next_ops["status"] = status
    next_ops["last_learned_at_jst"] = datetime.now(JST).isoformat()
    next_ops["rolling_roi"] = rolling_roi
    next_ops["last_learn_applied"] = applied
    mon["keep_thresholds_fixed_until_pause"] = False  # 日次学習を許可
    mon["unit"] = "daily"
    next_ops["monitoring"] = mon
    return next_ops


def main() -> None:
    now = datetime.now(JST)
    lock_path = SRC_DATA / "locked_honmei_rule.json"
    if not lock_path.exists():
        lock_path = REPORTS / "locked_honmei_rule.json"
    lock = load_json(lock_path, {}) or {}
    ops = load_json(SRC_DATA / "ops_live.json") or load_json(REPORTS / "ops_live.json") or {}
    days = load_accuracy_days(45)
    rows = iter_selected_rows(days)
    baseline = score_rows(lock, rows) if rows else {"n": 0, "roi": 0.0, "hits": 0, "bets": 0, "pay": 0, "pnl": 0, "hit_rate": 0.0}

    pause_below = float(((ops.get("monitoring") or {}).get("pause_if_roi_below")) or 90)
    review_below = float(((ops.get("monitoring") or {}).get("review_if_roi_below")) or 98)

    best_name = "baseline"
    best_rule = lock
    best_score = baseline
    for name, cand in candidate_rules(lock):
        sc = score_rows(cand, rows)
        if sc["n"] < max(8, int(baseline.get("n") or 0) * 0.55):
            continue  # 件数を削りすぎる学習は捨てる
        # 緩和（ST緩める等）はROI+5pt以上かつ件数維持でだけ許可
        loosened = float(cand.get("max_c1_st") or 0) > float(lock.get("max_c1_st") or 0) + 1e-9
        if loosened and sc["roi"] < baseline["roi"] + 5:
            continue
        if sc["roi"] > best_score["roi"] + 0.5 or (
            abs(sc["roi"] - best_score["roi"]) <= 0.5 and sc["n"] > best_score["n"]
        ):
            best_name, best_rule, best_score = name, cand, sc

    applied = False
    status = str(ops.get("status") or "live")
    note = "日次学習: 現行維持"
    min_pause_n = 20
    if baseline["n"] >= min_pause_n and baseline["roi"] < pause_below:
        status = "paused"
        note = f"日次学習: ローリングROI {baseline['roi']:.1f}% < {pause_below} のため一時停止推奨 (n={baseline['n']})"
    elif best_name != "baseline" and best_score["roi"] >= baseline["roi"] + 1.0:
        lock = apply_lock(
            lock,
            best_rule,
            f"日次自動学習 {best_name}: ROI {baseline['roi']:.1f}%→{best_score['roi']:.1f}% (n={best_score['n']})",
        )
        lock["validated_test_roi"] = round(best_score["roi"], 2)
        applied = True
        note = lock["validated_note"]
        sync_honmei_rules(lock)
        save_json(REPORTS / "locked_honmei_rule.json", lock)
        save_json(SRC_DATA / "locked_honmei_rule.json", lock)
        status = "live"
    elif baseline["n"] >= min_pause_n and baseline["roi"] < review_below:
        status = "review"
        note = f"日次学習: ローリングROI {baseline['roi']:.1f}% がレビュー閾値未満（ルールは維持）"
    elif baseline["n"] < min_pause_n:
        note = f"日次学習: サンプル不足のため監視のみ (n={baseline['n']}<{min_pause_n})"
        status = "live"

    ops = update_ops(ops, baseline.get("roi"), applied, status)
    save_json(REPORTS / "ops_live.json", ops)
    save_json(SRC_DATA / "ops_live.json", ops)

    state = {
        "learned_at": now.isoformat(),
        "rows": len(rows),
        "days": len(days),
        "baseline": baseline,
        "best": {"name": best_name, **best_score},
        "applied": applied,
        "status": status,
        "note": note,
        "policy": {
            "auto_apply_min_roi_gain_pp": 1.0,
            "min_keep_sample_ratio": 0.55,
            "no_reckless_loosening": True,
        },
    }
    save_json(REPORTS / "learning_state.json", state)
    save_json(SRC_DATA / "learning_state.json", state)
    print(json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    main()
