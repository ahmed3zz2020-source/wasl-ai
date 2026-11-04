#!/usr/bin/env python3
"""⭐ رسالة GPT الجاهزة — تُولَّد آلياً من آخر commit منشور (ما تتقادمش).

⭐ المبدأ: ⭐ **«الأداة بتتحدّث لوحدها»** ⇒ ⭐ **الرابط بيتولَّد من آخر commit فعلي على `main`
   (مش `main` الخام ⇒ عشان الكاش مبيقدّمش نسخة قديمة) ⇒ ⭐ **والتسليم بيتحقّق من الملف المنشور نفسه.**

الاستخدام:
    python3 tools/print_gpt_msg.py                # رسالتا المراجعة (١ ثم ٢)
    python3 tools/print_gpt_msg.py 1 | 2          # رسالة واحدة
    python3 tools/print_gpt_msg.py --reply        # ⭐ سطر «راجع الردود» (جاهز للنسخ)
    python3 tools/print_gpt_msg.py --reply --check  # ⭐ + يتحقّق أن الرابط منشور وحديث
    python3 tools/print_gpt_msg.py --copy         # ينسخ رسالة ١ للـclipboard
    python3 tools/print_gpt_msg.py --copy-reply   # ⭐ ينسخ سطر «راجع الردود» للـclipboard
    python3 tools/print_gpt_msg.py --link         # سطر «اقرأ الملف ده» (البرومبت الأصلي)
    python3 tools/print_gpt_msg.py --log          # سطر «سجل الردود» (ما نُفِّذ بعد آخر برومبت)
    python3 tools/print_gpt_msg.py --commit        # آخر commit منشور + ختم «آخر ردّ»
"""
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "docs/CHATGPT-POST-REVIEW-QUERY.md"
LOG = REPO / "docs/CHATGPT-REVIEW-LOG.md"
OWNER_REPO = "ahmed3zz2020-source/wasl-ai"
BASE_RAW = f"https://raw.githubusercontent.com/{OWNER_REPO}"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36"}


def fence(heading: str) -> str:
    txt = SRC.read_text(encoding="utf-8")
    m = re.search(r"##\s*📎\s*رسالة\s*" + heading + r"[\s\S]*?```\n([\s\S]*?)\n```", txt)
    if not m:
        sys.exit(f"⛔ مفيش «رسالة {heading}» في {SRC}")
    return m.group(1)


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ""


def latest_commit() -> str:
    """⭐ آخر commit **منشور فعلاً** على `main` ⇒ الأولوية لـls-remote (حقّ remote) ثم origin/main ثم HEAD."""
    out = git("ls-remote", "origin", "main")
    if out:
        return out.split()[0]
    for ref in ("origin/main", "main", "HEAD"):
        sha = git("rev-parse", ref)
        if sha:
            return sha
    return ""


def seal() -> str:
    """⭐ ختم «آخر ردّ مُنفَّذ = #X» من السجل ⇒ دليل أن الرابط يشير للنسخة المنشورة فعلاً."""
    if not LOG.exists():
        return ""
    m = re.search(r"آخر ردّ مُنفَّذ\s*=\s*(#[٠-٩]+)", LOG.read_text(encoding="utf-8"))
    return m.group(1) if m else ""


def pinned(sha: str, name: str) -> str:
    return f"{BASE_RAW}/{sha}/docs/{name}"


def fetch(url: str, timeout: int = 30) -> tuple[int, str]:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # ⛔ الشبكة قد تفشل ⇒ لا يُفشل التسليم كله
        return 0, str(e)


def reply_block(sha: str, link: str) -> str:
    return (
        "يا ChatGPT — اقرأ سجل الردود ده (آخر رد في §٣) وراجعه نقدياً: "
        "هل كل بند طلبته اتنفّذ كما طلبت؟ وأي بند سقط أو اتنفّذ ناقصاً؟ "
        "وبعدها اكتب ملاحظاتك الجديدة بنفس الصيغة المعتادة.\n\n"
        f"{link}"
    )


