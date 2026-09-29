//! L4 golden generator of the scheduler: inclusion frequencies of exercises and lessons in a
//! batch on scripted learner states, drawn by the REAL Trane v0.34.1 `DepthFirstScheduler`.
//!
//! For each state `BATCHES` independent batches are drawn (a freshly reopened `Trane` per batch,
//! see `scheduler_common`) and the counters are aggregated:
//!   batchSizes[n]      number of batches of size n
//!   exerciseCounts[id] number of batches containing the exercise (once per batch)
//!   lessonCounts[id]   number of batches containing at least one exercise of the lesson
//! Only non-zero counters are written. Output: `../../scheduler/golden/l4.json` (or the first
//! argument) and the `l4.json` entry of the neighbouring `MANIFEST.json`.
//!
//! Usage: `cargo run --release --offline --bin scheduler_l4_golden -- [out.json]`.

#[allow(dead_code)]
#[path = "../scheduler_common.rs"]
mod scheduler_common;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use anyhow::{Result, bail};
use scheduler_common::*;
use serde_json::{Value, json};

const BATCHES: usize = 5000;
const THREADS: usize = 16;
/// Seed of the deterministic part (states built with `Rng`).
const SEED: u64 = 0x5EED_1400_2026_0929;

struct Case {
    id: &'static str,
    what: &'static str,
    state: State,
    batch_size: usize,
    max_lessons_in_progress: Option<usize>,
}

fn l(id: &str, exercises: usize) -> Lesson {
    Lesson::new(id, exercises)
}

