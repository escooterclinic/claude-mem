#!/usr/bin/env python3
"""Build and atomically publish a deployment from the latest stable upstream tag."""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
STABLE = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def run(*args, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{args[0]} failed")
    return result.stdout.strip()


def version(tag):
    match = STABLE.fullmatch(tag)
    return tuple(map(int, match.groups())) if match else None


def write_status(path, status):
    path.parent.mkdir(parents=True, exist_ok=True)
    status["at"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        json.dump(status, stream, indent=2)
        stream.write("\n")
        temporary = stream.name
    os.replace(temporary, path)


def options():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deployment")
    parser.add_argument("--publish-url", required=True)
    parser.add_argument("--publish-branch", required=True)
    parser.add_argument("--upstream-url", default="https://github.com/thedotmack/claude-mem.git")
    parser.add_argument("--status-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def repository(temp, args):
    repo = temp / "repository"
    run("git", "init", "--quiet", str(repo))
    run("git", "-C", str(repo), "fetch", "--quiet", "--no-tags", args.upstream_url, "refs/tags/*:refs/tags/*")
    return repo


def published_tip(repo, args):
    ref = f"refs/heads/{args.publish_branch}"
    output = run("git", "ls-remote", "--heads", args.publish_url, ref)
    if not output:
        return None, None
    run("git", "-C", str(repo), "fetch", "--quiet", "--no-tags", args.publish_url, ref)
    tip = run("git", "-C", str(repo), "rev-parse", "FETCH_HEAD")
    raw = run("git", "-C", str(repo), "show", f"{tip}:plugin/.claude-plugin/plugin.json")
    published = json.loads(raw)["version"]
    if version("v" + published) is None:
        raise ValueError("published plugin version is not stable semver")
    return tip, published


def extract(repo, tag, tree):
    tree.mkdir()
    archive = tree.parent / "upstream.tar"
    run("git", "-C", str(repo), "archive", "--format=tar", f"--output={archive}", tag)
    run("tar", "-xf", str(archive), "-C", str(tree))


def review_files(manifest, tree):
    tree = tree.resolve()
    failures = []
    for line in manifest.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        action, target, expected, _payload = line.split("\t")
        path = tree / target
        if Path(target).is_absolute() or ".." in Path(target).parts or not path.parent.resolve().is_relative_to(tree):
            raise ValueError(f"unsafe manifest path: {target}")
        exists = path.exists() or path.is_symlink()
        mismatch = exists if action == "add" else not path.is_file() or path.is_symlink()
        if action in {"replace", "delete"} and not mismatch:
            mismatch = hashlib.sha256(path.read_bytes()).hexdigest() != expected
        if mismatch:
            failures.append(target)
    return failures


def build_overlay(overlay, tree, out, temp, deployment):
    env = dict(os.environ, OVERLAYS_ROOT=str(overlay.parent), OVERLAY_SKIP_BUILD="0")
    run("bash", str(ROOT / "apply.sh"), deployment, str(tree), str(out), env=env)


def verify_tree(out, tag):
    manifest = json.loads((out / ".claude-plugin/marketplace.json").read_text())
    if not manifest.get("name") or not isinstance(manifest.get("plugins"), list) or not manifest["plugins"]:
        raise ValueError("deployment root is not a Claude Code marketplace")
    published = json.loads((out / "plugin/.claude-plugin/plugin.json").read_text())["version"]
    if published != tag[1:]:
        raise ValueError("built plugin version differs from upstream tag")


def commit_tree(repo, out, tip, args, tag, manifest):
    # Force-add generated bundles, then explicitly exclude build-only directories.
    for directory, names, _files in os.walk(out, topdown=True):
        for name in list(names):
            if name in {"node_modules", ".git", ".overlay-build"}:
                path = Path(directory) / name
                path.unlink() if path.is_symlink() else shutil.rmtree(path)
                names.remove(name)
    git = ("git", "--git-dir", str(repo / ".git"), "--work-tree", str(out))
    run(*git, "read-tree", "--empty")
    run(*git, "add", "--force", "--all", ".", cwd=out)
    tree = run(*git, "write-tree")
    digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
    message = f"Deploy {args.deployment} from upstream {tag}; manifest sha256 {digest}"
    parents = ("-p", tip) if tip else ()
    env = dict(os.environ, GIT_AUTHOR_NAME="Overlay publisher", GIT_AUTHOR_EMAIL="overlay@localhost",
               GIT_COMMITTER_NAME="Overlay publisher", GIT_COMMITTER_EMAIL="overlay@localhost")
    return run(*git, "commit-tree", tree, *parents, "-m", message, env=env)


def advance(args, status, temp):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.deployment):
        raise ValueError("invalid deployment name")
    run("git", "check-ref-format", f"refs/heads/{args.publish_branch}")
    overlay = Path(os.environ.get("OVERLAYS_ROOT", ROOT)).resolve() / args.deployment
    manifest = overlay / "manifest.tsv"
    repo = repository(temp, args)
    tags = sorted(filter(version, run("git", "-C", str(repo), "tag").splitlines()), key=version)
    if not tags:
        raise ValueError("upstream has no stable release tags")
    latest = status["upstream_latest"] = tags[-1]
    tip, status["published"] = published_tip(repo, args)
    previous = version("v" + status["published"]) if status["published"] else (-1, -1, -1)
    status["releases_behind"] = sum(version(tag) > previous for tag in tags)
    if previous == version(latest):
        # Up to date means the published tree carries THIS overlay, not merely this upstream
        # version. MEASURED 2026-10-03: an org overlay change merged on v13.29.0 was reported
        # "up-to-date" and never published, because only the version was compared. The commit
        # message records the manifest digest it was built from, so compare that too.
        digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
        message = run("git", "-C", str(repo), "log", "-1", "--format=%B", tip)
        if f"manifest sha256 {digest}" in message:
            status.update(ok=True, stage="up-to-date")
            return 3
        return prepare(repo, overlay, manifest, latest, tip, args, status, temp,
                       tag_suffix=f"-overlay-{digest[:12]}")
    if previous > version(latest):
        raise ValueError("published version is newer than upstream; refusing downgrade")
    return prepare(repo, overlay, manifest, latest, tip, args, status, temp)


def prepare(repo, overlay, manifest, latest, tip, args, status, temp, tag_suffix=""):
    tree, out = temp / "upstream", temp / "output"
    extract(repo, latest, tree)
    status["stage"] = "overlay-review"
    status["files_needing_review"] = review_files(manifest, tree)
    if status["files_needing_review"]:
        status["error"] = "upstream overlay targets changed"
        return 2
    status["stage"] = "build"
    build_overlay(overlay, tree, out, temp, args.deployment)
    status["stage"] = "test"
    if (overlay / "test.sh").is_file():
        run("bash", str(overlay / "test.sh"), str(out), cwd=out)
    verify_tree(out, latest)
    status["stage"] = "publish"
    commit = commit_tree(repo, out, tip, args, latest, manifest)
    if args.dry_run:
        status.update(ok=True, stage="dry-run")
        return 0
    run("git", "-C", str(repo), "push", "--atomic", args.publish_url,
        f"{commit}:refs/heads/{args.publish_branch}", f"{commit}:refs/tags/{args.deployment}/{latest}{tag_suffix}")
    status.update(ok=True, stage="published", published=latest[1:], releases_behind=0)
    return 0


def main():
    args = options()
    path = args.status_file or Path.cwd() / ".overlay-build" / f"{args.deployment}-status.json"
    status = dict(deployment=args.deployment, upstream_latest=None, published=None,
                  releases_behind=0, ok=False, stage="fetch", error=None, files_needing_review=[], at=None)
    try:
        with tempfile.TemporaryDirectory(prefix="overlay-advance-") as temporary:
            code = advance(args, status, Path(temporary))
    except Exception as exc:
        status["error"] = str(exc)
        code = 1
    write_status(path, status)
    print(json.dumps(status))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
