//! T-49 golden generator: the set of lessons that are SOURCES OF NEW EXERCISES on scripted learner
//! states, as produced by the REAL Trane v0.34.1 `DepthFirstScheduler`.
//!
//! A source lesson is a lesson with no attempts at all (no exercise has a trial) at least one of
//! whose exercises shows up in some batch. Batches are drawn with `maxLessonsInProgress` 10000 and
//! batch size 50 (a freshly reopened `Trane` per batch, see `scheduler_common`), `BATCHES` per
//! run. The set is computed by TWO independent runs; the generator aborts if they disagree, so a
//! committed fixture is stable under a rerun at this batch count. Output:
//! `../../scheduler/golden/frontier.json` (or the first argument) and the `frontier.json` entry
//! of the neighbouring `MANIFEST.json`.
//!
//! Stderr diagnostics per case: the weakest source lesson (share of batches that reach it),
//! untouched lessons that are NOT sources, and the difference to the naive rule "every dependency
//! is passed" (see `naive_sources`).
//!
//! Usage: `cargo run --release --offline --bin scheduler_frontier_golden -- [out.json]`.

#[allow(dead_code)]
#[path = "../scheduler_common.rs"]
mod scheduler_common;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use anyhow::{Result, bail};
use scheduler_common::*;
use serde_json::json;

const BATCHES: usize = 1500;
const THREADS: usize = 16;
const BATCH_SIZE: usize = 50;
const MAX_LESSONS_IN_PROGRESS: usize = 10_000;
/// Seed of the deterministic part (random states built with `Rng`).
const SEED: u64 = 0x5EED_F407_2026_0929;
/// A source must be reached by at least this share of the batches, otherwise the batch count is
/// too small to call the set stable.
const MIN_REACH: f64 = 0.02;

struct Case {
    id: String,
    group: &'static str,
    what: String,
    state: State,
}

fn l(id: &str, exercises: usize) -> Lesson {
    Lesson::new(id, exercises)
}

fn case(id: &str, group: &'static str, what: &str, state: State) -> Case {
    Case { id: id.into(), group, what: what.into(), state }
}

const MASTERED: [(u8, i64); 2] = [(5, 3 * DAY_MS), (5, DAY_MS)];

/// Chain `0::0 -> 0::1 -> 0::2` with `n` exercises per lesson plus an independent starting lesson
/// `0::3`.
fn chain(n: usize) -> Vec<Course> {
    vec![Course::new(
        "0",
        vec![
            l("0::0", n),
            l("0::1", n).deps(&["0::0"]),
            l("0::2", n).deps(&["0::1"]),
            l("0::3", n),
        ],
    )]
}

/// A random library with attempts and blacklist (every number comes from the seeded `Rng`).
fn random_state(seed: u64) -> State {
    let mut rng = Rng(seed);
    let course_count = rng.range(3, 5) as usize;
    let mut courses: Vec<Course> = Vec::new();
    for c in 0..course_count {
        let lesson_count = rng.range(3, 6) as usize;
        let mut lessons: Vec<Lesson> = Vec::new();
        for i in 0..lesson_count {
            let exercises = if rng.below(12) == 0 { 0 } else { rng.range(2, 5) as usize };
            let mut lesson = Lesson::new(&format!("{c}::{i}"), exercises);
            let mut dependencies = BTreeSet::new();
            for j in 0..i {
                if dependencies.len() < 2 && rng.below(100) < 35 {
                    dependencies.insert(j);
                }
            }
            lesson.dependencies = dependencies.iter().map(|j| format!("{c}::{j}")).collect();
            if i > 0 && lesson.dependencies.is_empty() && rng.below(100) < 30 {
                lesson.superseded = vec![format!("{c}::{}", rng.below(i as u64))];
            }
            lessons.push(lesson);
        }
        let mut course = Course::new(&c.to_string(), lessons);
        for parent in 0..c {
            if course.dependencies.len() < 2 && rng.below(100) < 40 {
                course.dependencies.push(parent.to_string());
            }
        }
        courses.push(course);
    }

    let mut state = State::new(courses.clone());
    for course in &courses {
        for lesson in &course.lessons {
            if lesson.exercises == 0 || rng.below(100) >= 45 {
                continue;
            }
            let covered = if rng.below(100) < 60 {
                lesson.exercises
            } else {
                rng.range(1, lesson.exercises as u64) as usize
            };
            let rounds = rng.range(1, 2) as usize;
            let band = rng.below(10);
            for i in 0..covered {
                for round in 0..rounds {
                    let score = match band {
                        0..=6 => rng.range(4, 5),
                        7..=8 => rng.range(2, 3),
                        _ => rng.range(1, 5),
                    } as u8;
                    let ago =
                        (30 - 12 * round as i64) * DAY_MS - rng.range(0, 240) as i64 * HOUR_MS;
                    state = state.attempt(&format!("{}::{i}", lesson.id), score, ago);
                }
            }
        }
    }
    if rng.below(2) == 0 {
        let course = &courses[rng.below(course_count as u64) as usize];
        let lesson = &course.lessons[rng.below(course.lessons.len() as u64) as usize];
        state = state.blacklist(&[&lesson.id]);
    }
    if rng.below(4) == 0 {
        state = state.blacklist(&[&rng.below(course_count as u64).to_string()]);
    }
    state
}

