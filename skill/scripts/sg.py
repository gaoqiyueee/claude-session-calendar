#!/usr/bin/env python3
"""sg：读写 Claude Code 会话 / 项目的目标、状态、完成度。和 CloudCLI「会话日历」插件共用数据。

数据目录 ~/.claude/session-goals/
  sessions/<会话ID>.json
  projects/<sha1(项目路径)[:16]>.json

用法：
  sg.py show                               查看当前会话和所在项目的记录
  sg.py goal "目标"        [--project]      设目标
  sg.py status 挂起        [--project]      设状态：进行中 / 等待 / 挂起 / 已完成 / 已放弃
  sg.py eval --progress 60 --note "…" [--status 进行中] [--project]   写一次自评
  sg.py list [--open] [--here]             列出有记录的会话（--open 只看未完结的，--here 只看当前项目）
通用参数：--session <ID>（默认取 $CLAUDE_CODE_SESSION_ID） --by user|ai（默认 ai）
"""
import argparse
import glob
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/.claude/session-goals")
PROJECTS_LOG = os.path.expanduser("~/.claude/projects")
HISTORY_LIMIT = 50

STATUS = {"doing": "进行中", "waiting": "等待", "paused": "挂起", "done": "已完成", "dropped": "已放弃"}
ALIASES = {
    "进行": "doing", "进行中": "doing", "doing": "doing",
    "等待": "waiting", "等待中": "waiting", "waiting": "waiting",
    "挂起": "paused", "暂停": "paused", "paused": "paused",
    "完成": "done", "已完成": "done", "done": "done",
    "放弃": "dropped", "已放弃": "dropped", "dropped": "dropped",
}


class SgError(Exception):
    pass


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def project_key(path):
    return hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]


def record_path(kind, key):
    name = key if kind == "sessions" else project_key(key)
    if kind == "sessions" and not all(c.isalnum() or c == "-" for c in key):
        raise SgError(f"会话 ID 不合法：{key}")
    return os.path.join(ROOT, kind, name + ".json")


def load(kind, key):
    try:
        with open(record_path(kind, key), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"id": key, "goal": "", "status": "", "progress": None, "note": "",
                "updated_at": "", "history": []}


def save(kind, rec):
    path = record_path(kind, rec["id"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rec["history"] = rec["history"][-HISTORY_LIMIT:]
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def update(kind, key, by, **fields):
    rec = load(kind, key)
    if kind == "sessions" and not rec.get("project"):
        rec["project"] = session_cwd(key)
    changes = {k: v for k, v in fields.items() if v is not None}
    rec.update(changes)
    rec["updated_at"] = now_iso()
    rec["history"].append({"at": rec["updated_at"], "by": by, **changes})
    save(kind, rec)
    return rec


def current_session(args):
    sid = args.session or os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not sid:
        raise SgError("拿不到会话 ID：不在 Claude Code 里运行时请加 --session <ID>")
    return sid


def session_cwd(sid):
    """从会话日志里读启动目录，和 CloudCLI 的项目路径一致。"""
    for path in glob.glob(os.path.join(PROJECTS_LOG, "*", sid + ".jsonl")):
        with open(path, encoding="utf-8") as f:
            for line in f:
                if '"cwd"' in line:
                    try:
                        return json.loads(line)["cwd"]
                    except (json.JSONDecodeError, KeyError):
                        continue
    return os.getcwd()


def target(args):
    sid = current_session(args)
    if args.project:
        return "projects", session_cwd(sid)
    return "sessions", sid


def parse_status(text):
    if text is None:
        return None
    key = ALIASES.get(text.strip().lower())
    if not key:
        raise SgError(f"未知状态：{text}。可选：{' / '.join(STATUS.values())}")
    return key


def describe(title, rec):
    lines = [f"[{title}]"]
    lines.append(f"  目标：{rec['goal'] or '（未设）'}")
    lines.append(f"  状态：{STATUS.get(rec['status'], '（未设）')}")
    prog = rec.get("progress")
    lines.append(f"  完成度：{'（未评）' if prog is None else str(prog) + '%'}")
    if rec.get("note"):
        lines.append(f"  最近自评：{rec['note']}")
    if rec.get("updated_at"):
        lines.append(f"  更新于：{rec['updated_at']}")
    return "\n".join(lines)


def cmd_show(args):
    sid = current_session(args)
    cwd = session_cwd(sid)
    print(describe(f"会话 {sid}", load("sessions", sid)))
    print(describe(f"项目 {cwd}", load("projects", cwd)))


def cmd_list(args):
    here = session_cwd(current_session(args)) if args.here else None
    rows = []
    for path in glob.glob(os.path.join(ROOT, "sessions", "*.json")):
        with open(path, encoding="utf-8") as f:
            rec = json.load(f)
        if args.open and rec.get("status") in ("done", "dropped"):
            continue
        if here and rec.get("project") != here:
            continue
        rows.append(rec)
    rows.sort(key=lambda r: r.get("updated_at", ""), reverse=True)
    if not rows:
        print("没有记录。")
    for r in rows:
        prog = "" if r.get("progress") is None else f" {r['progress']}%"
        print(f"{STATUS.get(r.get('status'), '未设'):<4}{prog:>5}  {r['id'][:8]}  {r.get('goal') or '（无目标）'}")


def main(argv):
    p = argparse.ArgumentParser(prog="sg.py", description="会话目标 / 状态 / 完成度")
    # 通用参数挂在每个子命令上，写在子命令前后都行
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--session")
    common.add_argument("--by", choices=["user", "ai"], default="ai")
    common.add_argument("--project", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show", parents=[common])
    g = sub.add_parser("goal", parents=[common])
    g.add_argument("text")
    s = sub.add_parser("status", parents=[common])
    s.add_argument("value")
    e = sub.add_parser("eval", parents=[common])
    e.add_argument("--progress", type=int, required=True)
    e.add_argument("--note", required=True)
    e.add_argument("--status")
    ls = sub.add_parser("list", parents=[common])
    ls.add_argument("--open", action="store_true")
    ls.add_argument("--here", action="store_true")
    args = p.parse_args(argv)

    try:
        if args.cmd == "show":
            cmd_show(args)
        elif args.cmd == "list":
            cmd_list(args)
        elif args.cmd == "goal":
            kind, key = target(args)
            print(describe(key, update(kind, key, args.by, goal=args.text.strip())))
        elif args.cmd == "status":
            kind, key = target(args)
            print(describe(key, update(kind, key, args.by, status=parse_status(args.value))))
        elif args.cmd == "eval":
            if not 0 <= args.progress <= 100:
                raise SgError("--progress 必须在 0 到 100 之间")
            kind, key = target(args)
            rec = update(kind, key, args.by, progress=args.progress, note=args.note.strip(),
                         status=parse_status(args.status))
            print(describe(key, rec))
    except SgError as err:
        print(f"错误：{err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