def print_reply(check: bool) -> int:
    sha = latest_commit()
    if not sha:
        print("⛔ مفيش commit — الـtools/print_gpt_msg.py محتاج git.")
        return 1
    link = pinned(sha, "CHATGPT-REVIEW-LOG.md")
    main_link = f"{BASE_RAW}/main/docs/CHATGPT-REVIEW-LOG.md"
    block = reply_block(sha, link)
    print(block)
    print()
    print(f"⏺️ commit: {sha}")
    print(f"⏺️ الختم في الملف المنشور: {seal() or '؟'}")
    print(f"⏺️ بديل (نسخة تتحدّث تلقائياً مع كل commit): {main_link}")
    if not check:
        return 0
    status, body = fetch(link)
    if status != 200:
        print(f"⛔ الرابط المنشور رجّع {status} ⇒ استنى شوية وجرّب تاني (الكاش بيأخّر شوية).")
        return 1
    live = re.search(r"آخر ردّ مُنفَّذ\s*=\s*(#[٠-٩]+)", body)
    live_seal = live.group(1) if live else "؟"
    want = seal()
    if want and live_seal != want:
        print(f"⛔ النسخة المنشورة ختمها {live_seal} والمحلي {want} ⇒ الرابط مش أحدث نسخة (كاش).")
        return 1
    print(f"✅ متحقَّق: الرابط منشور (٢٠٠) وختمه {live_seal} = النسخة المحلية ⇒ ابحث/انسخ من فوق.")
    return 0


def copy_to_clipboard(body: str) -> int:
    for cmd in (["pbcopy"], ["xclip", "-selection", "clipboard"], ["wl-copy"], ["xsel", "-b", "--clipboard"]):
        if shutil.which(cmd[0]):
            p = subprocess.run(cmd, input=body, text=True)
            if p.returncode == 0:
                print("✅ اتنسخ للـclipboard")
                return 0
    print("⛔ مفيش أداة clipboard على الجهاز — النص اتطبع تحت:")
    print(body)
    return 1


def main() -> int:
    args = [a for a in sys.argv[1:]]
    check = "--check" in args
    args = [a for a in args if a != "--check"]
    arg = args[0] if args else "both"

    if arg == "--reply":
        return print_reply(check)
    if arg == "--copy-reply":
        sha = latest_commit()
        if not sha:
            print("⛔ مفيش commit")
            return 1
        return copy_to_clipboard(reply_block(sha, pinned(sha, "CHATGPT-REVIEW-LOG.md")))
    if arg == "--commit":
        print(latest_commit())
        print(seal())
        return 0
    if arg == "--link":
        print("يا ChatGPT — اقرأ الملف ده (فيه رسالتين جاهزتين بالترتيب: رسالة ١ ثم رسالة ٢) ونفّذهم:\n")
        print(f"{BASE_RAW}/main/docs/CHATGPT-POST-REVIEW-QUERY.md")
        return 0
    if arg == "--log":
        if not LOG.exists():
            sys.exit(f"⛔ مفيش سجل الردود: {LOG}")
        print("يا ChatGPT — ده سجل الردود على مراجعاتك (أنا اللي كاتبه). "
              "اقرأه: آخر رد مُنفَّذ في §٣، والسجل المختصر في §٢. "
              "بهذا تعرف بالظبط إيه اللي اتنفّذ بعد آخر برومبت لك.\n")
        print(f"{BASE_RAW}/main/docs/CHATGPT-REVIEW-LOG.md")
        print()
        print(" وبعد ما تقراه: راجع الردود السابقة نقدياً — "
              "هل كل بند طلبته اتنفّذ كما طلبت؟ وأي بند سقط أو اتنفّذ ناقصاً؟ "
              "واكتب ملاحظاتك بنفس الصيغة المعتادة.")
        return 0
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
