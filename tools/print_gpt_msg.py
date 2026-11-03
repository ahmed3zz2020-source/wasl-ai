#!/usr/bin/env python3
"""طبع رسالة GPT الجاهزة في الطرفية — بديل غرفة الإرسال.

الاستخدام:
    python3 print_gpt_msg.py          # يطبع الرسالتين
    python3 print_gpt_msg.py 1        # يطبع رسالة ١ بس
    python3 print_gpt_msg.py 2        # يطبع رسالة ٢ بس
    python3 print_gpt_msg.py --copy   # ينسخ رسالة ١ للـclipboard
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

SRC = Path("/workspace/wasl-ai/docs/CHATGPT-POST-REVIEW-QUERY.md")


def fence(heading: str) -> str:
    txt = SRC.read_text(encoding="utf-8")
    m = re.search(r"##\s*📎\s*رسالة\s*" + heading + r"[\s\S]*?```\n([\s\S]*?)\n```", txt)
    if not m:
        sys.exit(f"⛔ مفيش «رسالة {heading}» في {SRC}")
    return m.group(1)


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "both"
    if arg == "1":
        print(fence("١"))
    elif arg == "2":
        print(fence("٢"))
    elif arg == "--copy":
        body = fence("١")
        for cmd in (["pbcopy"], ["xclip", "-selection", "clipboard"], ["wl-copy"],
                    ["xsel", "-b", "--clipboard"]):
            if shutil.which(cmd[0]):
                p = subprocess.run(cmd, input=body, text=True)
                if p.returncode == 0:
                    print("✅ رسالة ١ اتنسخت للـclipboard")
                    return 0
        print("⛔ مفيش أداة clipboard على الجهاز — الـmessage اتطبع تحت:")
        print(body)
        return 1
    else:
        print("═══ رسالة ١ — تُرسل أولاً ═══\n")
        print(fence("١"))
        print("\n\n═══ رسالة ٢ — في نفس المحادثة ═══\n")
        print(fence("٢"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
