#!/usr/bin/env python3
"""
Train a first-pass study-slot classifier from exported behavior learning CSV data.

The model predicts whether a proposed slot is likely to be kept.
"""

from __future__ import annotations

import argparse
import json
import math
import pickle
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from study_slot_ml import (
    augment_examples_with_app_context,
    augment_examples_with_context,
    build_feature_row,
    load_app_behavior_events,
    load_exam_deadline_map,
)


POSITIVE_ACTIONS = {"create"}
NEGATIVE_ACTIONS = {"delete"}
SUPPORTED_ACTIONS = {"create", "delete", "reschedule"}
FEATURE_COLUMNS = [
    "slot_kind",
    "source",
    "weekday",
    "start_minutes",
    "duration_minutes",
    "hour_of_day",
    "time_sin",
    "time_cos",
    "days_until_exam",
    "same_day_historical_events",
    "trailing_7d_historical_events",
    "trailing_30d_historical_events",
    "historical_course_events",
    "recent_task_completions",
    "recent_due_date_changes",
    "recent_subtask_completions",
    "recent_comment_adds",
    "recent_course_activity",
    "recent_study_block_completions",
    "recent_study_block_skips",
    "calendar_summary",
    "title",
    "is_exam_prep",
    "is_seeded",
    "is_ai",
    "title_has_math",
    "title_has_cs",
    "title_has_demo",
    "title_has_exam",
    "title_has_review",
]


@dataclass
class TrainingArtifacts:
    model: Pipeline
    metrics: dict
    summary: dict
    weights: pd.DataFrame


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a baseline classifier for preferred study slots."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Absolute or relative path to an exported behavior_learning_schedule_events CSV.",
    )
    parser.add_argument(
        "--output-dir",
        default="ml/artifacts",
        help="Directory where model and metrics artifacts will be written.",
    )
    parser.add_argument(
        "--include-non-learning",
        action="store_true",
        help="Include rows where counts_for_learning is false.",
    )
    parser.add_argument(
        "--min-examples",
        type=int,
        default=20,
        help="Minimum number of derived examples required to train.",
    )
    parser.add_argument(
        "--context-export",
        default=None,
        help="Optional TaskFlow full export CSV used to derive exam-date context.",
    )
    parser.add_argument(
        "--app-events-input",
        default=None,
        help="Optional behavior_learning_app_events CSV used to derive broader productivity context.",
    )
    return parser.parse_args()


def clean_string(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip()


def safe_int(value: object) -> int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return int(float(value))


def build_slot_example(
    row: pd.Series,
    *,
    label: int,
    slot_kind: str,
    weekday: int | None,
    start_minutes: int | None,
    duration_minutes: int | None,
) -> dict | None:
    if weekday is None or start_minutes is None or duration_minutes is None:
        return None

    title = clean_string(row.get("title"))
    calendar_summary = clean_string(row.get("calendar_summary"))
    source = clean_string(row.get("source")) or "manual"
    return build_feature_row(
        created_at=clean_string(row.get("created_at")),
        date_key=clean_string(row.get("date_key")),
        label=label,
        slot_kind=slot_kind,
        source=source,
        weekday=weekday,
        start_minutes=start_minutes,
        duration_minutes=duration_minutes,
        title=title,
        calendar_summary=calendar_summary,
    )


def derive_examples(rows: pd.DataFrame) -> pd.DataFrame:
    examples: list[dict] = []

    for _, row in rows.iterrows():
        action = clean_string(row.get("action")).lower()
        if action not in SUPPORTED_ACTIONS:
            continue

        current_weekday = safe_int(row.get("weekday"))
        current_start = safe_int(row.get("start_minutes"))
        current_duration = safe_int(row.get("duration_minutes"))
        previous_weekday = safe_int(row.get("previous_weekday"))
        previous_start = safe_int(row.get("previous_start_minutes"))
        previous_duration = safe_int(row.get("previous_duration_minutes"))

        if action in POSITIVE_ACTIONS:
            example = build_slot_example(
                row,
                label=1,
                slot_kind="current",
                weekday=current_weekday,
                start_minutes=current_start,
                duration_minutes=current_duration,
            )
            if example:
                examples.append(example)
            continue

        if action in NEGATIVE_ACTIONS:
            example = build_slot_example(
                row,
                label=0,
                slot_kind="current",
                weekday=current_weekday,
                start_minutes=current_start,
                duration_minutes=current_duration,
            )
            if example:
                examples.append(example)
            continue

        if action == "reschedule":
            previous_example = build_slot_example(
                row,
                label=0,
                slot_kind="previous",
                weekday=previous_weekday,
                start_minutes=previous_start,
                duration_minutes=previous_duration,
            )
            if previous_example is not None:
                previous_example["date_key"] = clean_string(row.get("previous_date_key")) or clean_string(
                    row.get("date_key")
                )
            current_example = build_slot_example(
                row,
                label=1,
                slot_kind="current",
                weekday=current_weekday,
                start_minutes=current_start,
                duration_minutes=current_duration,
            )
            if previous_example:
                examples.append(previous_example)
            if current_example:
                examples.append(current_example)

    if not examples:
        return pd.DataFrame()

    dataset = pd.DataFrame(examples)
    dataset["created_at"] = pd.to_datetime(dataset["created_at"], utc=True, errors="coerce")
    dataset = dataset.dropna(subset=["created_at"]).sort_values("created_at").reset_index(drop=True)
    return dataset


def load_dataset(
    csv_path: Path,
    include_non_learning: bool,
    context_export: str | None = None,
    app_events_input: str | None = None,
) -> pd.DataFrame:
    raw = pd.read_csv(csv_path)

    if "counts_for_learning" not in raw.columns:
        raise ValueError("CSV is missing required column: counts_for_learning")

    if not include_non_learning:
        raw = raw[raw["counts_for_learning"].fillna(False).astype(bool)]

    dataset = derive_examples(raw)
    if dataset.empty:
        raise ValueError("No usable examples were derived from the CSV.")

    exam_deadline_map = load_exam_deadline_map(context_export)
    dataset = augment_examples_with_context(dataset, raw, exam_deadline_map)
    return augment_examples_with_app_context(dataset, load_app_behavior_events(app_events_input))


def chronological_split(dataset: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    split_index = max(1, int(len(dataset) * 0.8))
    train = dataset.iloc[:split_index].copy()
    test = dataset.iloc[split_index:].copy()

    if test.empty:
        test = train.iloc[-1:].copy()
        train = train.iloc[:-1].copy()

    if train.empty or test.empty:
        raise ValueError("Dataset is too small for a chronological train/test split.")

    return train, test


def build_model() -> Pipeline:
    numeric_features = [
        "weekday",
        "start_minutes",
        "duration_minutes",
        "hour_of_day",
        "time_sin",
        "time_cos",
        "days_until_exam",
        "same_day_historical_events",
        "trailing_7d_historical_events",
        "trailing_30d_historical_events",
        "historical_course_events",
        "recent_task_completions",
        "recent_due_date_changes",
        "recent_subtask_completions",
        "recent_comment_adds",
        "recent_course_activity",
        "recent_study_block_completions",
        "recent_study_block_skips",
        "is_exam_prep",
        "is_seeded",
        "is_ai",
        "title_has_math",
        "title_has_cs",
        "title_has_demo",
        "title_has_exam",
        "title_has_review",
    ]
    categorical_features = ["source", "calendar_summary", "slot_kind"]

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_features,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_features,
            ),
        ]
    )

    classifier = LogisticRegression(
        class_weight="balanced",
        max_iter=1000,
        random_state=42,
    )

    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", classifier),
        ]
    )


