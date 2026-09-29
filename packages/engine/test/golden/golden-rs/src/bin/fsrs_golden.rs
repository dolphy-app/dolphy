//! L1b golden generator: the REAL Rust FSRS adapter (`fsrs_scorer.rs`, variant `Hybrid`, default
//! FSRS-6 parameters) scores every input case of `powerlaw.jsonl` under both rating maps.
//!
//! Output (one line per case and map, keys sorted by serde_json):
//!   { "id": u32 (id of the powerlaw case), "rating_map": "runner"|"anki",
//!     "expect": {"ok":true,"value":f,"urgency":f,"velocity":f|null} | {"ok":false,"error":str} }
//! Inputs are NOT repeated: the test joins by `id` with `powerlaw.jsonl`.
//! Float encoding as in `powerlaw.jsonl`: exact f32 widened to f64; non-finite as strings.
//!
//! Usage: `cargo run --release --offline --bin fsrs_golden -- [powerlaw.jsonl] [out.jsonl]`.

#[allow(dead_code)]
#[path = "../fsrs_scorer.rs"]
mod fsrs_scorer;

use std::io::Write;
use std::panic::{AssertUnwindSafe, catch_unwind};

use fsrs_scorer::{FsrsScorer, RatingMap, Variant};
use serde_json::{Value, json};
use trane::data::{ExerciseDelta, ExerciseTrial, ExerciseType};
use trane::exercise_scorer::ExerciseScorer;

fn decode(value: &Value) -> f32 {
    match value {
        Value::String(text) => match text.as_str() {
            "NaN" => f32::NAN,
            "Infinity" => f32::INFINITY,
            "-Infinity" => f32::NEG_INFINITY,
            other => panic!("unexpected float text {other}"),
        },
        number => number.as_f64().expect("number") as f32,
    }
}

fn encode(x: f32) -> Value {
    let x = x as f64;
    match serde_json::Number::from_f64(x) {
        Some(n) => Value::Number(n),
        None if x.is_nan() => Value::String("NaN".into()),
        None if x > 0.0 => Value::String("Infinity".into()),
        None => Value::String("-Infinity".into()),
    }
}

fn main() -> anyhow::Result<()> {
    let input = std::env::args().nth(1).unwrap_or_else(|| "../powerlaw.jsonl".into());
    let output = std::env::args().nth(2).unwrap_or_else(|| "../fsrs-scorer.jsonl".into());
    let maps = [("runner", RatingMap::RunnerMap), ("anki", RatingMap::InverseM0)];

    let mut writer = std::io::BufWriter::new(std::fs::File::create(&output)?);
    let mut written = 0usize;
    let mut failures = 0usize;
    for line in std::fs::read_to_string(&input)?.lines().filter(|l| !l.is_empty()) {
        let case: Value = serde_json::from_str(line)?;
        let trials: Vec<ExerciseTrial> = case["trials"]
            .as_array()
            .expect("trials")
            .iter()
            .map(|t| ExerciseTrial {
                score: decode(&t["score"]),
                timestamp: t["timestamp"].as_i64().expect("timestamp"),
                ..Default::default()
            })
            .collect();
        let deltas: Vec<ExerciseDelta> = case["deltas"]
            .as_array()
            .expect("deltas")
            .iter()
            .map(|d| ExerciseDelta {
                delta: decode(&d["delta"]),
                timestamp: d["timestamp"].as_i64().expect("timestamp"),
                ..Default::default()
            })
            .collect();
        let exercise_type = match case["type"].as_str().expect("type") {
            "Declarative" => ExerciseType::Declarative,
            _ => ExerciseType::Procedural,
        };
        let now = case["now"].as_i64().expect("now");

        for (name, rating_map) in maps {
            let scorer = FsrsScorer::with_defaults(rating_map, Variant::Hybrid);
            let result = catch_unwind(AssertUnwindSafe(|| {
                scorer.score(exercise_type.clone(), &trials, &deltas, now)
            }));
            let expect = match result {
                Ok(Ok(s)) => json!({
                    "ok": true,
                    "value": encode(s.value),
                    "urgency": encode(s.urgency),
                    "velocity": s.velocity.map(encode),
                }),
                Ok(Err(e)) => {
                    failures += 1;
                    json!({ "ok": false, "error": e.to_string() })
                }
                Err(_) => {
                    failures += 1;
                    json!({ "ok": false, "error": "PANIC" })
                }
            };
            let out = json!({ "id": case["id"], "rating_map": name, "expect": expect });
            writeln!(writer, "{}", serde_json::to_string(&out)?)?;
            written += 1;
        }
    }
    writer.flush()?;
    eprintln!("wrote {written} cases ({failures} errors) to {output}");
    Ok(())
}
