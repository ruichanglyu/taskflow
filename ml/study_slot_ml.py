from __future__ import annotations

import csv
import math
import re
from typing import Iterable

import pandas as pd

COURSE_PATTERN = re.compile(r"\b([A-Z]{2,}\s\d{4})\b")
EXAM_PATTERN = re.compile(r"\b(final exam|exam\s+\d+|demo\s+\d+)\b", re.IGNORECASE)


def cyclical_components(minutes: float) -> tuple[float, float]:
    angle = 2 * math.pi * (minutes / 1440.0)
    return math.sin(angle), math.cos(angle)


def build_feature_row(
    *,
    created_at: str,
    date_key: str | None = None,
    source: str,
    title: str,
    calendar_summary: str,
    weekday: int,
    start_minutes: int,
    duration_minutes: int,
    slot_kind: str,
    label: int | None = None,
    days_until_exam: int | None = None,
    same_day_historical_events: int = 0,
    trailing_7d_historical_events: int = 0,
    trailing_30d_historical_events: int = 0,
    historical_course_events: int = 0,
    recent_task_completions: int = 0,
    recent_due_date_changes: int = 0,
    recent_subtask_completions: int = 0,
    recent_comment_adds: int = 0,
    recent_course_activity: int = 0,
) -> dict:
    hour = start_minutes / 60.0
    time_sin, time_cos = cyclical_components(start_minutes)
    normalized_title = title.strip().lower()
    normalized_calendar = calendar_summary.strip().lower()

    row = {
        "created_at": created_at,
        "date_key": date_key or "",
        "slot_kind": slot_kind,
        "source": source or "manual",
        "weekday": weekday,
        "start_minutes": start_minutes,
        "duration_minutes": duration_minutes,
        "hour_of_day": hour,
        "time_sin": time_sin,
        "time_cos": time_cos,
        "days_until_exam": -1 if days_until_exam is None else days_until_exam,
        "same_day_historical_events": same_day_historical_events,
        "trailing_7d_historical_events": trailing_7d_historical_events,
        "trailing_30d_historical_events": trailing_30d_historical_events,
        "historical_course_events": historical_course_events,
        "recent_task_completions": recent_task_completions,
        "recent_due_date_changes": recent_due_date_changes,
        "recent_subtask_completions": recent_subtask_completions,
        "recent_comment_adds": recent_comment_adds,
        "recent_course_activity": recent_course_activity,
        "calendar_summary": calendar_summary or "Unknown",
        "title": title or "Untitled",
        "is_exam_prep": int("exam prep" in normalized_calendar or "exam" in normalized_title),
        "is_seeded": int("seeded" in normalized_title),
        "is_ai": int((source or "manual") == "ai"),
        "title_has_math": int("math" in normalized_title),
        "title_has_cs": int("cs" in normalized_title),
        "title_has_demo": int("demo" in normalized_title),
        "title_has_exam": int("exam" in normalized_title),
        "title_has_review": int("review" in normalized_title),
    }
    if label is not None:
        row["label"] = label
    return row


def candidate_rows_to_frame(rows: Iterable[dict]) -> pd.DataFrame:
    dataset = pd.DataFrame(list(rows))
    if dataset.empty:
        return dataset
    dataset["created_at"] = pd.to_datetime(dataset["created_at"], utc=True, errors="coerce")
    return dataset


def extract_course_token(title: str) -> str | None:
    match = COURSE_PATTERN.search(title)
    if not match:
        return None
    return match.group(1).upper()


def extract_exam_token(title: str) -> str | None:
    match = EXAM_PATTERN.search(title)
    if not match:
        return None
    return re.sub(r"\s+", " ", match.group(1).strip().lower())


def load_exam_deadline_map(export_path: str | None) -> dict[tuple[str, str], pd.Timestamp]:
    if not export_path:
        return {}

    path = pd.io.common.stringify_path(export_path)
    text = pd.io.common.get_handle(path, "r", encoding="utf-8").handle.read()
    start = text.find("=== DEADLINES ===")
    end = text.find("=== COURSES ===")
    if start < 0 or end < 0 or end <= start:
        return {}

    section = text[start:end].splitlines()
    rows = [line for line in section[1:] if line.strip()]
    if not rows:
        return {}

    reader = csv.DictReader(rows)
    deadline_map: dict[tuple[str, str], pd.Timestamp] = {}
    for row in reader:
        if str(row.get("Type", "")).strip().lower() != "exam":
            continue
        course = str(row.get("Course", "")).strip().upper()
        title = str(row.get("Title", "")).strip()
        due_date = str(row.get("Due Date", "")).strip()
        if not course or not title or not due_date:
            continue

        exam_token = extract_exam_token(title)
        if not exam_token:
            continue

        parsed_due = pd.to_datetime(due_date, utc=False, errors="coerce")
        if pd.isna(parsed_due):
            continue
        deadline_map[(course, exam_token)] = parsed_due.normalize()

    return deadline_map


