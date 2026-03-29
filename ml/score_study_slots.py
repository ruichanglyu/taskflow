#!/usr/bin/env python3
"""
Score candidate study slots using a previously trained model.
"""

from __future__ import annotations

import argparse
import pickle
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from study_slot_ml import (
    augment_examples_with_app_context,
    augment_examples_with_context,
    build_feature_row,
    candidate_rows_to_frame,
    load_app_behavior_events,
    load_exam_deadline_map,
)
from train_study_slot_model import FEATURE_COLUMNS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score candidate study slots with the trained baseline model."
    )
    parser.add_argument(
        "--model",
        default="ml/artifacts/first-run/model.pkl",
        help="Path to a trained model.pkl artifact.",
    )
    parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help=(
            "Candidate slot in the format "
            "'weekday,start_minutes,duration_minutes,title,calendar_summary'. "
            "Repeat this flag for multiple candidates."
        ),
    )
    parser.add_argument(
        "--history-csv",
        default=None,
        help="Optional behavior_learning_schedule_events CSV for contextual features like day busyness.",
    )
    parser.add_argument(
        "--context-export",
        default=None,
        help="Optional TaskFlow full export CSV used to derive exam-date context.",
    )
    parser.add_argument(
        "--app-events-input",
        default=None,
        help="Optional behavior_learning_app_events CSV for broader productivity context.",
    )
    return parser.parse_args()


def parse_candidate(raw: str) -> dict:
    parts = [part.strip() for part in raw.split(",", 4)]
    if len(parts) != 5:
        raise ValueError(
            "Each --candidate must look like "
            "'weekday,start_minutes,duration_minutes,title,calendar_summary'."
        )

    weekday, start_minutes, duration_minutes, title, calendar_summary = parts
    return build_feature_row(
        created_at=datetime.now(timezone.utc).isoformat(),
        source="manual",
        title=title,
        calendar_summary=calendar_summary,
        weekday=int(weekday),
        start_minutes=int(start_minutes),
        duration_minutes=int(duration_minutes),
        slot_kind="current",
    )


def format_minutes(minutes: int) -> str:
    hour = (minutes // 60) % 24
    minute = minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12
    if display_hour == 0:
        display_hour = 12
    return f"{display_hour}:{minute:02d} {suffix}"


def main() -> None:
    args = parse_args()
    model_path = Path(args.model).expanduser().resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    if not args.candidate:
        raise ValueError("Pass at least one --candidate value.")

    rows = [parse_candidate(candidate) for candidate in args.candidate]
    dataset = candidate_rows_to_frame(rows)

    if args.history_csv:
        history = pd.read_csv(Path(args.history_csv).expanduser().resolve())
        history = history[history["counts_for_learning"].fillna(False).astype(bool)].copy()
    else:
        history = pd.DataFrame(columns=["created_at", "date_key", "title", "counts_for_learning"])

    exam_deadline_map = load_exam_deadline_map(args.context_export)
    dataset = augment_examples_with_context(dataset, history, exam_deadline_map)
    dataset = augment_examples_with_app_context(dataset, load_app_behavior_events(args.app_events_input))

    with model_path.open("rb") as handle:
        model = pickle.load(handle)

    probabilities = model.predict_proba(dataset[FEATURE_COLUMNS])[:, 1]
    output = dataset.copy()
    output["score"] = probabilities
    output = output.sort_values("score", ascending=False).reset_index(drop=True)

    print("Ranked study slots:")
    for index, row in output.iterrows():
        print(
            f"{index + 1}. score={row['score']:.4f} | "
            f"weekday={int(row['weekday'])} | "
            f"start={format_minutes(int(row['start_minutes']))} | "
            f"duration={int(row['duration_minutes'])}m | "
            f"days_until_exam={int(row['days_until_exam']) if int(row['days_until_exam']) >= 0 else 'unknown'} | "
            f"title={row['title']} | "
            f"calendar={row['calendar_summary']}"
        )


if __name__ == "__main__":
    main()