def compute_metrics(model: Pipeline, test: pd.DataFrame) -> dict:
    x_test = test[FEATURE_COLUMNS]
    y_test = test["label"]
    predictions = model.predict(x_test)
    probabilities = model.predict_proba(x_test)[:, 1]

    metrics = {
        "accuracy": accuracy_score(y_test, predictions),
        "precision": precision_score(y_test, predictions, zero_division=0),
        "recall": recall_score(y_test, predictions, zero_division=0),
        "f1": f1_score(y_test, predictions, zero_division=0),
    }

    if len(set(y_test.tolist())) > 1:
        metrics["roc_auc"] = roc_auc_score(y_test, probabilities)

    return metrics


def extract_feature_weights(model: Pipeline) -> pd.DataFrame:
    preprocessor: ColumnTransformer = model.named_steps["preprocessor"]
    classifier: LogisticRegression = model.named_steps["classifier"]

    feature_names = list(preprocessor.get_feature_names_out())
    coefficients = classifier.coef_[0]

    weights = pd.DataFrame(
        {
            "feature": feature_names,
            "coefficient": coefficients,
            "abs_coefficient": [abs(value) for value in coefficients],
        }
    ).sort_values("abs_coefficient", ascending=False)

    return weights


def train_artifacts(dataset: pd.DataFrame, min_examples: int) -> TrainingArtifacts:
    if len(dataset) < min_examples:
        raise ValueError(
            f"Need at least {min_examples} derived examples to train, found {len(dataset)}."
        )

    train, test = chronological_split(dataset)
    x_train = train[FEATURE_COLUMNS]
    y_train = train["label"]

    if len(set(y_train.tolist())) < 2:
        raise ValueError("Training split needs both positive and negative examples.")

    model = build_model()
    model.fit(x_train, y_train)

    metrics = compute_metrics(model, test)
    weights = extract_feature_weights(model)
    summary = {
        "total_examples": int(len(dataset)),
        "train_examples": int(len(train)),
        "test_examples": int(len(test)),
        "positive_examples": int(dataset["label"].sum()),
        "negative_examples": int((1 - dataset["label"]).sum()),
        "train_start": train["created_at"].min().isoformat(),
        "train_end": train["created_at"].max().isoformat(),
        "test_start": test["created_at"].min().isoformat(),
        "test_end": test["created_at"].max().isoformat(),
    }

    return TrainingArtifacts(
        model=model,
        metrics=metrics,
        summary=summary,
        weights=weights,
    )


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def save_artifacts(artifacts: TrainingArtifacts, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    model_path = output_dir / "model.pkl"
    metrics_path = output_dir / "metrics.json"
    summary_path = output_dir / "training_summary.json"
    weights_path = output_dir / "feature_weights.csv"

    with model_path.open("wb") as handle:
        pickle.dump(artifacts.model, handle)

    write_json(metrics_path, artifacts.metrics)
    write_json(summary_path, artifacts.summary)
    artifacts.weights.to_csv(weights_path, index=False)


def print_report(metrics: dict, summary: dict, output_dir: Path) -> None:
    print("Training complete.")
    print()
    print("Summary:")
    for key, value in summary.items():
        print(f"  {key}: {value}")
    print()
    print("Metrics:")
    for key, value in metrics.items():
        print(f"  {key}: {value:.4f}")
    print()
    print(f"Artifacts written to: {output_dir}")


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"Input CSV not found: {input_path}")

    dataset = load_dataset(
        input_path,
        include_non_learning=args.include_non_learning,
        context_export=args.context_export,
        app_events_input=args.app_events_input,
    )
    artifacts = train_artifacts(dataset, min_examples=args.min_examples)
    save_artifacts(artifacts, output_dir)
    print_report(artifacts.metrics, artifacts.summary, output_dir)


if __name__ == "__main__":
    main()
