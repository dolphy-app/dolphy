//! Golden-case generator for the TypeScript port of Trane's `PowerLawScorer`.
//!
//! Calls the REAL `trane::exercise_scorer::PowerLawScorer` (Trane v0.34.1) on pseudo-random and
//! targeted inputs produced by a fixed-seed PRNG, and writes one JSON object per line.
//!
//! Wire format (one case per line, keys sorted by serde_json):
//!   { "id": u32, "kind": str, "type": "Declarative"|"Procedural",
//!     "trials": [{"score": f, "timestamp": i64 seconds}], "deltas": [{"delta": f, "timestamp": i64}],
//!     "now": i64 seconds,
//!     "expect": {"ok":true,"value":f,"urgency":f,"velocity":f|null} | {"ok":false,"error":str} }
//! Float encoding: inputs are the shortest decimal text of the f32 (so `3.7` stays `3.7`); outputs
//! are the exact f32 value widened to f64. Non-finite floats are encoded as the strings "NaN",
//! "Infinity", "-Infinity" (JSON has no encoding for them).
//!
//! Usage: `cargo run --release -- [out.jsonl]` (default `../powerlaw.jsonl`).

use std::io::Write;
use std::panic::{AssertUnwindSafe, catch_unwind};

use serde_json::{Value, json};
use trane::data::{ExerciseDelta, ExerciseTrial, ExerciseType};
use trane::exercise_scorer::{ExerciseScorer, PowerLawScorer};

const SEED: u64 = 0x5EED_7A4E_2026_0929;
const DAY: i64 = 86_400;
/// Fixed reference epoch (seconds) around which all timelines are built (2023-11-14).
const BASE: i64 = 1_700_000_000;

// ---------------------------------------------------------------------------------------------
// Tiny seeded PRNG (splitmix64). Deliberately not `rand`: the sequence must never change.
// ---------------------------------------------------------------------------------------------
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform integer in `0..n`.
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
    /// Uniform integer in `lo..=hi`.
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as u64) as i64
    }
    /// Uniform float in `[0, 1)` with 53 bits.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len() as u64) as usize]
    }
}

// ---------------------------------------------------------------------------------------------
// Case model
// ---------------------------------------------------------------------------------------------
struct Case {
    kind: &'static str,
    ty: ExerciseType,
    trials: Vec<(f32, i64)>,
    deltas: Vec<(f32, i64)>,
    now: i64,
}

fn type_name(t: &ExerciseType) -> &'static str {
    match t {
        ExerciseType::Declarative => "Declarative",
        ExerciseType::Procedural => "Procedural",
    }
}

fn rand_type(rng: &mut Rng) -> ExerciseType {
    if rng.chance(0.5) { ExerciseType::Declarative } else { ExerciseType::Procedural }
}

/// A gap between consecutive trials in seconds: a mix of same-second, seconds, minutes, hours,
/// days, fractional days, multi-month and very long gaps.
fn gap(rng: &mut Rng) -> i64 {
    match rng.below(100) {
        0..=9 => 0,
        10..=22 => rng.range(1, 59),
        23..=36 => 60 * rng.range(1, 59) + rng.range(0, 59),
        37..=46 => 3600 * rng.range(1, 23) + 60 * rng.range(0, 59),
        47..=74 => DAY * rng.range(1, 30),
        75..=84 => DAY * rng.range(30, 150) + rng.range(0, DAY - 1),
        85..=91 => DAY * rng.range(1, 3) + rng.range(0, DAY - 1),
        _ => DAY * rng.range(150, 550),
    }
}

/// Score generators. Most scores are integers 1..=5 (what Trane's UI produces); some are
/// two-decimal floats.
#[derive(Clone, Copy)]
enum Profile {
    Uniform,
    Good,
    Bad,
    Mixed,
    Constant(f32),
}

fn rand_profile(rng: &mut Rng) -> Profile {
    match rng.below(6) {
        0 => Profile::Uniform,
        1 => Profile::Good,
        2 => Profile::Bad,
        3 => Profile::Mixed,
        4 => Profile::Constant(rng.pick(&[1.0, 2.0, 3.0, 4.0, 5.0])),
        _ => Profile::Uniform,
    }
}

fn float_score(rng: &mut Rng, lo: f64, hi: f64) -> f32 {
    (((lo + rng.unit() * (hi - lo)) * 100.0).round() / 100.0) as f32
}

