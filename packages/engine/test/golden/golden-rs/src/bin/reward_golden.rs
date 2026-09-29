//! L1 golden generator for `WeightedRewardScorer` (`score_rewards`, `apply_reward`): the REAL
//! Trane v0.34.1 code on pseudo-random and boundary inputs from a fixed-seed PRNG.
//!
//! Wire format (one case per line, keys sorted by serde_json; times are i64 seconds):
//!   score_rewards: { "id", "kind": "score_rewards", "course": [R], "lesson": [R], "now",
//!                    "expect": f }            with R = {"value": f, "weight": f, "timestamp": i}
//!   apply_reward:  { "id", "kind": "apply_reward", "reward": f, "trials": [{"score": f,
//!                    "timestamp": i}] (newest first), "now", "expect": bool }
//! Inputs are the shortest decimal text of the f32; outputs the exact f32 widened to f64.
//!
//! Usage: `cargo run --release --offline --bin reward_golden -- [out.jsonl]`
//! (default `../reward-scorer.jsonl`).

use std::io::Write;

use serde_json::{Value, json};
use trane::data::{ExerciseTrial, UnitReward};
use trane::reward_scorer::{RewardScorer, WeightedRewardScorer};
use ustr::Ustr;

const SEED: u64 = 0x5EED_4E3A_2026_0929;
const DAY: i64 = 86_400;
/// Fixed reference epoch (seconds), the same as `powerlaw.jsonl`.
const BASE: i64 = 1_700_000_000;

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as u64) as i64
    }
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len() as u64) as usize]
    }
}

fn fnum(x: f64) -> Value {
    match serde_json::Number::from_f64(x) {
        Some(n) => Value::Number(n),
        None if x.is_nan() => Value::String("NaN".into()),
        None if x > 0.0 => Value::String("Infinity".into()),
        None => Value::String("-Infinity".into()),
    }
}

/// Input encoding: shortest decimal text of the f32, parsed as f64.
fn f32_in(x: f32) -> Value {
    fnum(format!("{x}").parse::<f64>().unwrap())
}

/// Age of a reward in seconds: exact day boundaries, one second either side, random, future.
fn age(rng: &mut Rng) -> i64 {
    match rng.below(6) {
        0 => 0,
        1 => rng.range(0, 400) * DAY,
        2 => rng.range(1, 400) * DAY - 1,
        3 => rng.range(0, 400) * DAY + 1,
        4 => rng.range(0, 400 * DAY),
        _ => -rng.range(1, 10 * DAY),
    }
}

fn reward_value(rng: &mut Rng) -> f32 {
    const FIXED: [f32; 11] = [1.0, -1.0, 0.8, -0.8, 0.72, 0.4, -0.4, 0.3, -0.3, 0.5, -0.5];
    if rng.below(3) == 0 { rng.uniform(-1.0, 1.0) as f32 } else { rng.pick(&FIXED) }
}

fn reward_weight(rng: &mut Rng) -> f32 {
    const FIXED: [f32; 8] = [1.0, 0.8, 0.64, 0.512, 0.3, 0.2, 0.001, 0.0];
    if rng.below(3) == 0 { rng.uniform(0.2, 1.0) as f32 } else { rng.pick(&FIXED) }
}

fn rewards(rng: &mut Rng, now: i64) -> Vec<(f32, f32, i64)> {
    let n = rng.below(7);
    (0..n).map(|_| (reward_value(rng), reward_weight(rng), now - age(rng))).collect()
}

fn to_reward((value, weight, timestamp): (f32, f32, i64)) -> UnitReward {
    UnitReward { unit_id: Ustr::default(), value, weight, timestamp }
}

fn wire_rewards(list: &[(f32, f32, i64)]) -> Value {
    Value::Array(
        list.iter()
            .map(|(v, w, t)| json!({"value": f32_in(*v), "weight": f32_in(*w), "timestamp": t}))
            .collect(),
    )
}

fn main() -> anyhow::Result<()> {
    let out_path = std::env::args().nth(1).unwrap_or_else(|| "../reward-scorer.jsonl".into());
    let mut rng = Rng(SEED);
    let scorer = WeightedRewardScorer {};
    let mut lines: Vec<Value> = Vec::new();

    for _ in 0..1500 {
        let now = BASE + rng.range(0, DAY);
        let course = rewards(&mut rng, now);
        let lesson = rewards(&mut rng, now);
        let course_rewards: Vec<UnitReward> = course.iter().copied().map(to_reward).collect();
        let lesson_rewards: Vec<UnitReward> = lesson.iter().copied().map(to_reward).collect();
        let result = scorer.score_rewards(&course_rewards, &lesson_rewards, now)?;
        lines.push(json!({
            "id": lines.len(), "kind": "score_rewards",
            "course": wire_rewards(&course), "lesson": wire_rewards(&lesson),
            "now": now, "expect": fnum(result as f64),
        }));
    }

    const SCORES: [f32; 13] = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 2.0, 3.0, 4.0, 5.0];
    for _ in 0..1500 {
        let now = BASE + rng.range(0, DAY);
        let reward = match rng.below(4) {
            0 => 0.0,
            1 => 0.5,
            2 => -0.5,
            _ => reward_value(&mut rng),
        };
        let n = rng.below(7);
        let mut timestamp = now - age(&mut rng);
        let mut trials: Vec<(f32, i64)> = Vec::new();
        for _ in 0..n {
            trials.push((rng.pick(&SCORES), timestamp));
            timestamp -= rng.range(0, 30 * DAY);
        }
        let list: Vec<ExerciseTrial> = trials
            .iter()
            .map(|(s, t)| ExerciseTrial { score: *s, timestamp: *t, ..Default::default() })
            .collect();
        let applied = scorer.apply_reward(reward, &list, now);
        lines.push(json!({
            "id": lines.len(), "kind": "apply_reward", "reward": f32_in(reward),
            "trials": trials.iter().map(|(s, t)| json!({"score": f32_in(*s), "timestamp": t})).collect::<Vec<_>>(),
            "now": now, "expect": applied,
        }));
    }

    let mut writer = std::io::BufWriter::new(std::fs::File::create(&out_path)?);
    for line in &lines {
        writeln!(writer, "{}", serde_json::to_string(line)?)?;
    }
    writer.flush()?;
    eprintln!("wrote {} cases to {}", lines.len(), out_path);
    Ok(())
}
