import type { ChatBandTicket, ChatMessage, ChatRaceChip } from "@/lib/chatStore";
import { fetchDayResults, hasRaceResult, resultKey } from "@/lib/raceResults";
import { STADIUMS } from "@/lib/stadiums";

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function withTicketResult(
  ticket: ChatBandTicket,
  trifecta: Record<string, number>,
): ChatBandTicket {
  const payout = Number(trifecta[ticket.combo] || 0);
  return {
    ...ticket,
    result: payout > 0 ? "hit" : "miss",
    payout,
  };
}

function enrichChip(
  chip: ChatRaceChip,
  trifecta: Record<string, number>,
  finishCombo: string | null,
): ChatRaceChip {
  const bands = chip.bands
    ? {
        honmei: (chip.bands.honmei || []).map((t) => withTicketResult(t, trifecta)),
        honmeiSSingle: (chip.bands.honmeiSSingle || []).map((t) =>
          withTicketResult(t, trifecta),
        ),
        honmeiS: (chip.bands.honmeiS || []).map((t) => withTicketResult(t, trifecta)),
        oshi: (chip.bands.oshi || []).map((t) => withTicketResult(t, trifecta)),
        ana: (chip.bands.ana || []).map((t) => withTicketResult(t, trifecta)),
      }
    : undefined;

  const fromBands = [
    ...(bands?.honmei || []),
    ...(bands?.honmeiSSingle || []),
    ...(bands?.honmeiS || []),
    ...(bands?.oshi || []),
    ...(bands?.ana || []),
  ].map((t) => t.combo);
  const tickets = [
    ...new Set([...(chip.tickets || []).map(String).filter(Boolean), ...fromBands]),
  ];

  const settledTickets = tickets.map((combo) => {
    const payout = Number(trifecta[combo] || 0);
    return {
      combo,
      result: (payout > 0 ? "hit" : "miss") as "hit" | "miss",
      payout,
    };
  });

  const hitCount = settledTickets.filter((t) => t.result === "hit").length;
  const hitPay = settledTickets.reduce((s, t) => s + (t.payout || 0), 0);
  const whyBits = [
    finishCombo ? `着順 ${finishCombo}` : null,
    hitCount
      ? `的中 ${hitCount}点 / 払戻合計 ${yen(hitPay)}`
      : tickets.length
        ? "的中なし"
        : null,
  ].filter(Boolean);

  return {
    ...chip,
    tickets,
    bands,
    settled: true,
    finishCombo: finishCombo || undefined,
    ticketResults: settledTickets,
    status: "settled",
    exhibition: "after",
    why: whyBits.length ? whyBits.join(" / ") : chip.why,
  };
}

/**
 * レース結果が出ている買い目カードへ 的中/不的中と払戻を重ねる。
 * DBのメッセージ自体は更新せず、配信レスポンス上で展示待ちを結果表示へ置き換える。
 */