fn cases() -> Vec<Case> {
    let mut rng = Rng(SEED);
    let mut cases = Vec::new();

    // (a) empty learner: the frontier is the set of starting lessons (80 new candidates).
    cases.push(Case {
        id: "l4-empty-b20",
        what: "empty learner; 4 starting lessons of 2 courses (80 new candidates), dependents closed",
        state: State::new(vec![
            Course::new("0", vec![
                l("0::0", 20),
                l("0::1", 10).deps(&["0::0"]),
                l("0::2", 20),
                l("0::3", 20),
            ]),
            Course::new("1", vec![l("1::0", 20), l("1::1", 8).deps(&["1::0"])]),
        ]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (b) middle of a chain: one attempt per exercise, the average trials (1.0 < 1.8) keep the
    // next lesson closed. Few candidates: the dynamic batch size (one third of them) applies.
    cases.push(Case {
        id: "l4-chain-below-threshold-b20",
        what: "chain 0::0 -> 0::1 -> 0::2, 0::0 has 1 attempt each (avg trials 1 < 1.8): 0::1 closed; dynamic batch size",
        state: State::new(vec![
            Course::new("0", vec![
                l("0::0", 12),
                l("0::1", 12).deps(&["0::0"]),
                l("0::2", 12).deps(&["0::1"]),
                l("0::3", 12),
            ]),
            Course::new("1", vec![l("1::0", 10), l("1::1", 10), l("1::2", 10)]),
        ])
        .attempt_lesson("0::0", &[(3, 2 * DAY_MS)])
        .attempt_first("0::3", 6, &[(2, 3 * DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (c) threshold passed: five twice on every exercise opens the dependent lesson.
    cases.push(Case {
        id: "l4-threshold-passed-b20",
        what: "0::0 mastered (5,5 on all): 0::1 open and new, 0::2 behind it closed",
        state: State::new(vec![
            Course::new(
                "0",
                vec![l("0::0", 15), l("0::1", 15).deps(&["0::0"]), l("0::2", 15).deps(&["0::1"])],
            ),
            Course::new("1", vec![l("1::0", 15), l("1::1", 15), l("1::2", 15), l("1::3", 15)]),
        ])
        .attempt_lesson("0::0", &[(5, 3 * DAY_MS), (5, DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (d) blacklist: a lesson, a course and a single exercise.
    cases.push(Case {
        id: "l4-blacklist-b20",
        what: "blacklisted lesson 0::1 (its dependent 0::2 opens), course 1, exercise 2::0::3",
        state: State::new(vec![
            Course::new(
                "0",
                vec![l("0::0", 15), l("0::1", 15).deps(&["0::0"]), l("0::2", 15).deps(&["0::1"])],
            ),
            Course::new("1", vec![l("1::0", 15), l("1::1", 15), l("1::2", 15).deps(&["1::0"])]),
            Course::new("2", vec![l("2::0", 15)]).deps(&["0"]),
            Course::new("3", vec![l("3::0", 15), l("3::1", 15)]),
        ])
        .blacklist(&["0::1", "1", "2::0::3"])
        .attempt_lesson("0::0", &[(4, 2 * DAY_MS), (4, DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (e) superseded lesson and course (the superseding unit is mastered).
    cases.push(Case {
        id: "l4-superseded-b20",
        what: "seen 0::0 superseded by mastered 0::2 (0::1 opens), seen course 1 superseded by mastered course 2",
        state: State::new(vec![
            Course::new("0", vec![
                l("0::0", 15),
                l("0::1", 15).deps(&["0::0"]),
                l("0::2", 15).supersedes(&["0::0"]),
            ]),
            Course::new("1", vec![l("1::0", 15), l("1::1", 15).deps(&["1::0"])]),
            Course::new("2", vec![l("2::0", 15)]).supersedes(&["1"]),
            Course::new("3", vec![l("3::0", 15), l("3::1", 15)]),
        ])
        .attempt_lesson("0::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("1::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("1::1", &[(2, 2 * DAY_MS)])
        .attempt_lesson("0::2", &[(5, 3 * DAY_MS), (5, DAY_MS)])
        .attempt_lesson("2::0", &[(5, 3 * DAY_MS), (5, DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (f) course dependencies.
    cases.push(Case {
        id: "l4-course-deps-b20",
        what: "course 1 depends on mastered course 0; course 2 on 0 and half-done 1 (closed)",
        state: State::new(vec![
            Course::new("0", vec![l("0::0", 18), l("0::1", 18).deps(&["0::0"])]),
            Course::new("1", vec![l("1::0", 18), l("1::1", 18).deps(&["1::0"]), l("1::2", 18)])
                .deps(&["0"]),
            Course::new("2", vec![l("2::0", 18), l("2::1", 18).deps(&["2::0"])]).deps(&["0", "1"]),
        ])
        .attempt_lesson("0::0", &[(5, 4 * DAY_MS), (5, 2 * DAY_MS)])
        .attempt_lesson("0::1", &[(5, 3 * DAY_MS), (5, DAY_MS)])
        .attempt_lesson("1::0", &[(3, 2 * DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (g) mixture of scores 1..5 (the relearn pile is empty: fresh Trane per batch).
    let mut mixed = State::new(vec![
        Course::new(
            "0",
            vec![
                l("0::0", 20),
                l("0::1", 20).deps(&["0::0"]),
                l("0::2", 20).deps(&["0::1"]),
                l("0::3", 20),
            ],
        ),
        Course::new("1", vec![l("1::0", 15), l("1::1", 15)]),
    ]);
    for i in 0..20u8 {
        let e = format!("0::0::{i}");
        mixed = mixed.attempt(&e, i % 5 + 1, 5 * DAY_MS).attempt(&e, (i + 2) % 5 + 1, 2 * DAY_MS);
    }
    for i in 0..14u8 {
        mixed = mixed.attempt(&format!("0::1::{i}"), (i * 3) % 5 + 1, DAY_MS);
    }
    for i in 0..20u8 {
        mixed = mixed.attempt(&format!("0::3::{i}"), (i + 3) % 5 + 1, 6 * HOUR_MS);
    }
    cases.push(Case {
        id: "l4-mixed-scores-b20",
        what: "scores 1..5 in every window, two/one attempts, mixed ages",
        state: mixed,
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    // (h) diamond of dependencies, batch sizes 20 and 50.
    cases.push(Case {
        id: "l4-diamond-b20",
        what: "diamond 0::0 -> {0::1,0::2} -> 0::3 (one attempt: closed) -> {0::4,0::5} -> 0::6",
        state: State::new(vec![
            Course::new(
                "0",
                vec![
                    l("0::0", 12),
                    l("0::1", 12).deps(&["0::0"]),
                    l("0::2", 12).deps(&["0::0"]),
                    l("0::3", 12).deps(&["0::1", "0::2"]),
                    l("0::4", 12).deps(&["0::3"]),
                    l("0::5", 12).deps(&["0::3"]),
                    l("0::6", 12).deps(&["0::4", "0::5"]),
                ],
            ),
            Course::new("1", vec![l("1::0", 12), l("1::1", 12)]),
        ])
        .attempt_lesson("0::0", &[(4, 3 * DAY_MS), (4, DAY_MS)])
        .attempt_lesson("0::1", &[(4, 2 * DAY_MS), (4, DAY_MS)])
        .attempt_lesson("0::2", &[(3, 2 * DAY_MS), (3, DAY_MS)])
        .attempt_lesson("0::3", &[(2, DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });
    cases.push(Case {
        id: "l4-diamond-b50",
        what: "diamond with 0::0-0::3 done, 0::4/0::5 open, 0::6 closed; 6 more starting lessons; 162 candidates",
        state: State::new(vec![
            Course::new("0", vec![
                l("0::0", 12),
                l("0::1", 12).deps(&["0::0"]),
                l("0::2", 12).deps(&["0::0"]),
                l("0::3", 12).deps(&["0::1", "0::2"]),
                l("0::4", 12).deps(&["0::3"]),
                l("0::5", 12).deps(&["0::3"]),
                l("0::6", 12).deps(&["0::4", "0::5"]),
            ]),
            Course::new("1", (0..6).map(|i| l(&format!("1::{i}"), 15)).collect()),
        ])
        .attempt_lesson("0::0", &[(5, 3 * DAY_MS), (5, DAY_MS)])
        .attempt_lesson("0::1", &[(4, 3 * DAY_MS), (5, DAY_MS)])
        .attempt_lesson("0::2", &[(5, 3 * DAY_MS), (4, DAY_MS)])
        .attempt_lesson("0::3", &[(4, 2 * DAY_MS), (4, DAY_MS)]),
        batch_size: 50,
        max_lessons_in_progress: None,
    });

    // Large branching library at batch size 50 (190 exercises), seeded random attempts.
    let mut tree = State::new(vec![
        Course::new(
            "0",
            vec![
                l("0::0", 12),
                l("0::1", 12).deps(&["0::0"]),
                l("0::2", 12).deps(&["0::0"]),
                l("0::3", 12).deps(&["0::1"]),
                l("0::4", 12).deps(&["0::1"]),
                l("0::5", 12).deps(&["0::2"]),
                l("0::6", 12).deps(&["0::3", "0::4"]),
                l("0::7", 12).deps(&["0::5"]),
                l("0::8", 12).deps(&["0::6", "0::7"]),
                l("0::9", 12).deps(&["0::8"]),
            ],
        ),
        Course::new(
            "1",
            vec![
                l("1::0", 10),
                l("1::1", 10).deps(&["1::0"]),
                l("1::2", 10).deps(&["1::1"]),
                l("1::3", 10),
                l("1::4", 10).deps(&["1::3"]),
                l("1::5", 10),
            ],
        ),
        Course::new("2", vec![l("2::0", 10)]).deps(&["0"]),
    ]);
    for lesson in [
        "0::0", "0::1", "0::2", "0::3", "0::4", "0::5", "0::6", "0::7", "1::0", "1::1", "1::3",
        "1::4",
    ] {
        let count = tree.exercises_in(lesson);
        for i in 0..count {
            let e = format!("{lesson}::{i}");
            for round in 0..2i64 {
                let score = rng.range(3, 5) as u8;
                tree = tree.attempt(
                    &e,
                    score,
                    (8 - 3 * round) * DAY_MS - rng.range(0, 40) as i64 * HOUR_MS,
                );
            }
        }
    }
    cases.push(Case {
        id: "l4-large-tree-b50",
        what: "190 exercises, branching lesson tree, seeded random scores 3-5 (two attempts) on 12 lessons",
        state: tree,
        batch_size: 50,
        max_lessons_in_progress: None,
    });

    // maxLessonsInProgress override.
    cases.push(Case {
        id: "l4-max-lessons-in-progress-b20",
        what: "8 untouched starting lessons of 24, maxLessonsInProgress 3: 3 lessons per batch",
        state: State::new(vec![Course::new(
            "0",
            (0..8).map(|i| l(&format!("0::{i}"), 24)).collect(),
        )]),
        batch_size: 20,
        max_lessons_in_progress: Some(3),
    });

    // Old versus fresh attempts.
    cases.push(Case {
        id: "l4-recency-b20",
        what: "old good (60-90 days), fresh great, single 20-day-old attempts",
        state: State::new(vec![
            Course::new("0", vec![l("0::0", 15), l("0::1", 15).deps(&["0::0"]), l("0::2", 15)]),
            Course::new("1", vec![l("1::0", 15), l("1::1", 15)]),
        ])
        .attempt_lesson("0::0", &[(4, 90 * DAY_MS), (4, 60 * DAY_MS)])
        .attempt_lesson("0::1", &[(5, 2 * DAY_MS), (5, DAY_MS)])
        .attempt_lesson("0::2", &[(3, 20 * DAY_MS)]),
        batch_size: 20,
        max_lessons_in_progress: None,
    });

    cases
}

fn run_case(case: &Case) -> Result<(Value, usize, usize, usize)> {
    let opts = options(case.batch_size, case.max_lessons_in_progress);
    let batches = run_batches(&case.state, &opts, BATCHES, THREADS)?;

    let mut sizes = BTreeMap::<usize, usize>::new();
    let mut exercises = BTreeMap::<String, usize>::new();
    let mut lessons = BTreeMap::<String, usize>::new();
    for batch in &batches {
        *sizes.entry(batch.len()).or_default() += 1;
        let unique: BTreeSet<&String> = batch.iter().collect();
        if unique.len() != batch.len() {
            bail!("duplicate exercise in a batch of case {}", case.id);
        }
        let mut in_batch = BTreeSet::new();
        for e in unique {
            *exercises.entry(e.clone()).or_default() += 1;
            in_batch.insert(lesson_of(e).to_string());
        }
        for lesson in in_batch {
            *lessons.entry(lesson).or_default() += 1;
        }
    }

    let partial = |counts: &BTreeMap<String, usize>| {
        counts.values().filter(|c| **c > 0 && **c < BATCHES).count()
    };
    let (partial_exercises, partial_lessons) = (partial(&exercises), partial(&lessons));
    let test_range = exercises
        .values()
        .filter(|c| (**c as f64 / BATCHES as f64) > 0.01 && (**c as f64 / BATCHES as f64) < 0.99)
        .count();
    if partial_exercises == 0 {
        bail!("case {} has no exercise with 0 < p < 1", case.id);
    }

    let sizes_json: BTreeMap<String, usize> =
        sizes.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    let mut options_json = json!({"batchSize": case.batch_size});
    if let Some(max) = case.max_lessons_in_progress {
        options_json["maxLessonsInProgress"] = json!(max);
    }
    let value = json!({
        "id": case.id,
        "library": case.state.library_json(),
        "blacklist": case.state.blacklist,
        "options": options_json,
        "attempts": case.state.attempts_json(),
        "batches": BATCHES,
        "expect": {
            "batchSizes": sizes_json,
            "exerciseCounts": exercises,
            "lessonCounts": lessons,
        },
    });
    Ok((value, partial_exercises, partial_lessons, test_range))
}

fn main() -> Result<()> {
    let out_path = output_path("l4.json");
    let started = Instant::now();
    let cases = cases();
    let mut values = Vec::new();
    for case in &cases {
        let t = Instant::now();
        let (value, partial_exercises, partial_lessons, in_test_range) = run_case(case)?;
        eprintln!(
            "{:<34} {:>4} ex  p in (0,1): {:>3} ex, {:>2} lessons; p in (0.01,0.99): {:>3} ex; {:.1}s  # {}",
            case.id,
            case.state.total_exercises(),
            partial_exercises,
            partial_lessons,
            in_test_range,
            t.elapsed().as_secs_f64(),
            case.what,
        );
        values.push(value);
    }

    let document = json!({"trane": trane_json(), "nowMs": NOW_MS, "cases": values});
    write_json(&out_path, &document)?;
    update_manifest(
        &out_path,
        json!({
            "bin": "scheduler_l4_golden",
            "seed": format!("{SEED:#X}"),
            "seedScope": "scripted states only; batches use Trane's thread-local RNG and are not reproducible",
            "cases": cases.len(),
            "batchesPerCase": BATCHES,
        }),
    )?;
    eprintln!(
        "{} cases in {:.1}s -> {}",
        cases.len(),
        started.elapsed().as_secs_f64(),
        out_path.display()
    );
    Ok(())
}
