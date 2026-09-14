"use client";

import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STORAGE_KEY = "ai-yunduo-identity-acknowledged";

export function IdentityNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== "1");
    }
  }, []);

  const acknowledge = () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent data-testid="identity-notice">
        <AlertDialogHeader>
          <AlertDialogTitle>你好，我是云朵</AlertDialogTitle>
          <AlertDialogDescription>
            我不是心理咨询师，也不会诊断、不会开方、不做治疗性干预。我是陪伴
            你聊天的 AI 伙伴。
            <br />
            如果你现在正处于危险或想伤害自己，请立即联系学校心理中心，或拨打
            全国心理援助热线：400-161-9995。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={acknowledge}>我知道了</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
