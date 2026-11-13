#!/usr/bin/env python3
"""展示事故（進入変更・伸び・周回異常）を集計し learning_state に反映。"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SRC = ROOT / "src" / "data"
JST = timezone(timedelta(hours=9))


def load(path: Path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    store = load(REPORTS / "exhibition_incidents.json") or load(SRC / "exhibition_incidents.json") or {
        "incidents": [],
        "tallies": {},
    }
    incidents = store.get("incidents") or []
    by_kind = Counter(i.get("kind") for i in incidents)
    by_stadium_kind = Counter(f"{i.get('stadium')}:{i.get('kind')}" for i in incidents)

    # 進入変更が多い場トップ
    entry_by_stadium = Counter()
    for i in incidents:
        if i.get("kind") == "entry_change":
            entry_by_stadium[int(i.get("stadium") or 0)] += 1

    summary = {
        "learned_at": datetime.now(JST).isoformat(),
        "incident_count": len(incidents),
        "by_kind": dict(by_kind),
        "top_entry_change_stadiums": [
            {"stadium": s, "count": c} for s, c in entry_by_stadium.most_common(8) if s
        ],
        "tallies": dict(by_stadium_kind.most_common(40)),
        "policy": {
            "skip_on_entry_change": True,
            "keep_morning_tickets": True,
            "prefer_realtime_csv": True,
            "note": "展示前後で買い目券種は変えない。進入変更はスキップし事故学習へ蓄積。",
        },
    }
    save(REPORTS / "exhibition_incident_learning.json", summary)
    save(SRC / "exhibition_incident_learning.json", summary)

    # learning_state に追記
    for path in (REPORTS / "learning_state.json", SRC / "learning_state.json"):
        state = load(path, {}) or {}
        state["exhibition_incidents"] = summary
        if not state.get("note"):
            state["note"] = summary["policy"]["note"]
        else:
            if "展示前後" not in str(state.get("note")):
                state["note"] = f"{state.get('note')} / {summary['policy']['note']}"
        save(path, state)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