fn score(rng: &mut Rng, p: Profile) -> f32 {
    if let Profile::Constant(c) = p {
        return c;
    }
    if rng.chance(0.10) {
        // A float score.
        return match p {
            Profile::Good => float_score(rng, 3.5, 5.0),
            Profile::Bad => float_score(rng, 1.0, 2.5),
            _ => float_score(rng, 1.0, 5.0),
        };
    }
    match p {
        Profile::Uniform | Profile::Mixed => rng.range(1, 5) as f32,
        Profile::Good => rng.pick(&[4.0, 5.0, 5.0, 4.0, 3.0]),
        Profile::Bad => rng.pick(&[1.0, 2.0, 1.0, 2.0, 3.0]),
        Profile::Constant(_) => unreachable!(),
    }
}

/// Trials sorted descending by timestamp, starting at `newest`.
fn make_trials(rng: &mut Rng, n: usize, newest: i64, p: Profile, gap_fn: fn(&mut Rng) -> i64) -> Vec<(f32, i64)> {
    let mut ts = newest;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        if i > 0 {
            ts -= gap_fn(rng);
        }
        out.push((score(rng, p), ts));
    }
    out
}

fn make_deltas(rng: &mut Rng, n: usize, newest: i64) -> Vec<(f32, i64)> {
    let mut ts = newest - rng.range(0, 3 * DAY);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        if i > 0 {
            ts -= gap(rng);
        }
        let d = if rng.chance(0.3) {
            rng.pick(&[-2.0f32, -1.0, -0.5, 0.5, 1.0, 2.0])
        } else {
            float_score(rng, -3.0, 3.0)
        };
        out.push((d, ts));
    }
    out
}

fn now_after(rng: &mut Rng, newest: i64) -> i64 {
    match rng.below(100) {
        0..=3 => newest,
        4..=10 => newest + rng.range(1, 3600),
        11..=20 => newest + DAY * rng.range(0, 3) + rng.range(0, DAY - 1),
        21..=96 => newest + rng.range(0, 400 * DAY),
        _ => newest - rng.range(1, 400 * DAY), // now earlier than the newest trial
    }
}

fn newest_ts(rng: &mut Rng) -> i64 {
    BASE + rng.range(0, 100_000_000)
}

// ---------------------------------------------------------------------------------------------
// Generators per category
// ---------------------------------------------------------------------------------------------
fn gen_random(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for _ in 0..count {
        let n = if rng.chance(0.03) { 0 } else if rng.chance(0.5) { rng.range(1, 6) } else { rng.range(1, 25) } as usize;
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let trials = make_trials(rng, n, newest, p, gap);
        let dn = if rng.chance(0.4) { rng.range(0, 1) } else { rng.range(0, 12) } as usize;
        let mut deltas = make_deltas(rng, dn, newest);
        if deltas.len() >= 2 && rng.chance(0.05) {
            // Unsorted deltas are not an error in Trane; capture what it does.
            let i = rng.below(deltas.len() as u64) as usize;
            let j = rng.below(deltas.len() as u64) as usize;
            let (a, b) = (deltas[i].1, deltas[j].1);
            deltas[i].1 = b;
            deltas[j].1 = a;
        }
        let now = now_after(rng, newest);
        out.push(Case { kind: "random", ty: rand_type(rng), trials, deltas, now });
    }
}

/// Old-good floor: >=2 trials, weighted score >= 4.0, >= 50 days since the newest trial.
fn gen_old_good_floor(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(2, 12) as usize;
        let newest = newest_ts(rng);
        let mut trials = Vec::new();
        let mut ts = newest;
        for k in 0..n {
            if k > 0 {
                ts -= if rng.chance(0.5) { DAY * rng.range(1, 20) } else { gap(rng) };
            }
            let s = if rng.chance(0.15) { float_score(rng, 3.8, 5.0) } else { rng.pick(&[4.0, 5.0, 5.0, 4.0]) };
            trials.push((s, ts));
        }
        let elapsed = if i % 6 == 0 {
            // Boundary values around the 50-day threshold.
            rng.pick(&[50 * DAY - 1, 50 * DAY, 50 * DAY + 1, 49 * DAY, 51 * DAY])
        } else {
            rng.range(40 * DAY, 420 * DAY)
        };
        let dn = rng.range(0, 6) as usize;
        let deltas = if rng.chance(0.3) { make_deltas(rng, dn, newest) } else { vec![] };
        out.push(Case { kind: "old_good_floor", ty: rand_type(rng), trials, deltas, now: newest + elapsed });
    }
}

