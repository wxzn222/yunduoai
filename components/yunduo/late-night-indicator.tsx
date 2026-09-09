"use client";

import { useEffect, useState } from "react";

import { isLateNightShanghai } from "@/lib/ai/yunduo/late-night";

export function LateNightIndicator() {
  const [isLateNight, setIsLateNight] = useState(
    () => process.env.NEXT_PUBLIC_LATE_NIGHT_FORCE === "1"
  );

  useEffect(() => {
    const update = () => {
      setIsLateNight(
        process.env.NEXT_PUBLIC_LATE_NIGHT_FORCE === "1" ||
          isLateNightShanghai(new Date())
      );
    };

    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!isLateNight) {
    return null;
  }

  return (
    <p
      className="py-1 text-center text-xs text-muted-foreground/70"
      data-testid="late-night-indicator"
    >
      深夜陪伴中 · 我在，慢慢说
    </p>
  );
}
