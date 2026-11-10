#!/usr/bin/env python3
"""買い目を Discord Webhook へ送る。

使い方:
  export DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'
  python3 scripts/send_discord_picks.py
  python3 scripts/send_discord_picks.py --date 20261110
  python3 scripts/send_discord_picks.py --dry-run

Webhook はチャットに貼らず、環境変数または Cursor Apps の Secrets に設定する。
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
JST = timezone(timedelta(hours=9))

STADIUM_NAMES = {
    1: "桐生",
    2: "戸田",
    3: "江戸川",
    4: "平和島",
    5: "多摩川",
    6: "浜名湖",
    7: "蒲郡",
    8: "常滑",
    9: "津",
    10: "三国",
    11: "びわこ",
    12: "住之江",
    13: "尼崎",
    14: "鳴門",
    15: "丸亀",
    16: "児島",
    17: "宮島",
    18: "徳山",
    19: "下関",
    20: "若松",
    21: "芦屋",
    22: "福岡",
    23: "唐津",
    24: "大村",
}


def load_board(date_key: str | None = None) -> dict:
    if date_key:
        path = REPORTS / f"picks_{date_key}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    board_path = REPORTS / "picks_board.json"
    if board_path.exists():
        return json.loads(board_path.read_text(encoding="utf-8"))
    raise FileNotFoundError("picks_board.json がありません。先に generate_day_picks.py を実行してください。")


def format_pick(p: dict) -> str:
    stad = int(p.get("stadium") or 0)
    name = p.get("stadium_name") or STADIUM_NAMES.get(stad, f"場{stad}")
    race = p.get("race")
    tickets = p.get("tickets") or ["1-2-3"]
    status = p.get("status") or "provisional"
    status_jp = {
        "confirmed": "確定",
        "skipped": "スキップ",
        "provisional": "展示待ち",
        "odds_blocked": "オッズ回避",
    }.get(status, status)
    why = (p.get("why") or "").strip()
    line = f"・**{name} {race}R** `{'/'.join(tickets)}`（{status_jp}）"
    if status == "skipped" and p.get("skip_reason"):
        line += f"\n  └ {p.get('skip_reason')}"
    elif why:
        line += f"\n  └ {why[:120]}"
    return line


def build_message(board: dict) -> str:
    date_key = board.get("active_date") or board.get("date") or "—"
    mode = board.get("mode") or "honmei_fix_race_filter"
    picks = board.get("picks") or []
    buyable = [p for p in picks if p.get("status") != "skipped"]
    skipped = [p for p in picks if p.get("status") == "skipped"]

    lines = [
        f"**潮読み 本命買い目** `{date_key}`",
        f"モード: `{mode}` / 件数: {len(buyable)}（スキップ {len(skipped)}）",
        "",
    ]
    if not buyable:
        lines.append("本日の条件該当はありません（見送り）。")
    else:
        lines.append("**買い対象**")
        lines.extend(format_pick(p) for p in buyable)
    if skipped:
        lines.append("")
        lines.append("**スキップ**")
        lines.extend(format_pick(p) for p in skipped[:8])
    lines.append("")
    lines.append("※参考情報です。必ず勝てる保証はありません。")
    lines.append(f"送信: {datetime.now(JST).strftime('%Y-%m-%d %H:%M JST')}")
    return "\n".join(lines)


def post_webhook(url: str, content: str) -> dict:
    # Discord content max ~2000 chars
    if len(content) > 1900:
        content = content[:1890] + "\n…"
    body = json.dumps({"content": content}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "BoatYosoDiscord/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read()
        if not raw:
            return {"ok": True, "status": res.status}
        return json.loads(raw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD。省略時は picks_board.json")
    ap.add_argument("--dry-run", action="store_true", help="送信せず本文だけ表示")
    ap.add_argument("--webhook-env", default="DISCORD_WEBHOOK_URL")
    args = ap.parse_args()

    board = load_board(args.date)
    content = build_message(board)
    print(content)
    if args.dry_run:
        print("\n[dry-run] Discord には送っていません")
        return

    url = (os.environ.get(args.webhook_env) or "").strip()
    if not url:
        raise SystemExit(
            f"環境変数 {args.webhook_env} が未設定です。"
            "Discord チャンネル設定 → 連携サービス → ウェブフック でURLを発行し、"
            "環境変数に入れてから再実行してください。"
        )
    try:
        result = post_webhook(url, content)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Discord送信失敗: HTTP {e.code} {e.read()[:200]!r}") from e
    print("sent", result)


if __name__ == "__main__":
    main()