/// Delta term: >=2 deltas with mixed signs, recent `now` so retrievability stays high.
fn gen_delta_term(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for _ in 0..count {
        let n = rng.range(1, 10) as usize;
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let trials = make_trials(rng, n, newest, p, gap);
        let dn = rng.range(2, 12) as usize;
        let deltas = make_deltas(rng, dn, newest);
        let now = newest + rng.range(0, 30 * DAY);
        out.push(Case { kind: "delta_term", ty: rand_type(rng), trials, deltas, now });
    }
}

/// Mean reversion of difficulty: long histories with runs of failures/successes.
fn gen_mean_reversion(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(15, 25) as usize;
        let newest = newest_ts(rng);
        let mut ts = newest;
        let mut trials = Vec::new();
        // `runs`: chunks of constant score with occasional alternation.
        let mut cur = rng.range(1, 5) as f32;
        for k in 0..n {
            if k > 0 {
                ts -= match i % 3 {
                    0 => DAY * rng.range(1, 10),
                    1 => gap(rng),
                    _ => DAY * rng.range(1, 60),
                };
            }
            match i % 4 {
                0 => {
                    if rng.chance(0.25) { cur = rng.range(1, 5) as f32; }
                }
                1 => cur = if k % 2 == 0 { 1.0 } else { 5.0 },
                2 => cur = if k < n / 2 { 5.0 } else { 1.0 }, // newest half is bad (descending order)
                _ => cur = if k < n / 2 { 1.0 } else { 5.0 },
            }
            trials.push((cur, ts));
        }
        let now = now_after(rng, newest);
        out.push(Case { kind: "mean_reversion", ty: rand_type(rng), trials, deltas: vec![], now });
    }
}

fn gen_no_history(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let dn = rng.range(1, 6) as usize;
        let deltas = if i % 2 == 0 { vec![] } else { make_deltas(rng, dn, BASE) };
        let now = if i % 5 == 0 { 0 } else { BASE + rng.range(0, 400 * DAY) };
        out.push(Case { kind: "no_history", ty: rand_type(rng), trials: vec![], deltas, now });
    }
}

fn gen_small(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = if i % 2 == 0 { 1 } else { 2 };
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let trials = make_trials(rng, n, newest, p, gap);
        let now = now_after(rng, newest);
        out.push(Case { kind: if n == 1 { "single_trial" } else { "two_trials" }, ty: rand_type(rng), trials, deltas: vec![], now });
    }
}

fn gen_same_second_and_dense(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(2, 25) as usize;
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let (kind, trials): (&'static str, Vec<(f32, i64)>) = match i % 3 {
            0 => ("same_second", (0..n).map(|_| (score(rng, p), newest)).collect()),
            1 => ("dense_minutes", make_trials(rng, n, newest, p, |r| r.range(0, 600))),
            _ => ("one_second_apart", make_trials(rng, n, newest, p, |_| 1)),
        };
        let now = now_after(rng, newest);
        out.push(Case { kind, ty: rand_type(rng), trials, deltas: vec![], now });
    }
}

fn gen_errors(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(2, 8) as usize;
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let mut trials = make_trials(rng, n, newest, p, |r| DAY * r.range(1, 20) + r.range(0, 500));
        let kind;
        match i % 3 {
            0 => {
                // Fully ascending order.
                trials.reverse();
                kind = "error_ascending";
            }
            1 => {
                // One adjacent inversion somewhere in the middle (timestamps swapped).
                let k = rng.below((n - 1) as u64) as usize;
                let (a, b) = (trials[k].1, trials[k + 1].1);
                trials[k].1 = b;
                trials[k + 1].1 = a;
                kind = "error_one_swap";
            }
            _ => {
                // Off-by-one second: newest is one second older than the second-newest.
                trials[0].1 = trials[1].1 - 1;
                kind = "error_off_by_one_second";
            }
        }
        let now = now_after(rng, newest);
        out.push(Case { kind, ty: rand_type(rng), trials, deltas: vec![], now });
    }
    // Duplicate timestamps in sorted order are legal.
    for _ in 0..count / 3 {
        let n = rng.range(2, 10) as usize;
        let newest = newest_ts(rng);
        let mut trials = make_trials(rng, n, newest, Profile::Uniform, gap);
        for k in 1..n {
            if rng.chance(0.5) {
                trials[k].1 = trials[k - 1].1;
            }
        }
        // Restore descending order after copying (later trials must not exceed earlier ones).
        for k in 1..n {
            if trials[k].1 > trials[k - 1].1 {
                trials[k].1 = trials[k - 1].1;
            }
        }
        let now = now_after(rng, newest);
        out.push(Case { kind: "duplicate_timestamps", ty: rand_type(rng), trials, deltas: vec![], now });
    }
}

