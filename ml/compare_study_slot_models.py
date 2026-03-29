#!/usr/bin/env python3
"""
Compare the current heuristic slot scoring against the first ML baseline.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score

from train_study_slot_model import (
    FEATURE_COLUMNS,
    augment_examples_with_context,
    build_model,
    chronological_split,
    derive_examples,
)
from study_slot_ml import load_exam_deadline_map
from study_slot_ml import augment_examples_with_app_context, load_app_behavior_events


@dataclass
class BehaviorEvent:
    source: str
    action: str
    date_key: str
    weekday: int
    start_minutes: int
    duration_minutes: int
    previous_date_key: str | None
    previous_weekday: int | None
    previous_start_minutes: int | None
    previous_duration_minutes: int | None
    counts_for_learning: bool
    created_at: pd.Timestamp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare the ML study-slot classifier against the current heuristic baseline."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to an exported behavior_learning_schedule_events CSV.",
    )
    parser.add_argument(
        "--output",
        default="ml/artifacts/first-run/comparison.json",
        help="Where to write the comparison report.",
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


def bucket_minutes(value: int) -> int:
    bucket = round(value / 15) * 15
    return max(0, min(bucket, 23 * 60 + 45))


def build_score_maps(events: list[BehaviorEvent]):
    weekday_scores = [dict() for _ in range(7)]
    overall_scores: dict[int, float] = {}

    def add_score(weekday: int, minute: int, score: float) -> None:
      bucket = bucket_minutes(minute)
      weekday_scores[weekday][bucket] = weekday_scores[weekday].get(bucket, 0.0) + score
      overall_scores[bucket] = overall_scores.get(bucket, 0.0) + score

    for event in events:
        if not event.counts_for_learning:
            continue
        is_ai = event.source == "ai"
        if event.action == "create":
            add_score(event.weekday, event.start_minutes, 1 if is_ai else 2)
            continue
        if event.action == "delete":
            add_score(event.weekday, event.start_minutes, -3)
            continue
        if event.action == "reschedule":
            add_score(event.weekday, event.start_minutes, 1 if is_ai else 2)
            if event.previous_weekday is not None and event.previous_start_minutes is not None:
                add_score(event.previous_weekday, event.previous_start_minutes, -2)

    return weekday_scores, overall_scores


def score_study_slot(events: list[BehaviorEvent], date_key: str, start_minutes: int, duration_minutes: int) -> float:
    date = pd.to_datetime(f"{date_key}T00:00:00", utc=False, errors="coerce")
    if pd.isna(date):
        return 0.0

    bucket = bucket_minutes(start_minutes)
    duration_bias = 0.2 if duration_minutes >= 90 else 0.0
    weekday_scores, overall_scores = build_score_maps(events)
    weekday = int(date.dayofweek + 1) % 7
    weekday_score = weekday_scores[weekday].get(bucket, 0.0)
    overall_score = overall_scores.get(bucket, 0.0)
    return weekday_score * 1.6 + overall_score * 0.5 + duration_bias


def load_raw_events(path: Path) -> pd.DataFrame:
    raw = pd.read_csv(path)
    raw = raw[raw["counts_for_learning"].fillna(False).astype(bool)].copy()
    raw["created_at"] = pd.to_datetime(raw["created_at"], utc=True, errors="coerce")
    raw = raw.dropna(subset=["created_at"]).sort_values("created_at").reset_index(drop=True)
    return raw


def to_behavior_events(raw: pd.DataFrame) -> list[BehaviorEvent]:
    events: list[BehaviorEvent] = []
    for _, row in raw.iterrows():
        events.append(
            BehaviorEvent(
                source=str(row.get("source", "manual")),
                action=str(row.get("action", "")),
                date_key=str(row.get("date_key", "")),
                weekday=int(row.get("weekday")),
                start_minutes=int(row.get("start_minutes")),
                duration_minutes=int(row.get("duration_minutes")),
                previous_date_key=(str(row["previous_date_key"]) if pd.notna(row.get("previous_date_key")) else None),
                previous_weekday=(int(row["previous_weekday"]) if pd.notna(row.get("previous_weekday")) else None),
                previous_start_minutes=(
                    int(row["previous_start_minutes"]) if pd.notna(row.get("previous_start_minutes")) else None
                ),
                previous_duration_minutes=(
                    int(row["previous_duration_minutes"]) if pd.notna(row.get("previous_duration_minutes")) else None
                ),
                counts_for_learning=bool(row.get("counts_for_learning")),
                created_at=row["created_at"],
            )
        )
    return events


def tune_threshold(scores: list[float], labels: list[int]) -> float:
    candidates = sorted(set(scores))
    if not candidates:
        return 0.0

    best_threshold = candidates[0]
    best_f1 = -1.0

    for threshold in candidates:
        preds = [1 if score >= threshold else 0 for score in scores]
        score = f1_score(labels, preds, zero_division=0)
        if score > best_f1:
            best_f1 = score
            best_threshold = threshold

    return best_threshold


def metric_bundle(labels: list[int], preds: list[int], scores: list[float]) -> dict:
    metrics = {
        "accuracy": accuracy_score(labels, preds),
        "precision": precision_score(labels, preds, zero_division=0),
        "recall": recall_score(labels, preds, zero_division=0),
        "f1": f1_score(labels, preds, zero_division=0),
    }
    if len(set(labels)) > 1:
        metrics["roc_auc"] = roc_auc_score(labels, scores)
    return metrics


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    raw = load_raw_events(input_path)
    examples = derive_examples(raw)
    examples = augment_examples_with_context(examples, raw, load_exam_deadline_map(args.context_export))
    examples = augment_examples_with_app_context(examples, load_app_behavior_events(args.app_events_input))
    train, test = chronological_split(examples)

    model = build_model()
    model.fit(train[FEATURE_COLUMNS], train["label"])

    ml_train_scores = model.predict_proba(train[FEATURE_COLUMNS])[:, 1].tolist()
    ml_test_scores = model.predict_proba(test[FEATURE_COLUMNS])[:, 1].tolist()
    ml_threshold = tune_threshold(ml_train_scores, train["label"].tolist())
    ml_preds = [1 if score >= ml_threshold else 0 for score in ml_test_scores]

    behavior_events = to_behavior_events(raw)
    heuristic_train_scores: list[float] = []
    heuristic_test_scores: list[float] = []

    for dataset, target_scores in ((train, heuristic_train_scores), (test, heuristic_test_scores)):
        for _, row in dataset.iterrows():
            history = [event for event in behavior_events if event.created_at < row["created_at"]]
            target_scores.append(
                score_study_slot(
                    history,
                    str(row["date_key"]),
                    int(row["start_minutes"]),
                    int(row["duration_minutes"]),
                )
            )

    heuristic_threshold = tune_threshold(heuristic_train_scores, train["label"].tolist())
    heuristic_preds = [1 if score >= heuristic_threshold else 0 for score in heuristic_test_scores]

    report = {
        "summary": {
            "train_examples": int(len(train)),
            "test_examples": int(len(test)),
            "ml_threshold": ml_threshold,
            "heuristic_threshold": heuristic_threshold,
        },
        "ml_metrics": metric_bundle(test["label"].tolist(), ml_preds, ml_test_scores),
        "heuristic_metrics": metric_bundle(
            test["label"].tolist(),
            heuristic_preds,
            heuristic_test_scores,
        ),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Comparison complete.")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