export async function enrichChatMessagesWithResults(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const dates = new Set<string>();
  for (const m of messages) {
    const date = String(m.meta?.date || "");
    if (/^\d{8}$/.test(date)) dates.add(date);
  }
  if (!dates.size) return messages;

  const byDate = new Map<string, Awaited<ReturnType<typeof fetchDayResults>>>();
  await Promise.all(
    [...dates].map(async (date) => {
      byDate.set(date, await fetchDayResults(date));
    }),
  );

  return messages.map((m) => {
    const date = String(m.meta?.date || "");
    if (!/^\d{8}$/.test(date)) return m;
    const day = byDate.get(date);
    if (!day?.size) return m;

    const races = Array.isArray(m.meta?.races) ? m.meta!.races! : [];
    if (races.length) {
      let changed = false;
      const nextRaces = races.map((chip) => {
        const res = day.get(resultKey(chip.placeNo, chip.raceNo));
        // results/v3 の空スタブは無視。着順 or 払戻があるときだけ結果表示へ。
        if (!res || !hasRaceResult(res)) return chip;
        changed = true;
        return enrichChip(chip, res.trifecta, res.finishCombo);
      });
      if (!changed) return m;
      return {
        ...m,
        meta: {
          ...m.meta,
          races: nextRaces,
        },
      };
    }

    // races 無しの単レース投稿
    const placeNo = Number(m.meta?.placeNo || 0);
    const raceNo = Number(m.meta?.raceNo || 0);
    if (!placeNo || !raceNo) return m;
    const res = day.get(resultKey(placeNo, raceNo));
    if (!res || !hasRaceResult(res)) return m;

    const tickets = (m.meta?.tickets || []).map(String).filter(Boolean);
    const bands = m.meta?.bands
      ? {
          honmei: (m.meta.bands.honmei || []).map((t) => withTicketResult(t, res.trifecta)),
          honmeiSSingle: (m.meta.bands.honmeiSSingle || []).map((t) =>
            withTicketResult(t, res.trifecta),
          ),
          honmeiS: (m.meta.bands.honmeiS || []).map((t) => withTicketResult(t, res.trifecta)),
          oshi: (m.meta.bands.oshi || []).map((t) => withTicketResult(t, res.trifecta)),
          ana: (m.meta.bands.ana || []).map((t) => withTicketResult(t, res.trifecta)),
        }
      : undefined;

    return {
      ...m,
      meta: {
        ...m.meta,
        bands,
        tickets,
        races: [
          enrichChip(
            {
              placeNo,
              placeName: STADIUMS[placeNo] || `場${placeNo}`,
              raceNo,
              label: m.meta?.race_label || `${STADIUMS[placeNo] || placeNo} ${raceNo}R`,
              tickets,
              bands: m.meta?.bands,
              status: "provisional",
              exhibition: "waiting",
              why: undefined,
              confidence: m.meta?.confidence,
              confidenceLabel: m.meta?.confidenceLabel,
            },
            res.trifecta,
            res.finishCombo,
          ),
        ],
      },
    };
  });
}

function raceKeyOf(placeNo: number, raceNo: number): string {
  return `${placeNo}:${raceNo}`;
}

/**
 * 展示後に確定したレースは、朝の「展示待ち」チップも購入OK表示へ更新する。
 * liveTargets（本日の本命対象）の status も反映する。
 */
export function enrichWaitingWithExhibitionConfirmed(
  messages: ChatMessage[],
  liveTargets?: Array<{ stadium: number; race: number; status: string }>,
): ChatMessage[] {
  const finals = new Map<string, "confirmed" | "skipped">();

  for (const t of liveTargets || []) {
    const key = raceKeyOf(t.stadium, t.race);
    if (t.status === "skipped") finals.set(key, "skipped");
    else if (t.status === "confirmed") finals.set(key, "confirmed");
  }

  for (const m of messages) {
    for (const chip of m.meta?.races || []) {
      const key = raceKeyOf(chip.placeNo, chip.raceNo);
      if (chip.status === "skipped") finals.set(key, "skipped");
      else if (chip.status === "confirmed" || chip.exhibition === "after") {
        if (finals.get(key) !== "skipped") finals.set(key, "confirmed");
      }
    }
  }

  if (!finals.size) return messages;

  return messages.map((m) => {
    const races = m.meta?.races;
    if (!races?.length) return m;
    let changed = false;
    const next = races.map((chip) => {
      if (chip.settled || chip.status === "settled" || chip.finishCombo) return chip;
      if (chip.status === "confirmed" || chip.status === "skipped") return chip;
      const fin = finals.get(raceKeyOf(chip.placeNo, chip.raceNo));
      if (!fin) return chip;
      changed = true;
      return {
        ...chip,
        status: fin,
        exhibition: "after" as const,
      };
    });
    if (!changed) return m;
    return { ...m, meta: { ...m.meta, races: next } };
  });
}
