# Study Slot ML

This folder is the first ML foundation for TaskFlow's behavior-learning system.

It trains a lightweight classifier on exported `behavior_learning_schedule_events`
data from Supabase and predicts whether a study slot is likely to be kept.

## What it does

The training script converts behavior rows into labeled examples:

- `create` -> positive example for that slot
- `delete` -> negative example for that slot
- `reschedule` -> two examples
  - previous slot -> negative
  - new slot -> positive

That gives us a simple, honest first ML target:

- "Given this slot, how likely is the user to keep it?"

## Why this is useful

Right now the app uses heuristic scoring from behavior history.

This ML pipeline lets us compare that heuristic against a real model using:

- chronological train/test splits
- accuracy / precision / recall / F1
- ROC-AUC when the test set supports it

## Input data

Export `public.behavior_learning_schedule_events` from Supabase as CSV.

The script expects columns matching the current schema:

- `created_at`
- `source`
- `action`
- `title`
- `calendar_summary`
- `weekday`
- `start_minutes`
- `duration_minutes`
- `previous_weekday`
- `previous_start_minutes`
- `previous_duration_minutes`
- `counts_for_learning`

You can export from the table UI in Supabase or use SQL and export the result.

## Setup

Create a Python virtual environment if you want to keep dependencies isolated:

```bash
python3 -m venv .venv-ml
source .venv-ml/bin/activate
pip install -r ml/requirements.txt
```

## Train the baseline model

```bash
python3 ml/train_study_slot_model.py \
  --input "/absolute/path/to/behavior_learning_schedule_events.csv"
```

Optional output directory:

```bash
python3 ml/train_study_slot_model.py \
  --input "/absolute/path/to/behavior_learning_schedule_events.csv" \
  --context-export "/absolute/path/to/taskflow-export.csv" \
  --app-events-input "/absolute/path/to/behavior_learning_app_events.csv" \
  --output-dir ml/artifacts
```

## Outputs

The script writes:

- `model.pkl`
- `metrics.json`
- `training_summary.json`
- `feature_weights.csv`

These artifacts help with both debugging and explaining the model:

- `metrics.json` tells us how well it performs
- `feature_weights.csv` shows what the model is leaning on most

## Score candidate slots

Once a model is trained, you can score a few candidate time slots directly:

```bash
python3 ml/score_study_slots.py \
  --model ml/artifacts/first-run/model.pkl \
  --history-csv "/absolute/path/to/behavior_learning_schedule_events.csv" \
  --context-export "/absolute/path/to/taskflow-export.csv" \
  --app-events-input "/absolute/path/to/behavior_learning_app_events.csv" \
  --candidate "2,960,90,MATH 3012 Exam 3 Prep,Exam Prep" \
  --candidate "2,1185,90,MATH 3012 Exam 3 Prep,Exam Prep" \
  --candidate "2,1275,90,MATH 3012 Exam 3 Prep,Exam Prep"
```

Candidate format:

- `weekday,start_minutes,duration_minutes,title,calendar_summary`

Example meaning:

- `2,1185,90,MATH 3012 Exam 3 Prep,Exam Prep`
- Tuesday, `7:45 PM`, `90` minutes, title `MATH 3012 Exam 3 Prep`, calendar `Exam Prep`

## Compare ML vs the current heuristic

To compare the ML baseline against the existing behavior-score heuristic:

```bash
python3 ml/compare_study_slot_models.py \
  --input "/absolute/path/to/behavior_learning_schedule_events.csv" \
  --context-export "/absolute/path/to/taskflow-export.csv" \
  --app-events-input "/absolute/path/to/behavior_learning_app_events.csv"
```

This writes a comparison report with:

- ML metrics
- heuristic metrics
- tuned decision thresholds for both
- optional richer context from your full TaskFlow export, including exam dates

That gives us a clean answer to:

- "Is the model actually better than the current rule-based system?"

## Recommended workflow

1. Keep `Testing mode` on while experimenting in the app.
2. Let real behavior accumulate.
3. Export `behavior_learning_schedule_events`.
4. Train the model.
5. Compare its performance to the current heuristic scheduler.
6. Only integrate the model into slot ranking if it clearly helps.

## Next steps after this baseline

- Add richer features:
  - days before exam
  - nearby class density
  - number of study blocks already scheduled that week
  - course identity features
- Compare models:
  - logistic regression
  - random forest
  - gradient boosting
- Add a scoring script that ranks candidate free slots for one scheduling request
- Move from exported CSVs to a direct Supabase data pull once the modeling loop stabilizes
