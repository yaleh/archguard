#!/usr/bin/env python3
"""
Extract risk factors from git log for all source files in a project.
Computes per-file churn, authorCount, ownerConcentration, cochangeBreadth, recency, riskScore.

Usage:
    python3 extract-risk.py <repo_path> <file_extension> <output_csv>

Examples:
    python3 extract-risk.py /home/yale/work/archguard ts risk-scores-archguard.csv
    python3 extract-risk.py /home/yale/work/meta-cc go risk-scores-meta-cc.csv
"""

import sys
import subprocess
import math
import csv
import os
from collections import defaultdict
from datetime import datetime, timezone

RISK_WEIGHTS = {
    "churn": 0.25,
    "authorCount": 0.20,
    "ownerConcentration": 0.20,
    "cochangeBreadth": 0.15,
    "recency": 0.20,
}

SINCE_DAYS = 90


def run_git_log(repo_path: str, ext: str) -> str:
    """Run git log to get commit history for files with given extension."""
    pattern = f"*.{ext}"
    cmd = [
        "git", "-C", repo_path,
        "log",
        f"--since={SINCE_DAYS} days ago",
        "--format=COMMIT|%H|%ae|%ai",
        "--name-only",
        "--",
        pattern,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def parse_git_log(log_output: str):
    """
    Parse git log output into per-file metrics.
    Returns dict: file_path -> {'commits': [{'sha','author','date'}]}
    Also returns commit_to_files dict for co-change computation.
    """
    file_commits = defaultdict(list)  # file -> list of (sha, author, date)
    commit_to_files = defaultdict(list)  # sha -> list of files

    current_commit = None
    for line in log_output.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("COMMIT|"):
            parts = line.split("|", 3)
            if len(parts) >= 4:
                current_commit = {
                    "sha": parts[1],
                    "author": parts[2],
                    "date": parts[3].split(" ")[0],  # YYYY-MM-DD
                }
        elif current_commit and line:
            file_commits[line].append(current_commit)
            commit_to_files[current_commit["sha"]].append(line)

    return file_commits, commit_to_files


def compute_cochange_breadth(file_path: str, commit_to_files: dict, file_commits: dict) -> float:
    """
    Compute co-change breadth: normalized count of distinct files that co-changed.
    Approximation: # unique other files seen in same commits / max(1, total_files-1)
    """
    cochanged = set()
    for c in file_commits.get(file_path, []):
        for other in commit_to_files.get(c["sha"], []):
            if other != file_path:
                cochanged.add(other)
    total_files = max(1, len(file_commits) - 1)
    return min(1.0, len(cochanged) / total_files)


def log_normalize(value: float, scale: float = 10.0) -> float:
    """Log-normalize a raw count value to [0,1]."""
    if value <= 0:
        return 0.0
    return min(1.0, math.log1p(value) / math.log1p(scale))


def compute_recency(last_date_str: str, since_days: int = 90) -> float:
    """
    Recency factor: recent activity = higher risk.
    0 = not changed recently, 1 = changed today.
    """
    try:
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        days_ago = max(0, (now - last_date).days)
        # Recent = high risk (inverse of staleness)
        return max(0.0, 1.0 - days_ago / since_days)
    except (ValueError, TypeError):
        return 0.0


def extract_risk_scores(repo_path: str, ext: str) -> list:
    """Extract risk scores for all files in repo with given extension."""
    log_output = run_git_log(repo_path, ext)
    if not log_output.strip():
        print(f"  WARNING: No git log output for *.{ext} in {repo_path}", file=sys.stderr)
        return []

    file_commits, commit_to_files = parse_git_log(log_output)
    print(f"  Found {len(file_commits)} files with commits", file=sys.stderr)

    if not file_commits:
        return []

    # Find max churn for normalization
    max_churn = max(len(commits) for commits in file_commits.values())
    max_author_count = max(
        len(set(c["author"] for c in commits)) for commits in file_commits.values()
    )

    rows = []
    for file_path, commits in file_commits.items():
        churn_raw = len(commits)
        authors = set(c["author"] for c in commits)
        author_count_raw = len(authors)

        # Primary owner: author with most commits
        author_commit_counts = defaultdict(int)
        for c in commits:
            author_commit_counts[c["author"]] += 1
        primary_author = max(author_commit_counts, key=author_commit_counts.get)
        primary_share = author_commit_counts[primary_author] / max(1, churn_raw)

        # Factor values
        churn_factor = log_normalize(churn_raw, max(10, max_churn))
        author_factor = log_normalize(author_count_raw, max(5, max_author_count))
        owner_conc = 1.0 - primary_share  # LOW owner share = HIGH risk
        cochange = compute_cochange_breadth(file_path, commit_to_files, file_commits)

        # Recency: last commit date
        last_date = max(c["date"] for c in commits)
        recency_factor = compute_recency(last_date)

        # Composite risk score
        risk_score = (
            churn_factor * RISK_WEIGHTS["churn"]
            + author_factor * RISK_WEIGHTS["authorCount"]
            + owner_conc * RISK_WEIGHTS["ownerConcentration"]
            + cochange * RISK_WEIGHTS["cochangeBreadth"]
            + recency_factor * RISK_WEIGHTS["recency"]
        )

        rows.append({
            "file": file_path,
            "churn_raw": churn_raw,
            "churn": round(churn_factor, 4),
            "authorCount": round(author_factor, 4),
            "authorCount_raw": author_count_raw,
            "primaryOwnerShare": round(primary_share, 4),
            "ownerConcentration": round(owner_conc, 4),
            "cochangeBreadth": round(cochange, 4),
            "recency": round(recency_factor, 4),
            "lastCommitDate": last_date,
            "riskScore": round(risk_score, 4),
        })

    # Sort by riskScore descending
    rows.sort(key=lambda r: r["riskScore"], reverse=True)
    return rows


def main():
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <repo_path> <ext> <output_csv>")
        sys.exit(1)

    repo_path = sys.argv[1]
    ext = sys.argv[2]
    output_csv = sys.argv[3]

    print(f"Extracting risk scores from {repo_path} (*.{ext}) -> {output_csv}", file=sys.stderr)

    rows = extract_risk_scores(repo_path, ext)

    if not rows:
        print(f"  ERROR: No data extracted", file=sys.stderr)
        sys.exit(1)

    fieldnames = [
        "file", "churn_raw", "churn", "authorCount_raw", "authorCount",
        "primaryOwnerShare", "ownerConcentration", "cochangeBreadth",
        "recency", "lastCommitDate", "riskScore"
    ]

    with open(output_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"  Wrote {len(rows)} rows to {output_csv}", file=sys.stderr)
    print(f"  Top 5 files by risk:")
    for r in rows[:5]:
        print(f"    {r['riskScore']:.3f} {r['file']} (churn={r['churn_raw']}, authors={r['authorCount_raw']})", file=sys.stderr)


if __name__ == "__main__":
    main()