def augment_examples_with_context(
    examples: pd.DataFrame,
    raw_rows: pd.DataFrame,
    exam_deadline_map: dict[tuple[str, str], pd.Timestamp] | None = None,
) -> pd.DataFrame:
    if examples.empty:
        return examples

    deadline_map = exam_deadline_map or {}
    enriched = examples.copy()

    historical_created = pd.to_datetime(raw_rows["created_at"], utc=True, errors="coerce")
    historical_dates = pd.to_datetime(raw_rows["date_key"], utc=False, errors="coerce")
    historical_titles = raw_rows["title"].fillna("").astype(str)
    historical_courses = historical_titles.apply(lambda value: extract_course_token(value) or "")

    days_until_exam_values: list[int] = []
    same_day_counts: list[int] = []
    trailing_7d_counts: list[int] = []
    trailing_30d_counts: list[int] = []
    historical_course_counts: list[int] = []

    for _, row in enriched.iterrows():
        created_at = row["created_at"]
        slot_date = pd.to_datetime(row["date_key"], utc=False, errors="coerce")
        history_mask = historical_created < created_at

        same_day_count = 0
        trailing_7d_count = 0
        trailing_30d_count = 0
        if not pd.isna(slot_date):
            normalized_slot = slot_date.normalize()
            same_day_count = int((history_mask & (historical_dates == normalized_slot)).sum())
            day_delta = (normalized_slot - historical_dates).dt.days
            trailing_7d_count = int((history_mask & day_delta.between(0, 7, inclusive="both")).sum())
            trailing_30d_count = int((history_mask & day_delta.between(0, 30, inclusive="both")).sum())

        course_token = extract_course_token(str(row["title"])) or ""
        course_count = int((history_mask & (historical_courses == course_token)).sum()) if course_token else 0

        exam_token = extract_exam_token(str(row["title"]))
        days_until_exam = None
        if course_token and exam_token and not pd.isna(slot_date):
            exam_due = deadline_map.get((course_token, exam_token))
            if exam_due is not None:
                days_until_exam = int((exam_due - slot_date.normalize()).days)

        days_until_exam_values.append(-1 if days_until_exam is None else days_until_exam)
        same_day_counts.append(same_day_count)
        trailing_7d_counts.append(trailing_7d_count)
        trailing_30d_counts.append(trailing_30d_count)
        historical_course_counts.append(course_count)

    enriched["days_until_exam"] = days_until_exam_values
    enriched["same_day_historical_events"] = same_day_counts
    enriched["trailing_7d_historical_events"] = trailing_7d_counts
    enriched["trailing_30d_historical_events"] = trailing_30d_counts
    enriched["historical_course_events"] = historical_course_counts
    return enriched


def load_app_behavior_events(path: str | None) -> pd.DataFrame:
    if not path:
        return pd.DataFrame(
            columns=["created_at", "entity", "action", "title", "detail", "counts_for_learning"]
        )

    raw = pd.read_csv(path)
    if "counts_for_learning" in raw.columns:
        raw = raw[raw["counts_for_learning"].fillna(False).astype(bool)].copy()
    raw["created_at"] = pd.to_datetime(raw["created_at"], utc=True, errors="coerce")
    raw["title"] = raw.get("title", "").fillna("").astype(str)
    raw["detail"] = raw.get("detail", "").fillna("").astype(str)
    raw["action"] = raw.get("action", "").fillna("").astype(str)
    return raw.dropna(subset=["created_at"]).sort_values("created_at").reset_index(drop=True)


def augment_examples_with_app_context(
    examples: pd.DataFrame,
    app_events: pd.DataFrame,
) -> pd.DataFrame:
    if examples.empty:
        return examples

    if app_events.empty:
        enriched = examples.copy()
        for column in [
            "recent_task_completions",
            "recent_due_date_changes",
            "recent_subtask_completions",
            "recent_comment_adds",
            "recent_course_activity",
        ]:
            enriched[column] = 0
        return enriched

    enriched = examples.copy()
    app_created = pd.to_datetime(app_events["created_at"], utc=True, errors="coerce")
    app_titles = app_events["title"].fillna("").astype(str)
    app_details = app_events["detail"].fillna("").astype(str)
    app_actions = app_events["action"].fillna("").astype(str)
    app_courses = app_titles.apply(lambda value: extract_course_token(value) or "")

    recent_task_completions: list[int] = []
    recent_due_date_changes: list[int] = []
    recent_subtask_completions: list[int] = []
    recent_comment_adds: list[int] = []
    recent_course_activity: list[int] = []

    for _, row in enriched.iterrows():
        created_at = row["created_at"]
        history_mask = app_created < created_at
        cutoff_7d = created_at - pd.Timedelta(days=7)
        cutoff_30d = created_at - pd.Timedelta(days=30)
        recent_7d = history_mask & (app_created >= cutoff_7d)
        recent_30d = history_mask & (app_created >= cutoff_30d)

        course_token = extract_course_token(str(row["title"])) or ""
        course_mask = (app_courses == course_token) if course_token else pd.Series(False, index=app_events.index)

        recent_task_completions.append(
            int((recent_7d & (app_actions == "status-change") & app_details.str.contains("to:done", case=False)).sum())
        )
        recent_due_date_changes.append(int((recent_30d & (app_actions == "due-date-change")).sum()))
        recent_subtask_completions.append(int((recent_30d & (app_actions == "subtask-complete")).sum()))
        recent_comment_adds.append(int((recent_30d & (app_actions == "comment-add")).sum()))
        recent_course_activity.append(int((recent_30d & course_mask).sum()))

    enriched["recent_task_completions"] = recent_task_completions
    enriched["recent_due_date_changes"] = recent_due_date_changes
    enriched["recent_subtask_completions"] = recent_subtask_completions
    enriched["recent_comment_adds"] = recent_comment_adds
    enriched["recent_course_activity"] = recent_course_activity
    return enriched
