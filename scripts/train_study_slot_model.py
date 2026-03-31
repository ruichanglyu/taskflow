#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "ml" / "data" / "behavior_learning_schedule_events.csv"
ARTIFACTS_DIR = ROOT / "ml" / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "study_slot_model.json"
REPORT_PATH = ARTIFACTS_DIR / "study_slot_report.json"


def load_dataset() -> pd.DataFrame:
    if not DATA_PATH.exists():
      raise FileNotFoundError(
          f"Missing dataset: {DATA_PATH}\n"
          "Export behavior_learning_schedule_events from Supabase as CSV and place it there."
      )

    df = pd.read_csv(DATA_PATH)
    required = {
        "created_at",
        "source",
        "action",
        "title",
        "calendar_summary",
        "date_key",
        "weekday",
        "start_minutes",
        "duration_minutes",
        "counts_for_learning",
    }
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Dataset missing required columns: {sorted(missing)}")

    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    working = df.copy()
    working = working[working["counts_for_learning"].fillna(False).astype(bool)].copy()
    working = working[working["action"].isin(["create", "reschedule", "delete"])].copy()
    if working.empty:
        raise ValueError("No rows left after filtering counts_for_learning and supported actions.")

    working["created_at"] = pd.to_datetime(working["created_at"], utc=True, errors="coerce")
    working["date_key"] = pd.to_datetime(working["date_key"], errors="coerce")
    working["is_positive"] = working["action"].isin(["create", "reschedule"]).astype(int)
    working["hour_of_day"] = working["start_minutes"] / 60.0
    working["is_ai"] = (working["source"] == "ai").astype(int)
    working["is_exam_prep"] = working["calendar_summary"].fillna("").str.contains("exam prep", case=False).astype(int)
    working["is_study_block"] = working["title"].fillna("").str.contains("study", case=False).astype(int)
    working["month"] = working["date_key"].dt.month.fillna(0).astype(int)
    working["day_of_month"] = working["date_key"].dt.day.fillna(0).astype(int)

    return working.sort_values("created_at").reset_index(drop=True)


def temporal_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    if len(df) < 10:
        raise ValueError("Need at least 10 usable rows to train a meaningful baseline.")
    split_index = max(int(len(df) * 0.8), 1)
    train_df = df.iloc[:split_index].copy()
    test_df = df.iloc[split_index:].copy()
    if test_df.empty:
        raise ValueError("Temporal split produced an empty test set.")
    return train_df, test_df


def build_pipeline() -> Pipeline:
    numeric_features = [
        "weekday",
        "start_minutes",
        "duration_minutes",
        "hour_of_day",
        "month",
        "day_of_month",
        "is_ai",
        "is_exam_prep",
        "is_study_block",
    ]
    categorical_features = [
        "source",
        "action",
        "calendar_summary",
        "title",
    ]

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

    model = LogisticRegression(max_iter=1000, class_weight="balanced")

    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("model", model),
        ]
    )


def evaluate_model(pipeline: Pipeline, train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict:
    feature_columns = [
        "weekday",
        "start_minutes",
        "duration_minutes",
        "hour_of_day",
        "month",
        "day_of_month",
        "is_ai",
        "is_exam_prep",
        "is_study_block",
        "source",
        "action",
        "calendar_summary",
        "title",
    ]

    X_train = train_df[feature_columns]
    y_train = train_df["is_positive"]
    X_test = test_df[feature_columns]
    y_test = test_df["is_positive"]

    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(X_test)[:, 1]

    report = {
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "positive_rate_train": float(y_train.mean()),
        "positive_rate_test": float(y_test.mean()),
        "accuracy": float(accuracy_score(y_test, predictions)),
        "precision": float(precision_score(y_test, predictions, zero_division=0)),
        "recall": float(recall_score(y_test, predictions, zero_division=0)),
        "f1": float(f1_score(y_test, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, probabilities)) if len(set(y_test)) > 1 else None,
    }

    preprocessor = pipeline.named_steps["preprocessor"]
    model = pipeline.named_steps["model"]
    feature_names = preprocessor.get_feature_names_out().tolist()
    coefficients = model.coef_[0].tolist()
    ranked = sorted(
        zip(feature_names, coefficients),
        key=lambda pair: abs(pair[1]),
        reverse=True,
    )
    report["top_positive_features"] = [
        {"feature": name, "weight": float(weight)}
        for name, weight in ranked
        if weight > 0
    ][:12]
    report["top_negative_features"] = [
        {"feature": name, "weight": float(weight)}
        for name, weight in ranked
        if weight < 0
    ][:12]

    artifact = {
        "model_type": "logistic_regression",
        "feature_names": feature_names,
        "coefficients": [float(value) for value in coefficients],
        "intercept": float(model.intercept_[0]),
    }

    return {"report": report, "artifact": artifact}


def main() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    df = load_dataset()
    featured = build_features(df)
    train_df, test_df = temporal_split(featured)
    pipeline = build_pipeline()
    result = evaluate_model(pipeline, train_df, test_df)

    MODEL_PATH.write_text(json.dumps(result["artifact"], indent=2))
    REPORT_PATH.write_text(json.dumps(result["report"], indent=2))

    print("Training complete.")
    print(f"Model artifact: {MODEL_PATH}")
    print(f"Report: {REPORT_PATH}")
    print(json.dumps(result["report"], indent=2))


if __name__ == "__main__":
    main()