/// Constant score / exact thresholds at the old-good floor and weighted-score boundary.
fn gen_boundaries(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(2, 8) as usize;
        let newest = newest_ts(rng);
        let c = rng.pick(&[4.0f32, 4.0, 3.0, 5.0, 2.5, 3.75, 3.9999998, 4.0000005]);
        let mut ts = newest;
        let mut trials = Vec::new();
        for k in 0..n {
            if k > 0 {
                ts -= DAY * rng.range(1, 15);
            }
            trials.push((c, ts));
        }
        let elapsed = rng.pick(&[50 * DAY - 1, 50 * DAY, 50 * DAY + 1, 49 * DAY, 200 * DAY, 0]);
        let mut ty = rand_type(rng);
        if i % 2 == 0 { ty = ExerciseType::Declarative; }
        out.push(Case { kind: "threshold_boundary", ty, trials, deltas: vec![], now: newest + elapsed });
    }
}

fn gen_now_before(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for _ in 0..count {
        let n = rng.range(1, 10) as usize;
        let newest = newest_ts(rng);
        let p = rand_profile(rng);
        let trials = make_trials(rng, n, newest, p, gap);
        let now = newest - rng.range(1, 400 * DAY);
        let dn = rng.range(0, 5) as usize;
        let deltas = make_deltas(rng, dn, newest);
        out.push(Case { kind: "now_before_newest", ty: rand_type(rng), trials, deltas, now });
    }
}

fn gen_odd_scores(rng: &mut Rng, out: &mut Vec<Case>, count: usize) {
    for i in 0..count {
        let n = rng.range(1, 6) as usize;
        let newest = newest_ts(rng);
        let mut trials = make_trials(rng, n, newest, Profile::Uniform, gap);
        let k = rng.below(n as u64) as usize;
        let (kind, bad) = match i % 4 {
            0 => ("nan_score", f32::NAN),
            1 => ("out_of_range_score", rng.pick(&[0.0f32, -2.0, 7.5, 100.0])),
            2 => ("infinite_score", f32::INFINITY),
            _ => ("out_of_range_score", rng.pick(&[0.5f32, 5.5, 1.0e-8])),
        };
        trials[k].0 = bad;
        let now = now_after(rng, newest);
        out.push(Case { kind, ty: rand_type(rng), trials, deltas: vec![], now });
    }
}

/// Mirrors the robustness tests in `exercise_scorer.rs` plus a few more extreme timestamps.
fn gen_extreme(rng: &mut Rng, out: &mut Vec<Case>) {
    let now = BASE + 123_456;
    let t = |score: f32, ts: i64| (score, ts);
    let mut push = |kind: &'static str, ty: ExerciseType, trials: Vec<(f32, i64)>, now: i64| {
        out.push(Case { kind, ty, trials, deltas: vec![], now });
    };
    // invalid_timestamp: 1e10 days ago.
    push("extreme_1e10_days", ExerciseType::Declarative, vec![t(5.0, now - (1e10 as i64) * DAY)], now);
    push("extreme_1e10_days", ExerciseType::Procedural, vec![t(5.0, now - (1e10 as i64) * DAY)], now);
    // extreme_timestamp_gap_does_not_overflow: i64::MAX and i64::MIN.
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(5.0, i64::MAX), t(1.0, i64::MIN)], now);
    push("extreme_i64_gap", ExerciseType::Procedural, vec![t(5.0, i64::MAX), t(1.0, i64::MIN)], now);
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(3.0, i64::MAX), t(4.0, i64::MAX), t(1.0, i64::MIN)], i64::MIN);
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(5.0, i64::MAX)], i64::MIN);
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(5.0, i64::MIN)], i64::MAX);
    push("extreme_i64_gap", ExerciseType::Procedural, vec![t(5.0, i64::MAX)], i64::MAX);
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(4.0, i64::MAX), t(5.0, 0), t(2.0, i64::MIN)], 0);
    push("extreme_i64_gap", ExerciseType::Declarative, vec![t(4.0, 1), t(5.0, 0), t(2.0, -1)], 0);
    // Epoch zero and negative timestamps.
    push("extreme_epoch_zero", ExerciseType::Declarative, vec![t(4.0, 0), t(4.0, -DAY)], 0);
    push("extreme_epoch_zero", ExerciseType::Procedural, vec![t(5.0, 0)], BASE);
    push("extreme_negative_ts", ExerciseType::Declarative, vec![t(5.0, -1_000_000_000), t(4.0, -2_000_000_000)], now);
    // Very long spans with many trials (stability clamp to MAX_STABILITY).
    for ty in [ExerciseType::Declarative, ExerciseType::Procedural] {
        let mut ts = now - DAY;
        let mut trials = Vec::new();
        for _ in 0..25 {
            trials.push((5.0, ts));
            ts -= DAY * rng.range(200, 800);
        }
        push("extreme_long_span", ty, trials, now);
    }
    // 25 perfect scores, 1 day apart, then long silence.
    for ty in [ExerciseType::Declarative, ExerciseType::Procedural] {
        let trials: Vec<_> = (0..25).map(|k| (5.0, now - k * DAY)).collect();
        push("extreme_max_stability", ty.clone(), trials.clone(), now + 700 * DAY);
        push("extreme_max_stability", ty, trials, now + 3650 * DAY);
    }
}

