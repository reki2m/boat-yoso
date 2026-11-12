export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMorningHonmeiScheduler } = await import("@/lib/chatMorningPicks");
  startMorningHonmeiScheduler();
  // 重い Python 日次ジョブはプロセス内スケジューラで回さず、
  // CRON_SECRET 付き /api/cron/main-daily からのみ起動する（公開環境の負荷・追跡肥大を避ける）
  if (process.env.ENABLE_MAIN_DAILY_SCHEDULER === "1") {
    const { startMainAppDailyScheduler } = await import("@/lib/mainAppDaily");
    startMainAppDailyScheduler();
  }
}
