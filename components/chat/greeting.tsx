"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const DEFAULT_OPENING = "今天想从哪里聊起都可以。";

export const Greeting = () => {
  const [opening, setOpening] = useState(DEFAULT_OPENING);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/memory/opening`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as { opening?: string };
      })
      .then((data) => {
        if (data?.opening) {
          setOpening(data.opening);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {opening}
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-center text-muted-foreground/80 text-sm"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        不用整理好再说，想到什么都可以。
      </motion.div>
    </div>
  );
};