// ---------------------------------------------------------------------------------------------
// Encoding and evaluation
// ---------------------------------------------------------------------------------------------
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
    if x.is_finite() { fnum(format!("{x}").parse::<f64>().unwrap()) } else { fnum(x as f64) }
}

/// Output encoding: exact f32 value widened to f64.
fn f32_out(x: f32) -> Value {
    fnum(x as f64)
}

fn evaluate(c: &Case) -> Value {
    let trials: Vec<ExerciseTrial> = c
        .trials
        .iter()
        .map(|(s, t)| ExerciseTrial { score: *s, timestamp: *t, ..Default::default() })
        .collect();
    let deltas: Vec<ExerciseDelta> = c
        .deltas
        .iter()
        .map(|(d, t)| ExerciseDelta { delta: *d, timestamp: *t, ..Default::default() })
        .collect();
    let scorer = PowerLawScorer {};
    let res = catch_unwind(AssertUnwindSafe(|| scorer.score(c.ty.clone(), &trials, &deltas, c.now)));
    match res {
        Ok(Ok(s)) => json!({
            "ok": true,
            "value": f32_out(s.value),
            "urgency": f32_out(s.urgency),
            "velocity": s.velocity.map(f32_out),
        }),
        Ok(Err(e)) => json!({ "ok": false, "error": e.to_string() }),
        Err(_) => json!({ "ok": false, "error": "PANIC" }),
    }
}

fn main() -> anyhow::Result<()> {
    let out_path = std::env::args().nth(1).unwrap_or_else(|| "../powerlaw.jsonl".into());
    let mut rng = Rng(SEED);
    let mut cases: Vec<Case> = Vec::new();

    gen_extreme(&mut rng, &mut cases);
    gen_no_history(&mut rng, &mut cases, 40);
    gen_small(&mut rng, &mut cases, 300);
    gen_same_second_and_dense(&mut rng, &mut cases, 180);
    gen_errors(&mut rng, &mut cases, 90);
    gen_boundaries(&mut rng, &mut cases, 200);
    gen_now_before(&mut rng, &mut cases, 120);
    gen_odd_scores(&mut rng, &mut cases, 40);
    gen_old_good_floor(&mut rng, &mut cases, 500);
    gen_delta_term(&mut rng, &mut cases, 400);
    gen_mean_reversion(&mut rng, &mut cases, 400);
    gen_random(&mut rng, &mut cases, 3600);

    let mut w = std::io::BufWriter::new(std::fs::File::create(&out_path)?);
    let mut n_err = 0usize;
    for (id, c) in cases.iter().enumerate() {
        let expect = evaluate(c);
        if expect["ok"] == Value::Bool(false) {
            n_err += 1;
        }
        let line = json!({
            "id": id,
            "kind": c.kind,
            "type": type_name(&c.ty),
            "trials": c.trials.iter().map(|(s, t)| json!({"score": f32_in(*s), "timestamp": t})).collect::<Vec<_>>(),
            "deltas": c.deltas.iter().map(|(d, t)| json!({"delta": f32_in(*d), "timestamp": t})).collect::<Vec<_>>(),
            "now": c.now,
            "expect": expect,
        });
        writeln!(w, "{}", serde_json::to_string(&line)?)?;
    }
    w.flush()?;
    eprintln!("wrote {} cases ({} errors) to {}", cases.len(), n_err, out_path);
    Ok(())
}