fn cases() -> Vec<Case> {
    let mut cases = Vec::new();

    // --- untouched lessons: no attempts anywhere, the frontier is the starting lessons.
    cases.push(case(
        "fr-untouched-two-courses",
        "untouched-lesson",
        "nothing attempted: sources = starting lessons 0::0, 0::2, 1::0",
        State::new(vec![
            Course::new(
                "0",
                vec![
                    l("0::0", 4),
                    l("0::1", 4).deps(&["0::0"]),
                    l("0::2", 4),
                    l("0::3", 4).deps(&["0::1", "0::2"]),
                ],
            ),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]),
        ]),
    ));
    cases.push(case(
        "fr-untouched-course-chain",
        "untouched-lesson",
        "nothing attempted, course 1 depends on course 0: 1::0 (inherits the course dependency) closed",
        State::new(vec![
            Course::new("0", vec![l("0::0", 3)]),
            Course::new("1", vec![l("1::0", 3), l("1::1", 3).deps(&["1::0"])]).deps(&["0"]),
            Course::new("2", vec![l("2::0", 3)]),
        ]),
    ));
    cases.push(case(
        "fr-untouched-diamond",
        "untouched-lesson",
        "nothing attempted, diamond of 5 lessons and a second root",
        State::new(vec![Course::new(
            "0",
            vec![
                l("0::0", 5),
                l("0::1", 5).deps(&["0::0"]),
                l("0::2", 5).deps(&["0::0"]),
                l("0::3", 5).deps(&["0::1", "0::2"]),
                l("0::4", 5),
            ],
        )]),
    ));

    // --- dependency without attempts blocks.
    cases.push(case(
        "fr-dep-untouched-blocks",
        "untouched-dependency",
        "0::0 mastered; 0::1 untouched blocks 0::2; 0::3 waits for untouched starting lesson 0::4",
        State::new(vec![Course::new(
            "0",
            vec![
                l("0::0", 4),
                l("0::1", 4).deps(&["0::0"]),
                l("0::2", 4).deps(&["0::1"]),
                l("0::3", 4).deps(&["0::0", "0::4"]),
                l("0::4", 4),
            ],
        )])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-dep-untouched-second-course",
        "untouched-dependency",
        "course 0 mastered, course 1 untouched; course 2 needs both: closed",
        State::new(vec![
            Course::new("0", vec![l("0::0", 4)]),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]),
            Course::new("2", vec![l("2::0", 4)]).deps(&["0", "1"]),
        ])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-dep-partially-touched",
        "untouched-dependency",
        "0::0 has 2 of 4 exercises attempted (5,5): average over ALL exercises blocks 0::1",
        State::new(vec![Course::new(
            "0",
            vec![l("0::0", 4), l("0::1", 4).deps(&["0::0"]), l("0::2", 3)],
        )])
        .attempt_first("0::0", 2, &MASTERED),
    ));

    // --- empty lesson (avg = None passes the threshold).
    cases.push(case(
        "fr-empty-mid-chain",
        "empty-lesson",
        "0::0 mastered -> 0::1 (0 exercises) -> 0::2 untouched",
        State::new(vec![Course::new(
            "0",
            vec![l("0::0", 4), l("0::1", 0).deps(&["0::0"]), l("0::2", 4).deps(&["0::1"])],
        )])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-empty-start",
        "empty-lesson",
        "starting lesson 0::0 is empty; 0::1 and 0::2 behind it, second course untouched",
        State::new(vec![
            Course::new(
                "0",
                vec![l("0::0", 0), l("0::1", 4).deps(&["0::0"]), l("0::2", 4).deps(&["0::1"])],
            ),
            Course::new("1", vec![l("1::0", 4)]),
        ]),
    ));
    cases.push(case(
        "fr-empty-after-weak-lesson",
        "empty-lesson",
        "0::0 attempted once each (below threshold) -> empty 0::1 -> 0::2: blocked at 0::0",
        State::new(vec![Course::new(
            "0",
            vec![
                l("0::0", 4),
                l("0::1", 0).deps(&["0::0"]),
                l("0::2", 4).deps(&["0::1"]),
                l("0::3", 4),
            ],
        )])
        .attempt_lesson("0::0", &[(5, DAY_MS)]),
    ));
    cases.push(case(
        "fr-empty-course-only-lesson",
        "empty-lesson",
        "course 0 has a single empty lesson; course 1 depends on course 0",
        State::new(vec![
            Course::new("0", vec![l("0::0", 0)]),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]).deps(&["0"]),
        ]),
    ));
    cases.push(case(
        "fr-empty-course-without-lessons",
        "empty-lesson",
        "course 0 has no lessons; course 1 depends on course 0",
        State::new(vec![
            Course::new("0", vec![]),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]).deps(&["0"]),
        ]),
    ));

    // --- chains with attempts around the threshold (lesson score >= 3.0 and average trials >=
    // 1.8). Every chain also has an independent starting lesson 0::3, which is always a source.
    let threshold = |id: &str, what: &str, n: usize, prepare: &dyn Fn(State) -> State| {
        case(id, "chain", what, prepare(State::new(chain(n))))
    };
    cases.push(threshold(
        "fr-chain-score3-two-attempts",
        "0::0: score 3 twice, 3 and 1 days ago (lesson score 2.7 after forgetting): closed",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, 3 * DAY_MS), (3, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score3-two-attempts-just-now",
        "0::0: score 3 twice, 1 hour ago and at now (lesson score exactly 3.0): open",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, HOUR_MS), (3, 0)]),
    ));
    cases.push(threshold(
        "fr-chain-score3-two-attempts-hours-ago",
        "0::0: score 3 twice, 2 and 1 hours ago (lesson score about 2.98): closed",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, 2 * HOUR_MS), (3, HOUR_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score2-two-attempts",
        "0::0: score 2, two attempts on every exercise",
        3,
        &|s| s.attempt_lesson("0::0", &[(2, 3 * DAY_MS), (2, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score3-one-attempt",
        "0::0: score 3, ONE attempt per exercise (lesson score 3.0 at now, trials 1.0 < 1.8)",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, 0)]),
    ));
    cases.push(threshold(
        "fr-chain-score5-one-attempt",
        "0::0: score 5, ONE attempt per exercise (trials 1.0 < 1.8)",
        3,
        &|s| s.attempt_lesson("0::0", &[(5, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-two-attempts-on-one-of-three",
        "0::0: two attempts (5,5) on 1 of 3 exercises",
        3,
        &|s| s.attempt_first("0::0", 1, &MASTERED),
    ));
    cases.push(threshold(
        "fr-chain-two-attempts-on-two-of-three",
        "0::0: two attempts (5,5) on 2 of 3 exercises (avg trials 1.33)",
        3,
        &|s| s.attempt_first("0::0", 2, &MASTERED),
    ));
    cases.push(threshold(
        "fr-chain-avg-trials-exactly-1.8",
        "0::0 of 5 exercises: 2,2,2,2,1 attempts of score 5 (avg trials exactly 1.8)",
        5,
        &|s| s.attempt_lesson("0::0", &[(5, 3 * DAY_MS)]).attempt_first("0::0", 4, &[(5, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score3-old-attempts",
        "0::0: score 3 twice, 60 and 50 days ago (forgetting curve pulls the score below 3)",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, 60 * DAY_MS), (3, 50 * DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score4-old-attempts",
        "0::0: score 4 twice, 120 and 100 days ago (still passes)",
        3,
        &|s| s.attempt_lesson("0::0", &[(4, 120 * DAY_MS), (4, 100 * DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score3-then-4",
        "0::0: scores 3 then 4, 3 and 1 days ago (lesson score 3.33): open",
        3,
        &|s| s.attempt_lesson("0::0", &[(3, 3 * DAY_MS), (4, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score4-then-3",
        "0::0: scores 4 then 3, 3 and 1 days ago (lesson score 3.15): open",
        3,
        &|s| s.attempt_lesson("0::0", &[(4, 3 * DAY_MS), (3, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-score2-then-4",
        "0::0: scores 2 then 4, 3 and 1 days ago (lesson score 2.82): closed",
        3,
        &|s| s.attempt_lesson("0::0", &[(2, 3 * DAY_MS), (4, DAY_MS)]),
    ));
    cases.push(threshold(
        "fr-chain-second-lesson-weak",
        "0::0 mastered, 0::1 attempted once (below trials threshold): 0::2 closed, nothing new",
        3,
        &|s| s.attempt_lesson("0::0", &MASTERED).attempt_lesson("0::1", &[(5, DAY_MS)]),
    ));

    // --- course dependencies.
    cases.push(case(
        "fr-course-dep-passed",
        "course-deps",
        "course 0 mastered; both starting lessons of course 1 open, 1::1 waits for 1::0; course 2 after 1 closed",
        State::new(vec![
            Course::new("0", vec![l("0::0", 4)]),
            Course::new("1", vec![
                l("1::0", 4),
                l("1::1", 4).deps(&["1::0"]),
                l("1::2", 4),
            ])
            .deps(&["0"]),
            Course::new("2", vec![l("2::0", 4)]).deps(&["1"]),
        ])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-course-dep-not-passed",
        "course-deps",
        "course 0 attempted once (below threshold): course 1 closed, unrelated course 2 open",
        State::new(vec![
            Course::new("0", vec![l("0::0", 4)]),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]).deps(&["0"]),
            Course::new("2", vec![l("2::0", 4)]),
        ])
        .attempt_lesson("0::0", &[(5, DAY_MS)]),
    ));
    cases.push(case(
        "fr-course-dep-incomplete-course",
        "course-deps",
        "course 0: 0::0 mastered, 0::1 untouched, 0::2 behind it; course 1 depends on course 0",
        State::new(vec![
            Course::new(
                "0",
                vec![l("0::0", 4), l("0::1", 4).deps(&["0::0"]), l("0::2", 4).deps(&["0::1"])],
            ),
            Course::new("1", vec![l("1::0", 4)]).deps(&["0"]),
        ])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-course-dep-all-lessons-mastered",
        "course-deps",
        "course 0 (two lessons) fully mastered; course 1 opens; course 2 needs 0 and 1",
        State::new(vec![
            Course::new("0", vec![l("0::0", 3), l("0::1", 3).deps(&["0::0"])]),
            Course::new("1", vec![l("1::0", 3)]).deps(&["0"]),
            Course::new("2", vec![l("2::0", 3)]).deps(&["0", "1"]),
        ])
        .attempt_lesson("0::0", &MASTERED)
        .attempt_lesson("0::1", &MASTERED),
    ));
    cases.push(case(
        "fr-course-dep-two-parents",
        "course-deps",
        "course 2 depends on mastered course 0 and untouched course 1",
        State::new(vec![
            Course::new("0", vec![l("0::0", 3)]),
            Course::new("1", vec![l("1::0", 3)]),
            Course::new("2", vec![l("2::0", 3)]).deps(&["0", "1"]),
        ])
        .attempt_lesson("0::0", &MASTERED),
    ));
    cases.push(case(
        "fr-course-dep-on-lesson",
        "course-deps",
        "course 1 depends directly on lesson 0::0 (mastered) of course 0 whose 0::1 is untouched",
        State::new(vec![
            Course::new("0", vec![l("0::0", 3), l("0::1", 3).deps(&["0::0"])]),
            Course::new("1", vec![l("1::0", 3)]).deps(&["0::0"]),
        ])
        .attempt_lesson("0::0", &MASTERED),
    ));

    // --- blacklist (a blacklisted dependency counts as satisfied).
    cases.push(case(
        "fr-blacklist-lesson",
        "blacklist",
        "untouched 0::0 blacklisted: 0::1 opens, blacklisted 0::0 is not a source, 0::2 blocked by untouched 0::1",
        State::new(chain(4)).blacklist(&["0::0"]),
    ));
    cases.push(case(
        "fr-blacklist-course",
        "blacklist",
        "course 0 blacklisted: nothing of it; course 1 (depends on 0) opens",
        State::new(vec![
            Course::new("0", vec![l("0::0", 4), l("0::1", 4).deps(&["0::0"])]),
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]).deps(&["0"]),
            Course::new("2", vec![l("2::0", 4)]),
        ])
        .blacklist(&["0"]),
    ));
    cases.push(case(
        "fr-blacklist-mid-chain",
        "blacklist",
        "0::0 mastered, 0::1 blacklisted, 0::2 and 0::3 behind it",
        State::new(vec![Course::new(
            "0",
            vec![
                l("0::0", 4),
                l("0::1", 4).deps(&["0::0"]),
                l("0::2", 4).deps(&["0::1"]),
                l("0::3", 4).deps(&["0::2"]),
            ],
        )])
        .attempt_lesson("0::0", &MASTERED)
        .blacklist(&["0::1"]),
    ));
    cases.push(case(
        "fr-blacklist-exercises",
        "blacklist",
        "one exercise of 0::0 blacklisted (still a source), both exercises of 0::1 blacklisted (no candidates), 0::2 depends on 0::1",
        State::new(vec![Course::new("0", vec![
            l("0::0", 3),
            l("0::1", 2),
            l("0::2", 3).deps(&["0::1"]),
        ])])
        .blacklist(&["0::0::0", "0::1::0", "0::1::1"]),
    ));

    // --- superseded. Rust supersedes a unit only when EVERY valid exercise of it has been seen
    // and every superseding unit scores >= 4; then the unit is skipped and counts as satisfied.
    cases.push(case(
        "fr-superseded-lesson",
        "superseded",
        "0::0 (all exercises seen, weak) superseded by mastered 0::3: 0::1 opens, 0::2 behind untouched 0::1",
        State::new(vec![Course::new("0", vec![
            l("0::0", 4),
            l("0::1", 4).deps(&["0::0"]),
            l("0::2", 4).deps(&["0::1"]),
            l("0::3", 4).supersedes(&["0::0"]),
        ])])
        .attempt_lesson("0::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("0::3", &MASTERED),
    ));
    cases.push(case(
        "fr-superseded-lesson-unseen-exercises",
        "superseded",
        "untouched 0::0 'superseded' by mastered 0::3, but its exercises were never seen: no supersession, 0::0 stays a source, 0::1 closed",
        State::new(vec![Course::new("0", vec![
            l("0::0", 4),
            l("0::1", 4).deps(&["0::0"]),
            l("0::2", 4).deps(&["0::1"]),
            l("0::3", 4).supersedes(&["0::0"]),
        ])])
        .attempt_lesson("0::3", &MASTERED),
    ));
    cases.push(case(
        "fr-superseded-course",
        "superseded",
        "course 1 (one lesson, seen, weak) superseded by mastered course 2; course 3 depends on course 1 and opens",
        State::new(vec![
            Course::new("1", vec![l("1::0", 4)]),
            Course::new("2", vec![l("2::0", 4)]).supersedes(&["1"]),
            Course::new("3", vec![l("3::0", 4)]).deps(&["1"]),
        ])
        .attempt_lesson("1::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("2::0", &MASTERED),
    ));
    cases.push(case(
        "fr-superseded-course-blocked-lesson",
        "superseded",
        "course 1 superseded, but its lesson 1::1 is unreachable behind weak 1::0: the course is never completed, course 3 stays closed",
        State::new(vec![
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]),
            Course::new("2", vec![l("2::0", 4)]).supersedes(&["1"]),
            Course::new("3", vec![l("3::0", 4)]).deps(&["1"]),
        ])
        .attempt_lesson("1::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("1::1", &[(2, 2 * DAY_MS)])
        .attempt_lesson("2::0", &MASTERED),
    ));
    cases.push(case(
        "fr-superseded-course-unseen-exercises",
        "superseded",
        "course 1 untouched 'superseded' by mastered course 2: no supersession, 1::0 is a source, course 3 closed",
        State::new(vec![
            Course::new("1", vec![l("1::0", 4), l("1::1", 4).deps(&["1::0"])]),
            Course::new("2", vec![l("2::0", 4)]).supersedes(&["1"]),
            Course::new("3", vec![l("3::0", 4)]).deps(&["1"]),
        ])
        .attempt_lesson("2::0", &MASTERED),
    ));
    cases.push(case(
        "fr-superseded-not-mastered",
        "superseded",
        "0::0 seen, 0::3 supersedes it but only has a weak score (< 4): 0::0 not superseded, 0::1 closed",
        State::new(vec![Course::new("0", vec![
            l("0::0", 4),
            l("0::1", 4).deps(&["0::0"]),
            l("0::3", 4).supersedes(&["0::0"]),
            l("0::4", 4),
        ])])
        .attempt_lesson("0::0", &[(2, 2 * DAY_MS)])
        .attempt_lesson("0::3", &[(3, 3 * DAY_MS), (3, DAY_MS)]),
    ));
    cases.push(case(
        "fr-superseded-mid-chain",
        "superseded",
        "0::0 mastered, 0::1 (seen, weak) superseded by mastered 0::4: 0::2 opens, 0::3 behind it",
        State::new(vec![Course::new(
            "0",
            vec![
                l("0::0", 4),
                l("0::1", 4).deps(&["0::0"]),
                l("0::2", 4).deps(&["0::1"]),
                l("0::3", 4).deps(&["0::2"]),
                l("0::4", 4).supersedes(&["0::1"]),
            ],
        )])
        .attempt_lesson("0::0", &MASTERED)
        .attempt_lesson("0::1", &[(2, 2 * DAY_MS)])
        .attempt_lesson("0::4", &MASTERED),
    ));

    // --- random mixtures: offsets of `SEED` picked for a varied frontier (2-4 sources each).
    for offset in [3u64, 8, 10, 15] {
        let seed = SEED + offset;
        cases.push(Case {
            id: format!("fr-mixed-random-{offset}"),
            group: "mixed",
            what: format!(
                "seeded random library, attempts, blacklist and superseding (seed {seed:#X})"
            ),
            state: random_state(seed),
        });
    }

    cases
}

/// The naive rule the design started from: an untouched lesson is a source when every dependency
/// is "passed" (touched, mean over ALL exercises of the mean raw score >= 3 and average attempts
/// >= 1.8); dependencies of a starting lesson include the lessons of the course dependencies.
/// Blacklist, superseding and empty lessons are ignored on purpose: they are exactly what Rust
/// treats differently.
fn naive_sources(state: &State) -> BTreeSet<String> {
    let mut attempts = BTreeMap::<&str, Vec<u8>>::new();
    for a in &state.attempts {
        attempts.entry(&a.exercise_id).or_default().push(a.score);
    }
    let lessons: Vec<(&Course, &Lesson)> =
        state.courses.iter().flat_map(|c| c.lessons.iter().map(move |l| (c, l))).collect();
    let touched = |lesson: &Lesson| {
        (0..lesson.exercises).any(|i| attempts.contains_key(format!("{}::{i}", lesson.id).as_str()))
    };
    let passed = |lesson: &Lesson| {
        if lesson.exercises == 0 || !touched(lesson) {
            return false;
        }
        let n = lesson.exercises as f64;
        let mut score = 0.0;
        let mut trials = 0.0;
        for i in 0..lesson.exercises {
            if let Some(scores) = attempts.get(format!("{}::{i}", lesson.id).as_str()) {
                score += scores.iter().map(|s| f64::from(*s)).sum::<f64>() / scores.len() as f64;
                trials += scores.len() as f64;
            }
        }
        score / n >= 3.0 && trials / n >= 1.8
    };
    let course_passed = |course_id: &str| {
        state
            .courses
            .iter()
            .find(|c| c.id == course_id)
            .is_some_and(|c| !c.lessons.is_empty() && c.lessons.iter().all(&passed))
    };
    let mut result = BTreeSet::new();
    for (course, lesson) in &lessons {
        if touched(lesson) || lesson.exercises == 0 {
            continue;
        }
        let dependencies_ok = lesson
            .dependencies
            .iter()
            .all(|d| lessons.iter().find(|(_, l)| l.id == *d).is_some_and(|(_, l)| passed(l)));
        let is_starting = lesson.dependencies.is_empty();
        let course_ok = !is_starting || course.dependencies.iter().all(|d| course_passed(d));
        if dependencies_ok && course_ok {
            result.insert(lesson.id.clone());
        }
    }
    result
}

/// Untouched lessons (in library order) and the number of batches reaching each of them.
fn reach(state: &State, batches: &[Vec<String>]) -> BTreeMap<String, usize> {
    let touched: BTreeSet<&str> =
        state.attempts.iter().map(|a| lesson_of(&a.exercise_id)).collect();
    let mut reach = BTreeMap::<String, usize>::new();
    for course in &state.courses {
        for lesson in &course.lessons {
            if !touched.contains(lesson.id.as_str()) {
                reach.insert(lesson.id.clone(), 0);
            }
        }
    }
    for batch in batches {
        let lessons: BTreeSet<&str> = batch.iter().map(|e| lesson_of(e)).collect();
        for lesson in lessons {
            if let Some(count) = reach.get_mut(lesson) {
                *count += 1;
            }
        }
    }
    reach
}

fn sources_of(reach: &BTreeMap<String, usize>) -> BTreeSet<String> {
    reach.iter().filter(|(_, n)| **n > 0).map(|(k, _)| k.clone()).collect()
}

fn main() -> Result<()> {
    let out_path = output_path("frontier.json");
    let started = Instant::now();
    let opts = options(BATCH_SIZE, Some(MAX_LESSONS_IN_PROGRESS));
    let cases = cases();
    let mut ids = BTreeSet::new();
    let mut values = Vec::new();
    let mut groups = BTreeMap::<&str, usize>::new();

    for case in &cases {
        if !ids.insert(case.id.clone()) {
            bail!("duplicate case id {}", case.id);
        }
        *groups.entry(case.group).or_default() += 1;
        let t = Instant::now();
        let first = reach(&case.state, &run_batches(&case.state, &opts, BATCHES, THREADS)?);
        let second = reach(&case.state, &run_batches(&case.state, &opts, BATCHES, THREADS)?);
        let (sources, again) = (sources_of(&first), sources_of(&second));
        if sources != again {
            bail!(
                "case {}: sources differ between independent runs: {:?} vs {:?}",
                case.id,
                sources,
                again
            );
        }
        let weakest = sources
            .iter()
            .map(|s| (first[s].min(second[s]) as f64 / BATCHES as f64, s))
            .min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((share, lesson)) = weakest {
            if share < MIN_REACH {
                bail!(
                    "case {}: lesson {lesson} reached by only {:.3} of the batches",
                    case.id,
                    share
                );
            }
        }
        let unreached: Vec<&String> = first.keys().filter(|k| !sources.contains(*k)).collect();
        let naive = naive_sources(&case.state);
        let extra: Vec<&String> = sources.difference(&naive).collect();
        let missing: Vec<&String> = naive.difference(&sources).collect();
        eprintln!(
            "{:<38} {:<20} {:>3} ex  sources {:?}  weakest {}  not-sources {:?}  vs naive: +{:?} -{:?}  {:.1}s\n    # {}",
            case.id,
            case.group,
            case.state.total_exercises(),
            sources,
            weakest.map_or("-".into(), |(s, l)| format!("{l}={s:.3}")),
            unreached,
            extra,
            missing,
            t.elapsed().as_secs_f64(),
            case.what,
        );

        values.push(json!({
            "id": case.id,
            "group": case.group,
            "library": case.state.library_json(),
            "blacklist": case.state.blacklist,
            "attempts": case.state.attempts_json(),
            "nowMs": NOW_MS,
            "batches": BATCHES,
            "expect": { "sourceLessons": sources },
        }));
    }
    for (group, count) in &groups {
        if *count < 2 {
            bail!("group {group} has {count} case(s), at least 2 required");
        }
    }

    let document = json!({
        "trane": trane_json(),
        "nowMs": NOW_MS,
        "options": {"batchSize": BATCH_SIZE, "maxLessonsInProgress": MAX_LESSONS_IN_PROGRESS},
        "cases": values,
    });
    write_json(&out_path, &document)?;
    update_manifest(
        &out_path,
        json!({
            "bin": "scheduler_frontier_golden",
            "seed": format!("{SEED:#X}"),
            "seedScope": "random states of the `mixed` group only; batches use Trane's thread-local RNG and are not reproducible, the source sets are checked for stability across two independent runs",
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
